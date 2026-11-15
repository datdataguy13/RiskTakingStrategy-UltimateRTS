// Headless smoke test: two computer players fight a full match.
// Usage: node test/sim-test.js [seed] [difficultyA] [difficultyB] [factionA] [factionB]
require('../js/data.js');
require('../js/sim.js');
require('../js/ai.js');
const R = globalThis.RTS;

const seed = +process.argv[2] || 1234;
const dA = process.argv[3] || 'hard', dB = process.argv[4] || 'normal';
const sim = new R.Sim({ seed, players: [{ faction: process.argv[5] || 'liberty', ai: true }, { faction: process.argv[6] || 'vanguard', ai: true }] });
const ais = [new R.AI(sim, 0, dA), new R.AI(sim, 1, dB)];
const t0 = Date.now();
const maxTicks = 60 * 60 * R.TPS;
let worst = 0;
while (sim.winner < 0 && sim.tick < maxTicks) {
  for (const a of ais) a.update();
  const s = process.hrtime.bigint();
  sim.step();
  worst = Math.max(worst, Number(process.hrtime.bigint() - s) / 1e6);
  sim.events.length = 0;
  for (const e of sim.ents) if (e.kind === 'unit' && !(e.x >= 0 && e.y >= 0 && e.x < sim.W && e.y < sim.H)) throw new Error('unit out of bounds: ' + JSON.stringify({ id: e.id, x: e.x, y: e.y, type: e.type }));
  if (sim.tick % (5 * 60 * R.TPS) === 0) {
    console.log(`t=${sim.tick / R.TPS / 60}min ` + sim.players.map(p => {
      const mine = sim.ents.filter(e => e.owner === p.id);
      return `[${p.name} cash=${p.cash | 0} oil=${p.oil | 0} food=${p.used}/${p.cap} units=${mine.filter(e => e.kind === 'unit').length} blds=${mine.filter(e => e.kind === 'building').length} kills=${p.stats.unitsKilled}+${p.stats.bldKilled}b]`;
    }).join(' '));
  }
}
console.log(sim.winner >= 0 ? `WINNER: ${sim.players[sim.winner].name} (${[dA, dB][sim.winner]}) at ${(sim.tick / R.TPS / 60).toFixed(1)} min` : 'No winner within 60 min');
console.log(`ticks=${sim.tick} wall=${Date.now() - t0}ms worstTick=${worst.toFixed(2)}ms`);
for (const p of sim.players) console.log(p.name, JSON.stringify(p.stats));
