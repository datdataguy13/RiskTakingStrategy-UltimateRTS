// Risk Taking Strategy — game server. No dependencies: `node server.js`, then open http://localhost:8080
// Set PORT to use another port; web hosts such as Render and Fly.io set it for you.
//
// Does two things:
//  1. Serves the game files.
//  2. Runs multiplayer rooms over WebSocket (/ws). The server does not simulate the game.
//     It is the clock: every TURN_MS it sends every player the commands it received,
//     and each player's browser advances its own copy of the (deterministic) simulation.
//     Computer players are simulated in the browsers too, identically on each.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

require('./js/data.js');   // shared game data: faction and map-theme ids
const ROOT = __dirname, MAX_MSG = 64 * 1024;
const MAX_CLIENTS = 200;      // plenty for friends; stops a public server being flooded with connections
const PING_MS = 25000;        // hosting proxies close WebSockets that sit silent, e.g. a host waiting in the lobby
let TURN_MS = 100;
const FACTIONS = globalThis.RTS.FACTION_ORDER, THEMES = globalThis.RTS.THEME_ORDER;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------- static files ----------
function serve(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  const ok = file.startsWith(ROOT + path.sep) && /^\/(index\.html|css\/|js\/)/.test(p);   // only the game's own files
  if (!ok) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- minimal WebSocket (RFC 6455, text frames) ----------
const clients = new Set();
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.url.split('?')[0] !== '/ws' || clients.size >= MAX_CLIENTS) return socket.destroy();
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + hash + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { socket, room: null, idx: -1, faction: 'liberty', alive: true, buf: Buffer.alloc(0), frag: '' };
  clients.add(c);
  socket.on('data', d => { c.buf = Buffer.concat([c.buf, d]); try { parse(c); } catch (e) { drop(c); } });
  socket.on('close', () => drop(c));
  socket.on('error', () => drop(c));
}
function parse(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > MAX_MSG || !masked) return drop(c);
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    c.buf = b.subarray(off + 4 + len);
    if (op === 8) return drop(c);
    if (op === 9) { frame(c, data, 10); continue; }            // ping -> pong
    if (op === 1 || op === 0) {
      c.frag += data.toString('utf8');
      if (c.frag.length > MAX_MSG) return drop(c);
      if (fin) { const text = c.frag; c.frag = ''; let m; try { m = JSON.parse(text); } catch (e) { continue; } if (m && typeof m === 'object') handle(c, m); }
    }
  }
}
function frame(c, payload, op) {
  if (!c.alive) return;
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | op, len]) : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
  c.socket.write(Buffer.concat([head, payload]));
}
const send = (c, o) => frame(c, Buffer.from(JSON.stringify(o)), 1);

// ---------- rooms ----------
// A room has up to MAX_PLAYERS slots, each a human connection or a computer player.
// Slot order is the player order in the simulation. Once a match starts the server keeps
// every command it has released (room.log), so a player who drops can come back and catch up.
const rooms = new Map();
const MAX_PLAYERS = globalThis.RTS.MAX_PLAYERS, DIFFS = ['easy', 'normal', 'hard'];
let GRACE_MS = 60000;          // how long a dropped player has to reconnect before they forfeit
function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let s = ''; for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)]; if (!rooms.has(s)) return s; }
}
const clean = (t, max) => String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const humans = room => room.slots.filter(s => s.c);
const idxOf = c => c.room ? c.room.slots.findIndex(s => s.c === c) : -1;
function freeTeam(room) { for (let t = 0; t < MAX_PLAYERS; t++) if (!room.slots.some(s => s.team === t)) return t; return 0; }
function nameFor(room, want) {
  let n = clean(want, 16) || 'Player', k = 2;
  const base = n;
  while (room.slots.some(s => s.name === n)) n = base.slice(0, 14) + ' ' + k++;
  return n;
}
function lobby(room) {
  const slots = room.slots.map(s => ({ ai: s.ai || null, name: s.name, faction: s.faction, team: s.team }));
  const hostSlot = room.slots.findIndex(s => s.c === room.host);
  room.slots.forEach((s, i) => { if (s.c) send(s.c, { t: 'room', code: room.code, you: i, hostSlot, theme: room.theme, slots }); });
}
function toRoom(room, o) { for (const s of room.slots) if (s.c) send(s.c, o); }
function closeRoom(room) {
  clearInterval(room.timer);
  for (const s of room.slots) { clearTimeout(s.grace); if (s.c) s.c.room = null; }
  rooms.delete(room.code);
}
function clock(room) {
  clearInterval(room.timer); room.timer = null;
  if (!room.started || room.slots.some(s => s.away)) return;       // the match waits for dropped players
  room.timer = setInterval(() => {
    const msg = { t: 'turn', n: ++room.turn, c: room.cmds };
    if (room.cmds.length) room.log.push([room.turn, room.cmds]);
    room.cmds = [];
    toRoom(room, msg);
  }, TURN_MS);
}
// A player is out of the match for good: their side surrenders, on every copy of the game at once.
function forfeit(room, i) {
  const s = room.slots[i];
  clearTimeout(s.grace); s.away = false; s.gone = true; s.c = null;
  if (!room.slots.some(x => x.c)) return closeRoom(room);
  room.cmds.push({ type: 'surrender', player: i });
  toRoom(room, { t: 'gone', player: i });
  clock(room);
}
// Back to the lobby with the same people, ready for a rematch.
function endMatch(room) {
  clearInterval(room.timer); room.timer = null;
  for (const s of room.slots) clearTimeout(s.grace);
  room.slots = room.slots.filter(s => s.ai || s.c);
  for (const s of room.slots) { s.away = false; s.gone = false; }
  room.started = false; room.turn = 0; room.cmds = []; room.log = []; room.hashes = new Map(); room.startMsg = null;
  if (!room.slots.some(s => s.c)) return closeRoom(room);
  if (!room.slots.some(s => s.c === room.host)) room.host = humans(room)[0].c;
  lobby(room);
}
function drop(c) {
  if (!c.alive) return;
  c.alive = false;
  clients.delete(c);
  try { c.socket.destroy(); } catch (e) { /* gone */ }
  leave(c, false);
}
// left = the player chose to leave (no way back); otherwise the connection dropped
function leave(c, left) {
  const room = c.room, i = idxOf(c);
  c.room = null;
  if (!room || i < 0) return;
  const s = room.slots[i];
  if (room.started) {
    if (left) return forfeit(room, i);
    s.c = null; s.away = true;
    if (!room.slots.some(x => x.c)) {                              // nobody left to wait: keep the room briefly in case they return
      clearInterval(room.timer); room.timer = null;
      s.grace = setTimeout(() => { if (!room.slots.some(x => x.c)) closeRoom(room); else forfeit(room, i); }, GRACE_MS);
      return;
    }
    clock(room);
    toRoom(room, { t: 'away', player: i, secs: Math.round(GRACE_MS / 1000) });
    s.grace = setTimeout(() => forfeit(room, i), GRACE_MS);
    return;
  }
  room.slots.splice(i, 1);
  if (!room.slots.some(x => x.c)) return closeRoom(room);
  if (room.host === c) room.host = humans(room)[0].c;
  lobby(room);
}
function handle(c, m) {
  const room = c.room, me = idxOf(c);
  switch (m.t) {
    case 'host': {
      if (room) return;
      const r = { code: code(), slots: [], host: c, theme: 'grass', started: false, timer: null, turn: 0, cmds: [], log: [], hashes: new Map(), startMsg: null };
      if (THEMES.includes(m.theme)) r.theme = m.theme;
      r.slots.push({ c, name: nameFor(r, m.name), faction: FACTIONS.includes(m.faction) ? m.faction : 'liberty', team: 0 });
      rooms.set(r.code, r); c.room = r; lobby(r);
      break;
    }
    case 'join': {
      if (room) return;
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return send(c, { t: 'error', msg: 'No game found with that code' });
      if (r.started) return send(c, { t: 'error', msg: 'That game has already started' });
      if (r.slots.length >= MAX_PLAYERS) return send(c, { t: 'error', msg: 'That game is full' });
      r.slots.push({ c, name: nameFor(r, m.name), faction: FACTIONS.includes(m.faction) ? m.faction : 'liberty', team: freeTeam(r) });
      c.room = r; lobby(r);
      break;
    }
    case 'rejoin': {                                               // a dropped player returning to a running match
      if (room) return;
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      const i = r && r.started ? r.slots.findIndex(s => s.key && s.key === m.key && !s.c && !s.gone) : -1;
      if (i < 0) return send(c, { t: 'error', msg: 'That game is no longer running', rejoin: true });
      const s = r.slots[i], from = Number.isInteger(m.from) && m.from >= 0 ? m.from : 0;
      clearTimeout(s.grace); s.c = c; s.away = false; c.room = r;
      send(c, { t: 'resume', start: Object.assign({}, r.startMsg, { you: i, key: s.key }), turns: r.log.filter(e => e[0] > from), from, to: r.turn });
      for (const x of r.slots) if (x.c && x.c !== c) send(x.c, { t: 'back', player: i });
      for (const x of r.slots) if (x.away) send(c, { t: 'away', player: r.slots.indexOf(x), secs: Math.round(GRACE_MS / 1000) });
      clock(r);
      break;
    }
    case 'set': {                                                  // your own slot; the host also picks the map
      if (!room || room.started) return;
      const s = room.slots[me];
      if (FACTIONS.includes(m.faction)) s.faction = m.faction;
      if (Number.isInteger(m.team) && m.team >= 0 && m.team < MAX_PLAYERS) s.team = m.team;
      if (THEMES.includes(m.theme) && room.host === c) room.theme = m.theme;
      lobby(room);
      break;
    }
    case 'ai': {                                                   // host only: add, change or remove a computer player
      if (!room || room.started || room.host !== c) return;
      if (m.op === 'add') {
        if (room.slots.length >= MAX_PLAYERS) return;
        const n = room.slots.filter(s => s.ai).length + 1;
        room.slots.push({ ai: DIFFS.includes(m.difficulty) ? m.difficulty : 'normal', name: nameFor(room, 'Computer ' + n),
          faction: FACTIONS[crypto.randomInt(FACTIONS.length)], team: freeTeam(room) });
      } else {
        const s = room.slots[m.slot];
        if (!s || !s.ai) return;
        if (m.op === 'remove') room.slots.splice(m.slot, 1);
        else {
          if (FACTIONS.includes(m.faction)) s.faction = m.faction;
          if (DIFFS.includes(m.difficulty)) s.ai = m.difficulty;
          if (Number.isInteger(m.team) && m.team >= 0 && m.team < MAX_PLAYERS) s.team = m.team;
        }
      }
      lobby(room);
      break;
    }
    case 'start': {
      if (!room || room.started || room.host !== c) return;
      if (room.slots.length < 2 || new Set(room.slots.map(s => s.team)).size < 2) return send(c, { t: 'error', msg: 'You need at least two teams to start' });
      room.started = true; room.turn = 0; room.cmds = []; room.log = []; room.hashes = new Map(); room.desynced = false;
      room.startMsg = { t: 'start', code: room.code, match: room.matchNo = (room.matchNo || 0) + 1, seed: crypto.randomInt(1, 2 ** 30), theme: room.theme,
        players: room.slots.map(s => ({ faction: s.faction, team: s.team, ai: s.ai || null, name: s.name })) };
      room.slots.forEach((s, i) => {
        s.away = false; s.gone = false;
        if (s.c) { s.key = crypto.randomBytes(12).toString('hex'); send(s.c, Object.assign({}, room.startMsg, { you: i, key: s.key })); }
      });
      clock(room);
      break;
    }
    case 'cmd':
      if (!room || !room.started || !m.c || typeof m.c !== 'object' || typeof m.c.type !== 'string' || room.cmds.length >= 200) return;
      if (m.c.type === 'surrender') return;    // leaving is how you surrender
      m.c.player = me;                         // the server decides who issued it
      room.cmds.push(m.c);
      break;
    case 'hash': {
      if (!room || !room.started || !Number.isInteger(m.n)) return;
      const seen = room.hashes.get(m.n);
      if (seen === undefined) { room.hashes.set(m.n, m.h); if (room.hashes.size > 50) room.hashes.delete(room.hashes.keys().next().value); }
      else if (seen !== m.h && !room.desynced) { room.desynced = true; toRoom(room, { t: 'desync', n: m.n }); }
      break;
    }
    case 'chat': {                                                 // not part of the simulation: just relayed
      const text = clean(m.text, 200), now = Date.now();
      if (!room || !text || now - (c.lastChat || 0) < 300) return;
      c.lastChat = now;
      const from = room.slots[me];
      for (const s of room.slots) if (s.c && (!m.team || s.team === from.team)) send(s.c, { t: 'chat', from: me, name: from.name, text, team: !!m.team });
      break;
    }
    case 'ping': {                                                 // map ping, shown to your own team
      const now = Date.now();
      if (!room || !room.started || !Number.isFinite(m.x) || !Number.isFinite(m.y) || now - (c.lastPing || 0) < 400) return;
      c.lastPing = now;
      const from = room.slots[me];
      for (const s of room.slots) if (s.c && s.team === from.team) send(s.c, { t: 'ping', from: me, name: from.name, x: m.x, y: m.y });
      break;
    }
    case 'over':     // tagged with the match number, so a slow client's late report cannot end the rematch
      if (room && room.started && m.match === room.matchNo) endMatch(room);
      break;
    case 'leave':
      leave(c, true);
      break;
  }
}

function start(port, quiet, turnMs, graceMs) {
  if (turnMs) TURN_MS = turnMs;
  if (graceMs) GRACE_MS = graceMs;
  const server = http.createServer(serve);
  server.on('upgrade', accept);
  const keepalive = setInterval(() => { for (const c of clients) frame(c, Buffer.alloc(0), 9); }, PING_MS);
  keepalive.unref();
  server.on('close', () => clearInterval(keepalive));
  return new Promise(resolve => server.listen(port, () => {
    if (!quiet) {
      console.log(`Risk Taking Strategy server running.\n  This computer:   http://localhost:${server.address().port}`);
      for (const list of Object.values(require('os').networkInterfaces())) for (const a of list) if (a.family === 'IPv4' && !a.internal) console.log(`  Same network:    http://${a.address}:${server.address().port}`);
      console.log('Open that address in Chrome on both computers. Ctrl+C to stop.');
    }
    resolve(server);
  }));
}
module.exports = { start };
if (require.main === module) start(+process.env.PORT || 8080);
