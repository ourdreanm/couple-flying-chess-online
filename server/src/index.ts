import { WebSocketServer, WebSocket } from 'ws';
import {
  addPlayerToRoom,
  applyRematch,
  applyResolve,
  applyRoll,
  canStart,
  createRoom,
  Room,
  ServerPlayer,
  snapshotOf,
  startGame,
} from './game.js';
import { ClientMsg, ServerMsg, Theme } from './protocol.js';

const PORT = Number(process.env.PORT || 3001);

const rooms = new Map<string, Room>();

interface ConnState {
  ws: WebSocket;
  code: string | null;
  slot: 0 | 1 | null;
}

const conns = new Set<ConnState>();

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room: Room, msg: ServerMsg): void {
  for (const c of conns) {
    if (c.code === room.code && c.slot !== null && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(JSON.stringify(msg));
    }
  }
}

function sendError(ws: WebSocket, message: string): void {
  send(ws, { t: 'error', message });
}

function getRoom(code: string): Room | undefined {
  return rooms.get(code.trim().toUpperCase());
}

function sanitizeTheme(input: unknown): Theme | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  const tasks = Array.isArray(r.tasks)
    ? r.tasks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 500)
    : [];
  const audience = r.audience === 'male' || r.audience === 'female' ? r.audience : 'common';
  return {
    id: r.id.slice(0, 64),
    name: r.name.slice(0, 40),
    desc: typeof r.desc === 'string' ? r.desc.slice(0, 200) : '',
    audience,
    tasks,
  };
}

function handleMessage(state: ConnState, raw: string): void {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw) as ClientMsg;
  } catch {
    return;
  }
  const ws = state.ws;

  switch (msg.t) {
    case 'ping': {
      send(ws, { t: 'pong' });
      break;
    }

    case 'create': {
      const role = msg.role === 'female' ? 'female' : 'male';
      let created = createRoom(msg.name || '', role);
      // 极小概率房号冲突则重建
      while (rooms.has(created.room.code)) {
        created = createRoom(msg.name || '', role);
      }
      const { room, slot, token } = created;
      rooms.set(room.code, room);
      state.code = room.code;
      state.slot = slot;
      send(ws, { t: 'hello', slot, token });
      send(ws, { t: 'snapshot', room: snapshotOf(room) });
      console.log(`[room ${room.code}] created by slot ${slot}`);
      break;
    }

    case 'join': {
      const room = getRoom(msg.code || '');
      if (!room) {
        sendError(ws, '房间不存在，请检查房号');
        break;
      }
      const res = addPlayerToRoom(room, msg.name || '');
      if ('error' in res) {
        sendError(ws, res.error);
        break;
      }
      state.code = room.code;
      state.slot = res.slot;
      send(ws, { t: 'hello', slot: res.slot, token: res.token });
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
      console.log(`[room ${room.code}] slot ${res.slot} joined`);
      break;
    }

    case 'reconnect': {
      const room = getRoom(msg.code || '');
      const player = room?.players.find(
        (p): p is ServerPlayer => !!p && p.token === msg.token,
      );
      if (!room || !player) {
        sendError(ws, '重连失败，房间已失效');
        break;
      }
      player.connected = true;
      state.code = room.code;
      state.slot = player.slot;
      send(ws, { t: 'hello', slot: player.slot, token: player.token });
      send(ws, { t: 'snapshot', room: snapshotOf(room) });
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
      console.log(`[room ${room.code}] slot ${player.slot} reconnected`);
      break;
    }

    case 'set_theme': {
      const room = state.code ? rooms.get(state.code) : undefined;
      const player = room && state.slot !== null ? room.players[state.slot] : null;
      if (!room || !player) {
        sendError(ws, '请先创建或加入房间');
        break;
      }
      if (room.phase !== 'lobby') {
        sendError(ws, '游戏已开始，无法更换主题');
        break;
      }
      const theme = sanitizeTheme(msg.theme);
      if (!theme || theme.tasks.length === 0) {
        sendError(ws, '主题无效或没有任何任务');
        break;
      }
      player.theme = theme;
      room.lastActivity = Date.now();
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
      break;
    }

    case 'start': {
      const room = state.code ? rooms.get(state.code) : undefined;
      const player = room && state.slot !== null ? room.players[state.slot] : null;
      if (!room || !player) {
        sendError(ws, '请先创建或加入房间');
        break;
      }
      if (!player.isHost) {
        sendError(ws, '只有房主可以开始游戏');
        break;
      }
      const blocker = canStart(room);
      if (blocker) {
        sendError(ws, blocker);
        break;
      }
      startGame(room);
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
      console.log(`[room ${room.code}] game started, turn=${room.turn}`);
      break;
    }

    case 'roll': {
      const room = state.code ? rooms.get(state.code) : undefined;
      if (!room || state.slot === null) {
        sendError(ws, '请先创建或加入房间');
        break;
      }
      const res = applyRoll(room, state.slot);
      if ('error' in res) {
        sendError(ws, res.error);
        break;
      }
      broadcast(room, {
        t: 'turn_result',
        player: res.player,
        dice: res.dice,
        fromStep: res.fromStep,
        toStep: res.toStep,
        event: res.event,
        nextTurn: res.nextTurn,
      });
      // 同步一次快照，保证断线重连者也能拿到最新位置
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
      if (res.event === 'win') {
        broadcast(room, { t: 'game_over', winner: res.player });
      }
      break;
    }

    case 'resolve': {
      const room = state.code ? rooms.get(state.code) : undefined;
      if (!room || state.slot === null) {
        sendError(ws, '请先创建或加入房间');
        break;
      }
      const res = applyResolve(room, state.slot, msg.accept);
      if ('error' in res) {
        sendError(ws, res.error);
        break;
      }
      broadcast(room, {
        t: 'task_resolved',
        executor: res.executor,
        accepted: res.accepted,
        steps: res.steps,
        nextTurn: res.nextTurn,
      });
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
      break;
    }

    case 'rematch': {
      const room = state.code ? rooms.get(state.code) : undefined;
      if (!room) {
        sendError(ws, '请先创建或加入房间');
        break;
      }
      if (room.phase !== 'finished') {
        sendError(ws, '当前不在结算阶段');
        break;
      }
      applyRematch(room);
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
      console.log(`[room ${room.code}] rematch started`);
      break;
    }

    case 'leave': {
      handleLeave(state);
      break;
    }
  }
}

function handleLeave(state: ConnState): void {
  const room = state.code ? rooms.get(state.code) : undefined;
  if (room && state.slot !== null) {
    const player = room.players[state.slot];
    if (player) {
      if (room.phase === 'lobby') {
        // 大厅阶段离开：直接腾出位置
        room.players[state.slot] = null;
        console.log(`[room ${room.code}] slot ${state.slot} left lobby`);
      } else {
        // 对局中离开：标记断开，保留位置以便重连
        player.connected = false;
        console.log(`[room ${room.code}] slot ${state.slot} disconnected mid-game`);
      }
      room.lastActivity = Date.now();
      broadcast(room, { t: 'snapshot', room: snapshotOf(room) });
    }
    if (!room.players[0] && !room.players[1]) {
      rooms.delete(room.code);
      console.log(`[room ${room.code}] deleted (empty)`);
    }
  }
  state.code = null;
  state.slot = null;
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws: WebSocket) => {
  const state: ConnState = { ws, code: null, slot: null };
  conns.add(state);

  ws.on('message', (data) => handleMessage(state, data.toString()));
  ws.on('close', () => {
    handleLeave(state);
    conns.delete(state);
  });
  ws.on('error', () => {
    // 连接异常按断开处理
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
});

/* ---------- 定时清理：长时间无人的房间 ---------- */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyoneConnected = room.players.some((p) => p?.connected);
    const idleTooLong = !anyoneConnected && now - room.lastActivity > IDLE_TIMEOUT_MS;
    const tooOld = now - room.createdAt > MAX_AGE_MS;
    if (idleTooLong || tooOld) {
      for (const c of conns) {
        if (c.code === code) {
          send(c.ws, { t: 'error', message: '房间已过期，请重新创建' });
          try {
            c.ws.close();
          } catch {
            /* ignore */
          }
        }
      }
      rooms.delete(code);
      console.log(`[room ${code}] swept`);
    }
  }
}, SWEEP_INTERVAL_MS);

console.log(`🎲 联机飞行棋服务器已启动，监听端口 ${PORT}`);
