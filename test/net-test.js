// Multiplayer end-to-end test: starts the real server, connects two clients running the
// real client code (js/net.js), has a computer player drive each side over the network,
// and checks that both copies of the simulation stay identical for a whole match,
// with a computer player in the room and one client dropping out and rejoining from scratch.
// Usage: node test/net-test.js [maxMinutesOfGameTime]
'use strict';
const net = require('net'), crypto = require('crypto');
require('../js/data.js'); require('../js/sim.js'); require('../js/ai.js'); require('../js/net.js');
const R = globalThis.RTS;
const { start } = require('../server.js');

// Just enough of the browser WebSocket API, over a raw TCP socket.
class NodeWS {
  constructor(url) {
    const u = new URL(url);
    this.readyState = 0; this.buf = Buffer.alloc(0); this.up = false;
    const s = this.s = net.connect(+u.port, u.hostname, () => {
      s.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    s.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    s.on('close', () => { this.readyState = 3; if (this.onclose) this.onclose(); });
    s.on('error', () => { if (this.onerror) this.onerror(); });
  }
  pump() {
    if (!this.up) {
      const i = this.buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      this.buf = this.buf.subarray(i + 4); this.up = true; this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (b.length < off + len) return;
      const data = b.subarray(off, off + len).toString('utf8');
      this.buf = b.subarray(off + len);
      if ((b[0] & 0x0f) === 1 && this.onmessage) this.onmessage({ data });
    }
  }
  send(text) {
    const p = Buffer.from(text), mask = crypto.randomBytes(4);
    const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0x80 | 126, p.length >> 8, p.length & 255]);
    const body = Buffer.from(p);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
    this.s.write(Buffer.concat([head, mask, body]));
  }
  close() { this.s.destroy(); }
}

(async () => {
  const maxTicks = (+process.argv[2] || 14) * 60 * R.TPS;
  const server = await start(0, true, 1, 20000);   // 1 ms turns: play the match as fast as the machine allows
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const mk = () => ({ net: new R.Net(NodeWS), sim: null, ai: null, hashes: new Map(), start: null });
  const A = mk();
  let B = mk();
  let codeResolve; const gotCode = new Promise(r => { codeResolve = r; });
  let fail = null, rejoined = 0, chat = 0;

  // Build this client's copy of the match. Computer slots think locally, before every tick, on each client.
  const begin = (c, m) => {
    c.start = m;
    c.sim = new R.Sim({ seed: m.seed, theme: m.theme, players: m.players.map(p => ({ faction: p.faction, team: p.team, ai: !!p.ai, name: p.name })) });
    const bots = m.players.map((p, i) => p.ai ? new R.AI(c.sim, i, p.ai) : null).filter(Boolean);
    c.net.pre = () => { for (const b of bots) b.update(); };
    c.ai = new R.AI(c.sim, m.you, 'hard');      // stands in for the human at this client:
    c.ai.cmd = cmd => c.net.cmd(cmd);           // its orders go out over the network like a player's
  };
  const wire = c => {
    c.net.on('error', m => { fail = 'server error: ' + m.msg; });
    c.net.on('desync', m => { fail = 'DESYNC reported by server at turn ' + m.n; });
    c.net.on('chat', () => { chat++; });
    c.net.on('start', m => begin(c, m));
    c.net.on('resume', m => { if (!c.sim) begin(c, m.start); rejoined++; });
  };
  wire(A); wire(B);
  A.net.on('room', m => {
    if (m.slots.length === 1) codeResolve(m.code);
    else if (m.slots.length === 2) A.net.send({ t: 'ai', op: 'add', difficulty: 'hard' });
    else if (m.slots[2].team !== 1) A.net.send({ t: 'ai', op: 'set', slot: 2, team: 1, faction: 'dragon' });   // computer allied with B
    else A.net.send({ t: 'start' });
  });
  await A.net.connect(url); await B.net.connect(url);
  A.net.send({ t: 'host', name: 'Ann', faction: 'bear', theme: 'desert' });
  const code = await gotCode;
  B.net.send({ t: 'join', code, name: 'Bob', faction: 'vanguard' });

  const t0 = Date.now();
  let dropped = false;
  await new Promise(resolve => {
    const loop = () => {
      if (fail) return resolve();
      if (A.sim && B.sim) {
        for (const c of [A, B]) c.net.advance(c.sim, 1, () => { c.ai.update(); c.sim.events.length = 0; if (c.sim.tick % 200 === 0) c.hashes.set(c.sim.tick, c.sim.hash()); });
        // part-way through, B's browser "reloads": the connection drops and a brand-new client rejoins
        // with only the room code and its key, and has to rebuild the whole match from the server's log
        if (!dropped && B.sim.tick > 3000) {
          dropped = true;
          const key = B.start.key, old = B;
          old.net.close();
          B = mk(); wire(B); B.hashes = old.hashes;
          B.net.connect(url).then(() => B.net.send({ t: 'rejoin', code, key, from: 0 }));
          A.net.send({ t: 'chat', text: 'still there?' });
        }
        const done = c => c.sim.winner >= 0 || c.sim.tick >= maxTicks;
        if (done(A) && done(B)) return resolve();
      }
      if (Date.now() - t0 > 240000) { fail = 'timed out'; return resolve(); }
      setTimeout(loop, 1);
    };
    loop();
  });

  let checked = 0, late = 0;
  if (!fail) for (const [tick, h] of A.hashes) { if (B.hashes.has(tick)) { checked++; if (tick > 3400) late++; if (B.hashes.get(tick) !== h) { fail = 'state mismatch at tick ' + tick; break; } } }
  if (!fail && A.sim.winner !== B.sim.winner) fail = 'clients disagree on the winner';
  if (!fail && checked < 5) fail = 'too few checkpoints compared';
  if (!fail && (rejoined !== 1 || late < 3)) fail = 'the rejoin did not happen or was not checked (rejoined ' + rejoined + ', checkpoints after it ' + late + ')';
  if (!fail && !chat) fail = 'chat was not relayed';
  if (!fail && A.sim.players.length !== 3) fail = 'expected three players';
  // match over: the server puts everyone back in the lobby, and the host can start a rematch
  if (!fail) {
    const got = { A: null, B: null, again: 0 };
    A.net.on('room', m => { got.A = m; }); B.net.on('room', m => { got.B = m; });
    A.net.on('start', () => got.again++); B.net.on('start', () => got.again++);
    A.net.send({ t: 'over', match: A.start.match + 1 });      // wrong match number: must be ignored
    await new Promise(r => setTimeout(r, 150));
    if (got.A) fail = 'a stale match-over report ended the match';
    A.net.send({ t: 'over', match: A.start.match });
    await new Promise(r => setTimeout(r, 300));
    if (!got.A || !got.B || got.A.slots.length !== 3 || got.B.slots.length !== 3) fail = 'players were not returned to the lobby together';
    else { A.net.send({ t: 'start' }); await new Promise(r => setTimeout(r, 300)); if (got.again !== 2) fail = 'the rematch did not start for both players'; }
  }
  const cmds = c => c.sim.players.map(p => p.stats.built).join('/');
  if (fail) console.log('FAIL: ' + fail);
  else console.log(`PASS: 2 humans + 1 computer, ${checked} checkpoints identical over ${(A.sim.tick / R.TPS / 60).toFixed(1)} game-minutes (${late} after a drop and rejoin), rematch started; ` +
    (A.sim.winner >= 0 ? `team ${A.sim.winner} won` : 'no winner yet') + `; units trained ${cmds(A)} (A) vs ${cmds(B)} (B)`);
  A.net.close(); B.net.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
