// Deterministic game simulation. No DOM access: runs in the browser or in Node.
// All player/AI actions enter through sim.command(cmd) and are applied on the
// next tick, which is what lets this be driven over a network later (lockstep).
(function (G) {
  'use strict';
  const R = G.RTS, TPS = R.TPS;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

  function rng32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  R.rng32 = rng32;
  const fin = Number.isFinite;

  function noiseGrid(rnd, size, cell) {
    const n = Math.ceil(size / cell) + 2, g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return function (x, y) {
      const fx = x / cell, fy = y / cell, ix = fx | 0, iy = fy | 0;
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = g[iy * n + ix], b = g[iy * n + ix + 1], c = g[(iy + 1) * n + ix], d = g[(iy + 1) * n + ix + 1];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  }

  R.noiseGrid = noiseGrid;

  class Sim {
    constructor(o) {
      const W = this.W = this.H = o.size || 72, N = W * W;
      this.seed = o.seed | 0;
      this.theme = R.THEMES[o.theme] ? o.theme : 'grass';
      this.road = null;
      this.tick = 0; this.nextId = 1;
      this.ents = []; this.byId = new Map(); this.proj = [];
      this.events = []; this.cmdQ = [];
      this.winner = -1; this.dirty = true; this.anyDead = false; this.fogV = 0;
      this.terrain = new Uint8Array(N);   // 0 grass, 1 water, 2 trees, 3 rock
      this.block = new Uint8Array(N);     // 1 = impassable (terrain, buildings, ore)
      this._g = new Float32Array(N); this._from = new Int32Array(N);
      this._st = new Uint32Array(N); this._cl = new Uint32Array(N); this._stamp = 0;
      this._hf = []; this._hi = [];
      this._head = new Int32Array(N); this._nxt = []; this._sight = new Map();

      this.players = o.players.map((pl, i) => {
        const f = R.FACTIONS[pl.faction];
        return {
          id: i, faction: pl.faction, name: f.name, defs: R.makeDefs(pl.faction), unique: f.unique, hull: f.hull, emblem: f.emblem,
          color: f.color, cash: R.START_CASH, oil: 0, used: 0, cap: 0, alive: true, ai: !!pl.ai,
          visible: new Uint8Array(N), explored: new Uint8Array(N), lastAttack: null,
          stats: { cash: 0, oil: 0, spent: 0, built: 0, unitsLost: 0, bldLost: 0, killValue: 0, lostValue: 0, unitsKilled: 0, bldKilled: 0 }
        };
      });
      if (this.players[1] && this.players[1].faction === this.players[0].faction)
        this.players[1].color = R.FACTIONS[this.players[1].faction].alt;

      this.genMap();
      this.recalc();
      this.updateFog();
    }

    // ---------- map ----------
    genMap() {
      const W = this.W, H = this.H, t = this.terrain;
      const mir = (p) => [W - 2 - p[0], H - 2 - p[1]];
      const ORE = [[12, 4, 6000], [4, 12, 6000], [30, 7, 8000], [7, 30, 8000], [35, 35, 10000]];
      const SEEP = [[13, 9], [9, 13], [34, 18], [18, 40]];
      const ores = [], seeps = [];
      for (const o of ORE) { ores.push(o); const m = mir(o); if (m[0] !== o[0] || m[1] !== o[1]) ores.push([m[0], m[1], o[2]]); }
      for (const s of SEEP) { seeps.push(s); seeps.push(mir(s)); }
      const bases = [[7.5, 7.5], [W - 7.5, H - 7.5]];

      for (let attempt = 0; attempt < 30; attempt++) {
        const rnd = rng32(this.seed + attempt * 7919);
        const n1 = noiseGrid(rnd, W, 9), n2 = noiseGrid(rnd, W, 6);
        const th = R.THEMES[this.theme];
        const water = attempt < 20 ? th.water : 0, trees = attempt < 25 ? th.trees : 2;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, m = (H - 1 - y) * W + (W - 1 - x);
          if (i > m) continue;
          let v = 0;
          if (n1(x, y) < water) v = 1; else if (n2(x, y) > trees) v = 2; else if (rnd() < th.rock) v = 3;
          t[i] = v; t[m] = v;
        }
        const clear = (cx, cy, r) => {
          for (let y = Math.max(0, (cy - r) | 0); y <= Math.min(H - 1, cy + r); y++)
            for (let x = Math.max(0, (cx - r) | 0); x <= Math.min(W - 1, cx + r); x++)
              if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) t[y * W + x] = 0;
        };
        for (const b of bases) clear(b[0], b[1], 10);
        for (const o of ores) clear(o[0] + 1, o[1] + 1, 3.6);
        for (const s of seeps) clear(s[0] + 1, s[1] + 1, 3.6);
        for (let i = 0; i < t.length; i++) this.block[i] = t[i] ? 1 : 0;
        // every base and resource must be reachable from player 1's base
        let ok = true;
        const from = [9.5, 10.5];
        const targets = [[W - 9.5, H - 10.5]].concat(ores.map(o => [o[0] + 1, o[1] + 1]), seeps.map(s => [s[0] + 1, s[1] + 1]));
        for (const g of targets) {
          if (!this.findPath(from[0], from[1], { x0: g[0], y0: g[1], x1: g[0], y1: g[1] }, 2.5).reached) { ok = false; break; }
        }
        if (ok) break;
      }

      for (const o of ores) this.addNode('ore', o[0], o[1], o[2]);
      for (const s of seeps) this.addNode('seep', s[0], s[1], 0);
      this.addBuilding('hq', 0, 6, 6, true);
      for (let i = 0; i < 5; i++) this.addUnit('worker', 0, 5.5 + i, 9.5);
      if (this.players[1]) {
        this.addBuilding('hq', 1, W - 9, H - 9, true);
        for (let i = 0; i < 5; i++) this.addUnit('worker', 1, W - 5.5 - i, H - 9.5);
      }
      for (const u of this.ents) if (u.kind === 'unit') this.autoGather(u);
      // cosmetic supply road linking the bases
      this.road = this.findPath(9.5, 10.5, { x0: W - 9.5, y0: H - 10.5, x1: W - 9.5, y1: H - 10.5 }, 1.5).path;
    }

    // ---------- entities ----------
    addUnit(type, owner, x, y) {
      const d = this.players[owner].defs.units[type];
      const u = { id: this.nextId++, kind: 'unit', type, owner, def: d, x, y, px: x, py: y, hp: d.hp, maxHp: d.hp,
        facing: owner ? Math.PI : 0, order: { type: 'idle' }, path: null, pi: 0, target: 0, cd: 0, carry: 0, repath: 0, dead: false };
      this.ents.push(u); this.byId.set(u.id, u); this.dirty = true;
      return u;
    }
    addBuilding(type, owner, tx, ty, built) {
      const d = this.players[owner].defs.buildings[type];
      const b = { id: this.nextId++, kind: 'building', type, owner, def: d, tx, ty, w: d.w, h: d.h,
        x: tx + d.w / 2, y: ty + d.h / 2, hp: built ? d.hp : d.hp * 0.1, maxHp: d.hp, built: !!built, progress: built ? 1 : 0,
        queue: [], rally: null, cd: 0, target: 0, facing: 0, seep: 0, work: -9, dead: false };
      if (type === 'derrick') {
        const s = this.seepAt(tx, ty);
        if (s) { s.covered = true; b.seep = s.id; }
      }
      this.setBlock(tx, ty, d.w, d.h, 1);
      this.ents.push(b); this.byId.set(b.id, b); this.dirty = true;
      return b;
    }
    addNode(kind, tx, ty, amount) {
      const n = { id: this.nextId++, kind, type: kind, owner: -1, tx, ty, w: 2, h: 2, x: tx + 1, y: ty + 1, amount, covered: false, dead: false };
      if (kind === 'ore') this.setBlock(tx, ty, 2, 2, 1);
      this.ents.push(n); this.byId.set(n.id, n);
      return n;
    }
    setBlock(tx, ty, w, h, v) {
      for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.block[y * this.W + x] = v;
    }
    seepAt(tx, ty) {
      for (const e of this.ents) if (e.kind === 'seep' && e.tx === tx && e.ty === ty) return e;
      return null;
    }
    has(pid, type) {
      for (const e of this.ents) if (e.owner === pid && e.kind === 'building' && e.type === type && e.built && !e.dead) return true;
      return false;
    }
    blocked(x, y) {
      const tx = x | 0, ty = y | 0;
      return x < 0 || y < 0 || tx >= this.W || ty >= this.H || this.block[ty * this.W + tx] === 1;
    }
    rectOf(e) {
      return e.kind === 'unit' ? { x0: e.x, y0: e.y, x1: e.x, y1: e.y } : { x0: e.tx, y0: e.ty, x1: e.tx + e.w, y1: e.ty + e.h };
    }
    rectDist(px, py, e) {
      const dx = Math.max(e.tx - px, 0, px - (e.tx + e.w)), dy = Math.max(e.ty - py, 0, py - (e.ty + e.h));
      return Math.hypot(dx, dy);
    }
    // distance from a point to the edge of an entity
    dist(px, py, t) {
      return t.kind === 'unit' ? Math.max(0, Math.hypot(t.x - px, t.y - py) - t.def.r) : this.rectDist(px, py, t);
    }
    canSee(pid, t) { return this.players[pid].visible[(t.y | 0) * this.W + (t.x | 0)] === 1; }
    nearestFree(x, y) {
      const W = this.W, H = this.H, cx = Math.min(W - 1, Math.max(0, x | 0)), cy = Math.min(H - 1, Math.max(0, y | 0));
      if (!this.block[cy * W + cx]) return { x: Math.min(W - 0.01, Math.max(0, x)), y: Math.min(H - 0.01, Math.max(0, y)) };
      for (let r = 1; r < 30; r++) {
        let best = null, bd = 1e9;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = cx + dx, ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H || this.block[ty * W + tx]) continue;
          const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
          if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
        }
        if (best) return best;
      }
      return { x, y };
    }
    nearestOre(x, y, maxD) {
      let best = null, bd = maxD;
      for (const e of this.ents) if (e.kind === 'ore' && !e.dead) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
      return best;
    }
    nearestHQ(u) {
      let best = null, bd = 1e9;
      for (const e of this.ents) if (e.owner === u.owner && e.type === 'hq' && e.built && !e.dead) { const d = Math.hypot(e.x - u.x, e.y - u.y); if (d < bd) { bd = d; best = e; } }
      return best;
    }

    // ---------- pathfinding (A*, 8-way, no corner cutting) ----------
    // goal is a rect in tile coords; search ends at a tile whose centre is within gd of it.
    // Unreachable goals yield a path to the closest reachable tile.
    findPath(sx, sy, goal, gd, exact) {
      const W = this.W, H = this.H, block = this.block, g = this._g, from = this._from, st = this._st, cl = this._cl;
      const hf = this._hf, hi = this._hi, stamp = ++this._stamp;
      let hn = 0;
      const push = (i, f) => {
        let c = hn++;
        while (c > 0) { const p = (c - 1) >> 1; if (hf[p] <= f) break; hf[c] = hf[p]; hi[c] = hi[p]; c = p; }
        hf[c] = f; hi[c] = i;
      };
      const pop = () => {
        const top = hi[0]; hn--;
        if (hn > 0) {
          const f = hf[hn], i = hi[hn]; let c = 0;
          for (;;) { let k = 2 * c + 1; if (k >= hn) break; if (k + 1 < hn && hf[k + 1] < hf[k]) k++; if (hf[k] >= f) break; hf[c] = hf[k]; hi[c] = hi[k]; c = k; }
          hf[c] = f; hi[c] = i;
        }
        return top;
      };
      const hfun = (i) => {
        const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
        return Math.hypot(Math.max(goal.x0 - x, 0, x - goal.x1), Math.max(goal.y0 - y, 0, y - goal.y1));
      };
      const s0x = Math.min(W - 1, Math.max(0, sx | 0)), s0y = Math.min(H - 1, Math.max(0, sy | 0));
      const start = s0y * W + s0x;
      g[start] = 0; st[start] = stamp; from[start] = -1;
      let best = start, bestH = hfun(start), found = -1;
      push(start, bestH);
      while (hn > 0) {
        const cur = pop();
        if (cl[cur] === stamp) continue;
        cl[cur] = stamp;
        const hc = hfun(cur);
        if (hc <= gd) { found = cur; break; }
        if (hc < bestH) { bestH = hc; best = cur; }
        const cx = cur % W, cy = (cur / W) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = cx + DX[k], ny = cy + DY[k];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (block[ni] || cl[ni] === stamp) continue;
          if (k >= 4 && (block[cy * W + nx] || block[ny * W + cx])) continue;
          const ng = g[cur] + (k < 4 ? 1 : 1.4142);
          if (st[ni] !== stamp || ng < g[ni]) { st[ni] = stamp; g[ni] = ng; from[ni] = cur; push(ni, ng + hfun(ni)); }
        }
      }
      const pts = [];
      for (let i = found >= 0 ? found : best; i !== start && i >= 0; i = from[i]) pts.push({ x: (i % W) + 0.5, y: ((i / W) | 0) + 0.5 });
      pts.reverse();
      if (exact && found >= 0 && !this.blocked(goal.x0, goal.y0)) {
        const e = { x: goal.x0, y: goal.y0 };
        if (pts.length) pts[pts.length - 1] = e; else pts.push(e);
      }
      // smooth: skip waypoints that have a clear straight line
      const out = [];
      let px = sx, py = sy, i = -1;
      while (i < pts.length - 1) {
        let j = Math.min(pts.length - 1, i + 10);
        while (j > i + 1 && !this.los(px, py, pts[j].x, pts[j].y)) j--;
        out.push(pts[j]); px = pts[j].x; py = pts[j].y; i = j;
      }
      return { path: out, reached: found >= 0 };
    }
    los(x0, y0, x1, y1) {
      const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.3), m = 0.28;
      for (let i = 1; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
        if (this.blocked(x - m, y - m) || this.blocked(x + m, y - m) || this.blocked(x - m, y + m) || this.blocked(x + m, y + m)) return false;
      }
      return true;
    }
    pathTo(u, goal, gd, exact) {
      if (u.def.air) {   // aircraft fly straight to the goal
        const x = Math.min(this.W - 0.01, Math.max(0, (goal.x0 + goal.x1) / 2)), y = Math.min(this.H - 0.01, Math.max(0, (goal.y0 + goal.y1) / 2));
        u.path = [{ x, y }]; u.pi = 0; return;
      }
      u.path = this.findPath(u.x, u.y, goal, gd, exact).path; u.pi = 0;
    }
    // 0 = moving, 1 = arrived, 2 = blocked/no path
    follow(u, spd) {
      const p = u.path;
      if (!p) return 2;
      if (u.pi >= p.length) { u.path = null; return 1; }
      const wp = p[u.pi], dx = wp.x - u.x, dy = wp.y - u.y, d = Math.hypot(dx, dy), s = (spd || u.def.speed) / TPS;
      if (d <= s) {
        u.x = wp.x; u.y = wp.y;
        if (++u.pi >= p.length) { u.path = null; return 1; }
        return 0;
      }
      const nx = u.x + dx / d * s, ny = u.y + dy / d * s;
      if (!u.def.air && this.blocked(nx, ny)) { u.path = null; return 2; }
      u.x = nx; u.y = ny; u.facing = Math.atan2(dy, dx);
      return 0;
    }

    // ---------- commands ----------
    command(c) { this.cmdQ.push(c); }
    msg(pid, text) { this.events.push({ type: 'msg', player: pid, text }); }
    own(ids, pid) {
      const out = [];
      if (!Array.isArray(ids)) return out;
      for (const id of ids || []) { const e = this.byId.get(id); if (e && e.owner === pid && e.kind === 'unit') out.push(e); }
      return out;
    }
    pay(p, d, sign) {
      p.cash -= sign * d.cash; p.oil -= sign * (d.oil || 0); p.stats.spent += sign * (d.cash + (d.oil || 0));
    }
    orderMove(us, x, y, type) {
      const n = us.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), sp = 0.95;
      // attack-moving groups advance together at the pace of their slowest member
      let spd = 0;
      if (type === 'amove' && n > 1) { spd = 99; for (const u of us) spd = Math.min(spd, u.def.speed); }
      for (let i = 0; i < n; i++) {
        const u = us[i];
        const gx = x + ((i % cols) - (cols - 1) / 2) * sp, gy = y + (((i / cols) | 0) - (rows - 1) / 2) * sp;
        const f = u.def.air ? { x: Math.min(this.W - 0.01, Math.max(0, gx)), y: Math.min(this.H - 0.01, Math.max(0, gy)) } : this.nearestFree(gx, gy);
        u.order = { type, x: f.x, y: f.y, tries: 0, spd }; u.target = 0; u.path = null;
      }
    }
    autoGather(u) {
      if (u.type !== 'worker') return;
      const o = this.nearestOre(u.x, u.y, 18);
      if (o) { u.order = { type: 'gather', node: o.id, phase: u.carry ? 'back' : 'go', base: 0, t: 0 }; u.path = null; }
    }
    exec(c) {
      const p = this.players[c.player];
      if (!p || !p.alive) return;
      // commands may arrive over the network: never trust their shape
      if ((c.type === 'move' || c.type === 'amove' || c.type === 'rally') && !(fin(c.x) && fin(c.y))) return;
      if (c.type === 'build' && !(Number.isInteger(c.tx) && Number.isInteger(c.ty))) return;
      switch (c.type) {
        case 'move': case 'amove':
          this.orderMove(this.own(c.ids, c.player), c.x, c.y, c.type); break;
        case 'stop':
          for (const u of this.own(c.ids, c.player)) this.idle(u); break;
        case 'attack': {
          const t = this.byId.get(c.target);
          if (!t || t.owner < 0 || t.owner === c.player) return;
          for (const u of this.own(c.ids, c.player)) {
            if (u.def.dmg) { u.order = { type: 'attack', target: t.id }; u.target = 0; u.path = null; }
            else this.orderMove([u], t.x, t.y, 'move');
          }
          break;
        }
        case 'gather': {
          const t = this.byId.get(c.target);
          if (!t || t.kind !== 'ore') return;
          const rest = [];
          for (const u of this.own(c.ids, c.player)) {
            if (u.type === 'worker') { u.order = { type: 'gather', node: t.id, phase: u.carry ? 'back' : 'go', base: 0, t: 0 }; u.path = null; u.target = 0; }
            else rest.push(u);
          }
          if (rest.length) this.orderMove(rest, t.x, t.y + 1.6, 'move');
          break;
        }
        case 'build': {
          const d = p.defs.buildings[c.btype];
          if (!d) return;
          const why = this.canPlace(c.player, c.btype, c.tx, c.ty);
          if (why) return this.msg(c.player, why);
          if (p.cash < d.cash) return this.msg(c.player, 'Not enough cash');
          if (p.oil < (d.oil || 0)) return this.msg(c.player, 'Not enough oil');
          // a worker has to do the building: the nearest of those sent, else the nearest free one
          const w = this.builderFor(c.player, this.own(c.ids, c.player), c.tx + d.w / 2, c.ty + d.h / 2);
          if (!w) return this.msg(c.player, 'You need a Worker to build');
          this.pay(p, d, 1);
          const b = this.addBuilding(c.btype, c.player, c.tx, c.ty, false);
          if (w.order.type === 'build') w.order.q.push(b.id);        // already on a job: this one is next
          else { w.order = { type: 'build', b: b.id, q: [] }; w.path = null; w.target = 0; w.repath = 0; }
          this.events.push({ type: 'placed', owner: c.player, x: b.x, y: b.y });
          break;
        }
        case 'repair': {   // finish a construction site or mend a damaged building
          const b = this.byId.get(c.target);
          if (!b || b.kind !== 'building' || b.owner !== c.player || (b.built && b.hp >= b.maxHp)) return;
          for (const u of this.own(c.ids, c.player)) if (u.type === 'worker') { u.order = { type: 'build', b: b.id, q: [] }; u.path = null; u.target = 0; u.repath = 0; }
          break;
        }
        case 'train': {
          const b = this.byId.get(c.building), d = p.defs.units[c.utype];
          if (!b || !d || b.owner !== c.player || b.kind !== 'building' || !b.built || d.from !== b.type) return;
          if (d.req && !this.has(c.player, d.req)) return this.msg(c.player, 'Requires ' + p.defs.buildings[d.req].name);
          if (b.queue.length >= 6) return this.msg(c.player, 'Production queue is full');
          if (p.cash < d.cash) return this.msg(c.player, 'Not enough cash');
          if (p.oil < (d.oil || 0)) return this.msg(c.player, 'Not enough oil — build Derricks on oil seeps');
          const qs = d.supply * (d.count || 1);
          if (p.used + qs > p.cap) return this.msg(c.player, p.cap >= R.MAX_FOOD ? 'Army at maximum size' : 'Not enough food — build more Farms');
          this.pay(p, d, 1);
          const total = Math.round(d.time * TPS);
          b.queue.push({ type: c.utype, left: total, total });
          p.used += qs;
          break;
        }
        case 'cancel': {
          const b = this.byId.get(c.building);
          if (!b || b.owner !== c.player || b.kind !== 'building' || !b.queue.length) return;
          const q = b.queue.pop();
          this.pay(p, p.defs.units[q.type], -1); this.dirty = true;
          break;
        }
        case 'rally': {
          const b = this.byId.get(c.building);
          if (!b || b.owner !== c.player || b.kind !== 'building') return;
          b.rally = { x: c.x, y: c.y, node: c.node || 0 };
          break;
        }
      }
    }
    builderFor(pid, sent, x, y) {
      let best = null, bd = 1e9;
      // nearest worker, strongly preferring one with no jobs lined up
      const score = u => Math.hypot(u.x - x, u.y - y) + (u.order.type === 'build' ? 1000 * (1 + u.order.q.length) : 0);
      for (const u of sent) if (u.type === 'worker') { const d = score(u); if (d < bd) { bd = d; best = u; } }
      if (best) return best;
      for (const u of this.ents) {
        if (u.owner !== pid || u.type !== 'worker' || u.dead) continue;
        const d = score(u);
        if (d < bd) { bd = d; best = u; }
      }
      return best;
    }
    // '' if the building can be placed, otherwise the reason it cannot
    canPlace(pid, type, tx, ty) {
      const p = this.players[pid], d = p.defs.buildings[type], W = this.W;
      if (d.req && !this.has(pid, d.req)) return 'Requires ' + p.defs.buildings[d.req].name;
      if (tx < 0 || ty < 0 || tx + d.w > W || ty + d.h > this.H) return 'Out of bounds';
      if (type === 'derrick') {
        const s = this.seepAt(tx, ty);
        if (!s || s.covered) return 'Derricks must be built on an oil seep';
        if (!p.explored[(ty + 1) * W + tx + 1]) return 'Explore that oil seep first';
        return '';
      }
      for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) if (this.block[y * W + x]) return 'Something is in the way';
      let near = false;
      for (const e of this.ents) {
        if (e.dead) continue;
        if (e.kind === 'seep') {
          if (tx < e.tx + 2 && tx + d.w > e.tx && ty < e.ty + 2 && ty + d.h > e.ty) return 'Only Derricks can be built on oil seeps';
        } else if (e.kind === 'building' && e.owner === pid) {
          const dx = Math.max(e.tx - (tx + d.w), tx - (e.tx + e.w), 0), dy = Math.max(e.ty - (ty + d.h), ty - (e.ty + e.h), 0);
          if (Math.max(dx, dy) <= 5) near = true;
        }
      }
      if (type === 'hq') return p.explored[(ty + 1) * W + tx + 1] ? '' : 'Explore that area first';
      return near ? '' : 'Too far from your buildings';
    }

    // ---------- unit behaviour ----------
    idle(u) { u.order = { type: 'idle' }; u.path = null; u.target = 0; }
    updateUnit(u) {
      u.px = u.x; u.py = u.y;
      if (u.cd > 0) u.cd--;
      if (!u.def.air && this.block[(u.y | 0) * this.W + (u.x | 0)]) { const f = this.nearestFree(u.x, u.y); u.x = f.x; u.y = f.y; u.path = null; }
      const o = u.order;
      switch (o.type) {
        case 'idle': if (u.def.dmg) this.autoFight(u); break;
        case 'move': this.advance(u, o); break;
        case 'amove': if (!(u.def.dmg && this.autoFight(u))) this.advance(u, o); break;
        case 'attack': {
          const t = this.byId.get(o.target);
          if (!t) this.idle(u); else this.engage(u, t);
          break;
        }
        case 'gather': this.gather(u, o); break;
        case 'build': this.construct(u, o); break;
      }
    }
    // Workers raise construction sites and repair damaged buildings by standing next to them.
    construct(u, o) {
      const b = this.byId.get(o.b);
      if (!b || b.owner !== u.owner || (b.built && b.hp >= b.maxHp)) {
        if (o.q.length) { o.b = o.q.shift(); u.path = null; u.repath = 0; return; }   // on to the next job
        this.idle(u); this.autoGather(u); return;
      }
      if (this.rectDist(u.x, u.y, b) > 1.05) return this.goRect(u, b);
      u.path = null; u.facing = Math.atan2(b.y - u.y, b.x - u.x);
      if (!b.built) { b.work = this.tick; return; }
      // repair: a full rebuild from nothing would take 1.5x the build time and 35% of the price
      const p = this.players[u.owner], n = b.def.time * TPS * 1.5, cost = b.def.cash * 0.35 / n;
      if (p.cash < cost) { this.msg(u.owner, 'Not enough cash to repair'); return this.idle(u); }
      p.cash -= cost; p.stats.spent += cost;
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp / n);
      b.work = this.tick;
    }
    advance(u, o) {
      if (!u.path) {
        if (o.tries > 4) return this.idle(u);
        o.tries++;
        this.pathTo(u, { x0: o.x, y0: o.y, x1: o.x, y1: o.y }, 0.71, true);
      }
      const r = this.follow(u, o.spd);
      if (r === 1) this.idle(u); else if (r === 0) o.tries = 0;
    }
    autoFight(u) {
      let t = u.target ? this.byId.get(u.target) : null;
      if (t && !this.canSee(u.owner, t)) t = null;
      if (!t) {
        if (u.target) { u.target = 0; u.path = null; }
        if ((this.tick + u.id) % 6 === 0) {
          t = this.acquire(u, Math.max(u.def.range + 1, 6));
          if (t) { u.target = t.id; u.path = null; }
        }
      }
      if (!t) return false;
      this.engage(u, t);
      return true;
    }
    acquire(src, range) {
      let best = null, bs = 1e9;
      for (const e of this.ents) {
        if (e.owner < 0 || e.owner === src.owner || e.dead) continue;
        const d = this.dist(src.x, src.y, e);
        if (d > range || !this.canSee(src.owner, e)) continue;
        const s = d + (e.kind === 'building' ? (e.def.dmg ? 0 : 5) : (e.def.dmg ? 0 : 2));
        if (s < bs) { bs = s; best = e; }
      }
      return best;
    }
    engage(u, t) {
      if (this.dist(u.x, u.y, t) <= u.def.range) {
        u.path = null; u.facing = Math.atan2(t.y - u.y, t.x - u.x);
        if (u.cd <= 0) this.fire(u, t);
        return;
      }
      if (!u.path || this.tick >= u.repath) {
        this.pathTo(u, this.rectOf(t), Math.max(0.71, u.def.range - 0.5));
        u.repath = this.tick + 12 + (u.id % 5);
      }
      if (this.follow(u)) u.path = null;
    }
    gather(u, o) {
      if (o.phase === 'go') {
        const n = this.byId.get(o.node);
        if (!n) {
          const m = this.nearestOre(u.x, u.y, 16);
          if (m) { o.node = m.id; u.path = null; } else if (u.carry) { o.phase = 'back'; u.path = null; } else this.idle(u);
          return;
        }
        if (this.rectDist(u.x, u.y, n) <= 1.05) { o.phase = 'mine'; o.t = 70; u.path = null; u.facing = Math.atan2(n.y - u.y, n.x - u.x); return; }
        this.goRect(u, n);
      } else if (o.phase === 'mine') {
        const n = this.byId.get(o.node);
        if (!n) { o.phase = 'go'; return; }
        if (--o.t <= 0) {
          const amt = Math.min(10, n.amount);
          n.amount -= amt; u.carry = amt;
          if (n.amount <= 0) { n.dead = true; this.byId.delete(n.id); this.setBlock(n.tx, n.ty, 2, 2, 0); this.anyDead = true; }
          o.phase = 'back'; o.base = 0; u.path = null;
        }
      } else {
        let hq = this.byId.get(o.base);
        if (!hq) {
          hq = this.nearestHQ(u); u.path = null;
          if (!hq) return this.idle(u);
          o.base = hq.id;
        }
        if (this.rectDist(u.x, u.y, hq) <= 1.05) {
          const p = this.players[u.owner];
          p.cash += u.carry; p.stats.cash += u.carry; u.carry = 0;
          o.phase = 'go'; u.path = null;
          return;
        }
        this.goRect(u, hq);
      }
    }
    goRect(u, e) {
      if (!u.path) {
        if (this.tick < u.repath) return;
        this.pathTo(u, this.rectOf(e), 0.75);
        u.repath = this.tick + 10;
      }
      this.follow(u);
    }

    // ---------- combat ----------
    fire(src, t) {
      const d = src.def;
      src.cd = Math.round(d.cd * TPS);
      src.facing = Math.atan2(t.y - src.y, t.x - src.x);
      if (d.dtype === 'bullet' || d.dtype === 'beam') {
        this.events.push({ type: d.dtype, x: src.x, y: src.y, tx: t.x, ty: t.y });
        this.hit(t, d.dmg, d.dtype, src.owner, src);
      } else {
        const n = d.volley || 1;
        for (let k = 0; k < n; k++) {
          // deterministic scatter for volleys
          const a = (k * 2.39996 + src.id) % 6.2832, rr = n > 1 ? 0.35 + 0.25 * (k % 3) : 0;
          const ox = Math.cos(a) * rr, oy = Math.sin(a) * rr;
          this.proj.push({ x: src.x, y: src.y, px: src.x, py: src.y, tx: t.x + ox, ty: t.y + oy, ox, oy, target: t.id, dtype: d.dtype,
            look: n > 1 || d.dtype === 'rocket' ? 'rocket' : d.dtype, delay: k * 3,
            speed: d.dtype === 'shell' ? 14 : n > 1 ? 11 : 9, dmg: d.dmg, splash: d.splash || 0, owner: src.owner, src: src.id });
        }
        this.events.push({ type: 'fire', x: src.x, y: src.y, dtype: d.dtype });
      }
    }
    hit(t, dmg, dtype, owner, src) {
      if (t.dead) return;
      t.hp -= dmg * R.DMG[dtype][t.kind === 'building' ? 'bld' : t.def.armor];
      this.players[t.owner].lastAttack = { x: t.x, y: t.y, tick: this.tick };
      if (t.hp <= 0) return this.kill(t, owner);
      // idle armed units answer fire, even from attackers they cannot see
      if (src && !src.dead && t.kind === 'unit' && t.def.dmg && t.order.type === 'idle' && !t.target) {
        if (this.canSee(t.owner, src)) { t.target = src.id; t.path = null; }
        else { const f = this.nearestFree(src.x, src.y); t.order = { type: 'amove', x: f.x, y: f.y, tries: 0 }; t.path = null; }
      }
    }
    kill(t, killer) {
      t.dead = true; this.byId.delete(t.id); this.dirty = true; this.anyDead = true;
      const val = t.def.cash + (t.def.oil || 0), vp = this.players[t.owner], isU = t.kind === 'unit';
      vp.stats.lostValue += val; if (isU) vp.stats.unitsLost++; else vp.stats.bldLost++;
      if (killer >= 0 && killer !== t.owner) {
        const kp = this.players[killer];
        kp.stats.killValue += val; if (isU) kp.stats.unitsKilled++; else kp.stats.bldKilled++;
      }
      if (!isU) {
        this.setBlock(t.tx, t.ty, t.w, t.h, 0);
        const s = this.byId.get(t.seep); if (s) s.covered = false;
      }
      this.events.push({ type: 'death', x: t.x, y: t.y, size: isU ? t.def.r * 2.2 : Math.max(t.w, t.h) * 0.8, owner: t.owner, bld: !isU });
    }
    updateProjectiles() {
      const keep = [];
      for (const pr of this.proj) {
        if (pr.delay > 0) { pr.delay--; keep.push(pr); continue; }
        const t = this.byId.get(pr.target);
        if (t) { pr.tx = t.x + pr.ox; pr.ty = t.y + pr.oy; }
        pr.px = pr.x; pr.py = pr.y;
        const dx = pr.tx - pr.x, dy = pr.ty - pr.y, d = Math.hypot(dx, dy), s = pr.speed / TPS;
        if (d > s) { pr.x += dx / d * s; pr.y += dy / d * s; keep.push(pr); continue; }
        const src = this.byId.get(pr.src);
        if (pr.splash) {
          for (const e of this.ents) {
            if (e.owner < 0 || e.owner === pr.owner || e.dead) continue;
            const dd = this.dist(pr.tx, pr.ty, e);
            if (dd <= pr.splash) this.hit(e, pr.dmg * (1 - 0.5 * dd / pr.splash), pr.dtype, pr.owner, src);
          }
        } else if (t) this.hit(t, pr.dmg, pr.dtype, pr.owner, src);
        this.events.push({ type: 'boom', x: pr.tx, y: pr.ty, size: pr.splash ? pr.splash : 0.35 });
      }
      this.proj = keep;
    }

    // ---------- buildings ----------
    updateBuilding(b) {
      const p = this.players[b.owner], d = b.def;
      if (!b.built) {
        if (b.work < this.tick - 1) return;      // no worker on site: construction waits
        const n = d.time * TPS;
        b.progress += 1 / n; b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 / n);
        if (b.progress >= 1) { b.progress = 1; b.built = true; this.dirty = true; this.events.push({ type: 'built', owner: b.owner, name: d.name, x: b.x, y: b.y }); }
        return;
      }
      if (b.queue.length && --b.queue[0].left <= 0) this.spawn(b, b.queue.shift().type);
      if (d.oilRate && this.tick % TPS === 0) { p.oil += d.oilRate; p.stats.oil += d.oilRate; }
      if (d.dmg) {
        if (b.cd > 0) b.cd--;
        let t = b.target ? this.byId.get(b.target) : null;
        if (t && (this.dist(b.x, b.y, t) > d.range || !this.canSee(b.owner, t))) t = null;
        if (!t && (this.tick + b.id) % 6 === 0) t = this.acquire(b, d.range);
        b.target = t ? t.id : 0;
        if (t) { b.facing = Math.atan2(t.y - b.y, t.x - b.x); if (b.cd <= 0) this.fire(b, t); }
      }
    }
    spawn(b, type) {
      for (let i = this.players[b.owner].defs.units[type].count || 1; i > 0; i--) this.spawnOne(b, type);
    }
    spawnOne(b, type) {
      const f = this.nearestFree(b.x, b.ty + b.h + 0.5);
      const u = this.addUnit(type, b.owner, f.x, f.y);
      this.players[b.owner].stats.built++;
      this.events.push({ type: 'trained', owner: b.owner, name: u.def.name });
      const r = b.rally;
      if (r) {
        const n = r.node && this.byId.get(r.node);
        if (n && type === 'worker') { u.order = { type: 'gather', node: n.id, phase: 'go', base: 0, t: 0 }; }
        else {
          // fan arrivals out around the rally point instead of stacking them on it
          const k = b.rallyN = ((b.rallyN || 0) + 1) % 30, a = k * 2.4, d = 0.8 * Math.sqrt(k);
          this.orderMove([u], r.x + Math.cos(a) * d, r.y + Math.sin(a) * d, 'move');
        }
      } else this.autoGather(u);
    }

    // ---------- per-tick systems ----------
    separate(us) {
      const W = this.W, H = this.H, head = this._head, nxt = this._nxt;
      head.fill(-1);
      for (let i = 0; i < us.length; i++) { const c = (us[i].y | 0) * W + (us[i].x | 0); nxt[i] = head[c]; head[c] = i; }
      for (let i = 0; i < us.length; i++) {
        const u = us[i];
        if (u.order.type === 'gather') continue;
        const cx = u.x | 0, cy = u.y | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const x = cx + ox, y = cy + oy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          for (let j = head[y * W + x]; j >= 0; j = nxt[j]) {
            if (j <= i) continue;
            const v = us[j];
            if (v.order.type === 'gather' || !u.def.air !== !v.def.air) continue;
            let dx = v.x - u.x, dy = v.y - u.y, d = Math.hypot(dx, dy);
            const min = u.def.r + v.def.r;
            if (d >= min) continue;
            if (d < 1e-4) { const a = ((u.id * 7 + v.id * 13) % 628) / 100; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
            const push = (min - d) * 0.5, px = dx / d * push, py = dy / d * push;
            if (!this.blocked(u.x - px, u.y - py)) { u.x -= px; u.y -= py; }
            if (!this.blocked(v.x + px, v.y + py)) { v.x += px; v.y += py; }
          }
        }
      }
    }
    sightOffsets(r) {
      let o = this._sight.get(r);
      if (!o) {
        o = [];
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1) o.push(dx, dy);
        this._sight.set(r, o);
      }
      return o;
    }
    updateFog() {
      const W = this.W, H = this.H;
      for (const p of this.players) p.visible.fill(0);
      for (const e of this.ents) {
        if (e.owner < 0 || e.dead) continue;
        const p = this.players[e.owner], o = this.sightOffsets(e.kind === 'building' && !e.built ? 2 : e.def.sight);
        const cx = e.x | 0, cy = e.y | 0;
        for (let k = 0; k < o.length; k += 2) {
          const x = cx + o[k], y = cy + o[k + 1];
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          p.visible[y * W + x] = 1; p.explored[y * W + x] = 1;
        }
      }
      this.fogV++;
    }
    recalc() {
      for (const p of this.players) { p.used = 0; p.cap = 0; p.nb = 0; }
      for (const e of this.ents) {
        if (e.owner < 0 || e.dead) continue;
        const p = this.players[e.owner];
        if (e.kind === 'unit') p.used += e.def.supply;
        else {
          p.nb++;
          if (e.built) p.cap += e.def.supply || 0;
          for (const q of e.queue) { const d = p.defs.units[q.type]; p.used += d.supply * (d.count || 1); }
        }
      }
      for (const p of this.players) p.cap = Math.min(R.MAX_FOOD, p.cap);
      this.dirty = false;
    }

    // cheap state checksum, used to detect multiplayer desyncs
    hash() {
      let h = this.tick | 0;
      for (const e of this.ents) {
        h = (Math.imul(h, 31) + e.id) | 0;
        h = (Math.imul(h, 31) + Math.round(e.x * 1000)) | 0;
        h = (Math.imul(h, 31) + Math.round(e.y * 1000)) | 0;
        h = (Math.imul(h, 31) + Math.round((e.hp || e.amount || 0) * 10)) | 0;
      }
      for (const p of this.players) h = (Math.imul(h, 31) + Math.round(p.cash * 10) + Math.round(p.oil * 10)) | 0;
      return h >>> 0;
    }

    step() {
      if (this.winner >= 0) return;
      const q = this.cmdQ; this.cmdQ = [];
      for (const c of q) this.exec(c);
      this.tick++;
      const units = [];
      for (let i = 0, n = this.ents.length; i < n; i++) {
        const e = this.ents[i];
        if (e.dead) continue;
        if (e.kind === 'unit') { this.updateUnit(e); units.push(e); }
        else if (e.kind === 'building') this.updateBuilding(e);
      }
      this.separate(units);
      this.updateProjectiles();
      if (this.anyDead) { this.ents = this.ents.filter(e => !e.dead); this.anyDead = false; }
      if (this.tick % 4 === 0) this.updateFog();
      if (this.dirty) this.recalc();
      if (this.tick % 10 === 0) {
        let alive = 0, last = -1;
        for (const p of this.players) {
          if (p.alive && p.nb === 0) p.alive = false;
          if (p.alive) { alive++; last = p.id; }
        }
        if (alive <= 1 && this.players.length > 1) this.winner = last;
      }
    }
  }
  R.Sim = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
