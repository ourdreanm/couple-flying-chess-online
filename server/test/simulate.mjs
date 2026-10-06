/**
 * 端到端模拟测试：两个 WebSocket 客户端完整打一局联机飞行棋。
 * 运行：npm run test:e2e   （需先 npm run build）
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const PORT = 3457;
const SERVER_URL = `ws://127.0.0.1:${PORT}`;
const TIMEOUT = 8000;

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ 断言失败: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.inbox = [];
    this.waiters = new Set();
    this.ws = new WebSocket(SERVER_URL);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      this.inbox.push(msg);
      this.pump();
    });
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
  }
  pump() {
    for (const w of [...this.waiters]) {
      const idx = this.inbox.findIndex(w.pred);
      if (idx >= 0) {
        const [msg] = this.inbox.splice(idx, 1);
        this.waiters.delete(w);
        w.resolve(msg);
      }
    }
  }
  waitFor(pred, what) {
    const idx = this.inbox.findIndex(pred);
    if (idx >= 0) {
      const [msg] = this.inbox.splice(idx, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(w);
        reject(new Error(`${this.label} 等待 ${what} 超时`));
      }, TIMEOUT);
      const w = {
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      this.waiters.add(w);
    });
  }
  waitMsg(t) {
    return this.waitFor((m) => m.t === t, t);
  }
  /** 丢弃收件箱里所有 t 类型的旧消息（用于对齐时序） */
  drain(t) {
    this.inbox = this.inbox.filter((m) => m.t !== t);
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  close() {
    this.ws.close();
  }
}

const themeA = {
  id: 'tA',
  name: '主题A',
  desc: '',
  audience: 'common',
  tasks: ['任务A1', '任务A2', '任务A3'],
};
const themeB = {
  id: 'tB',
  name: '主题B',
  desc: '',
  audience: 'common',
  tasks: ['任务B1', '任务B2'],
};

async function main() {
  const server = spawn('node', ['dist/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  await sleep(1200);

  try {
    const A = new Client('A');
    const B = new Client('B');
    await Promise.all([A.ready, B.ready]);
    console.log('✅ 两个客户端已连接');

    // A 创建房间（男方）
    A.send({ t: 'create', name: '阿强', role: 'male' });
    const helloA = await A.waitMsg('hello');
    assert(helloA.slot === 0, 'A 应为 slot 0');
    const snapA = await A.waitMsg('snapshot');
    const code = snapA.room.code;
    assert(code.length === 6, '房号应为 6 位');
    console.log(`✅ A 创建房间 ${code}`);

    // 房号错误应报错
    B.send({ t: 'join', code: 'ZZZZZZ', name: '小美' });
    const errJoin = await B.waitMsg('error');
    assert(errJoin.message.includes('不存在'), '错误房号应报错');
    console.log('✅ 错误房号被拒绝');

    // B 加入
    B.send({ t: 'join', code, name: '小美' });
    const helloB = await B.waitMsg('hello');
    assert(helloB.slot === 1, 'B 应为 slot 1');
    await A.waitMsg('snapshot');
    await B.waitMsg('snapshot');
    console.log('✅ B 加入房间');

    // 未选主题就开始应报错
    A.send({ t: 'start' });
    const errStart = await A.waitMsg('error');
    assert(errStart.message.includes('选择主题'), '未选主题开始应报错');
    console.log('✅ 未选主题时开始被拒绝');

    // 双方选主题（每次 set_theme 都会广播，等双方都设置好的快照）
    A.send({ t: 'set_theme', theme: themeA });
    B.send({ t: 'set_theme', theme: themeB });
    const bothThemed = (m) =>
      m.t === 'snapshot' && m.room.players[0]?.theme && m.room.players[1]?.theme;
    const s1 = await A.waitFor(bothThemed, '双方主题快照');
    const s2 = await B.waitFor(bothThemed, '双方主题快照');
    assert(s1.room.players[0].theme.name === '主题A', 'A 主题同步');
    assert(s2.room.players[1].theme.name === '主题B', 'B 主题同步');
    // 丢弃 set_theme 过程中产生的旧快照，保证后续时序对齐
    A.drain('snapshot');
    B.drain('snapshot');
    console.log('✅ 双方主题同步');

    // 非房主开始应报错
    B.send({ t: 'start' });
    const errHost = await B.waitMsg('error');
    assert(errHost.message.includes('房主'), '非房主开始应报错');
    console.log('✅ 非房主开始被拒绝');

    // 房主开始（广播发给双方，两端都要消费）
    A.send({ t: 'start' });
    const playingPred = (m) => m.t === 'snapshot' && m.room.phase === 'playing';
    const started = await A.waitFor(playingPred, 'playing 快照');
    await B.waitFor(playingPred, 'playing 快照(B)');
    let turn = started.room.turn;
    console.log(`✅ 游戏开始，先手=${turn}`);

    // 非回合方掷骰应报错
    const other = turn === 0 ? B : A;
    other.send({ t: 'roll' });
    const errTurn = await other.waitMsg('error');
    assert(errTurn.message.includes('轮到你'), '非回合掷骰应报错');
    console.log('✅ 非回合掷骰被拒绝');

    // 完整对局
    let rounds = 0;
    let winner = null;
    const seenTurnResults = [];
    while (rounds < 600 && winner === null) {
      rounds++;
      const roller = turn === 0 ? A : B;
      const watcher = turn === 0 ? B : A;
      roller.send({ t: 'roll' });
      const trR = await roller.waitMsg('turn_result');
      const trW = await watcher.waitMsg('turn_result');
      assert(
        trR.dice === trW.dice && trR.toStep === trW.toStep,
        `第${rounds}回合双方看到的结果应一致`,
      );
      seenTurnResults.push(trR);
      // 快照同步
      await roller.waitMsg('snapshot');
      await watcher.waitMsg('snapshot');

      if (trR.event === 'win') {
        winner = trR.player;
        const go = await roller.waitMsg('game_over');
        assert(go.winner === winner, 'game_over 胜者一致');
        console.log(`✅ 第${rounds}回合：玩家${winner} 获胜`);
        break;
      } else if (trR.event) {
        const ev = trR.event;
        assert(typeof ev.task === 'string' && ev.task.length > 0, '任务卡应有任务文本');
        const executor = ev.executorPlayerId === 0 ? A : B;
        const accept = rounds % 2 === 0;
        executor.send({ t: 'resolve', accept });
        const resR = await roller.waitMsg('task_resolved');
        const resW = await watcher.waitMsg('task_resolved');
        assert(resR.nextTurn === resW.nextTurn, '结算后回合一致');
        await roller.waitMsg('snapshot');
        await watcher.waitMsg('snapshot');
        turn = resR.nextTurn;
      } else {
        turn = trR.nextTurn;
      }
    }
    assert(winner !== null, '对局应在 600 回合内结束');
    assert(seenTurnResults.length > 0, '应有多回合 turn_result');
    console.log(`✅ 完整对局结束，共 ${rounds} 回合`);

    // 再来一局
    A.send({ t: 'rematch' });
    const reA = await A.waitMsg('snapshot');
    const reB = await B.waitMsg('snapshot');
    assert(reA.room.phase === 'playing', '再来一局后回到 playing');
    assert(reA.room.players[0].step === 0 && reA.room.players[1].step === 0, '步数清零');
    assert(reA.room.players[0].theme.name === '主题A', '主题保留');
    assert(reB.room.phase === 'playing', 'B 也收到再来一局');
    console.log('✅ 再来一局');

    // 断线重连
    A.close();
    await sleep(500);
    const A2 = new Client('A2');
    await A2.ready;
    A2.send({ t: 'reconnect', code, token: helloA.token });
    const helloA2 = await A2.waitMsg('hello');
    assert(helloA2.slot === 0, '重连后 slot 不变');
    const snapRe = await A2.waitMsg('snapshot');
    assert(snapRe.room.phase === 'playing', '重连后拿到对局快照');
    console.log('✅ 断线重连恢复对局');

    B.close();
    A2.close();
    console.log('\n🎉 全部测试通过！');
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error(`❌ 测试失败: ${e.message}`);
  process.exit(1);
});
