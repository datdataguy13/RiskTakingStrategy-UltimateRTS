// Superweapon test, headless. Builds one the way a player does (worker, full price, full build time),
// waits out the charge, fires it, and checks every rule along the way, for each faction.
// Usage: node test/strike-test.js
require('../js/data.js');
require('../js/sim.js');
require('../js/ai.js');
const R = globalThis.RTS, TPS = R.TPS;

let checks = 0; const fails = [];
const ok = (cond, what) => { checks++; if (!cond) fails.push(what); };
const run = (sim, ticks, on) => { for (let i = 0; i < ticks; i++) { sim.step(); if (on) for (const e of sim.events) on(e); sim.events.length = 0; } };
const msgs = (sim, fn) => { const out = []; fn(); sim.step(); for (const e of sim.events) if (e.type === 'msg') out.push(e.text); sim.events.length = 0; return out; };

for (const fid of R.FACTION_ORDER) {
  const tag = fid + ': ';
  // three players: 0 = attacker, 1 = attacker's ally, 2 = enemy
  const sim = new R.Sim({ seed: 9, players: [{ faction: fid, team: 0 }, { faction: 'bear', team: 0 }, { faction: 'liberty', team: 1 }] });
  const me = sim.players[0], k = me.strike, d = me.defs.buildings.silo;
  const hq = sim.ents.find(e => e.owner === 0 && e.type === 'hq');
  const site = { tx: hq.tx + 5, ty: hq.ty };
  const worker = sim.ents.find(e => e.owner === 0 && e.type === 'worker');

  // --- building it ---
  me.cash = 100000; me.oil = 100000;
  ok(sim.canPlace(0, 'silo', site.tx, site.ty).startsWith('Requires'), tag + 'should need a Tech Lab first');
  let m = msgs(sim, () => sim.command({ type: 'build', player: 0, btype: 'silo', tx: site.tx, ty: site.ty, ids: [worker.id] }));
  ok(m.some(t => t.startsWith('Requires')) && !sim.ents.some(e => e.type === 'silo'), tag + 'build order without a Tech Lab should be refused');
  for (const t of ['barracks', 'factory', 'techlab']) sim.addBuilding(t, 0, hq.tx + 5, hq.ty + 4 + ['barracks', 'factory', 'techlab'].indexOf(t) * 4, true);
  me.cash = d.cash - 5; me.oil = d.oil;
  m = msgs(sim, () => sim.command({ type: 'build', player: 0, btype: 'silo', tx: site.tx, ty: site.ty, ids: [worker.id] }));
  ok(m.includes('Not enough cash') && !sim.ents.some(e => e.type === 'silo'), tag + 'should be refused when short of cash');
  me.cash = d.cash; me.oil = d.oil;
  run(sim, 1, null); sim.command({ type: 'build', player: 0, btype: 'silo', tx: site.tx, ty: site.ty, ids: [worker.id] }); run(sim, 1);
  const silo = sim.ents.find(e => e.type === 'silo');
  ok(!!silo && !silo.built, tag + 'build order should start a construction site');
  ok(Math.round(me.cash) === 0 && Math.round(me.oil) === 0, tag + `should charge the full price (left: $${me.cash}, ${me.oil} oil)`);
  me.cash = 100000; me.oil = 100000;
  ok(/only have one/.test(sim.canPlace(0, 'silo', site.tx + 4, site.ty)), tag + 'a second one should be refused');
  ok(sim.canPlace(1, 'silo', 0, 0) !== '' , tag + 'ally placement is checked separately');
  let built = -1, builtEv = null;
  const t0 = sim.tick;
  run(sim, (d.time + 30) * TPS, e => { if (e.type === 'built' && e.btype === 'silo') { built = sim.tick; builtEv = e; } });
  ok(silo.built && built > 0, tag + 'the worker should finish building it');
  ok(built - t0 >= d.time * TPS - 2, tag + `construction should take the full ${d.time}s (took ${((built - t0) / TPS).toFixed(1)}s)`);
  ok(builtEv && builtEv.owner === 0, tag + 'completion should be announced (this is what warns the other players)');

  // --- charging ---
  const chargedAt0 = silo.charge;
  ok(chargedAt0 > 0 && chargedAt0 < d.charge * TPS, tag + 'should be charging, not ready, right after it is built');
  const enemyHq = sim.ents.find(e => e.owner === 2 && e.type === 'hq');
  m = msgs(sim, () => sim.command({ type: 'strike', player: 0, building: silo.id, x: enemyHq.x, y: enemyHq.y }));
  ok(m.includes('Still charging') && !sim.strikes.length, tag + 'firing early should be refused');
  let charged = 0;
  run(sim, d.charge * TPS - silo.charge - 5, e => { if (e.type === 'charged') charged++; });
  ok(charged === 0 && silo.charge < d.charge * TPS, tag + 'should not be ready before the full four minutes');
  run(sim, 10, e => { if (e.type === 'charged' && e.owner === 0) charged++; });
  ok(charged === 1 && silo.charge === d.charge * TPS, tag + 'should announce ready exactly once at four minutes');
  ok(d.charge === 240, tag + 'charge time should be 240 seconds');

  // --- who may fire ---
  sim.command({ type: 'strike', player: 2, building: silo.id, x: hq.x, y: hq.y }); run(sim, 1);
  sim.command({ type: 'strike', player: 1, building: silo.id, x: enemyHq.x, y: enemyHq.y }); run(sim, 1);
  ok(!sim.strikes.length && silo.charge === d.charge * TPS, tag + 'only the owner can fire it (enemy and ally orders ignored)');
  for (const bad of [{ x: NaN, y: 5 }, { x: 5 }, { x: '5', y: 5 }, { x: Infinity, y: 5 }]) sim.command(Object.assign({ type: 'strike', player: 0, building: silo.id }, bad));
  run(sim, 1);
  ok(!sim.strikes.length && silo.charge === d.charge * TPS, tag + 'malformed targets are ignored without spending the charge');

  // --- the strike ---
  // Stand-ins around the target: an enemy unit inside the blast and one outside it, plus the attacker's own and
  // an ally's unit inside it. All are unarmed workers, so the only damage in this test comes from the strike.
  // A second enemy building far away keeps the match going if the HQ falls.
  const T = { x: enemyHq.x, y: enemyHq.y };
  const reach = k.radius + k.spread;
  sim.addBuilding('farm', 2, enemyHq.tx - 20, enemyHq.ty - 20, true);
  const near = sim.addUnit('worker', 2, T.x - 2.2, T.y + 2.2), far = sim.addUnit('worker', 2, T.x - reach - 4, T.y);
  const own = sim.addUnit('worker', 0, T.x, T.y + 2.2), ally = sim.addUnit('worker', 1, T.x - 2.2, T.y);
  const before = { hq: enemyHq.hp, near: near.hp, far: far.hp, own: own.hp, ally: ally.hp, kills: me.stats.killValue };
  sim.command({ type: 'strike', player: 0, building: silo.id, x: T.x, y: T.y });
  let warn = null, blasts = [], firstBlast = -1, lastBlast = -1;
  const fired = sim.tick;
  const watch = e => { if (e.type === 'strike') warn = e; if (e.type === 'blast') { blasts.push(e); if (firstBlast < 0) firstBlast = sim.tick; lastBlast = sim.tick; } };
  run(sim, 1, watch);
  ok(warn && warn.owner === 0 && Math.abs(warn.x - T.x) < 0.01 && Math.abs(warn.y - T.y) < 0.01 && warn.name === k.name, tag + 'launch should broadcast a warning with the target');
  ok(warn && Math.abs(warn.radius - reach) < 1e-9, tag + 'warning should show the true danger radius');
  ok(silo.charge <= 1, tag + 'firing should spend the whole charge');
  run(sim, R.STRIKE_WARN - 3, watch);
  ok(blasts.length === 0 && enemyHq.hp === before.hq, tag + 'nothing should land during the warning time');
  run(sim, k.n * k.gap + 40, watch);
  ok(firstBlast - fired >= R.STRIKE_WARN && firstBlast - fired <= R.STRIKE_WARN + 2, tag + `first blast should land ${R.STRIKE_WARN / TPS}s after launch (landed after ${((firstBlast - fired) / TPS).toFixed(2)}s)`);
  ok(blasts.length === k.n, tag + `should deliver ${k.n} blast(s), delivered ${blasts.length}`);
  ok(k.n === 1 || lastBlast - firstBlast === (k.n - 1) * k.gap, tag + 'blasts should be evenly spaced');
  ok(blasts.every(b => Math.hypot(b.x - T.x, b.y - T.y) <= k.spread + 1e-6), tag + 'every blast should fall inside the warned area');
  ok(!sim.strikes.length, tag + 'the strike should be finished and cleaned up');
  ok(enemyHq.dead || enemyHq.hp < before.hq - 300, tag + `enemy HQ at the centre should be badly hurt (${before.hq} -> ${enemyHq.dead ? 'destroyed' : Math.round(enemyHq.hp)})`);
  ok(enemyHq.dead || enemyHq.hp > 0, tag + 'bookkeeping');
  ok(near.dead || near.hp < before.near, tag + 'enemy unit inside the blast should be damaged');
  ok(!far.dead && far.hp === before.far, tag + 'enemy unit outside the warned area should be untouched');
  ok(!own.dead && own.hp === before.own, tag + "the attacker's own unit in the blast should be untouched");
  ok(!ally.dead && ally.hp === before.ally, tag + "an ally's unit in the blast should be untouched");
  ok(!hq.dead && hq.hp === hq.maxHp, tag + "the attacker's base should be untouched");
  const hqLeft = enemyHq.dead ? 0 : Math.round(enemyHq.hp);
  ok(fid === 'vanguard' || !enemyHq.dead, tag + 'a single strike should not destroy a full-health HQ outright');

  // --- recharge and second strike ---
  ok(silo.charge > 0 && silo.charge < d.charge * TPS, tag + 'should start recharging');
  charged = 0;
  run(sim, d.charge * TPS, e => { if (e.type === 'charged') charged++; });
  ok(charged === 1 && silo.charge === d.charge * TPS, tag + 'should be ready again four minutes later');
  // off-map target is pulled back onto the map
  sim.command({ type: 'strike', player: 0, building: silo.id, x: -50, y: 9999 }); warn = null; blasts = [];
  run(sim, R.STRIKE_WARN + k.n * k.gap + 40, watch);
  ok(warn && warn.x === 0 && warn.y <= sim.H && warn.y > sim.H - 1, tag + 'an off-map target should be clamped to the map edge');
  ok(blasts.length === k.n, tag + 'second strike should also deliver all blasts');

  // --- losing it ---
  run(sim, 200);
  const c = silo.charge;
  sim.kill(silo, 2); run(sim, 2);
  sim.command({ type: 'strike', player: 0, building: silo.id, x: T.x, y: T.y }); run(sim, 2);
  ok(!sim.strikes.length, tag + 'a destroyed superweapon cannot fire');
  ok(sim.canPlace(0, 'silo', site.tx, site.ty) === '', tag + 'after losing it, a new one can be built on the same spot');
  console.log(`${fid.padEnd(9)} ${k.name.padEnd(14)} ${d.name.padEnd(17)} $${d.cash}+${d.oil} oil, built in ${d.time}s | ${k.n} blast(s), reach ${reach} tiles | enemy HQ ${before.hq} -> ${hqLeft}, enemy worker in blast: ${near.dead ? 'killed' : Math.round(near.hp) + ' hp'}`);
}

// --- a strike in flight still lands if the launcher is destroyed; kills are credited ---
{
  const sim = new R.Sim({ seed: 4, players: [{ faction: 'bear' }, { faction: 'vanguard' }] });
  const silo = sim.addBuilding('silo', 0, 14, 6, true); silo.charge = silo.def.charge * TPS;
  const victims = []; for (let i = 0; i < 6; i++) victims.push(sim.addUnit('rifle', 1, 40 + i * 0.5, 40));
  for (const u of victims) u.order = { type: 'move', x: u.x, y: u.y, tries: 0 };
  sim.command({ type: 'strike', player: 0, building: silo.id, x: 41, y: 40 }); run(sim, 5);
  sim.kill(silo, 1);
  run(sim, R.STRIKE_WARN + 20);
  ok(victims.every(u => u.dead), 'a strike already launched should land even if the launcher is destroyed');
  ok(sim.players[0].stats.unitsKilled === 6 && sim.players[1].stats.unitsLost === 6, 'strike kills should be credited to the attacker');
  ok(sim.winner < 0, 'bookkeeping: match still running');
}

// --- a strike can win the match: the last enemy building falls ---
{
  const sim = new R.Sim({ seed: 4, players: [{ faction: 'liberty' }, { faction: 'vanguard' }] });
  const silo = sim.addBuilding('silo', 0, 14, 6, true); silo.charge = silo.def.charge * TPS;
  const hq = sim.ents.find(e => e.owner === 1 && e.type === 'hq'); hq.hp = 900;
  sim.command({ type: 'strike', player: 0, building: silo.id, x: hq.x, y: hq.y });
  run(sim, R.STRIKE_WARN + 40);
  ok(hq.dead && sim.winner === 0, 'destroying the last enemy building with a strike should win the match');
}

// --- the computer player builds one and uses it ---
{
  const sim = new R.Sim({ seed: 5, theme: 'desert', players: [0, 1, 2, 3].map(i => ({ faction: R.FACTION_ORDER[i], team: i, ai: true })) });
  const ais = sim.players.map(p => new R.AI(sim, p.id, 'hard'));
  let builtBy = new Set(), launches = 0, onFoe = 0, onFriend = 0;
  while (sim.winner < 0 && sim.tick < 45 * 60 * TPS) {
    for (const a of ais) a.update();
    sim.step();
    for (const e of sim.events) {
      if (e.type === 'built' && e.btype === 'silo') builtBy.add(e.owner);
      if (e.type === 'strike') {
        launches++;
        const hit = sim.ents.filter(x => x.kind === 'building' && !x.dead && Math.hypot(x.x - e.x, x.y - e.y) <= e.radius + 2);
        if (hit.some(x => sim.hostile(e.owner, x.owner))) onFoe++;
        if (hit.some(x => x.owner === e.owner)) onFriend++;
      }
    }
    sim.events.length = 0;
  }
  ok(builtBy.size >= 1 && launches >= 1, `computer players should build and fire superweapons in a long match (built by ${builtBy.size}, ${launches} launches)`);
  ok(onFoe === launches, `every computer launch should be aimed at enemy buildings (${onFoe} of ${launches})`);
  ok(onFriend === 0, 'no computer launch should be aimed at its own base');
  console.log(`computer players: ${builtBy.size} built a superweapon, ${launches} launches, all aimed at enemy buildings: ${onFoe === launches}`);
}

console.log(fails.length ? `FAIL: ${fails.length} of ${checks} checks failed\n  - ` + fails.join('\n  - ') : `PASS: all ${checks} superweapon checks`);
process.exit(fails.length ? 1 : 0);
