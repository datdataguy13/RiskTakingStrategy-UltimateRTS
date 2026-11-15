// Risk Takes Strategy — game server. No dependencies: `node server.js`, then open http://localhost:8080
//
// Does two things:
//  1. Serves the game files.
//  2. Runs multiplayer rooms over WebSocket (/ws). The server does not simulate the game.
//     It is the clock: every TURN_MS it sends both players the commands it received,
//     and each player's browser advances its own copy of the (deterministic) simulation.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

require('./js/data.js');   // shared game data: faction and map-theme ids
const ROOT = __dirname, MAX_MSG = 64 * 1024;
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
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.url.split('?')[0] !== '/ws') return socket.destroy();
  const hash = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + hash + '\r\n\r\n');
  socket.setNoDelay(true);
  const c = { socket, room: null, idx: -1, faction: 'liberty', alive: true, buf: Buffer.alloc(0), frag: '' };
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
const rooms = new Map();
function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let s = ''; for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)]; if (!rooms.has(s)) return s; }
}
function lobby(room) {
  room.players.forEach((p, i) => send(p, { t: 'room', code: room.code, you: i, theme: room.theme, players: room.players.map(q => ({ faction: q.faction })) }));
}
function drop(c) {
  if (!c.alive) return;
  c.alive = false;
  try { c.socket.destroy(); } catch (e) { /* gone */ }
  const room = c.room;
  if (!room) return;
  room.players = room.players.filter(p => p !== c);
  if (!room.players.length || room.started) {
    for (const p of room.players) send(p, { t: 'left' });
    clearInterval(room.timer); rooms.delete(room.code);
    for (const p of room.players) p.room = null;
  } else lobby(room);
}
function handle(c, m) {
  const room = c.room;
  switch (m.t) {
    case 'host': {
      if (room) return;
      const r = { code: code(), players: [c], theme: 'grass', started: false, timer: null, turn: 0, cmds: [], hashes: new Map() };
      if (FACTIONS.includes(m.faction)) c.faction = m.faction;
      if (THEMES.includes(m.theme)) r.theme = m.theme;
      rooms.set(r.code, r); c.room = r; lobby(r);
      break;
    }
    case 'join': {
      if (room) return;
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return send(c, { t: 'error', msg: 'No game found with that code' });
      if (r.started || r.players.length >= 2) return send(c, { t: 'error', msg: 'That game is full or already started' });
      if (FACTIONS.includes(m.faction)) c.faction = m.faction;
      r.players.push(c); c.room = r; lobby(r);
      break;
    }
    case 'set':
      if (!room || room.started) return;
      if (FACTIONS.includes(m.faction)) c.faction = m.faction;
      if (THEMES.includes(m.theme) && room.players[0] === c) room.theme = m.theme;
      lobby(room);
      break;
    case 'start': {
      if (!room || room.started || room.players[0] !== c || room.players.length !== 2) return;
      room.started = true;
      const seed = crypto.randomInt(1, 2 ** 30);
      room.players.forEach((p, i) => { p.idx = i; send(p, { t: 'start', seed, theme: room.theme, you: i, factions: room.players.map(q => q.faction) }); });
      room.timer = setInterval(() => {
        const msg = { t: 'turn', n: ++room.turn, c: room.cmds };
        room.cmds = [];
        for (const p of room.players) send(p, msg);
      }, TURN_MS);
      break;
    }
    case 'cmd':
      if (!room || !room.started || !m.c || typeof m.c !== 'object' || typeof m.c.type !== 'string' || room.cmds.length >= 200) return;
      m.c.player = c.idx;            // the server decides who issued it
      room.cmds.push(m.c);
      break;
    case 'hash': {
      if (!room || !room.started || !Number.isInteger(m.n)) return;
      const seen = room.hashes.get(m.n);
      if (seen === undefined) { room.hashes.set(m.n, m.h); if (room.hashes.size > 50) room.hashes.delete(room.hashes.keys().next().value); }
      else { room.hashes.delete(m.n); if (seen !== m.h) for (const p of room.players) send(p, { t: 'desync', n: m.n }); }
      break;
    }
    case 'over':
      if (room && room.started) clearInterval(room.timer);
      break;
  }
}

function start(port, quiet, turnMs) {
  if (turnMs) TURN_MS = turnMs;
  const server = http.createServer(serve);
  server.on('upgrade', accept);
  return new Promise(resolve => server.listen(port, () => {
    if (!quiet) {
      console.log(`Risk Takes Strategy server running.\n  This computer:   http://localhost:${server.address().port}`);
      for (const list of Object.values(require('os').networkInterfaces())) for (const a of list) if (a.family === 'IPv4' && !a.internal) console.log(`  Same network:    http://${a.address}:${server.address().port}`);
      console.log('Open that address in Chrome on both computers. Ctrl+C to stop.');
    }
    resolve(server);
  }));
}
module.exports = { start };
if (require.main === module) start(+process.env.PORT || 8080);
