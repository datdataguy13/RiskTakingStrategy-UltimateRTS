// Replay test: play a match while recording one side's commands the way the game records a
// human's, then play the recording back and check the two runs match tick for tick.
// Usage: node test/replay-test.js [seed] [mode]      mode: duel (default) | 2v2
require('../js/data.js');
require('../js/sim.js');
require('../js/ai.js');
const R = globalThis.RTS;

const seed = +process.argv[2] || 21, mode = process.argv[3] || 'duel';
// player 0 is "the human": its commands are logged. Everyone else is a computer player, re-run during playback.
const players = mode === '2v2'
  ? [{ faction: 'dragon', team: 0, ai: null }, { faction: 'bear', team: 0, ai: 'hard' }, { faction: 'liberty', team: 1, ai: 'normal' }, { faction: 'vanguard', team: 1, ai: 'hard' }]
  : [{ faction: 'bear', team: 0, ai: null }, { faction: 'liberty', team: 1, ai: 'hard' }];
const make = () => new R.Sim({ seed, theme: 'snow', players: players.map(p => ({ faction: p.faction, team: p.team, ai: !!p.ai })) });
const bots = sim => players.map((p, i) => p.ai ? new R.AI(sim, i, p.ai) : null).filter(Boolean);
const maxTicks = 40 * 60 * R.TPS;

// --- live run ---
const live = make(), liveBots = bots(live), log = [], marks = new Map();
const human = new R.AI(live, 0, 'hard');
human.cmd = c => {                                   // same as game.cmd in single player
  if (c.x !== undefined) { c.x = Math.round(c.x * 100) / 100; c.y = Math.round(c.y * 100) / 100; }
  c.player = 0; live.command(c); log.push([live.tick, c]);
};
while (live.winner < 0 && live.tick < maxTicks) {
  human.update();
  for (const b of liveBots) b.update();
  live.step(); live.events.length = 0;
  if (live.tick % 100 === 0) marks.set(live.tick, live.hash());
}
// what the game would save, after a trip through JSON like a replay file
const rep = JSON.parse(JSON.stringify({ v: 1, seed, theme: 'snow', players, me: 0, ticks: live.tick, log }));

// --- playback ---
const play = make(), playBots = bots(play);
let i = 0, bad = -1;
while (play.winner < 0 && play.tick < rep.ticks) {
  while (i < rep.log.length && rep.log[i][0] <= play.tick) play.command(rep.log[i++][1]);
  for (const b of playBots) b.update();
  play.step(); play.events.length = 0;
  if (play.tick % 100 === 0 && marks.get(play.tick) !== play.hash()) { bad = play.tick; break; }
}
const ok = bad < 0 && play.tick === live.tick && play.winner === live.winner && play.hash() === live.hash() && i === rep.log.length;
console.log(ok
  ? `PASS ${mode}: replay of ${log.length} recorded commands matched the live match at all ${marks.size} checkpoints over ${(live.tick / R.TPS / 60).toFixed(1)} game-minutes; ${live.winner >= 0 ? 'team ' + live.winner + ' won' : 'no winner'} in both`
  : `FAIL ${mode}: ` + (bad >= 0 ? 'playback diverged at tick ' + bad : `end state differs (ticks ${play.tick}/${live.tick}, winner ${play.winner}/${live.winner}, commands used ${i}/${rep.log.length})`));
process.exit(ok ? 0 : 1);
