// Game data: factions, units, buildings, damage table.
(function (G) {
  'use strict';
  const R = G.RTS = G.RTS || {};
  R.TILE = 32;        // pixels per tile
  R.TPS = 20;         // simulation ticks per second
  R.START_CASH = 600;
  R.MAX_FOOD = 100;

  // damage type -> armor class multiplier
  R.DMG = {
    bullet:    { inf: 1.0, light: 0.7, heavy: 0.25, bld: 0.3 },
    rocket:    { inf: 0.4, light: 1.2, heavy: 1.3,  bld: 1.0 },
    shell:     { inf: 0.5, light: 1.0, heavy: 1.0,  bld: 0.8 },
    explosive: { inf: 1.0, light: 0.8, heavy: 0.6,  bld: 1.6 },
    beam:      { inf: 1.0, light: 1.0, heavy: 1.0,  bld: 0.6 }
  };

  // Base stats. Each faction renames and modifies these (see FACTIONS below).
  const UNITS = {
    worker: { name: 'Worker', key: 'w', cash: 50, oil: 0, supply: 1, hp: 60, speed: 2.4, armor: 'inf',
      dmg: 0, range: 0, cd: 1, sight: 6, time: 8, r: 0.28, from: 'hq',
      desc: 'Mines ore and hauls it back to a Command Center.' },
    rifle: { name: 'Rifleman', key: 'r', cash: 80, oil: 0, supply: 1, hp: 95, speed: 2.1, armor: 'inf',
      dmg: 9, dtype: 'bullet', range: 4.5, cd: 0.7, sight: 7, time: 7, r: 0.28, from: 'barracks',
      desc: 'Basic infantry. Strong vs infantry, weak vs armor.' },
    rocket: { name: 'Rocket Trooper', key: 't', cash: 120, oil: 10, supply: 1, hp: 80, speed: 1.9, armor: 'inf',
      dmg: 30, dtype: 'rocket', range: 5.5, cd: 2.0, sight: 7, time: 10, r: 0.28, from: 'barracks',
      desc: 'Anti-armor infantry. Strong vs vehicles and buildings.' },
    buggy: { name: 'Scout Car', key: 'b', cash: 140, oil: 30, supply: 2, hp: 170, speed: 4.4, armor: 'light',
      dmg: 8, dtype: 'bullet', range: 4.5, cd: 0.35, sight: 9, time: 11, r: 0.38, from: 'factory', veh: 1,
      desc: 'Fast raider with a heavy machine gun. Shreds infantry and workers.' },
    tank: { name: 'Battle Tank', key: 't', cash: 260, oil: 80, supply: 3, hp: 440, speed: 2.5, armor: 'heavy',
      dmg: 42, dtype: 'shell', range: 5.5, cd: 1.6, sight: 7, time: 17, r: 0.45, from: 'factory', veh: 1,
      desc: 'Armored backbone of any army.' },
    artillery: { name: 'Howitzer', key: 'y', cash: 320, oil: 120, supply: 3, hp: 180, speed: 1.7, armor: 'light',
      dmg: 75, dtype: 'explosive', range: 10, cd: 3.6, splash: 1.5, sight: 7, time: 22, r: 0.42,
      from: 'factory', req: 'techlab', veh: 1,
      desc: 'Long-range siege gun with splash damage. Needs spotters and escorts.' },
    // --- faction elites ---
    drone: { name: 'Reaper Drone', key: 'u', cash: 320, oil: 120, supply: 3, hp: 240, speed: 4.2, armor: 'light',
      dmg: 34, dtype: 'rocket', range: 6, cd: 1.4, sight: 10, time: 20, r: 0.42,
      from: 'factory', req: 'techlab', veh: 1, air: 1, faction: 'liberty',
      desc: 'Armed drone. Flies over water, forest and rock. Hellfire missiles wreck armor.' },
    juggernaut: { name: 'Tsar Tank', key: 'u', cash: 480, oil: 160, supply: 5, hp: 900, speed: 1.7, armor: 'heavy',
      dmg: 70, dtype: 'shell', range: 6, cd: 1.8, splash: 0.8, sight: 7, time: 30, r: 0.55,
      from: 'factory', req: 'techlab', veh: 1, faction: 'bear',
      desc: 'Twin-barrel super-heavy tank. Slow, brutal, expensive.' },
    barrage: { name: 'Barrage Truck', key: 'u', cash: 300, oil: 90, supply: 3, hp: 200, speed: 2.4, armor: 'light',
      dmg: 18, dtype: 'explosive', volley: 6, splash: 1.0, range: 9, cd: 5, sight: 7, time: 20, r: 0.42,
      from: 'factory', req: 'techlab', veh: 1, faction: 'vanguard',
      desc: 'Rocket launcher truck. Rains a six-rocket volley on anything in range.' }
  };

  const BUILDINGS = {
    hq: { name: 'Command Center', key: 'q', cash: 600, oil: 0, hp: 1600, time: 40, w: 3, h: 3, supply: 10, sight: 9,
      desc: 'Trains workers and receives ore. Build more on explored ground to expand.' },
    farm: { name: 'Farm', key: 'f', cash: 100, oil: 0, hp: 400, time: 10, w: 2, h: 2, supply: 8, sight: 4,
      desc: 'Produces food. Each one feeds 8 more troops.' },
    barracks: { name: 'Barracks', key: 'b', cash: 200, oil: 0, hp: 800, time: 18, w: 3, h: 2, sight: 6,
      desc: 'Trains infantry.' },
    derrick: { name: 'Oil Derrick', key: 'd', cash: 150, oil: 0, hp: 500, time: 14, w: 2, h: 2, sight: 5, oilRate: 1.5,
      desc: 'Pumps oil. Must be built on an oil seep.' },
    factory: { name: 'War Factory', key: 'v', cash: 400, oil: 0, hp: 1100, time: 26, w: 3, h: 3, sight: 6, req: 'barracks',
      desc: 'Builds vehicles. Vehicles burn oil.' },
    techlab: { name: 'Tech Lab', key: 't', cash: 300, oil: 100, hp: 600, time: 24, w: 2, h: 2, sight: 6, req: 'factory',
      desc: 'Unlocks artillery and your faction\'s elite unit.' },
    turret: { name: 'Gun Turret', key: 'g', cash: 150, oil: 0, hp: 500, time: 12, w: 1, h: 1, sight: 8, req: 'barracks',
      dmg: 18, dtype: 'shell', range: 6.5, cd: 0.7,
      desc: 'Base defense. Engages anything in range, including drones.' }
  };

  const round5 = v => Math.round(v / 5) * 5;
  const cost = (d, k) => { d.cash = round5(d.cash * k); d.oil = round5(d.oil * k); };

  // hull: vehicle/building camo colour. emblem: insignia drawn on HQs and in the menu.
  R.FACTIONS = {
    liberty: {
      name: 'Liberty Command', short: 'Liberty', color: '#3f8cff', alt: '#39c5cf', hull: '#b3a274', emblem: 'star', unique: 'drone',
      voice: { pitch: 1.0, rate: 1.15, select: ['Ready.', 'Standing by.', 'Go ahead, command.', 'Awaiting orders.'], move: ['Roger that.', 'Moving out.', 'Copy.', 'On the move.'], attack: ['Weapons free.', 'Engaging.', 'Target acquired.', 'Light them up.'] },
      tagline: 'Precision weapons. Advanced tech. Air power.',
      perks: ['+15% weapon range on all units', 'Body armor: units have +5% HP', 'Derricks pump 30% more oil', 'Elite: Reaper Drone flies over any terrain', 'Units cost 10% more'],
      names: { worker: 'Engineer', rifle: 'Marine', rocket: 'Javelin Team', buggy: 'Recon Jeep', tank: 'Liberator MBT', artillery: 'Paladin Howitzer',
        hq: 'Forward HQ', farm: 'Supply Depot', barracks: 'Barracks', factory: 'Motor Pool', techlab: 'R&D Lab', turret: 'Guard Tower' },
      mod(d) {
        for (const u of Object.values(d.units)) { if (u.range > 1) u.range = +(u.range * 1.15).toFixed(2); u.hp = Math.round(u.hp * 1.05); cost(u, 1.1); }
        d.buildings.derrick.oilRate = +(d.buildings.derrick.oilRate * 1.3).toFixed(2);
      }
    },
    bear: {
      name: 'Iron Bear Federation', short: 'Iron Bear', color: '#f0a32f', alt: '#e0e4ea', hull: '#59634f', emblem: 'shield', unique: 'juggernaut',
      voice: { pitch: 0.55, rate: 0.95, select: ['Yes, commander.', 'Orders?', 'We are ready.', 'Speak.'], move: ['Moving.', 'As you command.', 'Forward.', 'It will be done.'], attack: ['Crush them.', 'Open fire.', 'No retreat.', 'For the Federation.'] },
      tagline: 'Heavy armor. Big guns. No retreat.',
      perks: ['Vehicles have +25% HP', 'Tanks hit 15% harder', 'Elite: Tsar Tank super-heavy', 'Vehicles move 5% slower'],
      names: { worker: 'Worker', rifle: 'Motor Rifleman', rocket: 'RPG Trooper', buggy: 'BTR Scout', tank: 'Medved Tank', artillery: 'Msta Howitzer',
        hq: 'Federal Command', farm: 'Kolkhoz', barracks: 'Barracks', factory: 'Tank Works', techlab: 'Institute', turret: 'Bunker Gun' },
      mod(d) {
        for (const u of Object.values(d.units)) if (u.veh) { u.hp = Math.round(u.hp * 1.25); u.speed = +(u.speed * 0.95).toFixed(2); }
        for (const k of ['tank', 'juggernaut']) d.units[k].dmg = Math.round(d.units[k].dmg * 1.15);
      }
    },
    vanguard: {
      name: "People's Vanguard Army", short: 'Vanguard', color: '#e5484d', alt: '#ff8a3d', hull: '#5d6a3b', emblem: 'redstar', unique: 'barrage',
      voice: { pitch: 1.35, rate: 1.25, select: ['We serve.', 'Ready, comrade.', 'Command us.', 'We are many.'], move: ['At once.', 'Forward, together.', 'Marching.', 'We go.'], attack: ['For the people.', 'Charge.', 'Overwhelm them.', 'Attack.'] },
      tagline: 'Cheap. Fast. Endless.',
      perks: ['Units cost 20% less and train 30% faster', 'Conscripts are trained two at a time', 'Elite: Barrage Truck rocket volleys', 'Units have 15% less HP'],
      names: { worker: 'Laborer', rifle: 'Conscripts', rocket: 'RPG Team', buggy: 'Technical', tank: 'Chonma Tank', artillery: 'Koksan Gun',
        hq: 'Party Headquarters', farm: 'Collective Farm', barracks: 'Conscription Office', factory: 'Tractor Plant', techlab: 'Rocket Institute', turret: 'Gun Nest' },
      descs: { rifle: 'Two cheap conscripts per order. Strength in numbers.' },
      mod(d) {
        for (const u of Object.values(d.units)) { cost(u, 0.8); u.time = +(u.time * 0.7).toFixed(1); u.hp = Math.round(u.hp * 0.85); }
        const c = d.units.rifle; c.count = 2; c.cash = round5(c.cash * 1.5);
      }
    }
  };
  R.FACTION_ORDER = ['liberty', 'bear', 'vanguard'];

  // Map themes. water/trees/rock steer terrain generation; the renderer owns the look.
  R.THEMES = {
    grass:  { name: 'Grassland', water: 0.30, trees: 0.68, rock: 0.012 },
    desert: { name: 'Desert',    water: 0.20, trees: 0.77, rock: 0.035 },
    snow:   { name: 'Winter',    water: 0.31, trees: 0.63, rock: 0.015 }
  };
  R.THEME_ORDER = ['grass', 'desert', 'snow'];

  // Per-player definitions with faction names and modifiers applied.
  R.makeDefs = function (fid) {
    const f = R.FACTIONS[fid], d = { units: {}, buildings: {} };
    for (const [k, u] of Object.entries(UNITS)) if (!u.faction || u.faction === fid) d.units[k] = Object.assign({}, u);
    for (const [k, b] of Object.entries(BUILDINGS)) d.buildings[k] = Object.assign({}, b);
    for (const [k, n] of Object.entries(f.names || {})) (d.units[k] || d.buildings[k]).name = n;
    for (const [k, n] of Object.entries(f.descs || {})) (d.units[k] || d.buildings[k]).desc = n;
    f.mod(d);
    return d;
  };
})(typeof window !== 'undefined' ? window : globalThis);
