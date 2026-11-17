# Risk Taking Strategy

A browser real-time strategy game. Pick a faction, mine ore for cash, pump oil, build farms for food, raise an army and take the map. You get a grade for how efficiently you won.

No install and no build step. It is plain HTML, CSS and JavaScript.

## Play

- **vs Computer:** open `index.html` in Chrome.
- **Multiplayer:** run `node server.js` and open the address it prints in Chrome on both computers. One player hosts and gets a 4-letter code; the other joins with it.

## Factions

| Faction | Style |
|---|---|
| Liberty Coalition | Modern army: longer range, tougher units, drones, better oil. Units cost more. |
| Iron Bear | Heavy armor: tougher, harder-hitting vehicles and the Juggernaut. Vehicles are slower. |
| People's Vanguard | Cheap, fast to build, rifles train in pairs, Barrage rocket artillery. Units are fragile. |
| Jade Dragon Republic | Industry and numbers: buildings are cheap and go up fast, massed infantry and tanks hit harder, Fire Dragon flamethrower tank. Vehicles burn more oil. |

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
| Sound | `M` cycles all / effects only / off |
| Pause / menu | `P` |

## Tests

```
node test/sim-test.js      # computer vs computer match, headless
node test/net-test.js      # two networked clients through the real server stay in sync
```

## Roadmap

**Phase 1 (done):** three factions, computer opponent at three difficulty levels, efficiency grades, grassland/desert/winter maps, synthesized sound and voice lines, two-player multiplayer over a local server.

**Next:** a fourth faction, then internet hosting for multiplayer.
