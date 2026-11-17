# Risk Taking Strategy

A browser real-time strategy game. Pick a faction, mine ore for cash, pump oil, build farms for food, raise an army and take the map. You get a grade for how efficiently you won.

No install and no build step. It is plain HTML, CSS and JavaScript.

## Play

**Play now (single player):** https://datdataguy13.github.io/RiskTakingStrategy-UltimateRTS/

That site is the game against computer players, plus replays. Multiplayer needs the game server, which is hosted separately (see Hosting).

- **vs Computer:** open `index.html` in Chrome. Choose a duel, a 2 v 2 with a computer ally, or a 4-way free-for-all.
- **Multiplayer on the same network:** run `node server.js` and open the address it prints in Chrome on each computer. One player hosts and gets a 4-letter code; the others join with it. If port 8080 is taken, use `PORT=8081 node server.js`.
- **Multiplayer over the internet:** put the server on a web host (below) and send your friends the link.

## Multiplayer

- **Up to four players**, any mix of people and computer players. The host adds computer players and sets their faction and difficulty. Click a **Team** button to change sides: players on the same team are allies, share vision and win together. Three or four players get a larger map.
- **Chat:** press `Enter`. `Tab` switches between allies and everyone.
- **Map ping:** `Alt`+click the map or minimap to flag a spot for your allies.
- **Dropped connection:** the match pauses for everyone and the dropped player has 60 seconds to get back in. The game reconnects by itself; reloading the page also puts you back in the match. After 60 seconds, or if a player quits, their side surrenders.
- **Rematch:** when a match ends, everyone returns to the same lobby.

## Replays

Every finished match is recorded. Watch it from the end screen or the **Replays** tab, at up to 8× speed, from any player's side. The last four are kept in the browser; save one to a file to keep it or send it to someone, and load it with **Load a replay file**. A replay only plays back correctly on the same version of the game.

## Hosting

The server is one Node process with no dependencies. It serves the game and runs the multiplayer rooms, and it listens on `PORT`.

- **Render:** New → Blueprint, pick this repository. `render.yaml` sets everything up on the free plan. A free service sleeps after 15 minutes with nobody connected, so the first visit after a break takes about a minute to load.
- **Anywhere else:** start command `node server.js`, health check path `/`.
- **GitHub Pages** serves the same files with no server, so it is single-player only. Set `R.MULTIPLAYER_URL` in `js/data.js` to the hosted server's address and the Pages copy's Multiplayer tab links to it.

Run exactly one instance. Rooms live in that process's memory, so two instances would put the host and the joiner on different servers.

## Factions

| Faction | Style |
|---|---|
| Liberty Coalition | Modern army: longer range, tougher units, drones, better oil. Units cost more. |
| Iron Bear | Heavy armor: tougher, harder-hitting vehicles and the Juggernaut. Vehicles are slower. |
| People's Vanguard | Cheap, fast to build, rifles train in pairs, Barrage rocket artillery. Units are fragile. |
| Jade Dragon Republic | Industry and numbers: buildings are cheap and go up fast, massed infantry and tanks hit harder, Fire Dragon flamethrower tank. Vehicles burn more oil. |

## Research, veterans and superweapons

- **Research:** select a Tech Lab to buy Weapons and Armor upgrades (two levels each, +10% per level) and your faction's doctrine.
- **Veterans:** a unit that destroys twice its own price in enemy assets becomes a Veteran (+15% damage, +10% health), and at five times, Elite (+30% damage, +20% health, heals itself). Chevrons mark them.
- **Superweapon:** needs a Tech Lab, costs a lot, and charges for four minutes. Select it, press `L`, and click a target anywhere on the map. Everyone is warned when one is built and sees where a strike will land a few seconds before it hits. One per player.

| Faction | Second elite | Doctrine | Superweapon |
|---|---|---|---|
| Liberty Coalition | Sniper Team | Satellite Uplink: +2 sight | Orbital Lance: one pinpoint blast |
| Iron Bear | Hind Gunship | Field Workshops: vehicles self-repair | Tsar Missile: one enormous blast |
| People's Vanguard | Mortar Team | Mass Mobilization: units train 25% faster | Rocket Storm: 24 rockets over a wide area |
| Jade Dragon Republic | Gatling Tank | Human Wave: massed bonus +45% | Firestorm: burns an area for eight seconds |

## Controls

| Action | Input |
|---|---|
| Select | click or drag; double-click selects all units of that type |
| Order | right-click to move, attack or mine |
| Attack-move | `A`, then click |
| Build | pick a structure, click the map; a Worker walks over and builds it |
| Repair | right-click a damaged building with Workers selected (or `E`, then click) |
| Rally point | select a production building and right-click the map (or `L`, then click) |
| Airlift | build an Airfield and a transport; right-click the transport with infantry selected to board; `U`, then click to paradrop them |
| Camera | arrow keys, screen edges, minimap |
| Control groups | `Ctrl+1–9` to save, `1–9` to recall |
| Research | select a Tech Lab, pick an upgrade |
| Superweapon | select it, `L`, then click the target |
| Chat (multiplayer) | `Enter`; `Tab` switches allies / everyone |
| Map ping | `Alt`+click the map or minimap |
| Sound | `M` cycles all / effects only / off |
| Pause / menu | `P` |

## Tests

```
npm test                   # all of the below
node test/sim-test.js      # computer vs computer duel, headless
node test/team-test.js     # four computer players, 2 v 2 on the large map (also: ffa, 2v1)
node test/replay-test.js   # a recorded match plays back identically
node test/strike-test.js   # superweapons: building, charging, firing and damage rules for every faction
node test/net-test.js      # two clients and a computer player through the real server stay in sync,
                           # through a drop, a rejoin and a rematch
```

## Roadmap

**Phase 1 (done):** three factions, computer opponent at three difficulty levels, efficiency grades, grassland/desert/winter maps, synthesized sound and voice lines, two-player multiplayer over a local server.

**Phase 4 (done):** internet hosting, team games for up to four players with computer allies and opponents, replays, reconnecting, chat and map pings, rematches, research, veterancy, superweapons, a second elite unit per faction.
