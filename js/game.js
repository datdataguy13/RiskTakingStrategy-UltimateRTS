// Game session: main loop, mouse/keyboard input, HUD. Talks to the sim only through sim.command().
(function () {
  'use strict';
  const R = window.RTS, T = R.TILE, TPS = R.TPS;
  const $ = id => document.getElementById(id);

  const Snd = R.Snd;

  const game = R.game = {
    sim: null, ai: null, rend: null, me: 0, running: false, paused: false, over: false,
    net: null, sel: [], groups: {}, mode: null, box: null, alert: null, lastAlertTick: -999,
    mouse: { x: 0, y: 0, inside: false, down: false, sx: 0, sy: 0 }, keys: {},
    acc: 0, last: 0, cardKey: '', hudTick: 0, msgT: 0, lastGroup: { k: '', t: 0 }, mmDrag: false, onEnd: null
  };
  const cv = $('game'), mm = $('minimap');

  // o: { seed, theme, faction, difficulty } vs computer, or { seed, theme, net, me, factions } for multiplayer
  game.start = function (o) {
    this.opts = o; this.net = o.net || null; this.me = o.net ? o.me : 0;
    let players;
    if (o.net) players = o.factions.map(f => ({ faction: f }));
    else {
      const others = R.FACTION_ORDER.filter(f => f !== o.faction);
      players = [{ faction: o.faction }, { faction: o.foe || others[(o.seed >>> 3) % others.length], ai: true }];
    }
    this.sim = new R.Sim({ seed: o.seed, theme: o.theme, players });
    this.ai = o.net ? null : new R.AI(this.sim, 1, o.difficulty);
    this.demo = o.demo && !o.net ? new R.AI(this.sim, 0, 'hard') : null;   // ?demo=1: computer plays your side too
    this.rend = new R.Renderer(cv, mm, this.sim, this.me);
    this.sel = []; this.groups = {}; this.mode = null; this.box = null; this.alert = null; this.lastAlertTick = -999;
    this.paused = false; this.over = false; this.acc = 0; this.cardKey = ''; this.keys = {}; this.hudTick = 5;
    for (let i = 0; i < (o.ff || 0) && this.ai && this.sim.winner < 0; i++) { this.ai.update(); if (this.demo) this.demo.update(); this.sim.step(); this.sim.events.length = 0; }
    const hq = this.sim.ents.find(e => e.owner === this.me && e.type === 'hq');
    this.rend.center(hq.x, hq.y + 1.5);
    $('pause').classList.add('hidden');
    $('pause-title').textContent = o.net ? 'Menu' : 'Paused';
    $('btn-pause').textContent = o.net ? 'Menu (P)' : 'Pause (P)';
    $('pause-note').textContent = o.net ? 'The battle continues while this menu is open.' : '';
    const foe = this.sim.players[1 - this.me];
    this.say(`${this.sim.players[this.me].name} vs ${foe.name} — destroy every enemy building.`);
    Snd.say('Command link established.', 'eva');
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(frame); }
  };
  game.stop = function () { this.running = false; if (this.net) { this.net.close(); this.net = null; } };
  game.say = function (text, bad) {
    const m = $('msg'); m.textContent = text; m.className = bad ? 'bad show' : 'show'; this.msgT = 3.5;
    if (bad) Snd.play('err');
  };
  game.cmd = function (c) {
    if (this.net) this.net.cmd(c);                 // multiplayer: the server schedules it for both players
    else { c.player = this.me; this.sim.command(c); }
  };
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
    if (one && one.owner === this.me && one.kind === 'building' && one.built && Object.values(p.defs.units).some(u => u.from === one.type)) {
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
      if (t && t.owner >= 0 && t.owner !== this.me) { this.cmd({ type: 'attack', ids, target: t.id }); this.rend.ping(t.x, t.y, '#ff5a5a'); if (us.some(u => u.def.dmg)) Snd.ack(this.sim.players[this.me].faction, 'attack'); }
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
    if (e.button === 0) {
      if (game.mode && game.mode.place) {
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
      if (game.mode === 'amove') { const p = mmPos(e); game.cmd({ type: 'amove', ids: game.ownUnits().map(u => u.id), x: p.x, y: p.y }); game.mode = null; }
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
  window.addEventListener('keydown', e => {
    if (!game.running || game.over) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    game.keys[k] = true;
    if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
    if (e.repeat) return;
    if (k === 'p') return game.togglePause();
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
  window.addEventListener('keyup', e => { game.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  window.addEventListener('blur', () => { game.keys = {}; game.mouse.inside = false; game.mouse.down = false; game.box = null; });
  window.addEventListener('resize', () => { if (game.rend) game.rend.resize(); });

  game.togglePause = function () {
    if (this.over) return;
    this.paused = !this.paused;
    $('pause').classList.toggle('hidden', !this.paused);
  };

  // ----- HUD -----
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  function hud() {
    const s = game.sim, p = s.players[game.me];
    $('r-cash').textContent = Math.floor(p.cash);
    $('r-oil').textContent = Math.floor(p.oil);
    $('r-food').textContent = p.used + ' / ' + p.cap;
    $('r-food').parentNode.classList.toggle('warn', p.cap - p.used < 2);
    const sec = Math.floor(s.tick / TPS);
    $('clock').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');

    const items = game.card();
    const key = items.map(i => i.act + (i.lock ? 'L' : '') + (i.poor ? 'P' : '') + (i.on ? 'O' : '')).join('|');
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
        const d = one.def, foe = one.owner !== game.me;
        h = `${ico(one, 'big')}<h3 style="color:${s.players[one.owner].color}">${esc(d.name)}${foe ? ' <em>enemy</em>' : ''}</h3>${hp(one)}`;
        if (one.kind === 'unit') {
          h += `<p>${d.dmg ? `Damage ${d.dmg} (${d.dtype}) · Range ${d.range}` : 'Unarmed'} · Armor ${{ inf: 'infantry', light: 'light', heavy: 'heavy' }[d.armor]}</p>`;
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
      h = `<img class="big" src="${R.emblemIcon(p.faction)}" alt=""><h3 style="color:${p.color}">${esc(p.name)}</h3><p class="dim">Drag to select units. Right-click to move, attack or mine.<br>Pick a structure on the right, then click the map to build it.<br>H: go to base · Space: jump to last alert · P: pause</p>`;
    }
    if (info._h !== h) { info.innerHTML = h; info._h = h; }
  }

  function events() {
    const s = game.sim;
    for (const ev of s.events) {
      if (ev.type === 'msg') { if (ev.player === game.me) { game.say(ev.text, true); if (/cash|oil/.test(ev.text)) Snd.say('Insufficient funds.', 'eva'); } }
      else if (ev.type === 'placed') { if (ev.owner === game.me) Snd.play('place'); }
      else if (ev.type === 'built') { if (ev.owner === game.me) { game.say(ev.name + ' complete'); Snd.play('done'); Snd.say('Construction complete.', 'eva'); } }
      else if (ev.type === 'jump') { /* drawn from unit state */ }
      else if (ev.type === 'trained') { if (ev.owner === game.me) { Snd.play('unit'); Snd.say('Unit ready.', 'eva'); } }
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
    if (s.winner >= 0 && !game.over) { game.over = true; game.mode = null; if (game.onEnd) game.onEnd(s.winner === game.me); }
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
        game.acc += dt;
        let n = 0;
        while (game.acc >= 1 / TPS && n < 5 && s.winner < 0) {
          game.ai.update(); if (game.demo) game.demo.update(); s.step(); events();
          game.acc -= 1 / TPS; n++;
        }
        if (n === 5) game.acc = 0;
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
    r.draw((game.paused && !game.net) || game.over ? 1 : game.acc * TPS, { sel: new Set(game.sel), box: game.box, ghost: game.ghost(), alert: game.alert }, dt);
    if (++game.hudTick % 6 === 0) hud();
  }
})();
