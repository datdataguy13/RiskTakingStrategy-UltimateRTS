// Multiplayer end-to-end test: starts the real server, connects two clients running the
// real client code (js/net.js), has a computer player drive each side over the network,
// and checks that both copies of the simulation stay identical for a whole match.
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
  const server = await start(0, true, 1);   // 1 ms turns: play the match as fast as the machine allows
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const mk = () => ({ net: new R.Net(NodeWS), sim: null, ai: null, hashes: new Map(), desync: false });
  const A = mk(), B = mk();
  let codeResolve; const gotCode = new Promise(r => { codeResolve = r; });
  let started = 0, fail = null;

  for (const c of [A, B]) {
    c.net.on('room', m => { if (c === A) { if (m.players.length === 1) codeResolve(m.code); else c.net.send({ t: 'start' }); } });
    c.net.on('error', m => { fail = 'server error: ' + m.msg; });
    c.net.on('desync', m => { c.desync = true; fail = 'DESYNC reported by server at turn ' + m.n; });
    c.net.on('start', m => {
      c.sim = new R.Sim({ seed: m.seed, theme: m.theme, players: m.factions.map(f => ({ faction: f })) });
      c.ai = new R.AI(c.sim, m.you, 'hard');
      c.ai.cmd = cmd => c.net.cmd(cmd);       // the computer player issues its orders through the network
      c.me = m.you; started++;
    });
    await c.net.connect(url);
  }
  A.net.send({ t: 'host', faction: 'bear', theme: 'desert' });
  B.net.send({ t: 'join', code: await gotCode, faction: 'vanguard' });

  const t0 = Date.now();
  await new Promise(resolve => {
    const loop = () => {
      if (fail) return resolve();
      if (started === 2) {
        for (const c of [A, B]) c.net.advance(c.sim, 1, () => { c.ai.update(); c.sim.events.length = 0; if (c.sim.tick % 200 === 0) c.hashes.set(c.sim.tick, c.sim.hash()); });
        const done = c => c.sim.winner >= 0 || c.sim.tick >= maxTicks;
        if (done(A) && done(B)) return resolve();
      }
      if (Date.now() - t0 > 240000) { fail = 'timed out'; return resolve(); }
      setTimeout(loop, 1);
    };
    loop();
  });

  let checked = 0;
  if (!fail) for (const [tick, h] of A.hashes) { if (B.hashes.has(tick)) { checked++; if (B.hashes.get(tick) !== h) { fail = 'state mismatch at tick ' + tick; break; } } }
  if (!fail && A.sim.winner !== B.sim.winner) fail = 'clients disagree on the winner';
  if (!fail && checked < 5) fail = 'too few checkpoints compared';
  const cmds = c => c.sim.players.map(p => p.stats.built).join('/');
  if (fail) console.log('FAIL: ' + fail);
  else console.log(`PASS: ${checked} checkpoints identical over ${(A.sim.tick / R.TPS / 60).toFixed(1)} game-minutes; ` +
    (A.sim.winner >= 0 ? `winner ${A.sim.players[A.sim.winner].name}` : 'no winner yet') + `; units trained ${cmds(A)} (A) vs ${cmds(B)} (B)`);
  A.net.close(); B.net.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
