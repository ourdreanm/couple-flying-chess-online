import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, User, UserRound, WifiOff, Loader2 } from 'lucide-react';
import { OnlineGameApi, TurnResultEvent } from '../../hooks/useOnlineGame';
import { Player, TaskEventData } from '../../types';
import { GameBoard } from '../GameBoard';
import { Dice } from '../Dice';
import { TaskCardModal } from '../modals/TaskCardModal';
import { WinModal } from '../modals/WinModal';
import { generateSpiralPath, calculateNewPosition } from '../../utils/gameLogic';

interface OnlineGameViewProps {
  api: OnlineGameApi;
  onExit: () => void;
}

const STEP_ANIM_MS = 220;

export function OnlineGameView({ api, onExit }: OnlineGameViewProps) {
  const { room, mySlot } = api;
  const pathCoords = useMemo(() => generateSpiralPath(), []);

  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [isRollingDice, setIsRollingDice] = useState(false);
  const [anim, setAnim] = useState<TurnResultEvent | null>(null);
  const [displaySteps, setDisplaySteps] = useState<[number, number] | null>(null);
  const [activeTask, setActiveTask] = useState<TaskEventData | null>(null);
  const [resolving, setResolving] = useState(false);
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [overrideTurn, setOverrideTurn] = useState<0 | 1 | null>(null);

  const animRef = useRef<TurnResultEvent | null>(null);
  animRef.current = anim;
  const queueRef = useRef<TurnResultEvent[]>([]);

  /* ---------- 新对局 / 再来一局时重置本地动画状态 ---------- */
  useEffect(() => {
    if (room?.phase === 'playing' && room.winner === null) {
      queueRef.current = [];
      setWinner(null);
      setActiveTask(null);
      setOverrideTurn(null);
      setDisplaySteps(null);
      setDiceResult(null);
      setIsRollingDice(false);
      setResolving(false);
      setAnim(null);
    }
    if (room?.phase === 'lobby') {
      queueRef.current = [];
      setWinner(null);
      setActiveTask(null);
      setAnim(null);
    }
  }, [room?.phase, room?.winner, room?.code]);

  /* ---------- 收到服务端回合事件：入队 ---------- */
  const { turnResult } = api;
  useEffect(() => {
    if (!turnResult || !room) return;
    api.consumeTurnResult();
    queueRef.current.push(turnResult);
  }, [api, turnResult, room]);

  /* ---------- 从队列取事件播放骰子动画 ---------- */
  useEffect(() => {
    if (anim || queueRef.current.length === 0 || !room) return;
    const tr = queueRef.current.shift() as TurnResultEvent;
    setAnim(tr);
    setOverrideTurn(null);
    setIsRollingDice(true);
    if (navigator.vibrate) navigator.vibrate(20);

    window.setTimeout(() => {
      setDiceResult(tr.dice);
      setIsRollingDice(false);
    }, 1000);
  }, [anim, room]);

  const finishAnimation = useCallback(
    (tr: TurnResultEvent) => {
      // 走子动画结束：按服务端结果收尾
      setDisplaySteps(null);
      setDiceResult(null);
      setAnim(null);
      if (tr.event === 'win') {
        setWinner(tr.player);
      } else if (tr.event) {
        setActiveTask(tr.event);
        setResolving(false);
      } else {
        setOverrideTurn(tr.nextTurn);
      }
    },
    [],
  );

  const handleRollComplete = useCallback(() => {
    const tr = animRef.current;
    if (!tr || !room) return;

    // 从 fromStep 开始逐步走到 toStep（用与服务端相同的反弹规则）
    const steps: [number, number] = [
      room.players[0]?.step ?? 0,
      room.players[1]?.step ?? 0,
    ];
    steps[tr.player] = tr.fromStep;
    setDisplaySteps([...steps] as [number, number]);

    let current = tr.fromStep;
    const stepOnce = () => {
      current = calculateNewPosition(current, 1);
      steps[tr.player] = current;
      setDisplaySteps([...steps] as [number, number]);

      if (current !== tr.toStep) {
        window.setTimeout(stepOnce, STEP_ANIM_MS);
        return;
      }
      window.setTimeout(() => finishAnimation(tr), STEP_ANIM_MS);
    };
    window.setTimeout(stepOnce, STEP_ANIM_MS);
  }, [finishAnimation, room]);

  /* ---------- 任务结算广播 ---------- */
  useEffect(() => {
    const r = api.taskResolved;
    if (!r) return;
    api.consumeTaskResolved();
    setActiveTask(null);
    setResolving(false);
    setOverrideTurn(r.nextTurn);
  }, [api, api.taskResolved]);

  if (!room || mySlot === null) return null;

  const players: Player[] = [0, 1].map((i) => {
    const p = room.players[i];
    return {
      id: i,
      name: p?.name || (i === 0 ? '男方' : '女方'),
      color: p?.color || (i === 0 ? '#0A84FF' : '#FF375F'),
      role: p?.role || (i === 0 ? 'male' : 'female'),
      step: displaySteps ? displaySteps[i] : p?.step ?? 0,
      themeId: null,
    };
  });

  const displayTurn = overrideTurn ?? anim?.player ?? room.turn;
  const isMyTurn = displayTurn === mySlot && !anim && !activeTask && room.phase === 'playing';
  const me = players[mySlot];
  const opponent = room.players[mySlot === 0 ? 1 : 0];
  const iAmExecutor = activeTask?.executorPlayerId === mySlot;

  const handleRoll = () => {
    if (!isMyTurn || isRollingDice || diceResult) return;
    api.clearError();
    api.roll();
  };

  const handleResolve = (accept: boolean) => {
    if (resolving || !iAmExecutor) return;
    setResolving(true);
    api.resolveTask(accept);
  };

  const handleBack = () => {
    if (confirm('离开对局？对方将看到你断线，你可以凭房间号重连回来')) {
      api.leave();
      onExit();
    }
  };

  const handleRematch = () => {
    setWinner(null);
    api.rematch();
  };

  const turnNumber = Math.floor(Math.max(...players.map((p) => p.step)) / 4) + 1;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute inset-0 z-0">
        <div className="w-full h-full bg-gradient-to-br from-gray-900 via-black to-gray-900 opacity-60" />
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
      </div>

      <div className="relative z-10 flex flex-col h-full max-w-[430px] mx-auto w-full">
        <header className="pt-12 pb-2 px-4 flex items-center gap-4 shrink-0">
          <button
            onClick={handleBack}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center ios-btn border border-white/5"
          >
            <ArrowLeft className="text-white" size={20} />
          </button>
          <div className="flex-1 flex justify-center">
            <div className="p-1.5 bg-[#1C1C1E] rounded-full flex items-center gap-2 border border-white/10">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300 ${
                  displayTurn === 0
                    ? 'bg-[#0A84FF] text-white shadow-lg shadow-blue-900/50'
                    : 'text-[#0A84FF] opacity-60'
                }`}
              >
                <User size={14} />
                <span className="text-xs font-bold">{players[0].name}</span>
              </div>
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2">
                Turn {turnNumber}
              </div>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300 ${
                  displayTurn === 1
                    ? 'bg-[#FF375F] text-white shadow-lg shadow-pink-900/50'
                    : 'text-[#FF375F] opacity-60'
                }`}
              >
                <span className="text-xs font-bold">{players[1].name}</span>
                <UserRound size={14} />
              </div>
            </div>
          </div>
          <div className="w-10" />
        </header>

        {opponent && !opponent.connected && (
          <div className="mx-4 mt-2 p-2.5 rounded-2xl bg-yellow-400/10 border border-yellow-400/30 flex items-center justify-center gap-2">
            <WifiOff size={14} className="text-yellow-400" />
            <span className="text-xs text-yellow-400">对方断线了，等待 TA 重连…</span>
          </div>
        )}
        {api.status === 'reconnecting' && (
          <div className="mx-4 mt-2 p-2.5 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin text-gray-400" />
            <span className="text-xs text-gray-400">网络重连中…</span>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center px-4">
          <GameBoard
            boardMap={room.boardMap}
            pathCoords={pathCoords}
            players={players}
            currentTurn={displayTurn}
          />
        </div>

        <div className="h-[260px] w-full ios-glass rounded-t-[32px] flex flex-col items-center pt-8 pb-8 px-6 border-t border-white/10 shadow-2xl shrink-0">
          <div
            className={`text-sm font-medium mb-6 text-center ${
              isMyTurn ? 'animate-pulse' : ''
            } ${displayTurn === 0 ? 'text-[#0A84FF]' : 'text-[#FF375F]'}`}
          >
            {room.phase !== 'playing'
              ? '对局已结束'
              : anim
                ? `${players[anim.player].name} 掷出了 ${anim.dice} 点`
                : activeTask
                  ? iAmExecutor
                    ? '轮到你决定：接受还是拒绝？'
                    : `等待 ${players[activeTask.executorPlayerId].name} 选择…`
                  : isMyTurn
                    ? `${me.name}（你）回合：点击骰子`
                    : `等待 ${players[displayTurn].name} 掷骰子…`}
          </div>
          <div onClick={handleRoll} className={isMyTurn ? 'cursor-pointer' : 'opacity-70'}>
            <Dice isRolling={isRollingDice} result={diceResult} onRollComplete={handleRollComplete} />
          </div>
          {!isMyTurn && room.phase === 'playing' && !anim && !activeTask && (
            <div className="text-xs text-gray-600 mt-4">对方操作时你会实时看到</div>
          )}
        </div>
      </div>

      <TaskCardModal
        isOpen={!!activeTask}
        taskData={activeTask}
        interactive={iAmExecutor}
        waitingText={activeTask ? `等待 ${players[activeTask.executorPlayerId].name} 选择…` : undefined}
        onAccept={() => handleResolve(true)}
        onReject={() => handleResolve(false)}
      />

      <WinModal
        isOpen={winner !== null}
        winnerName={winner !== null ? players[winner].name : ''}
        onRestart={handleRematch}
      />

      {api.error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[130] px-5 py-3 rounded-full bg-[#FF453A] text-white text-sm font-medium shadow-xl whitespace-nowrap">
          {api.error}
          <button onClick={api.clearError} className="ml-3 underline">
            知道了
          </button>
        </div>
      )}
    </div>
  );
}
