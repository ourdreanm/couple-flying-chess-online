import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientMsg,
  PlayerRole,
  RoomSnapshot,
  ServerMsg,
  TaskEventData,
  Theme,
  getServerUrl,
} from '../net/protocol';
import { loadFromStorage, saveToStorage, removeFromStorage } from '../utils/localStorage';

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface TurnResultEvent {
  player: 0 | 1;
  dice: number;
  fromStep: number;
  toStep: number;
  event: TaskEventData | 'win' | null;
  nextTurn: 0 | 1;
}

export interface TaskResolvedEvent {
  executor: 0 | 1;
  accepted: boolean;
  steps: [number, number];
  nextTurn: 0 | 1;
}

interface SavedSession {
  code: string;
  token: string;
}

const SESSION_KEY = 'couples-ludo-online-session';

export function useOnlineGame() {
  const [status, setStatus] = useState<ConnStatus>('idle');
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [mySlot, setMySlot] = useState<0 | 1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnResult, setTurnResult] = useState<TurnResultEvent | null>(null);
  const [taskResolved, setTaskResolved] = useState<TaskResolvedEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<ConnStatus>('idle');
  const sessionRef = useRef<SavedSession | null>(loadFromStorage<SavedSession | null>(SESSION_KEY, null));
  const intentionalCloseRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectTriesRef = useRef(0);

  const setStatusBoth = useCallback((s: ConnStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const scheduleReconnect = useCallback(() => {
    const session = sessionRef.current;
    if (!session || intentionalCloseRef.current) return;
    if (reconnectTriesRef.current >= 8) {
      setStatusBoth('failed');
      setError('连接已断开，请检查网络后重试');
      return;
    }
    setStatusBoth('reconnecting');
    const delay = Math.min(1000 * 2 ** reconnectTriesRef.current, 15000);
    reconnectTriesRef.current += 1;
    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(() => {
      connectWithSession(session);
    }, delay);
  }, [clearReconnectTimer, setStatusBoth]);

  const connectWithSession = useCallback(
    (session: SavedSession | null, helloMsg?: ClientMsg) => {
      clearReconnectTimer();
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      setStatusBoth(session ? 'reconnecting' : 'connecting');
      setError(null);

      const ws = new WebSocket(getServerUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectTriesRef.current = 0;
        setStatusBoth('connected');
        if (session) {
          ws.send(JSON.stringify({ t: 'reconnect', code: session.code, token: session.token } satisfies ClientMsg));
        } else if (helloMsg) {
          ws.send(JSON.stringify(helloMsg));
        }
      };

      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data as string) as ServerMsg;
        } catch {
          return;
        }
        switch (msg.t) {
          case 'hello':
            setMySlot(msg.slot);
            sessionRef.current = { code: sessionRef.current?.code || '', token: msg.token };
            // code 会在 snapshot 到达时补全；先暂存 token
            break;
          case 'snapshot':
            setRoom(msg.room);
            if (sessionRef.current) {
              sessionRef.current = { code: msg.room.code, token: sessionRef.current.token };
              saveToStorage(SESSION_KEY, sessionRef.current);
            }
            break;
          case 'turn_result':
            setTurnResult({
              player: msg.player,
              dice: msg.dice,
              fromStep: msg.fromStep,
              toStep: msg.toStep,
              event: msg.event,
              nextTurn: msg.nextTurn,
            });
            break;
          case 'task_resolved':
            setTaskResolved({
              executor: msg.executor,
              accepted: msg.accepted,
              steps: msg.steps,
              nextTurn: msg.nextTurn,
            });
            break;
          case 'game_over':
            // 胜负由 turn_result(event='win') 驱动动画；此处仅兜底同步快照
            break;
          case 'error':
            setError(msg.message);
            break;
          case 'pong':
            break;
        }
      };

      ws.onclose = () => {
        if (intentionalCloseRef.current) {
          setStatusBoth('idle');
          return;
        }
        // 意外断开：有会话则自动重连
        if (sessionRef.current) {
          scheduleReconnect();
        } else {
          setStatusBoth('idle');
        }
      };

      ws.onerror = () => {
        // 错误后会触发 onclose，统一走重连逻辑
      };
    },
    [clearReconnectTimer, scheduleReconnect, setStatusBoth],
  );

  // 心跳
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (statusRef.current === 'connected') {
        send({ t: 'ping' });
      }
    }, 25000);
    return () => window.clearInterval(timer);
  }, [send]);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      intentionalCloseRef.current = true;
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [clearReconnectTimer]);

  const createRoom = useCallback(
    (name: string, role: PlayerRole) => {
      intentionalCloseRef.current = false;
      sessionRef.current = null;
      removeFromStorage(SESSION_KEY);
      setRoom(null);
      setMySlot(null);
      setTurnResult(null);
      setTaskResolved(null);
      connectWithSession(null, { t: 'create', name, role });
    },
    [connectWithSession],
  );

  const joinRoom = useCallback(
    (code: string, name: string) => {
      intentionalCloseRef.current = false;
      sessionRef.current = null;
      removeFromStorage(SESSION_KEY);
      setRoom(null);
      setMySlot(null);
      setTurnResult(null);
      setTaskResolved(null);
      connectWithSession(null, { t: 'join', code: code.trim().toUpperCase(), name });
    },
    [connectWithSession],
  );

  /** 手动重连（断线重连按钮用） */
  const reconnectNow = useCallback(() => {
    const session = sessionRef.current || loadFromStorage<SavedSession | null>(SESSION_KEY, null);
    if (!session) {
      setError('没有可恢复的房间会话');
      return;
    }
    intentionalCloseRef.current = false;
    reconnectTriesRef.current = 0;
    sessionRef.current = session;
    connectWithSession(session);
  }, [connectWithSession]);

  const setTheme = useCallback(
    (theme: Theme) => {
      send({ t: 'set_theme', theme });
    },
    [send],
  );

  const start = useCallback(() => send({ t: 'start' }), [send]);
  const roll = useCallback(() => send({ t: 'roll' }), [send]);

  const resolveTask = useCallback(
    (accept: boolean) => send({ t: 'resolve', accept }),
    [send],
  );

  const rematch = useCallback(() => {
    setTurnResult(null);
    setTaskResolved(null);
    send({ t: 'rematch' });
  }, [send]);

  const leave = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    send({ t: 'leave' });
    sessionRef.current = null;
    removeFromStorage(SESSION_KEY);
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    setRoom(null);
    setMySlot(null);
    setTurnResult(null);
    setTaskResolved(null);
    setError(null);
    setStatusBoth('idle');
  }, [clearReconnectTimer, send, setStatusBoth]);

  const clearError = useCallback(() => setError(null), []);
  const consumeTurnResult = useCallback(() => setTurnResult(null), []);
  const consumeTaskResolved = useCallback(() => setTaskResolved(null), []);

  const hasSavedSession = !!loadFromStorage<SavedSession | null>(SESSION_KEY, null);

  return {
    status,
    room,
    mySlot,
    error,
    turnResult,
    taskResolved,
    hasSavedSession,
    createRoom,
    joinRoom,
    reconnectNow,
    setTheme,
    start,
    roll,
    resolveTask,
    rematch,
    leave,
    clearError,
    consumeTurnResult,
    consumeTaskResolved,
  };
}

export type OnlineGameApi = ReturnType<typeof useOnlineGame>;
