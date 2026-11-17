// Headless test of team games: four computer players, two against two, on the large map.
// Checks that allies never damage each other, share vision, and that one team wins.
// Usage: node test/team-test.js [seed] [mode]      mode: 2v2 (default) | ffa | 2v1
require('../js/data.js');
require('../js/sim.js');
require('../js/ai.js');
const R = globalThis.RTS;

const seed = +process.argv[2] || 77, mode = process.argv[3] || '2v2';
const setup = { '2v2': [0, 0, 1, 1], ffa: [0, 1, 2, 3], '2v1': [0, 0, 1] }[mode];
const sim = new R.Sim({ seed, theme: 'desert', players: setup.map((team, i) => ({ faction: R.FACTION_ORDER[i], team, ai: true })) });
const ais = sim.players.map(p => new R.AI(sim, p.id, 'hard'));
const fail = m => { console.log('FAIL: ' + m); process.exit(1); };

for (const a of sim.players) for (const b of sim.players) if (a.team === b.team && a.visible !== b.visible) fail('allies do not share vision');
if (new Set(sim.players.map(p => p.color)).size !== sim.players.length) fail('two players share a colour');
const homes = sim.players.map(p => p.home.x + ',' + p.home.y);
if (new Set(homes).size !== homes.length) fail('two players share a start position');

const t0 = Date.now(), maxTicks = 90 * 60 * R.TPS;
const seen = { research: 0, promote: 0, strike: 0, blast: 0 };
let worst = 0;
while (sim.winner < 0 && sim.tick < maxTicks) {
  for (const a of ais) a.update();
  const s = process.hrtime.bigint();
  sim.step();
  worst = Math.max(worst, Number(process.hrtime.bigint() - s) / 1e6);
  for (const ev of sim.events) {
    if (ev.type === 'researched') seen.research++; else if (ev.type === 'promote') seen.promote++;
    else if (ev.type === 'strike') seen.strike++; else if (ev.type === 'blast') seen.blast++;
  }
  sim.events.length = 0;
  for (const e of sim.ents) {
    if (e.kind === 'unit' && !(e.x >= 0 && e.y >= 0 && e.x < sim.W && e.y < sim.H)) fail('unit out of bounds');
    if (e.target) { const t = sim.byId.get(e.target); if (t && !sim.hostile(e.owner, t.owner)) fail('a unit is targeting an ally'); }
  }
}
if (sim.winner < 0) fail('no winner within 90 minutes');
const winners = sim.players.filter(p => p.team === sim.winner);
if (!winners.some(p => p.alive)) fail('the winning team has no survivor');
if (sim.players.some(p => p.team !== sim.winner && p.alive)) fail('a losing player is still alive');
console.log(`PASS ${mode}: team ${sim.winner} (${winners.map(p => p.name).join(' + ')}) won at ${(sim.tick / R.TPS / 60).toFixed(1)} min on a ${sim.W}x${sim.H} map`);
console.log(`  research finished ${seen.research}, promotions ${seen.promote}, superweapon launches ${seen.strike} (${seen.blast} blasts); wall ${Date.now() - t0}ms, worst tick ${worst.toFixed(1)}ms`);
