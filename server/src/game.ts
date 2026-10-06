import { randomUUID } from 'node:crypto';
import {
  PlayerRole,
  RoomPlayerInfo,
  RoomSnapshot,
  TaskEventData,
  Theme,
  TileType,
} from './protocol.js';

/* ---------- 与前端 src/utils/gameLogic.ts 保持一致的规则 ---------- */

const TILES_COUNT = 49;
const FINAL_STEP = 48;

export function generateBoardMap(): TileType[] {
  const boardMap: TileType[] = new Array(TILES_COUNT).fill('blank');
  const available: number[] = [];
  for (let i = 1; i < TILES_COUNT - 1; i++) available.push(i);
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  for (let i = 0; i < 16; i++) boardMap[available[i]] = 'lucky';
  for (let i = 16; i < 32; i++) boardMap[available[i]] = 'trap';
  return boardMap;
}

/** 超出终点则反弹，与前端 calculateNewPosition 一致 */
export function calculateNewPosition(current: number, steps: number): number {
  let target = current + steps;
  if (target >= FINAL_STEP) {
    target = FINAL_STEP - (target - FINAL_STEP);
  }
  return target;
}

function pickTask(theme: Theme | null): string {
  if (!theme || theme.tasks.length === 0) return '';
  return theme.tasks[Math.floor(Math.random() * theme.tasks.length)];
}

const PLAYER_COLORS: Record<PlayerRole, string> = {
  male: '#0A84FF',
  female: '#FF375F',
};

const DEFAULT_NAMES: Record<PlayerRole, string> = {
  male: '男方',
  female: '女方',
};

/* ---------------- 房间 ---------------- */

export interface ServerPlayer extends RoomPlayerInfo {
  token: string;
}

export interface Room {
  code: string;
  players: [ServerPlayer | null, ServerPlayer | null];
  phase: 'lobby' | 'playing' | 'finished';
  turn: 0 | 1;
  boardMap: TileType[];
  pendingEvent: TaskEventData | null;
  winner: 0 | 1 | null;
  createdAt: number;
  lastActivity: number;
}

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function createRoom(name: string, role: PlayerRole): { room: Room; slot: 0 | 1; token: string } {
  const slot: 0 | 1 = role === 'male' ? 0 : 1;
  const token = randomUUID();
  const player: ServerPlayer = {
    slot,
    name: name.trim() || DEFAULT_NAMES[role],
    color: PLAYER_COLORS[role],
    role,
    step: 0,
    theme: null,
    connected: true,
    isHost: true,
    token,
  };
  const players: [ServerPlayer | null, ServerPlayer | null] = [null, null];
  players[slot] = player;
  const now = Date.now();
  const room: Room = {
    code: makeRoomCode(),
    players,
    phase: 'lobby',
    turn: 0,
    boardMap: generateBoardMap(),
    pendingEvent: null,
    winner: null,
    createdAt: now,
    lastActivity: now,
  };
  return { room, slot, token };
}

export function addPlayerToRoom(room: Room, name: string): { slot: 0 | 1; token: string } | { error: string } {
  const freeSlot = (room.players[0] ? 1 : 0) as 0 | 1;
  if (room.players[0] && room.players[1]) {
    return { error: '房间已满' };
  }
  if (room.phase !== 'lobby') {
    return { error: '游戏已经开始，无法加入' };
  }
  const role: PlayerRole = freeSlot === 0 ? 'male' : 'female';
  const token = randomUUID();
  room.players[freeSlot] = {
    slot: freeSlot,
    name: name.trim() || DEFAULT_NAMES[role],
    color: PLAYER_COLORS[role],
    role,
    step: 0,
    theme: null,
    connected: true,
    isHost: false,
    token,
  };
  room.lastActivity = Date.now();
  return { slot: freeSlot, token };
}

export function snapshotOf(room: Room): RoomSnapshot {
  const toInfo = (p: ServerPlayer | null): RoomPlayerInfo | null =>
    p
      ? {
          slot: p.slot,
          name: p.name,
          color: p.color,
          role: p.role,
          step: p.step,
          theme: p.theme,
          connected: p.connected,
          isHost: p.isHost,
        }
      : null;
  return {
    code: room.code,
    phase: room.phase,
    players: [toInfo(room.players[0]), toInfo(room.players[1])],
    turn: room.turn,
    boardMap: [...room.boardMap],
    pendingEvent: room.pendingEvent ? { ...room.pendingEvent } : null,
    winner: room.winner,
  };
}

/* ---------------- 回合结算（服务端权威） ---------------- */

export interface TurnResult {
  player: 0 | 1;
  dice: number;
  fromStep: number;
  toStep: number;
  event: TaskEventData | 'win' | null;
  nextTurn: 0 | 1;
}

/** 掷骰并结算一整回合：移动 -> 判定事件。与前端 useGameState.checkTile 规则一致 */
export function applyRoll(room: Room, slot: 0 | 1): TurnResult | { error: string } {
  if (room.phase !== 'playing') return { error: '游戏尚未开始' };
  if (room.turn !== slot) return { error: '还没轮到你' };
  if (room.pendingEvent) return { error: '请先处理当前任务卡' };

  const me = room.players[slot];
  const opp = room.players[slot === 0 ? 1 : 0];
  if (!me || !opp) return { error: '对手尚未加入' };

  const dice = Math.floor(Math.random() * 6) + 1;
  const fromStep = me.step;
  const toStep = calculateNewPosition(fromStep, dice);
  me.step = toStep;

  let event: TaskEventData | 'win' | null = null;
  const nextTurn = (slot === 0 ? 1 : 0) as 0 | 1;

  if (toStep === FINAL_STEP) {
    event = 'win';
    room.phase = 'finished';
    room.winner = slot;
  } else if (toStep !== 0 && toStep === opp.step) {
    // 亲密追尾：由对手执行发起方的主题任务
    const theme = me.theme;
    event = {
      type: 'collision',
      initiatorPlayerId: slot,
      executorPlayerId: opp.slot,
      title: '亲密追尾',
      subtitle: `任务来自「${theme?.name || ''}」`,
      icon: 'handshake',
      color: 'text-yellow-400',
      task: pickTask(theme),
      taskSourceId: theme?.id || '',
    };
    room.pendingEvent = event;
  } else {
    const tile = room.boardMap[toStep];
    if (tile === 'lucky') {
      const theme = me.theme;
      event = {
        type: 'lucky',
        initiatorPlayerId: slot,
        executorPlayerId: opp.slot,
        title: '幸运时刻',
        subtitle: `任务来自「${theme?.name || ''}」`,
        icon: 'favorite',
        color: 'text-[#FF375F]',
        task: pickTask(theme),
        taskSourceId: theme?.id || '',
      };
      room.pendingEvent = event;
    } else if (tile === 'trap') {
      const theme = opp.theme;
      event = {
        type: 'trap',
        initiatorPlayerId: slot,
        executorPlayerId: slot,
        title: '意外陷阱',
        subtitle: `任务来自「${theme?.name || ''}」`,
        icon: 'lock',
        color: 'text-[#BF5AF2]',
        task: pickTask(theme),
        taskSourceId: theme?.id || '',
      };
      room.pendingEvent = event;
    } else {
      room.turn = nextTurn;
    }
  }

  room.lastActivity = Date.now();
  return { player: slot, dice, fromStep, toStep, event, nextTurn };
}

export interface ResolveResult {
  executor: 0 | 1;
  accepted: boolean;
  steps: [number, number];
  nextTurn: 0 | 1;
}

/** 结算任务卡：接受 -> 直接过；拒绝 -> 按原规则惩罚（追尾回起点，其余倒退1~3格） */
export function applyResolve(room: Room, slot: 0 | 1, accept: boolean): ResolveResult | { error: string } {
  const event = room.pendingEvent;
  if (!event) return { error: '当前没有待处理的任务' };
  if (event.executorPlayerId !== slot) return { error: '这张任务卡不由你执行' };

  const executor = room.players[slot];
  if (!executor) return { error: '玩家不存在' };

  if (!accept) {
    if (event.type === 'collision') {
      executor.step = 0;
    } else {
      const backSteps = Math.floor(Math.random() * 3) + 1;
      executor.step = Math.max(0, executor.step - backSteps);
    }
  }

  room.pendingEvent = null;
  const nextTurn = (room.turn === 0 ? 1 : 0) as 0 | 1;
  room.turn = nextTurn;
  room.lastActivity = Date.now();

  return {
    executor: slot,
    accepted: accept,
    steps: [room.players[0]?.step ?? 0, room.players[1]?.step ?? 0],
    nextTurn,
  };
}

/** 再来一局：保留主题，重置棋盘与回合 */
export function applyRematch(room: Room): void {
  for (const p of room.players) {
    if (p) p.step = 0;
  }
  room.boardMap = generateBoardMap();
  room.pendingEvent = null;
  room.winner = null;
  room.turn = Math.random() < 0.5 ? 0 : 1;
  room.phase = 'playing';
  room.lastActivity = Date.now();
}

/** 房主开始游戏：双方都已选主题且任务不为空 */
export function canStart(room: Room): string | null {
  if (room.phase !== 'lobby') return '游戏已经开始';
  const [p0, p1] = room.players;
  if (!p0 || !p1) return '等待对方加入房间';
  if (!p0.connected || !p1.connected) return '等待对方连接';
  for (const p of [p0, p1]) {
    if (!p.theme) return `等待${p.name}选择主题`;
    if (p.theme.tasks.length === 0) return `「${p.theme.name}」还没有任务，请先添加`;
  }
  return null;
}

export function startGame(room: Room): void {
  room.phase = 'playing';
  room.turn = Math.random() < 0.5 ? 0 : 1;
  room.lastActivity = Date.now();
}
