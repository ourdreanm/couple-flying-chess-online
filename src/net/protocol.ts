/**
 * 联机协议（前端侧）：与 server/src/protocol.ts 保持一致。
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

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  players: [RoomPlayerInfo | null, RoomPlayerInfo | null];
  turn: 0 | 1;
  boardMap: TileType[];
  pendingEvent: TaskEventData | null;
  winner: 0 | 1 | null;
}

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

/** 游戏服务器地址：构建时通过 VITE_GAME_SERVER_URL 注入，默认为本地开发地址 */
export function getServerUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const fromEnv = env?.VITE_GAME_SERVER_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return `wss://${window.location.host}/ws`;
  }
  return 'ws://localhost:3001';
}
