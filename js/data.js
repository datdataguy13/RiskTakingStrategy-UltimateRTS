// Game data: factions, units, buildings, damage table.
(function (G) {
  'use strict';
  const R = G.RTS = G.RTS || {};
  R.TILE = 32;        // pixels per tile
  R.TPS = 20;         // simulation ticks per second
  R.START_CASH = 600;
  R.MAX_FOOD = 150;

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
    transport: { name: 'Transport Helicopter', key: 't', cash: 220, oil: 60, supply: 2, hp: 280, speed: 4.6, armor: 'light',
      dmg: 0, range: 0, cd: 1, sight: 8, time: 16, r: 0.5, from: 'airfield', veh: 1, air: 1, cap: 8,
      desc: 'Unarmed airlifter. Carries infantry over any terrain and drops them by parachute.' },
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
      desc: 'Rocket launcher truck. Rains a six-rocket volley on anything in range.' },
    flame: { name: 'Fire Dragon', key: 'u', cash: 300, oil: 110, supply: 3, hp: 480, speed: 2.6, armor: 'heavy',
      dmg: 20, dtype: 'explosive', splash: 1.2, range: 4, cd: 0.5, sight: 7, time: 20, r: 0.45, look: 'flame',
      from: 'factory', req: 'techlab', veh: 1, faction: 'dragon',
      desc: 'Flamethrower tank. Short range, but burns through infantry and buildings in a wide arc.' },
    // --- second faction elites ---
    sniper: { name: 'Sniper Team', key: 'n', cash: 200, oil: 0, supply: 2, hp: 70, speed: 1.9, armor: 'inf',
      dmg: 70, dtype: 'bullet', range: 8, cd: 3.2, sight: 10, time: 14, r: 0.28, from: 'barracks', req: 'techlab', faction: 'liberty',
      desc: 'Long-range marksmen. Pick off infantry from beyond their reach; useless against armor.' },
    gunship: { name: 'Hind Gunship', key: 'g', cash: 380, oil: 140, supply: 4, hp: 380, speed: 3.6, armor: 'light',
      dmg: 18, dtype: 'shell', range: 5.5, cd: 0.6, sight: 9, time: 24, r: 0.5, from: 'airfield', req: 'techlab', veh: 1, air: 1, faction: 'bear',
      desc: 'Armored attack helicopter. Flies over any terrain and chews through vehicles with its autocannon.' },
    mortar: { name: 'Mortar Team', key: 'n', cash: 150, oil: 20, supply: 2, hp: 75, speed: 1.8, armor: 'inf',
      dmg: 34, dtype: 'explosive', splash: 1.1, range: 8, cd: 3.0, sight: 7, time: 13, r: 0.28, from: 'barracks', req: 'techlab', faction: 'vanguard',
      desc: 'Cheap infantry artillery. Lobs splash-damage shells over the front line.' },
    gatling: { name: 'Gatling Tank', key: 'g', cash: 240, oil: 70, supply: 3, hp: 330, speed: 3.0, armor: 'light',
      dmg: 7, dtype: 'bullet', range: 5, cd: 0.15, sight: 8, time: 16, r: 0.42, from: 'factory', req: 'techlab', veh: 1, faction: 'dragon',
      desc: 'Twin rotary cannons. Mows down infantry and light vehicles; bounces off heavy armor.' }
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
    airfield: { name: 'Airfield', key: 'r', cash: 350, oil: 50, hp: 900, time: 24, w: 4, h: 2, sight: 7, req: 'factory',
      desc: 'Builds transport aircraft that airlift and paradrop infantry.' },
    turret: { name: 'Gun Turret', key: 'g', cash: 150, oil: 0, hp: 500, time: 12, w: 1, h: 1, sight: 8, req: 'barracks',
      dmg: 18, dtype: 'shell', range: 6.5, cd: 0.7,
      desc: 'Base defense. Engages anything in range, including drones.' },
    silo: { name: 'Superweapon', key: 'n', cash: 1500, oil: 600, hp: 1200, time: 60, w: 3, h: 3, sight: 6, req: 'techlab', charge: 240,
      desc: 'Charges for four minutes, then strikes anywhere on the map. Everyone is warned when it is built and when it fires. One per commander.' }
  };

  const round5 = v => Math.round(v / 5) * 5;
  const cost = (d, k) => { d.cash = round5(d.cash * k); d.oil = round5(d.oil * k); };

  // hull: vehicle/building camo colour. emblem: insignia drawn on HQs and in the menu.
  R.FACTIONS = {
    liberty: {
      name: 'Liberty Command', short: 'Liberty', color: '#3f8cff', alt: '#39c5cf', hull: '#b3a274', emblem: 'star', unique: 'drone', unique2: 'sniper',
      voice: { pitch: 1.0, rate: 1.15, select: ['Ready.', 'Standing by.', 'Go ahead, command.', 'Awaiting orders.'], move: ['Roger that.', 'Moving out.', 'Copy.', 'On the move.'], attack: ['Weapons free.', 'Engaging.', 'Target acquired.', 'Light them up.'] },
      tagline: 'Precision weapons. Advanced tech. Air power.',
      perks: ['+15% weapon range on all units', 'Body armor: units have +5% HP', 'Derricks pump 30% more oil', 'Elites: Reaper Drone and Sniper Team', 'Superweapon: Orbital Lance, one pinpoint blast', 'Units cost 10% more'],
      // strike: n blasts of dmg within radius, scattered over spread tiles, one every gap ticks
      strike: { name: 'Orbital Lance', n: 1, radius: 3, dmg: 900, dtype: 'explosive', spread: 0, gap: 1, look: 'beam' },
      doctrine: { name: 'Satellite Uplink', desc: 'Everything you own sees 2 tiles farther, and Guard Towers gain 1.5 range.',
        apply(d) { for (const u of Object.values(d.units)) u.sight += 2; for (const b of Object.values(d.buildings)) b.sight += 2; d.buildings.turret.range += 1.5; } },
      names: { worker: 'Engineer', rifle: 'Marine', rocket: 'Javelin Team', buggy: 'Recon Jeep', tank: 'Liberator MBT', artillery: 'Paladin Howitzer',
        transport: 'Osprey Tiltrotor', airfield: 'Airbase',
        hq: 'Forward HQ', farm: 'Supply Depot', barracks: 'Barracks', factory: 'Motor Pool', techlab: 'R&D Lab', turret: 'Guard Tower', silo: 'Uplink Station' },
      mod(d) {
        for (const u of Object.values(d.units)) { if (u.range > 1) u.range = +(u.range * 1.15).toFixed(2); u.hp = Math.round(u.hp * 1.05); cost(u, 1.1); }
        d.buildings.derrick.oilRate = +(d.buildings.derrick.oilRate * 1.3).toFixed(2);
        d.units.transport.speed = 5.4;                       // tiltrotor: the fastest airlift
      }
    },
    bear: {
      name: 'Iron Bear Federation', short: 'Iron Bear', color: '#f0a32f', alt: '#e0e4ea', hull: '#59634f', emblem: 'shield', unique: 'juggernaut', unique2: 'gunship',
      voice: { pitch: 0.55, rate: 0.95, select: ['Yes, commander.', 'Orders?', 'We are ready.', 'Speak.'], move: ['Moving.', 'As you command.', 'Forward.', 'It will be done.'], attack: ['Crush them.', 'Open fire.', 'No retreat.', 'For the Federation.'] },
      tagline: 'Heavy armor. Big guns. No retreat.',
      perks: ['Vehicles have +25% HP', 'Tanks hit 15% harder', 'Elites: Tsar Tank and Hind Gunship', 'Superweapon: Tsar Missile, one enormous blast', 'Vehicles move 5% slower'],
      strike: { name: 'Tsar Missile', n: 1, radius: 5.5, dmg: 650, dtype: 'explosive', spread: 0, gap: 1, look: 'nuke' },
      doctrine: { name: 'Field Workshops', desc: 'Vehicles repair themselves, regaining 1% of their health every second.',
        apply(d) { for (const u of Object.values(d.units)) if (u.veh) u.regen = 0.01; } },
      names: { worker: 'Worker', rifle: 'Motor Rifleman', rocket: 'RPG Trooper', buggy: 'BTR Scout', tank: 'Medved Tank', artillery: 'Msta Howitzer',
        transport: 'Condor Helicopter', airfield: 'Aerodrome',
        hq: 'Federal Command', farm: 'Kolkhoz', barracks: 'Barracks', factory: 'Tank Works', techlab: 'Institute', turret: 'Bunker Gun', silo: 'Missile Silo' },
      mod(d) {
        for (const u of Object.values(d.units)) if (u.veh) { u.hp = Math.round(u.hp * 1.25); u.speed = +(u.speed * 0.95).toFixed(2); }
        for (const k of ['tank', 'juggernaut']) d.units[k].dmg = Math.round(d.units[k].dmg * 1.15);
      }
    },
    vanguard: {
      name: "People's Vanguard Army", short: 'Vanguard', color: '#e5484d', alt: '#ff8a3d', hull: '#5d6a3b', emblem: 'redstar', unique: 'barrage', unique2: 'mortar',
      voice: { pitch: 1.35, rate: 1.25, select: ['We serve.', 'Ready, comrade.', 'Command us.', 'We are many.'], move: ['At once.', 'Forward, together.', 'Marching.', 'We go.'], attack: ['For the people.', 'Charge.', 'Overwhelm them.', 'Attack.'] },
      tagline: 'Cheap. Fast. Endless.',
      perks: ['Units cost 20% less and train 30% faster', 'Conscripts are trained two at a time', 'Elites: Barrage Truck and Mortar Team', 'Superweapon: Rocket Storm blankets a wide area', 'Units have 15% less HP'],
      strike: { name: 'Rocket Storm', n: 24, radius: 1.7, dmg: 150, dtype: 'explosive', spread: 6, gap: 4, look: 'rocket' },
      doctrine: { name: 'Mass Mobilization', desc: 'All units train 25% faster.',
        apply(d) { for (const u of Object.values(d.units)) u.time = +(u.time * 0.75).toFixed(1); } },
      names: { worker: 'Laborer', rifle: 'Conscripts', rocket: 'RPG Team', buggy: 'Technical', tank: 'Chonma Tank', artillery: 'Koksan Gun',
        transport: 'Colt Biplane', airfield: 'Airstrip',
        hq: 'Party Headquarters', farm: 'Collective Farm', barracks: 'Conscription Office', factory: 'Tractor Plant', techlab: 'Rocket Institute', turret: 'Gun Nest', silo: 'Rocket Battery' },
      descs: { rifle: 'Two cheap conscripts per order. Strength in numbers.' },
      mod(d) {
        for (const u of Object.values(d.units)) { cost(u, 0.8); u.time = +(u.time * 0.7).toFixed(1); u.hp = Math.round(u.hp * 0.85); }
        const c = d.units.rifle; c.count = 2; c.cash = round5(c.cash * 1.5);
        d.units.transport.cap = 6; d.units.transport.speed = 3.8;   // old biplane: cheap, slow, small
      }
    }
  };
  R.FACTIONS.dragon = {
    name: 'Jade Dragon Republic', short: 'Jade Dragon', color: '#2fc48d', alt: '#f2d14a', hull: '#6c7f78', emblem: 'goldstar', unique: 'flame', unique2: 'gatling',
    voice: { pitch: 0.85, rate: 1.2, select: ['Reporting.', 'The Republic is ready.', 'Your orders?', 'Standing in formation.'], move: ['Advancing.', 'In formation.', 'Understood.', 'Moving as one.'], attack: ['Strength in numbers.', 'Burn them out.', 'All units, fire.', 'For the Republic.'] },
    tagline: 'Industry. Numbers. Fight as one.',
    perks: ['Buildings cost 25% less and go up 40% faster', 'Massed: units deal +25% damage with 5 or more comrades nearby', 'Elites: Fire Dragon and Gatling Tank', 'Superweapon: Firestorm burns an area for eight seconds', 'Vehicles burn 15% more oil'],
    strike: { name: 'Firestorm', n: 10, radius: 4.5, dmg: 80, dtype: 'explosive', spread: 0, gap: 16, look: 'flame' },
    doctrine: { name: 'Human Wave', desc: 'The massed bonus rises from +25% to +45% damage.',
      apply(d) { for (const u of Object.values(d.units)) if (u.horde) u.horde = 1.45; } },
    names: { worker: 'Construction Crew', rifle: 'Guardsman', rocket: 'Red Arrow Team', buggy: 'Lynx Scout', tank: 'Tiger Tank', artillery: 'Thunder Gun',
      transport: 'Crane Airlifter', airfield: 'Air Corps Field',
      hq: 'Central Command', farm: 'Granary', barracks: 'Garrison', factory: 'Heavy Industry Plant', techlab: 'Weapons Bureau', turret: 'Sentry Gun', silo: 'Firestorm Battery' },
    mod(d) {
      for (const b of Object.values(d.buildings)) { cost(b, 0.75); b.time = +(b.time * 0.6).toFixed(1); }
      for (const u of Object.values(d.units)) { if (u.veh) u.oil = round5(u.oil * 1.15); if (u.dmg) u.horde = 1.25; }
      d.units.transport.cap = 12;                            // heavy airlifter: moves a whole platoon
    }
  };
  // Research, bought at the Tech Lab. weapons/armor have two levels; doctrine is each faction's own (FACTIONS[f].doctrine).
  R.RESEARCH = {
    weapons: { name: 'Weapons', key: 'w', desc: 'All units and turrets deal 10% more damage per level.',
      levels: [{ cash: 300, oil: 150, time: 45 }, { cash: 500, oil: 300, time: 70 }] },
    armor: { name: 'Armor', key: 'a', desc: 'All units gain 10% health per level.',
      levels: [{ cash: 300, oil: 150, time: 45 }, { cash: 500, oil: 300, time: 70 }] },
    doctrine: { name: 'Doctrine', key: 'd', desc: '', levels: [{ cash: 400, oil: 200, time: 60 }] }
  };
  R.RESEARCH_ORDER = ['weapons', 'armor', 'doctrine'];
  // Veterancy: a unit is promoted once it has destroyed VET_AT[rank] times its own price.
  R.VET_AT = [2, 5]; R.VET_DMG = 0.15; R.VET_HP = 0.1; R.VET_REGEN = 0.01;
  R.RANKS = ['', 'Veteran', 'Elite'];
  R.STRIKE_WARN = 80;   // ticks between a superweapon launch and its first blast
  R.MAX_PLAYERS = 4;
  // Address of the hosted multiplayer server. The single-player site (GitHub Pages) has no game
  // server of its own, so its Multiplayer tab links here instead. Leave empty until there is one.
  R.MULTIPLAYER_URL = '';
  R.COLORS = ['#c779ff', '#ff7bd5', '#9be25a', '#f4f4f4'];   // spare player colors when faction colors run out
  R.HORDE_SIZE = 5;     // comrades needed within HORDE_RANGE tiles for the massed bonus
  R.HORDE_RANGE = 3.5;
  R.FACTION_ORDER = ['liberty', 'bear', 'vanguard', 'dragon'];

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
