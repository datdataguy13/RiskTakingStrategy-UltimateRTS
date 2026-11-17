// Game session: main loop, mouse/keyboard input, HUD. Talks to the sim only through sim.command().
(function () {
  'use strict';
  const R = window.RTS, T = R.TILE, TPS = R.TPS;
  const $ = id => document.getElementById(id);

  const Snd = R.Snd;
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const game = R.game = {
    sim: null, bots: [], replay: null, log: [], rend: null, me: 0, running: false, paused: false, over: false,
    net: null, sel: [], groups: {}, mode: null, box: null, alert: null, lastAlertTick: -999,
    mouse: { x: 0, y: 0, inside: false, down: false, sx: 0, sy: 0 }, keys: {},
    acc: 0, last: 0, cardKey: '', hudTick: 0, msgT: 0, lastGroup: { k: '', t: 0 }, mmDrag: false, onEnd: null
  };
  const cv = $('game'), mm = $('minimap');

  // o: { seed, theme, players: [{ faction, team, ai: difficulty|null, name }], me }
  //    + net (multiplayer), or replay: a recorded match to play back, or ff: ticks to fast-forward (testing)
  game.start = function (o) {
    this.opts = o; this.net = o.net || null; this.me = o.me || 0;
    const sim = this.sim = new R.Sim({ seed: o.seed, theme: o.theme, players: o.players.map(p => ({ faction: p.faction, team: p.team, ai: !!p.ai, name: p.name })) });
    // computer players think on this machine. In multiplayer every client runs the same ones and reaches the same decisions.
    this.bots = o.players.map((p, i) => p.ai ? new R.AI(sim, i, p.ai) : null).filter(Boolean);
    this.replay = o.replay ? { log: o.replay.log, i: 0, speed: 1, end: o.replay.ticks } : null;
    this.log = [];                                  // every command with the tick it was applied on: the replay
    if (o.net) { o.net.pre = () => { for (const b of this.bots) b.update(); }; o.net.onCmd = c => this.log.push([sim.tick, c]); }
    this.rend = new R.Renderer(cv, mm, sim, this.me);
    this.sel = []; this.groups = {}; this.mode = null; this.box = null; this.alert = null; this.lastAlertTick = -999;
    this.paused = false; this.over = false; this.acc = 0; this.cardKey = ''; this.keys = {}; this.hudTick = 5; this.outSeen = false;
    for (let i = 0; i < (o.ff || 0) && !o.net && sim.winner < 0; i++) { localTick(); sim.events.length = 0; }
    this.rend.center(sim.players[this.me].home.x, sim.players[this.me].home.y + 1.5);
    $('pause').classList.add('hidden');
    $('pause-title').textContent = o.net ? 'Menu' : 'Paused';
    $('btn-pause').textContent = o.net ? 'Menu (P)' : 'Pause (P)';
    $('pause-note').textContent = o.net ? 'The battle continues while this menu is open. Quitting surrenders the match.' : '';
    $('quit').textContent = o.net ? 'Surrender and quit' : 'Quit to menu';
    $('rp').classList.toggle('hidden', !this.replay);
    for (const b of $('rp').querySelectorAll('[data-s]')) b.classList.toggle('on', b.dataset.s === '1');
    $('chat-log').innerHTML = ''; this.chatClose(); this.wait(null);
    if (this.replay) this.view(this.me);
    const mine = sim.players[this.me], foes = sim.players.filter(p => p.team !== mine.team), allies = sim.players.filter(p => p.team === mine.team && p !== mine);
    this.say(this.replay ? 'Replay — use the controls at the top to change speed or switch sides.'
      : `${mine.name}${allies.length ? ' with ' + allies.map(p => p.name).join(', ') : ''} vs ${foes.map(p => p.name).join(', ')} — destroy every enemy building.`);
    Snd.say('Command link established.', 'eva');
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(frame); }
  };
  // one tick of a local (single-player or replay) match
  function localTick() {
    const s = game.sim, rp = game.replay;
    if (rp) while (rp.i < rp.log.length && rp.log[rp.i][0] <= s.tick) s.command(rp.log[rp.i++][1]);
    for (const b of game.bots) b.update();
    s.step();
  }
  // The connection belongs to the lobby (main.js), which keeps it for a rematch: stopping only lets go of it.
  game.stop = function () { this.running = false; if (this.net) { this.net.pre = null; this.net.onCmd = null; this.net = null; } };
  // Everything needed to play this match back: same seed, same players, same commands on the same ticks.
  game.replayData = function () {
    const o = this.opts;
    return { v: 1, date: Date.now(), seed: o.seed, theme: this.sim.theme, players: o.players.map(p => ({ faction: p.faction, team: p.team, ai: p.ai || null, name: p.name || '' })),
      me: this.me, ticks: this.sim.tick, winner: this.sim.winner, log: this.log };
  };
  game.pname = function (i) { const p = this.sim.players[i]; return p.label || p.name; };
  game.watching = function () { return !!this.replay || !this.sim.players[this.me].alive; };   // no orders: a replay, or you are out
  // look at the match from another player's side (replays)
  game.view = function (i) {
    this.me = i; this.rend.me = i; this.rend.fogV = -1; this.sel = []; this.mode = null; this.cardKey = '';
    $('rp-view').textContent = 'Viewing: ' + this.pname(i);
  };
  game.say = function (text, bad) {
    const m = $('msg'); m.textContent = text; m.className = bad ? 'bad show' : 'show'; this.msgT = 3.5;
    if (bad) Snd.play('err');
  };
  game.cmd = function (c) {
    if (this.watching()) return;
    if (c.x !== undefined) { c.x = Math.round(c.x * 100) / 100; c.y = Math.round(c.y * 100) / 100; }
    if (this.net) this.net.cmd(c);                 // multiplayer: the server schedules it for every player
    else { c.player = this.me; this.sim.command(c); this.log.push([this.sim.tick, c]); }
  };
  // ----- chat, map pings, connection banner -----
  game.chat = function (name, color, text, team) {
    const log = $('chat-log'), el = document.createElement('div');
    el.innerHTML = `<b style="color:${color}">${esc(name)}${team ? ' (allies)' : ''}:</b> ${esc(text)}`;
    log.appendChild(el);
    while (log.children.length > 8) log.removeChild(log.firstChild);
    setTimeout(() => el.classList.add('old'), 12000);
    Snd.play('click');
  };
  game.chatOpen = function () {
    if (!this.net) return;
    const allies = this.sim.players.some(p => p.team === this.sim.players[this.me].team && p.id !== this.me && !p.ai);
    this.chatTeam = allies && this.chatTeam !== false;
    $('chat-scope').textContent = this.chatTeam ? 'Allies' : 'All';
    $('chat-scope').classList.toggle('hidden', !allies);
    $('chat-row').classList.remove('hidden'); $('chat-in').value = ''; $('chat-in').focus();
    this.keys = {};
  };
  game.chatClose = function () { $('chat-row').classList.add('hidden'); $('chat-in').blur(); };
  game.pingMap = function (x, y) {
    if (this.net) this.net.send({ t: 'ping', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    else this.onPing(this.me, x, y);
  };
  game.onPing = function (from, x, y) {
    if (!this.running || !(x >= 0 && y >= 0 && x < this.sim.W && y < this.sim.H)) return;
    this.rend.beacon(x, y, this.sim.players[from] ? this.sim.players[from].color : '#fff');
    Snd.play('ping');
  };
  game.wait = function (text) { const el = $('netwait'); el.textContent = text || ''; el.classList.toggle('hidden', !text); };
  game.world = function () { const c = this.rend.cam, m = this.mouse; return { x: (m.x + c.x) / T, y: (m.y + c.y) / T }; };
  game.ownUnits = function () {
    const out = [];
    for (const id of this.sel) { const e = this.sim.byId.get(id); if (e && e.owner === this.me && e.kind === 'unit') out.push(e); }
    return out;
  };
  game.single = function () { return this.sel.length === 1 ? this.sim.byId.get(this.sel[0]) : null; };
  game.pick = function (x, y) {
    const s = this.sim, p = s.players[this.me], i = (y | 0) * s.W + (x | 0);
    let best = null, bd = 1e9;
    for (const e of s.ents) {
      if (e.dead || e.kind !== 'unit' || (e.owner !== this.me && !p.visible[i])) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < e.def.r + 0.3 && d < bd) { bd = d; best = e; }
    }
    if (best) return best;
    for (const e of s.ents) {
      if (e.dead || e.kind === 'unit' || (e.kind === 'seep' && e.covered)) continue;
      if (x >= e.tx && y >= e.ty && x < e.tx + e.w && y < e.ty + e.h && (e.owner === this.me || p.explored[i])) return e;
    }
    return null;
  };
  game.ghost = function () {
    if (!this.mode || !this.mode.place) return null;
    const type = this.mode.place, d = this.sim.players[this.me].defs.buildings[type], w = this.world();
    let tx = Math.floor(w.x - d.w / 2 + 0.5), ty = Math.floor(w.y - d.h / 2 + 0.5);
    if (type === 'derrick') for (const e of this.sim.ents) if (e.kind === 'seep' && !e.covered && Math.hypot(e.x - w.x, e.y - w.y) < 2.2) { tx = e.tx; ty = e.ty; }
    return { type, tx, ty, ok: !this.sim.canPlace(this.me, type, tx, ty) };
  };

  // ----- command card -----
  game.card = function () {
    const s = this.sim, p = s.players[this.me], items = [], one = this.single();
    const costOf = d => '$' + d.cash + (d.oil ? ` · ${d.oil} oil` : '');
    if (this.watching()) return items;
    if (one && one.owner === this.me && one.type === 'techlab' && one.built) {
      for (const key of R.RESEARCH_ORDER) {
        const r = R.RESEARCH[key], lvl = p.research[key], spec = r.levels[lvl], doc = key === 'doctrine';
        const name = doc ? p.doctrine.name : r.name + ' ' + ['I', 'II', 'II'][lvl];
        items.push({ act: 'research:' + key, name, key: r.key, cost: spec ? (p.busy[key] ? 'in progress' : costOf(spec)) : 'researched',
          lock: !spec || !!p.busy[key] || !!one.res, poor: !!spec && (p.cash < spec.cash || p.oil < spec.oil),
          tip: (doc ? p.doctrine.desc : r.desc) + (spec ? `\nTakes ${spec.time} seconds.` : '\nFully researched.') });
      }
      items.push({ act: 'cancel', name: 'Cancel', key: 'x', cost: 'research', lock: !one.res, tip: 'Cancel the research in progress for a full refund.' });
    } else if (one && one.owner === this.me && one.type === 'silo' && one.built) {
      const left = Math.ceil((one.def.charge * TPS - one.charge) / TPS);
      items.push({ act: 'strike', name: 'Launch ' + p.strike.name, key: 'l', cost: left > 0 ? `charging ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'ready — then click', lock: left > 0, on: this.mode === 'strike',
        tip: 'Click anywhere on the map or minimap to strike there. Every player is warned and sees where it will land a few seconds before it hits.' });
    } else if (one && one.owner === this.me && one.kind === 'building' && one.built && Object.values(p.defs.units).some(u => u.from === one.type)) {
      for (const [t, d] of Object.entries(p.defs.units)) {
        if (d.from !== one.type) continue;
        const need = d.req && !s.has(this.me, d.req);
        items.push({ act: 'train:' + t, icon: R.icon(p.faction, t, p.color), name: d.name, key: d.key, cost: costOf(d), lock: need, poor: p.cash < d.cash || p.oil < d.oil,
          tip: `${d.desc}${d.dmg ? `\nHP ${d.hp} · Damage ${d.dmg}${d.volley ? ' ×' + d.volley : ''} · Range ${d.range}` : `\nHP ${d.hp}`} · Food ${d.supply * (d.count || 1)}${need ? `\nRequires ${p.defs.buildings[d.req].name}` : ''}` });
      }
      items.push({ act: 'rally', name: 'Rally Point', key: 'l', cost: 'then click', on: this.mode === 'rally', tip: 'New units gather where you click. Click an ore deposit to send new Workers straight to mining.\nShortcut: right-click the map with this building selected.' });
      items.push({ act: 'cancel', name: 'Cancel', key: 'x', cost: 'last in queue', lock: !one.queue.length, tip: 'Cancel the last queued unit for a full refund.' });
    } else {
      for (const [t, d] of Object.entries(p.defs.buildings)) {
        const need = d.req && !s.has(this.me, d.req);
        items.push({ act: 'build:' + t, icon: R.icon(p.faction, t, p.color), name: d.name, key: d.key, cost: costOf(d), lock: need, poor: p.cash < d.cash || p.oil < d.oil, on: this.mode && this.mode.place === t,
          tip: `${d.desc}${need ? `\nRequires ${p.defs.buildings[d.req].name}` : ''}` });
      }
      if (this.ownUnits().some(u => u.type === 'worker'))
        items.push({ act: 'repair', name: 'Repair', key: 'e', cost: 'then click', on: this.mode === 'repair', tip: 'Send the selected Workers to repair a damaged building or finish a construction site. Repairs cost a little cash.\nShortcut: right-click the building with Workers selected.' });
      if (this.ownUnits().some(u => u.cargo && u.cargo.length))
        items.push({ act: 'drop', name: 'Paradrop', key: 'u', cost: 'then click', on: this.mode === 'drop', tip: 'The selected transports fly to the point you click and parachute their troops there.\nClick right under a transport to unload on the spot.' });
      if (this.ownUnits().length) {
        items.push({ act: 'amove', name: 'Attack-Move', key: 'a', cost: 'then click', on: this.mode === 'amove', tip: 'Advance to a point, engaging anything on the way.' });
        items.push({ act: 'stop', name: 'Stop', key: 's', cost: '', tip: 'Halt and hold here.' });
      }
    }
    return items;
  };
  game.act = function (act, shift) {
    const s = this.sim, p = s.players[this.me], [verb, arg] = act.split(':');
    Snd.play('click');
    if (verb === 'build') {
      const d = p.defs.buildings[arg];
      if (d.req && !s.has(this.me, d.req)) return this.say('Requires ' + p.defs.buildings[d.req].name, true);
      this.mode = { place: arg };
    } else if (verb === 'train') {
      const b = this.single();
      if (b) for (let i = 0; i < (shift ? 5 : 1); i++) this.cmd({ type: 'train', building: b.id, utype: arg });
    } else if (verb === 'research') {
      const b = this.single(); if (b) this.cmd({ type: 'research', building: b.id, key: arg });
    } else if (verb === 'strike') {
      const b = this.single();
      if (b && b.charge >= b.def.charge * TPS) this.mode = 'strike'; else this.say('Still charging', true);
    } else if (verb === 'cancel') {
      const b = this.single(); if (b) this.cmd({ type: 'cancel', building: b.id });
    } else if (verb === 'amove') { if (this.ownUnits().length) this.mode = 'amove'; }
    else if (verb === 'repair' || verb === 'rally' || verb === 'drop') this.mode = verb;
    else if (verb === 'stop') this.cmd({ type: 'stop', ids: this.ownUnits().map(u => u.id) });
  };

  // ----- orders -----
  game.smartOrder = function (x, y) {
    const us = this.ownUnits(), one = this.single();
    if (us.length) {
      const ids = us.map(u => u.id), t = this.pick(x, y);
      if (t && this.sim.hostile(this.me, t.owner)) { this.cmd({ type: 'attack', ids, target: t.id }); this.rend.ping(t.x, t.y, '#ff5a5a'); if (us.some(u => u.def.dmg)) Snd.ack(this.sim.players[this.me].faction, 'attack'); }
      else if (t && t.owner === this.me && t.cargo && us.some(u => u.def.armor === 'inf')) {
        if (t.cargo.length >= t.def.cap) this.say('That transport is full', true);
        else { this.cmd({ type: 'load', ids, target: t.id }); this.rend.ping(t.x, t.y, '#7fd0ff'); }
      }
      else if (t && this.fixable(t) && us.some(u => u.type === 'worker')) { this.cmd({ type: 'repair', ids, target: t.id }); this.rend.ping(t.x, t.y, '#ffd65a'); }
      else if (t && t.kind === 'ore' && us.some(u => u.type === 'worker')) { this.cmd({ type: 'gather', ids, target: t.id }); this.rend.ping(t.x, t.y, '#ffe27a'); }
      else { this.cmd({ type: 'move', ids, x, y }); this.rend.ping(x, y, '#6dff8a'); if (us.some(u => u.def.dmg)) Snd.ack(this.sim.players[this.me].faction, 'move'); }
      Snd.play('click');
    } else if (one && one.owner === this.me && one.kind === 'building') this.setRally(one, x, y);
  };
  game.fixable = function (t) { return t.kind === 'building' && t.owner === this.me && (!t.built || t.hp < t.maxHp); };
  game.launch = function (x, y) {
    const b = this.single();
    if (b && b.type === 'silo') { this.cmd({ type: 'strike', building: b.id, x, y }); Snd.play('click'); }
    this.mode = null;
  };
  game.setRally = function (b, x, y) {
    if (!Object.values(this.sim.players[this.me].defs.units).some(u => u.from === b.type)) return;
    const t = this.pick(x, y);
    this.cmd({ type: 'rally', building: b.id, x, y, node: t && t.kind === 'ore' ? t.id : 0 });
    this.rend.ping(x, y, '#6dff8a'); Snd.play('click');
  };

  // ----- mouse -----
  cv.addEventListener('mousedown', e => {
    if (!game.running || game.over) return;
    const m = game.mouse; m.x = e.clientX; m.y = e.clientY;
    const w = game.world();
    if (e.button === 0 && e.altKey) return game.pingMap(w.x, w.y);
    if (game.watching()) { if (e.button === 0) { m.down = true; m.sx = m.x; m.sy = m.y; } return; }
    if (e.button === 0) {
      if (game.mode === 'strike') game.launch(w.x, w.y);
      else if (game.mode && game.mode.place) {
        const gh = game.ghost();
        game.cmd({ type: 'build', btype: gh.type, tx: gh.tx, ty: gh.ty, ids: game.ownUnits().filter(u => u.type === 'worker').map(u => u.id) });
        if (!gh.ok) game.say(game.sim.canPlace(game.me, gh.type, gh.tx, gh.ty), true);
        else if (!e.shiftKey) game.mode = null;
      } else if (game.mode === 'amove') {
        game.cmd({ type: 'amove', ids: game.ownUnits().map(u => u.id), x: w.x, y: w.y });
        game.rend.ping(w.x, w.y, '#ff9a4a'); game.mode = null; Snd.play('click'); Snd.ack(game.sim.players[game.me].faction, 'attack');
      } else if (game.mode === 'drop') {
        game.cmd({ type: 'drop', ids: game.ownUnits().map(u => u.id), x: w.x, y: w.y });
        game.rend.ping(w.x, w.y, '#7fd0ff'); game.mode = null; Snd.play('click'); Snd.ack(game.sim.players[game.me].faction, 'move');
      } else if (game.mode === 'rally') {
        const b = game.single(); if (b) game.setRally(b, w.x, w.y);
        game.mode = null;
      } else if (game.mode === 'repair') {
        const t = game.pick(w.x, w.y);
        if (t && game.fixable(t)) { game.cmd({ type: 'repair', ids: game.ownUnits().map(u => u.id), target: t.id }); game.rend.ping(t.x, t.y, '#ffd65a'); Snd.play('click'); game.mode = null; }
        else game.say(t && t.kind === 'building' && t.owner === game.me ? 'That building is not damaged' : 'Click one of your damaged buildings', true);
      } else { m.down = true; m.sx = m.x; m.sy = m.y; }
    } else if (e.button === 2) {
      if (game.mode) game.mode = null; else game.smartOrder(w.x, w.y);
    }
  });
  window.addEventListener('mousemove', e => {
    const m = game.mouse; m.x = e.clientX; m.y = e.clientY; m.inside = true;
    if (m.down && Math.hypot(m.x - m.sx, m.y - m.sy) > 5)
      game.box = { x0: Math.min(m.x, m.sx), y0: Math.min(m.y, m.sy), x1: Math.max(m.x, m.sx), y1: Math.max(m.y, m.sy) };
    if (game.mmDrag) mmMove(e);
  });
  document.addEventListener('mouseleave', () => { game.mouse.inside = false; });
  window.addEventListener('mouseup', e => {
    game.mmDrag = false;
    const m = game.mouse;
    if (e.button !== 0 || !m.down || !game.running) return;
    m.down = false;
    const s = game.sim, c = game.rend.cam;
    if (game.box) {
      const b = game.box; game.box = null;
      const x0 = (b.x0 + c.x) / T, y0 = (b.y0 + c.y) / T, x1 = (b.x1 + c.x) / T, y1 = (b.y1 + c.y) / T;
      let us = s.ents.filter(u => u.kind === 'unit' && u.owner === game.me && !u.dead && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
      if (us.some(u => u.type !== 'worker')) us = us.filter(u => u.type !== 'worker');
      if (us.length) {
        const ids = us.map(u => u.id);
        game.sel = e.shiftKey ? Array.from(new Set(game.ownUnits().map(u => u.id).concat(ids))) : ids;
        if (us.some(u => u.def.dmg)) Snd.ack(s.players[game.me].faction, 'select');
      }
    } else {
      const w = game.world(), t = game.pick(w.x, w.y);
      if (!t) { if (!e.shiftKey) game.sel = []; }
      else if (e.shiftKey && t.owner === game.me && t.kind === 'unit') {
        const cur = game.ownUnits().map(u => u.id), i = cur.indexOf(t.id);
        if (i >= 0) cur.splice(i, 1); else cur.push(t.id);
        game.sel = cur;
      } else game.sel = [t.id];
    }
  });
  cv.addEventListener('dblclick', () => {
    const w = game.world(), t = game.pick(w.x, w.y);
    if (!t || t.owner !== game.me || t.kind !== 'unit') return;
    game.sel = game.sim.ents.filter(u => u.kind === 'unit' && u.owner === game.me && u.type === t.type && game.rend.onScreen(u.x, u.y, 0)).map(u => u.id);
  });
  window.addEventListener('contextmenu', e => e.preventDefault());

  function mmPos(e) {
    const r = mm.getBoundingClientRect(), s = game.sim;
    return { x: Math.max(0, Math.min(s.W - 0.01, (e.clientX - r.left) / r.width * s.W)), y: Math.max(0, Math.min(s.H - 0.01, (e.clientY - r.top) / r.height * s.H)) };
  }
  function mmMove(e) { const p = mmPos(e); game.rend.center(p.x, p.y); }
  mm.addEventListener('mousedown', e => {
    if (!game.running) return;
    if (e.button === 0) {
      if (e.altKey) { const p = mmPos(e); game.pingMap(p.x, p.y); }
      else if (game.mode === 'strike') { const p = mmPos(e); game.launch(p.x, p.y); }
      else if (game.mode === 'amove') { const p = mmPos(e); game.cmd({ type: 'amove', ids: game.ownUnits().map(u => u.id), x: p.x, y: p.y }); game.mode = null; }
      else { game.mmDrag = true; mmMove(e); }
    } else if (e.button === 2) { const p = mmPos(e); game.smartOrder(p.x, p.y); }
  });

  // ----- command card + tooltip -----
  const cardEl = $('card'), tip = $('tip');
  cardEl.addEventListener('mousedown', e => {
    const b = e.target.closest('button');
    if (b && e.button === 0) game.act(b.dataset.act, e.shiftKey);
  });
  cardEl.addEventListener('mouseover', e => {
    const b = e.target.closest('button');
    if (!b) return;
    tip.textContent = b.dataset.tip; tip.classList.remove('hidden');
  });
  cardEl.addEventListener('mouseleave', () => tip.classList.add('hidden'));

  // ----- keyboard -----
  const typing = e => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  $('chat-in').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') game.chatClose();
    else if (e.key === 'Tab') { e.preventDefault(); if (!$('chat-scope').classList.contains('hidden')) { game.chatTeam = !game.chatTeam; $('chat-scope').textContent = game.chatTeam ? 'Allies' : 'All'; } }
    else if (e.key === 'Enter') {
      const text = $('chat-in').value.trim();
      if (text && game.net) game.net.send({ t: 'chat', text, team: !!game.chatTeam });
      game.chatClose();
    }
  });
  $('chat-in').addEventListener('keyup', e => e.stopPropagation());
  $('chat-scope').addEventListener('mousedown', e => { e.preventDefault(); game.chatTeam = !game.chatTeam; $('chat-scope').textContent = game.chatTeam ? 'Allies' : 'All'; });
  $('rp').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !game.replay) return;
    if (b.dataset.s) { game.replay.speed = +b.dataset.s; for (const x of $('rp').querySelectorAll('[data-s]')) x.classList.toggle('on', x === b); }
    else game.view((game.me + 1) % game.sim.players.length);
  });
  window.addEventListener('keydown', e => {
    if (!game.running || game.over || typing(e)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    game.keys[k] = true;
    if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
    if (e.repeat) return;
    if (k === 'p') return game.togglePause();
    if (k === 'Enter') { e.preventDefault(); return game.chatOpen(); }
    if (game.paused && !game.net) { if (k === 'Escape') game.togglePause(); return; }
    if (k === 'Escape') { if (game.mode) game.mode = null; else game.sel = []; return; }
    if (k === 'm') return game.say(Snd.cycle());
    if (k >= '0' && k <= '9') {
      if (e.ctrlKey || e.metaKey || e.altKey) { game.groups[k] = game.ownUnits().map(u => u.id); e.preventDefault(); return game.say('Group ' + k + ' set'); }
      const ids = (game.groups[k] || []).filter(id => game.sim.byId.has(id));
      if (!ids.length) return;
      game.sel = ids;
      const now = performance.now();
      if (game.lastGroup.k === k && now - game.lastGroup.t < 400) { const u = game.sim.byId.get(ids[0]); game.rend.center(u.x, u.y); }
      game.lastGroup = { k, t: now };
      return;
    }
    if (k === 'h') {
      const hq = game.sim.ents.find(b => b.owner === game.me && b.type === 'hq');
      if (hq) { game.sel = [hq.id]; game.rend.center(hq.x, hq.y); }
      return;
    }
    if (k === ' ') { if (game.alert) game.rend.center(game.alert.x, game.alert.y); return; }
    if (e.ctrlKey || e.metaKey) return;
    const it = game.card().find(i => i.key === k);
    if (it) game.act(it.act, e.shiftKey);
  });
  window.addEventListener('keyup', e => { if (typing(e)) return; game.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  window.addEventListener('blur', () => { game.keys = {}; game.mouse.inside = false; game.mouse.down = false; game.box = null; });
  window.addEventListener('resize', () => { if (game.rend) game.rend.resize(); });

  game.togglePause = function () {
    if (this.over) return;
    this.paused = !this.paused;
    $('pause').classList.toggle('hidden', !this.paused);
  };

  // ----- HUD -----
  function hud() {
    const s = game.sim, p = s.players[game.me];
    $('r-cash').textContent = Math.floor(p.cash);
    $('r-oil').textContent = Math.floor(p.oil);
    $('r-food').textContent = p.used + ' / ' + p.cap;
    $('r-food').parentNode.classList.toggle('warn', p.cap - p.used < 2);
    const sec = Math.floor(s.tick / TPS);
    $('clock').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');

    const items = game.card();
    const key = items.map(i => i.act + i.name + i.cost + (i.lock ? 'L' : '') + (i.poor ? 'P' : '') + (i.on ? 'O' : '')).join('|');
    if (key !== game.cardKey) {
      game.cardKey = key;
      cardEl.innerHTML = items.map(i => `<button class="cb${i.lock ? ' lock' : ''}${i.poor ? ' poor' : ''}${i.on ? ' on' : ''}" data-act="${i.act}" data-tip="${esc(i.name + '\n' + i.tip)}">${i.icon ? `<img src="${i.icon}" alt="">` : ''}<i>${i.key.toUpperCase()}</i><b>${esc(i.name)}</b><span>${esc(i.cost)}</span></button>`).join('');
    }

    // selection info
    const info = $('info'), one = game.single(), us = game.ownUnits();
    let h = '';
    const ico = (e, cls) => `<img class="${cls || 'ico'}" src="${R.icon(s.players[e.owner].faction, e.type, s.players[e.owner].color)}" alt="">`;
    const hp = e => `<div class="hp"><div style="width:${Math.max(0, 100 * e.hp / e.maxHp)}%"></div></div><small>${Math.ceil(e.hp)} / ${e.maxHp} HP</small>`;
    if (one) {
      if (one.kind === 'ore') h = `<h3>Ore Deposit</h3><p>${one.amount} cash remaining</p><p class="dim">Right-click with Workers selected to mine.</p>`;
      else if (one.kind === 'seep') h = `<h3>Oil Seep</h3><p class="dim">Build an Oil Derrick here (D) for a steady oil income.</p>`;
      else {
        const d = one.def, foe = one.owner !== game.me, ally = foe && !s.hostile(game.me, one.owner);
        h = `${ico(one, 'big')}<h3 style="color:${s.players[one.owner].color}">${one.rank ? R.RANKS[one.rank] + ' ' : ''}${esc(d.name)}${ally ? ' <em class="ally">ally</em>' : foe ? ' <em>enemy</em>' : ''}</h3>${hp(one)}`;
        if (foe && s.players.length > 2) h += `<p class="dim">${esc(game.pname(one.owner))}</p>`;
        if (one.kind === 'unit') {
          h += `<p>${d.dmg ? `Damage ${one.rank ? +(d.dmg * (1 + R.VET_DMG * one.rank)).toFixed(1) : d.dmg} (${d.dtype}) · Range ${d.range}` : 'Unarmed'} · Armor ${{ inf: 'infantry', light: 'light', heavy: 'heavy' }[d.armor]}</p>`;
          if (d.dmg && !foe) {
            const own = d.cash + (d.oil || 0), next = one.rank < 2 ? own * R.VET_AT[one.rank] : 0;
            h += `<p class="dim">${one.rank === 2 ? 'Elite: +30% damage, +20% health, heals itself.' : `Destroyed $${Math.round(one.xp)} of enemy assets — ${R.RANKS[one.rank + 1]} at $${next}.`}</p>`;
          }
          if (one.cargo && !foe) {
            const c = {}; for (const v of one.cargo) c[v.type] = (c[v.type] || 0) + 1;
            h += `<p>Carrying ${one.cargo.length} / ${d.cap} infantry</p><p class="queue">${Object.entries(c).map(([t, k]) => `<span><img src="${R.icon(p.faction, t, p.color)}" alt="">${esc(p.defs.units[t].name)} ×${k}</span>`).join('')}</p>`;
            h += `<p class="dim">${one.cargo.length ? 'U, then click: parachute the troops there.' : 'Select infantry and right-click this aircraft to board.'}</p>`;
          }
          if (one.type === 'worker' && !foe) {
            const job = s.byId.get(one.order.b);
            h += `<p class="dim">${one.order.type === 'gather' ? 'Mining ore' : one.order.type === 'build' && job ? (job.built ? 'Repairing ' : 'Building ') + esc(job.def.name) : 'Idle — right-click ore to mine, or a damaged building to repair'}</p>`;
          }
        } else if (!one.built) h += `<p>Under construction — ${Math.floor(one.progress * 100)}%</p>` + (!foe && one.work < s.tick - 20 ? '<p class="dim">Waiting for a Worker. Right-click here with a Worker selected.</p>' : '');
        else if (!foe) {
          if (one.hp < one.maxHp) h += '<p class="dim">Damaged — right-click here with Workers to repair.</p>';
          if (d.supply) h += `<p>Provides ${d.supply} food</p>`;
          if (d.oilRate) h += `<p>Pumping ${d.oilRate} oil / sec</p>`;
          if (one.type === 'techlab') {
            const done = R.RESEARCH_ORDER.filter(k => p.research[k]).map(k => k === 'doctrine' ? p.doctrine.name : R.RESEARCH[k].name + ' ' + ['', 'I', 'II'][p.research[k]]);
            if (one.res) h += `<p>Researching ${esc(one.res.key === 'doctrine' ? p.doctrine.name : R.RESEARCH[one.res.key].name)}</p><div class="hp prog"><div style="width:${100 * (1 - one.res.left / one.res.total)}%"></div></div>`;
            h += `<p class="dim">${done.length ? 'Researched: ' + esc(done.join(', ')) : 'Pick an upgrade on the right to research it.'}</p>`;
          }
          if (d.charge) {
            const f = one.charge / (d.charge * TPS);
            h += `<p>${esc(p.strike.name)} — ${f >= 1 ? 'ready to launch (L)' : 'charging'}</p><div class="hp prog"><div style="width:${100 * f}%"></div></div>`;
          }
          if (one.queue.length) {
            const q = one.queue[0];
            h += `<p>Training ${esc(p.defs.units[q.type].name)}</p><div class="hp prog"><div style="width:${100 * (1 - q.left / q.total)}%"></div></div>`;
            h += `<p class="queue">${one.queue.map(x => `<span><img src="${R.icon(p.faction, x.type, p.color)}" alt="">${esc(p.defs.units[x.type].name)}</span>`).join('')}</p>`;
          }
        }
      }
    } else if (us.length) {
      const c = {};
      for (const u of us) c[u.type] = (c[u.type] || 0) + 1;
      h = `<h3>${us.length} units selected</h3><p class="queue">${Object.entries(c).map(([t, k]) => `<span><img src="${R.icon(p.faction, t, p.color)}" alt="">${esc(p.defs.units[t].name)} ×${k}</span>`).join('')}</p><p class="dim">Right-click: move / attack · A: attack-move · Ctrl+1-9: save group</p>`;
    } else {
      if (game.watching()) h = `<img class="big" src="${R.emblemIcon(p.faction)}" alt=""><h3 style="color:${p.color}">${esc(game.pname(game.me))}</h3><p class="dim">${game.replay ? 'Replay. Click a unit or building to inspect it.' : 'You have been eliminated. You can keep watching your allies fight.'}</p>`;
      else h = `<img class="big" src="${R.emblemIcon(p.faction)}" alt=""><h3 style="color:${p.color}">${esc(p.name)}</h3><p class="dim">Drag to select units. Right-click to move, attack or mine.<br>Pick a structure on the right, then click the map to build it.<br>H: go to base · Space: jump to last alert · P: pause</p>`;
    }
    if (info._h !== h) { info.innerHTML = h; info._h = h; }
  }

  function events() {
    const s = game.sim;
    for (const ev of s.events) {
      if (ev.type === 'msg') { if (ev.player === game.me) { game.say(ev.text, true); if (/cash|oil/.test(ev.text)) Snd.say('Insufficient funds.', 'eva'); } }
      else if (ev.type === 'placed') { if (ev.owner === game.me) Snd.play('place'); }
      else if (ev.type === 'built') {
        if (ev.owner === game.me) { game.say(ev.name + ' complete'); Snd.play('done'); Snd.say('Construction complete.', 'eva'); }
        else if (ev.btype === 'silo') { const foe = s.hostile(game.me, ev.owner); game.say(`${game.pname(ev.owner)} has built a superweapon`, foe); if (foe) { Snd.play('alert'); Snd.say('Warning. Enemy superweapon detected.', 'eva'); } }
      }
      else if (ev.type === 'jump') { /* drawn from unit state */ }
      else if (ev.type === 'trained') { if (ev.owner === game.me) { Snd.play('unit'); Snd.say('Unit ready.', 'eva'); } }
      else if (ev.type === 'researched') { if (ev.owner === game.me) { game.say((ev.key === 'doctrine' ? s.players[game.me].doctrine.name : R.RESEARCH[ev.key].name + ' ' + ['', 'I', 'II'][ev.level]) + ' researched'); Snd.play('done'); Snd.say('Research complete.', 'eva'); } }
      else if (ev.type === 'charged') { if (ev.owner === game.me) { game.say(ev.name + ' is ready to launch'); Snd.play('done'); Snd.say('Superweapon ready.', 'eva'); } }
      else if (ev.type === 'strike') {
        const foe = s.hostile(game.me, ev.owner);
        game.say(`${ev.name} launched by ${game.pname(ev.owner)}!` + (foe ? ' (Space to jump there)' : ''), foe);
        Snd.play('siren'); Snd.say(foe ? 'Warning. Superweapon launch detected.' : 'Superweapon launched.', 'eva');
        if (foe) game.alert = { x: ev.x, y: ev.y, t: 6 };
        game.rend.onEvent(ev);
      }
      else if (ev.type === 'out') {
        if (s.winner < 0 && s.players.length > 2) game.say(`${game.pname(ev.player)} has been eliminated`, ev.player === game.me || !s.hostile(game.me, ev.player));
      }
      else game.rend.onEvent(ev);
    }
    s.events.length = 0;
    const la = s.players[game.me].lastAttack;
    if (la && la.tick === s.tick) {
      if (s.tick - game.lastAlertTick > 240 && !game.rend.onScreen(la.x, la.y, 0)) {
        game.say('We are under attack! (Space to jump there)', true); Snd.play('alert'); Snd.say('Our forces are under attack.', 'eva');
        game.lastAlertTick = s.tick;
      }
      game.alert = { x: la.x, y: la.y, t: 4 };
    }
  }

  function checkEnd() {
    const s = game.sim;
    const rp = game.replay;
    if ((s.winner >= 0 || (rp && s.tick >= rp.end)) && !game.over) { game.over = true; game.mode = null; game.chatClose(); if (game.onEnd) game.onEnd(s.winner === s.players[game.me].team); }
  }
  // Browsers stop animation frames for hidden tabs. A multiplayer match must not stall
  // when a player switches tabs, so keep the simulation in step from a timer instead.
  setInterval(() => {
    if (!document.hidden || !game.running || !game.net || game.over) return;
    for (let i = 0; i < 5; i++) game.net.advance(game.sim, 1, events);
    checkEnd();
  }, 250);

  function frame(ts) {
    if (!game.running) return;
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.1, (ts - game.last) / 1000)); game.last = ts;
    const s = game.sim, r = game.rend;
    if (!game.over && (game.net || !game.paused)) {
      if (game.net) {                      // multiplayer: ticks are released by the server's turn clock
        game.net.advance(s, dt, events);
        game.acc = Math.min(1 / TPS, game.net.acc);
      } else {
        const rp = game.replay, max = rp ? 5 * rp.speed : 5;
        game.acc += dt * (rp ? rp.speed : 1);
        let n = 0;
        while (game.acc >= 1 / TPS && n < max && s.winner < 0 && !(rp && s.tick >= rp.end)) {
          localTick(); events();
          game.acc -= 1 / TPS; n++;
        }
        if (n === max) game.acc = 0;
      }
      checkEnd();
      // camera scroll: arrow keys + screen edges
      const k = game.keys, m = game.mouse, sp = 900 * dt, edge = m.inside && !m.down && !game.mmDrag;
      if (k.ArrowLeft || (edge && m.x <= 3)) r.cam.x -= sp;
      if (k.ArrowRight || (edge && m.x >= r.vw - 4)) r.cam.x += sp;
      if (k.ArrowUp || (edge && m.y <= 3)) r.cam.y -= sp;
      if (k.ArrowDown || (edge && m.y >= r.vh - 4)) r.cam.y += sp;
      r.clampCam();
    }
    game.sel = game.sel.filter(id => s.byId.has(id));
    if (game.alert) game.alert.t -= dt;
    if (game.msgT > 0 && (game.msgT -= dt) <= 0) $('msg').classList.remove('show');
    cv.style.cursor = game.mode ? 'crosshair' : 'default';
    let aim = null;
    if (game.mode === 'strike') { const w = game.world(), k = s.players[game.me].strike; aim = { x: w.x, y: w.y, r: k.radius + k.spread }; }
    r.draw((game.paused && !game.net) || game.over ? 1 : Math.min(1, game.acc * TPS), { sel: new Set(game.sel), box: game.box, ghost: game.ghost(), alert: game.alert, aim }, dt);
    if (++game.hudTick % 6 === 0) hud();
  }
})();
