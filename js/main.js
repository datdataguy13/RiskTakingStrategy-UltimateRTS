// Menus, multiplayer lobby, victory grading, and boot.
(function () {
  'use strict';
  const R = window.RTS, game = R.game;
  const $ = id => document.getElementById(id);
  let faction = 'liberty', difficulty = 'normal', theme = 'random', mode = 'sp';
  let net = null, room = null, lastWasNet = false;
  const PAR = { easy: 12, normal: 16, hard: 20 };   // par time in minutes
  const clamp = v => Math.max(0, Math.min(100, v));
  const pickTheme = seed => theme === 'random' ? R.THEME_ORDER[(seed >>> 5) % R.THEME_ORDER.length] : theme;
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // Efficiency grade for a finished match.
  R.grade = function (sim, me, diff) {
    const p = sim.players[me], s = p.stats, secs = sim.tick / R.TPS, par = PAR[diff] * 60;
    const ratio = s.killValue / Math.max(1, s.lostValue);
    const income = R.START_CASH + s.cash + s.oil;
    const parts = [
      { name: 'Speed', w: 0.3, score: clamp(100 - 60 * (secs / par - 1)),
        detail: `Won in ${fmt(secs)} — par ${PAR[diff]}:00` },
      { name: 'Combat', w: 0.3, score: clamp(ratio / 2.5 * 100),
        detail: `Destroyed $${s.killValue} of enemy assets, lost $${s.lostValue} (${ratio.toFixed(2)} : 1)` },
      { name: 'Economy', w: 0.2, score: clamp(s.spent / income / 0.9 * 100),
        detail: `Put ${Math.round(100 * s.spent / income)}% of $${Math.round(income)} income to work` },
      { name: 'Preservation', w: 0.2, score: s.built ? clamp(100 * (1 - s.unitsLost / s.built)) : 100,
        detail: `Lost ${s.unitsLost} of ${s.built} units trained, ${s.bldLost} buildings` }
    ];
    const total = parts.reduce((a, x) => a + x.w * x.score, 0);
    const letter = total >= 90 ? 'S' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : 'D';
    return { parts, total, letter };
  };
  function fmt(secs) { secs = Math.floor(secs); return Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'); }

  // ----- main menu -----
  const fEl = $('factions');
  fEl.innerHTML = R.FACTION_ORDER.map(id => {
    const f = R.FACTIONS[id], d = R.makeDefs(id);
    const roster = ['rifle', 'tank', f.unique].map(t => `<span><img src="${R.icon(id, t)}" alt="">${d.units[t].name}</span>`).join('');
    return `<button class="faction" data-f="${id}" style="--c:${f.color}"><div class="fhead"><img class="emb" src="${R.emblemIcon(id)}" alt=""><div><h3>${f.name}</h3><em>${f.tagline}</em></div></div>` +
      `<ul>${f.perks.map(x => `<li>${x}</li>`).join('')}</ul><div class="roster">${roster}</div></button>`;
  }).join('');
  $('themes').innerHTML = `<button data-t="random">Random</button>` + R.THEME_ORDER.map(t => `<button data-t="${t}">${R.THEMES[t].name}</button>`).join('');

  function refresh() {
    for (const b of fEl.children) b.classList.toggle('on', b.dataset.f === faction);
    for (const b of $('diffs').children) b.classList.toggle('on', b.dataset.d === difficulty);
    for (const b of $('themes').children) b.classList.toggle('on', b.dataset.t === theme);
    for (const b of $('modes').children) b.classList.toggle('on', b.dataset.m === mode);
    $('pane-sp').classList.toggle('hidden', mode !== 'sp');
    $('pane-mp').classList.toggle('hidden', mode !== 'mp');
    let best = null;
    try { best = localStorage.getItem('rts-best-' + difficulty); } catch (e) { /* storage unavailable */ }
    $('best').textContent = best ? `Best grade on ${difficulty}: ${best}` : `No victory on ${difficulty} yet`;
    // multiplayer lobby
    $('mp-entry').classList.toggle('hidden', !!room);
    $('mp-room').classList.toggle('hidden', !room);
    if (room) {
      const host = room.you === 0, full = room.players.length === 2;
      $('room-code').textContent = room.code;
      $('room-players').innerHTML = [0, 1].map(i => {
        const p = room.players[i];
        if (!p) return `<div class="slot empty">Waiting for an opponent to join…</div>`;
        const f = R.FACTIONS[p.faction];
        return `<div class="slot" style="--c:${f.color}"><img src="${R.emblemIcon(p.faction)}" alt=""><b>${esc(f.name)}</b><span>${i === room.you ? 'You' : 'Opponent'}${i === 0 ? ' · host' : ''}</span></div>`;
      }).join('');
      $('room-note').textContent = `Map: ${R.THEMES[room.theme].name}. ` + (host ? (full ? 'Ready when you are.' : 'Give your opponent the code above.') : 'Waiting for the host to start.');
      $('mp-start').classList.toggle('hidden', !host);
      $('mp-start').disabled = !full;
    }
  }
  fEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    faction = b.dataset.f;
    if (room) net.send({ t: 'set', faction });
    refresh();
  });
  $('diffs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { difficulty = b.dataset.d; refresh(); } });
  $('themes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    theme = b.dataset.t;
    if (room && room.you === 0) net.send({ t: 'set', theme: pickTheme((Math.random() * 1e9) | 0) });
    refresh();
  });
  $('modes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { mode = b.dataset.m; refresh(); } });

  function show(id) {
    for (const s of ['menu', 'end', 'pause']) $(s).classList.toggle('hidden', s !== id);
    document.body.classList.toggle('playing', id !== 'menu');
  }
  function begin(extra) {
    R.Snd.init();
    show(null); lastWasNet = false;
    const seed = (extra && extra.seed) || (Math.random() * 1e9) | 0;
    game.start(Object.assign({ faction, difficulty, seed, theme: pickTheme(seed) }, extra));
  }
  function toMenu() {
    game.stop();
    leaveRoom();
    show('menu'); refresh();
  }
  $('start').addEventListener('click', () => begin());
  $('again').addEventListener('click', () => lastWasNet ? toMenu() : begin());
  $('to-menu').addEventListener('click', toMenu);
  $('quit').addEventListener('click', toMenu);
  $('resume').addEventListener('click', () => game.togglePause());
  $('btn-pause').addEventListener('click', () => game.togglePause());

  // ----- multiplayer lobby -----
  function mpStatus(text, bad) { const el = $('mp-status'); el.textContent = text || ''; el.classList.toggle('bad', !!bad); }
  function leaveRoom() { if (net) net.close(); net = null; room = null; }
  async function connect() {
    if (net) return net;
    const url = location.protocol === 'file:' ? 'ws://localhost:8080/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const n = new R.Net(WebSocket);
    n.on('room', m => { room = m; mpStatus(''); refresh(); })
      .on('error', m => { mpStatus(m.msg, true); if (!room) leaveRoom(); })
      .on('start', m => {
        R.Snd.init(); n.reset(); show(null); lastWasNet = true;
        game.start({ net: n, me: m.you, factions: m.factions, seed: m.seed, theme: m.theme });
      })
      .on('left', () => { if (game.running && !game.over) { game.over = true; game.onEnd(true, 'Your opponent left the game.'); } })
      .on('desync', () => game.say('Warning: the two games have fallen out of sync. Results may differ between players.', true))
      .on('close', () => {
        const inGame = game.running && game.net === n && !game.over;
        net = null; room = null;
        if (inGame) { game.over = true; game.onEnd(false, 'Connection to the server was lost.'); }
        else { mpStatus('Disconnected from the server.', true); refresh(); }
      });
    mpStatus('Connecting…');
    try { await n.connect(url); } catch (e) {
      mpStatus('No game server found. In the game folder run "node server.js", then open http://localhost:8080 in Chrome.', true);
      throw e;
    }
    net = n;
    return n;
  }
  $('mp-host').addEventListener('click', async () => {
    try { (await connect()).send({ t: 'host', faction, theme: pickTheme((Math.random() * 1e9) | 0) }); } catch (e) { /* status already shown */ }
  });
  async function join() {
    const code = $('mp-code').value.trim().toUpperCase();
    if (code.length !== 4) return mpStatus('Enter the 4-letter code from the host.', true);
    try { (await connect()).send({ t: 'join', code, faction }); } catch (e) { /* status already shown */ }
  }
  $('mp-join').addEventListener('click', join);
  $('mp-code').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') join(); });
  $('mp-start').addEventListener('click', () => { if (net) net.send({ t: 'start' }); });
  $('mp-leave').addEventListener('click', () => { leaveRoom(); mpStatus(''); refresh(); });

  // ----- end screen -----
  game.onEnd = function (won, note) {
    const sim = game.sim, s = sim.players[game.me].stats, mp = !!game.net || lastWasNet;
    if (game.net) game.net.send({ t: 'over' });
    $('end-title').textContent = won ? 'Victory' : 'Defeat';
    $('end').className = 'screen hidden ' + (won ? 'won' : 'lost');
    $('again').textContent = mp ? 'Back to lobby' : 'Play again';
    R.Snd.say(won ? 'Mission accomplished.' : 'Mission failed.', 'eva');
    const diff = mp ? 'normal' : difficulty, g = R.grade(sim, game.me, diff);
    let h = note ? `<p class="sub">${esc(note)}</p>` : '';
    if (won) {
      const order = 'DCBAS';
      let best = null, isBest = false;
      if (!mp) try {
        best = localStorage.getItem('rts-best-' + difficulty);
        isBest = !!best && order.indexOf(g.letter) > order.indexOf(best);
        if (!best || isBest) localStorage.setItem('rts-best-' + difficulty, g.letter);
      } catch (e) { /* storage unavailable */ }
      h += `<div class="grade g${g.letter}">${g.letter}</div><p class="sub">Efficiency ${Math.round(g.total)} / 100 · ${mp ? 'vs human opponent' : difficulty + ' computer'}${isBest ? ' · new best!' : ''}</p>`;
      h += g.parts.map(x => `<div class="row"><b>${x.name}</b><div class="meter"><div style="width:${x.score}%"></div></div><span>${Math.round(x.score)}</span><small>${x.detail}</small></div>`).join('');
    } else {
      if (!note) h += `<p class="sub">Your last building fell after ${fmt(sim.tick / R.TPS)}. Grades are awarded for victories.</p>`;
      h += `<div class="row"><b>Combat</b><small>Destroyed $${s.killValue} of enemy assets, lost $${s.lostValue}</small></div>`;
      h += `<div class="row"><b>Army</b><small>Trained ${s.built} units, lost ${s.unitsLost}; killed ${s.unitsKilled} units and ${s.bldKilled} buildings</small></div>`;
    }
    $('end-body').innerHTML = h;
    setTimeout(() => { if (game.over) $('end').classList.remove('hidden'); }, 900);
  };

  refresh();
  // dev/testing hooks: ?auto=1&faction=bear&difficulty=hard&theme=snow&seed=5&ff=2400&demo=1
  //                    ?mp=host&autostart=1   ?mp=join&code=ABCD
  const q = new URLSearchParams(location.search);
  if (R.FACTIONS[q.get('faction')]) faction = q.get('faction');
  if (PAR[q.get('difficulty')]) difficulty = q.get('difficulty');
  if (R.THEMES[q.get('theme')]) theme = q.get('theme');
  if (q.get('auto')) begin({ seed: +q.get('seed') || 1234, ff: +q.get('ff') || 0, demo: !!q.get('demo') });
  else if (q.get('mp')) {
    mode = 'mp'; refresh();
    if (q.get('mp') === 'host') {
      $('mp-host').click();
      if (q.get('autostart')) { const t = setInterval(() => { if (room && room.players.length === 2) { clearInterval(t); $('mp-start').click(); } }, 200); }
    } else { $('mp-code').value = q.get('code') || ''; join(); }
  }
})();
