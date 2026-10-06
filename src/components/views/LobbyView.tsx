import { useState } from 'react';
import { Copy, Check, LogOut, Play, User, UserRound, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { OnlineGameApi } from '../../hooks/useOnlineGame';
import { PlayerRole, Theme } from '../../net/protocol';

interface LobbyViewProps {
  api: OnlineGameApi;
  themes: Theme[];
  onOpenThemePicker: () => void;
  onExit: () => void;
}

function ConnBadge({ api }: { api: OnlineGameApi }) {
  if (api.status === 'connected') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400">
        <Wifi size={14} /> 已连接
      </span>
    );
  }
  if (api.status === 'connecting' || api.status === 'reconnecting') {
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-400">
        <Loader2 size={14} className="animate-spin" /> 连接中…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <WifiOff size={14} /> 未连接
    </span>
  );
}

export function LobbyView({ api, themes, onOpenThemePicker, onExit }: LobbyViewProps) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [role, setRole] = useState<PlayerRole>('male');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const room = api.room;
  const mySlot = api.mySlot;
  const me = mySlot !== null ? room?.players[mySlot] || null : null;
  const opponent = mySlot !== null ? room?.players[mySlot === 0 ? 1 : 0] || null : null;

  const handleCopy = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = room.code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleStart = () => {
    api.clearError();
    api.start();
  };

  /* ---------- 未进房间：创建 / 加入 ---------- */
  if (!room) {
    const busy = api.status === 'connecting' || api.status === 'reconnecting';
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-y-auto">
        <div className="absolute inset-0 z-0">
          <div className="w-full h-full bg-gradient-to-br from-gray-900 via-black to-gray-900 opacity-60" />
        </div>
        <div className="relative z-10 flex flex-col w-full max-w-[430px] mx-auto min-h-full px-6 pt-14 pb-10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-2xl font-bold text-white">🌐 在线联机</h2>
            <ConnBadge api={api} />
          </div>
          <p className="text-sm text-gray-500 mb-8">和异地的 TA 来一局飞行棋</p>

          {api.hasSavedSession && (
            <button
              onClick={api.reconnectNow}
              disabled={busy}
              className="w-full h-12 mb-6 rounded-2xl bg-[#0A84FF]/15 border border-[#0A84FF]/40 text-[#0A84FF] font-semibold text-sm ios-btn disabled:opacity-50"
            >
              {busy ? '连接中…' : '↩ 恢复上次的房间'}
            </button>
          )}

          <div className="flex bg-[#1C1C1E] rounded-full p-1 mb-6">
            {(['create', 'join'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 h-10 rounded-full text-sm font-semibold transition-all ${
                  tab === t ? 'bg-white text-black' : 'text-gray-400'
                }`}
              >
                {t === 'create' ? '创建房间' : '加入房间'}
              </button>
            ))}
          </div>

          {tab === 'join' && (
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-2 block">房间号（6 位字母数字）</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="例如：A3K9QZ"
                className="w-full h-14 bg-[#1C1C1E] rounded-2xl px-5 text-white text-xl font-mono tracking-[0.3em] text-center outline-none border border-white/10 focus:border-[#0A84FF]/60 placeholder:text-gray-600 placeholder:tracking-normal placeholder:text-base"
              />
            </div>
          )}

          <div className="mb-4">
            <label className="text-xs text-gray-500 mb-2 block">你的昵称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 12))}
              placeholder={tab === 'create' ? (role === 'male' ? '男方' : '女方') : '输入昵称'}
              className="w-full h-14 bg-[#1C1C1E] rounded-2xl px-5 text-white text-base outline-none border border-white/10 focus:border-[#0A84FF]/60 placeholder:text-gray-600"
            />
          </div>

          {tab === 'create' && (
            <div className="mb-8">
              <label className="text-xs text-gray-500 mb-2 block">你是</label>
              <div className="flex gap-3">
                {(['male', 'female'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={`flex-1 h-14 rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold border transition-all ${
                      role === r
                        ? r === 'male'
                          ? 'bg-[#0A84FF]/20 border-[#0A84FF] text-white'
                          : 'bg-[#FF375F]/20 border-[#FF375F] text-white'
                        : 'bg-[#1C1C1E] border-white/10 text-gray-400'
                    }`}
                  >
                    {r === 'male' ? <User size={18} /> : <UserRound size={18} />}
                    {r === 'male' ? '男方' : '女方'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {api.error && (
            <div className="mb-4 p-3 rounded-2xl bg-[#FF453A]/10 border border-[#FF453A]/30 text-[#FF453A] text-sm text-center">
              {api.error}
            </div>
          )}

          <div className="flex-1" />

          <button
            disabled={busy || (tab === 'join' && code.length !== 6)}
            onClick={() => {
              api.clearError();
              if (tab === 'create') api.createRoom(name, role);
              else api.joinRoom(code, name);
            }}
            className="w-full h-14 bg-white rounded-full text-black font-semibold text-lg ios-btn disabled:opacity-40 mb-4"
          >
            {busy ? '连接中…' : tab === 'create' ? '创建房间' : '加入房间'}
          </button>
          <button
            onClick={onExit}
            className="w-full h-12 rounded-full text-gray-500 text-sm ios-btn"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  /* ---------- 已在房间：等待 / 选主题 / 开始 ---------- */
  const bothReady = room.players[0]?.theme && room.players[1]?.theme;
  const myTheme = me?.theme || null;
  const selectableCount = themes.filter(
    (t) => me && (t.audience === 'common' || t.audience === me.role) && t.tasks.length > 0,
  ).length;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col overflow-y-auto">
      <div className="absolute inset-0 z-0">
        <div className="w-full h-full bg-gradient-to-br from-gray-900 via-black to-gray-900 opacity-60" />
      </div>
      <div className="relative z-10 flex flex-col w-full max-w-[430px] mx-auto min-h-full px-6 pt-14 pb-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">🌐 在线联机</h2>
          <ConnBadge api={api} />
        </div>

        <div className="ios-card p-6 text-center mb-6 border border-white/5">
          <div className="text-xs text-gray-500 mb-2">房间号（发给 TA 加入）</div>
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl font-mono font-bold tracking-[0.2em] text-white">
              {room.code}
            </span>
            <button
              onClick={handleCopy}
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center ios-btn"
            >
              {copied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} className="text-white" />}
            </button>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          {[me, opponent].map((p, idx) => {
            const isMe = idx === 0;
            if (!p) {
              return (
                <div
                  key={idx}
                  className="ios-card p-5 border border-dashed border-white/15 flex items-center justify-center gap-2"
                >
                  <Loader2 size={16} className="animate-spin text-gray-500" />
                  <span className="text-sm text-gray-500">等待对方加入…</span>
                </div>
              );
            }
            const theme = p.theme;
            return (
              <div key={p.slot} className="ios-card p-5 border border-white/5">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.role === 'male' ? (
                      <User className="text-white" size={24} />
                    ) : (
                      <UserRound className="text-white" size={24} />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-base font-semibold text-white flex items-center gap-2">
                      {p.name}
                      {p.isHost && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 font-bold">
                          房主
                        </span>
                      )}
                      {!p.connected && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-400">
                          断线
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-400 mt-0.5">
                      {theme ? `📦 ${theme.name}（${theme.tasks.length} 个任务）` : '未选择主题'}
                    </div>
                  </div>
                </div>
                {isMe && (
                  <button
                    onClick={onOpenThemePicker}
                    className="mt-4 w-full h-11 rounded-full bg-white/10 text-white text-sm font-semibold ios-btn border border-white/10"
                  >
                    {myTheme ? '更换我的主题' : '选择我的主题'}
                    {selectableCount === 0 && (
                      <span className="block text-[11px] text-gray-500 font-normal mt-0.5">
                        主题库是空的，先去「主题」页创建
                      </span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {api.error && (
          <div className="mb-4 p-3 rounded-2xl bg-[#FF453A]/10 border border-[#FF453A]/30 text-[#FF453A] text-sm text-center">
            {api.error}
          </div>
        )}

        <div className="flex-1" />

        {me?.isHost ? (
          <button
            onClick={handleStart}
            disabled={!bothReady}
            className="w-full h-14 bg-white rounded-full text-black font-semibold text-lg ios-btn disabled:opacity-40 mb-4 flex items-center justify-center gap-2"
          >
            <Play size={20} /> 开始游戏
          </button>
        ) : (
          <div className="w-full h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center gap-2 mb-4">
            <Loader2 size={16} className="animate-spin text-gray-400" />
            <span className="text-sm text-gray-400">
              {bothReady ? '等待房主开始游戏…' : '选择主题后等待房主开始…'}
            </span>
          </div>
        )}

        <button
          onClick={() => {
            if (confirm('确定要退出房间吗？')) {
              api.leave();
              onExit();
            }
          }}
          className="w-full h-12 rounded-full text-gray-500 text-sm ios-btn flex items-center justify-center gap-2"
        >
          <LogOut size={16} /> 退出房间
        </button>
      </div>
    </div>
  );
}
