// Menus, multiplayer lobby, replays, victory grading, and boot.
(function () {
  'use strict';
  const R = window.RTS, game = R.game;
  const $ = id => document.getElementById(id);
  let faction = 'liberty', difficulty = 'normal', theme = 'random', mode = 'sp', match = 'duel';
  let net = null, room = null;
  let session = null;      // { code, key }: lets this browser rejoin a running multiplayer match
  let last = { kind: 'sp' };   // how the current match was started: 'sp' | 'net' | 'replay'
  let replay = null;       // recording of the match that just ended
  let waitTimer = null;
  const TEAM_COL = ['#6cb6ff', '#ff7b72', '#8fdc6a', '#f0c33c'];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  const PAR = { easy: 12, normal: 16, hard: 20 };   // par time in minutes
  const clamp = v => Math.max(0, Math.min(100, v));
  const pickTheme = seed => theme === 'random' ? R.THEME_ORDER[(seed >>> 5) % R.THEME_ORDER.length] : theme;
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const cap = t => t[0].toUpperCase() + t.slice(1);

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
    const roster = ['rifle', 'tank', f.unique, f.unique2].map(t => `<span><img src="${R.icon(id, t)}" alt="">${d.units[t].name}</span>`).join('');
    return `<button class="faction" data-f="${id}" style="--c:${f.color}"><div class="fhead"><img class="emb" src="${R.emblemIcon(id)}" alt=""><div><h3>${f.name}</h3><em>${f.tagline}</em></div></div>` +
      `<ul>${f.perks.map(x => `<li>${x}</li>`).join('')}</ul><div class="roster">${roster}</div></button>`;
  }).join('');
  $('themes').innerHTML = `<button data-t="random">Random</button>` + R.THEME_ORDER.map(t => `<button data-t="${t}">${R.THEMES[t].name}</button>`).join('');
  $('mp-name').value = store.get('rts-name') || '';
  const myName = () => { const n = $('mp-name').value.trim(); store.set('rts-name', n); return n; };

  function refresh() {
    for (const b of fEl.children) b.classList.toggle('on', b.dataset.f === faction);
    for (const b of $('diffs').children) b.classList.toggle('on', b.dataset.d === difficulty);
    for (const b of $('matches').children) b.classList.toggle('on', b.dataset.k === match);
    for (const b of $('themes').children) b.classList.toggle('on', b.dataset.t === theme);
    for (const b of $('modes').children) b.classList.toggle('on', b.dataset.m === mode);
    for (const m of ['sp', 'mp', 'rp']) $('pane-' + m).classList.toggle('hidden', mode !== m);
    const best = store.get('rts-best-' + difficulty);
    $('best').textContent = match !== 'duel' ? 'Grades are recorded for duels.' : best ? `Best grade on ${difficulty}: ${best}` : `No victory on ${difficulty} yet`;
    if (mode === 'rp') replayList();
    // multiplayer lobby
    $('mp-entry').classList.toggle('hidden', !!room);
    $('mp-room').classList.toggle('hidden', !room);
    if (room) {
      const host = room.hostSlot === room.you, teams = new Set(room.slots.map(s => s.team)).size, full = room.slots.length >= R.MAX_PLAYERS;
      $('room-code').textContent = room.code;
      $('room-players').innerHTML = room.slots.map((sl, i) => {
        const f = R.FACTIONS[sl.faction], mine = i === room.you, edit = mine || (host && sl.ai) ? '' : ' disabled';
        return `<div class="slot" style="--c:${f.color};--t:${TEAM_COL[sl.team]}"><img src="${R.emblemIcon(sl.faction)}" alt=""><b>${esc(sl.name)}</b>` +
          `<span>${mine ? 'You' : sl.ai ? 'Computer' : 'Player'}${i === room.hostSlot ? ' · host' : ''}</span>` +
          (sl.ai ? `<button data-a="fac" data-i="${i}"${edit} title="Change faction">${esc(f.short)}</button><button data-a="diff" data-i="${i}"${edit} title="Change difficulty">${cap(sl.ai)}</button>` : `<span>${esc(f.short)}</span>`) +
          `<button class="team" data-a="team" data-i="${i}"${edit} title="Players on the same team are allies">Team ${sl.team + 1}</button>` +
          (sl.ai && host ? `<button class="x" data-a="del" data-i="${i}" title="Remove">✕</button>` : '') + `</div>`;
      }).join('') + (full ? '' : `<div class="slot empty">Open slot — share the code above${host ? ', or add a computer player' : ''}</div>`);
      $('room-note').textContent = `Map: ${R.THEMES[room.theme].name}${room.slots.length > 2 ? ' (large)' : ''}. ` +
        (room.slots.length < 2 ? 'Waiting for someone to join.' : teams < 2 ? 'Everyone is on one team — put players on at least two.' : host ? 'Ready when you are.' : 'Waiting for the host to start.');
      $('mp-start').classList.toggle('hidden', !host);
      $('mp-addai').classList.toggle('hidden', !host || full);
      $('mp-start').disabled = room.slots.length < 2 || teams < 2;
    }
  }
  fEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    faction = b.dataset.f;
    if (room) net.send({ t: 'set', faction });
    refresh();
  });
  $('diffs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { difficulty = b.dataset.d; refresh(); } });
  $('matches').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { match = b.dataset.k; refresh(); } });
  $('themes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    theme = b.dataset.t;
    if (room && room.hostSlot === room.you) net.send({ t: 'set', theme: pickTheme((Math.random() * 1e9) | 0) });
    refresh();
  });
  $('modes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { mode = b.dataset.m; refresh(); } });

  function show(id) {
    for (const s of ['menu', 'end', 'pause']) $(s).classList.toggle('hidden', s !== id);
    document.body.classList.toggle('playing', id !== 'menu');
  }
  // Single player: you against one computer, with a computer ally against two, or against three in a free-for-all.
  function spPlayers(seed) {
    const others = R.FACTION_ORDER.filter(f => f !== faction), k = (seed >>> 3) % others.length;
    const pool = others.slice(k).concat(others.slice(0, k));
    const bot = (f, team) => ({ faction: f, team, ai: difficulty, name: '' });
    const me = { faction, team: 0, ai: null, name: '' };
    if (match === 'ally') return [me, bot(pool[0], 0), bot(pool[1], 1), bot(pool[2], 1)];
    if (match === 'ffa') return [me, bot(pool[0], 1), bot(pool[1], 2), bot(pool[2], 3)];
    return [me, bot(pool[0], 1)];
  }
  function begin(extra) {
    extra = extra || {};
    R.Snd.init(); show(null);
    const seed = extra.seed || (Math.random() * 1e9) | 0, players = spPlayers(seed);
    if (extra.demo) players[0].ai = 'hard';        // ?demo=1: the computer plays your side too
    last = { kind: 'sp', difficulty, match };
    game.start({ seed, theme: pickTheme(seed), players, me: 0, ff: extra.ff });
  }
  function watch(rep) {
    R.Snd.init(); show(null);
    last = { kind: 'replay', rep };
    game.start({ seed: rep.seed, theme: rep.theme, players: rep.players, me: rep.me, replay: rep });
  }
  function stopWait() { clearInterval(waitTimer); waitTimer = null; game.wait(null); }
  function clearSession() { session = null; try { sessionStorage.removeItem('rts-session'); } catch (e) { /* storage unavailable */ } }
  function toMenu() {                      // leave the match and any multiplayer room
    stopWait();
    if (net) net.send({ t: 'leave' });
    game.stop(); leaveRoom(); clearSession();
    show('menu'); refresh();
  }
  function toLobby() {                     // match over: same room, ready for a rematch
    stopWait(); game.stop();
    mode = 'mp'; show('menu'); refresh();
  }
  $('start').addEventListener('click', () => begin());
  $('again').addEventListener('click', () => last.kind === 'replay' ? watch(last.rep) : last.kind === 'net' ? (room ? toLobby() : toMenu()) : begin());
  $('to-menu').addEventListener('click', () => room && last.kind === 'replay' ? toLobby() : toMenu());
  $('watch').addEventListener('click', () => { if (replay) { game.stop(); watch(replay); } });
  $('save').addEventListener('click', () => { if (replay) download(replay); });
  $('quit').addEventListener('click', toMenu);
  $('resume').addEventListener('click', () => game.togglePause());
  $('btn-pause').addEventListener('click', () => game.togglePause());

  // ----- multiplayer lobby -----
  function mpStatus(text, bad) { const el = $('mp-status'); el.textContent = text || ''; el.classList.toggle('bad', !!bad); }
  function leaveRoom() { if (net) net.close(); net = null; room = null; }
  const wsUrl = () => location.protocol === 'file:' ? 'ws://localhost:8080/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  function startNet(n, m) {
    R.Snd.init(); show(null); stopWait(); mpStatus('');
    last = { kind: 'net' };
    session = { code: m.code, key: m.key };
    try { sessionStorage.setItem('rts-session', JSON.stringify(session)); } catch (e) { /* storage unavailable */ }
    game.start({ net: n, me: m.you, players: m.players, seed: m.seed, theme: m.theme, match: m.match });
  }
  // The connection dropped mid-match: keep trying to get back in. The server holds our place for a minute
  // and pauses the match for everyone meanwhile; on return it sends the turns we missed.
  function reconnect(n) {
    const t0 = Date.now();
    game.wait('Connection lost. Reconnecting…');
    const attempt = async () => {
      if (game.net !== n || game.over || !session) return;
      if (Date.now() - t0 > 60000) return giveUp(n, 'Connection to the server was lost.');
      try { await n.connect(wsUrl()); n.send({ t: 'rejoin', code: session.code, key: session.key, from: n.recv }); }
      catch (e) { setTimeout(attempt, 2000); }
    };
    attempt();
  }
  function giveUp(n, why) {
    stopWait(); clearSession();
    const inGame = game.running && game.net === n && !game.over;
    if (net === n) { n.close(); net = null; room = null; }
    if (inGame) { game.over = true; game.onEnd(false, why); }
    else { mpStatus(why, true); refresh(); }
  }
  async function connect() {
    if (net) return net;
    const n = new R.Net(WebSocket);
    const inGame = () => game.running && game.net === n && !game.over;
    n.on('room', m => { room = m; mpStatus(''); refresh(); })
      .on('error', m => {
        if (m.rejoin) return giveUp(n, inGame() ? 'Connection to the server was lost.' : 'That game is no longer running.');
        mpStatus(m.msg, true); if (!room) leaveRoom();
      })
      .on('start', m => { n.reset(); startNet(n, m); })
      .on('resume', m => { if (!inGame()) startNet(n, m.start); stopWait(); })
      .on('away', m => {
        if (!inGame()) return;
        const until = Date.now() + m.secs * 1000, name = game.pname(m.player);
        const tick = () => game.wait(`Paused — waiting for ${name} to reconnect… ${Math.max(0, Math.ceil((until - Date.now()) / 1000))}s`);
        clearInterval(waitTimer); waitTimer = setInterval(tick, 500); tick();
      })
      .on('back', m => { stopWait(); if (inGame()) game.say(game.pname(m.player) + ' is back'); })
      .on('gone', m => { stopWait(); if (inGame()) game.say(game.pname(m.player) + ' left the game', true); })
      .on('chat', m => { if (inGame()) game.chat(m.name, game.sim.players[m.from] ? game.sim.players[m.from].color : '#fff', m.text, m.team); })
      .on('ping', m => { if (inGame()) game.onPing(m.from, m.x, m.y); })
      .on('desync', () => game.say('Warning: the games have fallen out of sync. Results may differ between players.', true))
      .on('close', () => {
        if (inGame() && session) return reconnect(n);
        if (net === n) { net = null; room = null; }
        mpStatus('Disconnected from the server.', true); refresh();
      });
    mpStatus('Connecting…');
    try { await n.connect(wsUrl()); } catch (e) {
      mpStatus('No game server found. In the game folder run "node server.js", then open the address it prints in Chrome.', true);
      throw e;
    }
    net = n;
    return n;
  }
  $('mp-host').addEventListener('click', async () => {
    try { (await connect()).send({ t: 'host', name: myName(), faction, theme: pickTheme((Math.random() * 1e9) | 0) }); } catch (e) { /* status already shown */ }
  });
  async function join() {
    const code = $('mp-code').value.trim().toUpperCase();
    if (code.length !== 4) return mpStatus('Enter the 4-letter code from the host.', true);
    try { (await connect()).send({ t: 'join', code, name: myName(), faction }); } catch (e) { /* status already shown */ }
  }
  $('mp-join').addEventListener('click', join);
  $('mp-code').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') join(); });
  $('mp-name').addEventListener('keydown', e => e.stopPropagation());
  $('mp-start').addEventListener('click', () => { if (net) net.send({ t: 'start' }); });
  $('mp-addai').addEventListener('click', () => { if (net) net.send({ t: 'ai', op: 'add', difficulty }); });
  $('mp-leave').addEventListener('click', () => { leaveRoom(); mpStatus(''); refresh(); });
  $('room-players').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !room || !net) return;
    const i = +b.dataset.i, sl = room.slots[i], next = (list, v) => list[(list.indexOf(v) + 1) % list.length];
    if (!sl) return;
    if (b.dataset.a === 'team') { const team = (sl.team + 1) % R.MAX_PLAYERS; net.send(sl.ai ? { t: 'ai', op: 'set', slot: i, team } : { t: 'set', team }); }
    else if (b.dataset.a === 'fac') net.send({ t: 'ai', op: 'set', slot: i, faction: next(R.FACTION_ORDER, sl.faction) });
    else if (b.dataset.a === 'diff') net.send({ t: 'ai', op: 'set', slot: i, difficulty: next(['easy', 'normal', 'hard'], sl.ai) });
    else if (b.dataset.a === 'del') net.send({ t: 'ai', op: 'remove', slot: i });
  });

  // ----- replays -----
  // A replay is the match's seed and players plus every command and the tick it landed on.
  // The last few are kept in this browser; any of them can be saved to a file and loaded again.
  const KEEP = 4;
  function replays() { try { const a = JSON.parse(store.get('rts-replays') || '[]'); return Array.isArray(a) ? a.filter(validReplay) : []; } catch (e) { return []; } }
  function keepReplay(rep) {
    if (rep.ticks < 200) return;
    const all = [rep].concat(replays()).slice(0, KEEP);
    while (all.length && !store.set('rts-replays', JSON.stringify(all))) all.pop();   // out of space: drop the oldest
  }
  function validReplay(r) {
    return !!r && r.v === 1 && Number.isFinite(r.seed) && Number.isInteger(r.ticks) && r.ticks > 0 && Array.isArray(r.players) && r.players.length >= 2 && r.players.length <= R.MAX_PLAYERS &&
      r.players.every(p => p && R.FACTIONS[p.faction] && Number.isInteger(p.team) && (p.ai === null || PAR[p.ai])) && Number.isInteger(r.me) && r.me >= 0 && r.me < r.players.length &&
      Array.isArray(r.log) && r.log.every(e => Array.isArray(e) && Number.isInteger(e[0]) && e[1] && typeof e[1] === 'object' && typeof e[1].type === 'string');
  }
  function describe(r) {
    const teams = new Map();
    r.players.forEach(p => { if (!teams.has(p.team)) teams.set(p.team, []); teams.get(p.team).push(p.name || R.FACTIONS[p.faction].short + (p.ai ? ' (computer)' : '')); });
    return Array.from(teams.values()).map(t => t.join(' + ')).join('  vs  ');
  }
  function download(r) {
    const d = new Date(r.date || Date.now()), pad = v => String(v).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
    a.download = `rts-replay-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function replayList() {
    const all = replays();
    $('rp-list').innerHTML = all.length ? all.map((r, i) =>
      `<div class="rep"><div><b>${esc(describe(r))}</b><small>${new Date(r.date).toLocaleString()} · ${fmt(r.ticks / R.TPS)} · ${R.THEMES[r.theme] ? R.THEMES[r.theme].name : ''}</small></div>` +
      `<button class="go" data-w="${i}">Watch</button><button data-s="${i}">Save file</button></div>`).join('')
      : '<p class="dim">No replays yet. Every match you finish is recorded here automatically.</p>';
  }
  $('rp-list').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const all = replays();
    if (b.dataset.w !== undefined && all[+b.dataset.w]) watch(all[+b.dataset.w]);
    else if (b.dataset.s !== undefined && all[+b.dataset.s]) download(all[+b.dataset.s]);
  });
  $('rp-load').addEventListener('click', () => $('rp-file').click());
  $('rp-file').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    let r = null;
    try { r = JSON.parse(await f.text()); } catch (err) { /* reported below */ }
    if (!validReplay(r)) { $('rp-status').textContent = 'That file is not a replay from this game.'; return; }
    $('rp-status').textContent = '';
    watch(r);
  });

  // ----- end screen -----
  game.onEnd = function (won, note) {
    const sim = game.sim, me = sim.players[game.me], s = me.stats, mp = last.kind === 'net', rp = last.kind === 'replay';
    stopWait();
    if (!rp) { replay = game.replayData(); keepReplay(replay); }
    if (game.net && sim.winner >= 0) game.net.send({ t: 'over', match: game.opts.match });      // sends everyone back to the lobby
    if (mp) clearSession();
    const winners = sim.players.filter(p => p.team === sim.winner).map(p => game.pname(p.id)).join(' and ');
    $('end-title').textContent = rp ? 'Replay over' : won ? 'Victory' : 'Defeat';
    $('end').className = 'screen hidden ' + (rp ? '' : won ? 'won' : 'lost');
    $('again').textContent = rp ? 'Watch again' : mp ? (room ? 'Back to lobby' : 'Main menu') : 'Play again';
    $('to-menu').textContent = rp && room ? 'Back to lobby' : mp && room ? 'Leave the game' : 'Main menu';
    $('to-menu').classList.toggle('hidden', mp && !room);
    $('watch').classList.toggle('hidden', rp || !replay);
    $('save').classList.toggle('hidden', !(rp ? last.rep : replay));
    if (rp) replay = last.rep;
    if (!rp) R.Snd.say(won ? 'Mission accomplished.' : 'Mission failed.', 'eva');
    const diff = mp ? 'normal' : last.difficulty || 'normal', g = R.grade(sim, game.me, diff);
    let h = note ? `<p class="sub">${esc(note)}</p>` : '';
    if (rp) h += `<p class="sub">${sim.winner >= 0 ? esc(winners) + ' won' : 'The recording ends here'} after ${fmt(sim.tick / R.TPS)}.</p>`;
    else if (won) {
      const order = 'DCBAS', duel = !mp && last.match === 'duel';
      let isBest = false;
      if (duel) {
        const best = store.get('rts-best-' + diff);
        isBest = !!best && order.indexOf(g.letter) > order.indexOf(best);
        if (!best || isBest) store.set('rts-best-' + diff, g.letter);
      }
      h += `<div class="grade g${g.letter}">${g.letter}</div><p class="sub">Efficiency ${Math.round(g.total)} / 100 · ${mp ? 'multiplayer' : diff + ' computer'}${isBest ? ' · new best!' : ''}</p>`;
      h += g.parts.map(x => `<div class="row"><b>${x.name}</b><div class="meter"><div style="width:${x.score}%"></div></div><span>${Math.round(x.score)}</span><small>${x.detail}</small></div>`).join('');
    } else {
      if (!note) h += `<p class="sub">${sim.players.length > 2 ? esc(winners) + ' won' : 'Your last building fell'} after ${fmt(sim.tick / R.TPS)}. Grades are awarded for victories.</p>`;
      h += `<div class="row"><b>Combat</b><small>Destroyed $${s.killValue} of enemy assets, lost $${s.lostValue}</small></div>`;
      h += `<div class="row"><b>Army</b><small>Trained ${s.built} units, lost ${s.unitsLost}; killed ${s.unitsKilled} units and ${s.bldKilled} buildings</small></div>`;
    }
    if (sim.players.length > 2 || rp) h += sim.players.map(p =>
      `<div class="row"><b style="color:${p.color}">${esc(game.pname(p.id))}</b><small>Team ${p.team + 1}${p.team === sim.winner ? ' · winner' : ''} — destroyed $${p.stats.killValue}, lost $${p.stats.lostValue}, trained ${p.stats.built} units</small></div>`).join('');
    $('end-body').innerHTML = h;
    setTimeout(() => { if (game.over) $('end').classList.remove('hidden'); }, 900);
  };

  refresh();
  // dev/testing hooks: ?auto=1&faction=bear&difficulty=hard&theme=snow&match=ally&seed=5&ff=2400&demo=1
  //                    ?mp=host&autostart=1   ?mp=join&code=ABCD
  const q = new URLSearchParams(location.search);
  if (R.FACTIONS[q.get('faction')]) faction = q.get('faction');
  if (PAR[q.get('difficulty')]) difficulty = q.get('difficulty');
  if (R.THEMES[q.get('theme')]) theme = q.get('theme');
  if (['duel', 'ally', 'ffa'].includes(q.get('match'))) match = q.get('match');
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('rts-session') || 'null'); } catch (e) { /* storage unavailable */ }
  if (q.get('auto')) begin({ seed: +q.get('seed') || 1234, ff: +q.get('ff') || 0, demo: !!q.get('demo') });
  else if (q.get('mp')) {
    mode = 'mp'; refresh();
    if (q.get('mp') === 'host') {
      $('mp-host').click();
      if (q.get('autostart')) { const t = setInterval(() => { if (room && room.slots.length >= 2) { clearInterval(t); $('mp-start').click(); } }, 200); }
    } else { $('mp-code').value = q.get('code') || ''; join(); }
  } else if (saved && saved.code && saved.key) {
    // this tab was in a multiplayer match when the page reloaded: get back in and catch up
    session = saved; mode = 'mp'; refresh();
    connect().then(n => { mpStatus('Rejoining your game…'); n.send({ t: 'rejoin', code: saved.code, key: saved.key, from: 0 }); }).catch(clearSession);
  } else refresh();
})();
