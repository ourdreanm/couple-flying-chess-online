/**
 * 联机协议：客户端 <-> 游戏服务器 的消息定义。
 * 前端 `src/net/protocol.ts` 与此文件保持一致（字段名/类型一一对应）。
 */

export type TileType = 'blank' | 'lucky' | 'trap';
export type PlayerRole = 'male' | 'female';
export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface Theme {
  id: string;
  name: string;
  desc: string;
  audience: 'common' | 'male' | 'female';
  tasks: string[];
}

export interface TaskEventData {
  type: 'collision' | 'lucky' | 'trap';
  initiatorPlayerId: number;
  executorPlayerId: number;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  task: string;
  taskSourceId: string;
}

export interface RoomPlayerInfo {
  slot: 0 | 1;
  name: string;
  color: string;
  role: PlayerRole;
  step: number;
  theme: Theme | null;
  connected: boolean;
  isHost: boolean;
}

/** 房间完整快照：用于初次同步 / 重连恢复 / 状态变更广播 */
export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  players: [RoomPlayerInfo | null, RoomPlayerInfo | null];
  turn: 0 | 1;
  boardMap: TileType[];
  pendingEvent: TaskEventData | null;
  winner: 0 | 1 | null;
}

/* ---------------- 客户端 -> 服务器 ---------------- */

export type ClientMsg =
  | { t: 'create'; name: string; role: PlayerRole }
  | { t: 'join'; code: string; name: string }
  | { t: 'reconnect'; code: string; token: string }
  | { t: 'set_theme'; theme: Theme }
  | { t: 'start' }
  | { t: 'roll' }
  | { t: 'resolve'; accept: boolean }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping' };

/* ---------------- 服务器 -> 客户端 ---------------- */

export type ServerMsg =
  | { t: 'hello'; slot: 0 | 1; token: string }
  | { t: 'snapshot'; room: RoomSnapshot }
  | {
      t: 'turn_result';
      player: 0 | 1;
      dice: number;
      fromStep: number;
      toStep: number;
      event: TaskEventData | 'win' | null;
      nextTurn: 0 | 1;
    }
  | {
      t: 'task_resolved';
      executor: 0 | 1;
      accepted: boolean;
      steps: [number, number];
      nextTurn: 0 | 1;
    }
  | { t: 'game_over'; winner: 0 | 1 }
  | { t: 'error'; message: string }
  | { t: 'pong' };
