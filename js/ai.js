// Computer opponent. Plays by the same rules as a human: it only issues
// commands through sim.command() and gets no resource or vision bonuses
// beyond knowing where enemy buildings stand.
(function (G) {
  'use strict';
  const R = G.RTS;

  const CFG = {
    easy: { period: 40, workers: 8, wave: 5, grow: 2, minTick: 8400, queue: 1, food: 2, maxBar: 1, maxFac: 1, edge: 1.0,
      order: [['barracks', 1], ['derrick', 1], ['factory', 1], ['derrick', 2], ['turret', 1]] },
    normal: { period: 20, workers: 12, wave: 7, grow: 3, minTick: 6000, queue: 1, food: 4, maxBar: 3, maxFac: 2, edge: 1.25,
      order: [['barracks', 1], ['derrick', 1], ['factory', 1], ['derrick', 2], ['turret', 1], ['techlab', 1], ['barracks', 2], ['turret', 2]] },
    hard: { period: 10, workers: 16, wave: 10, grow: 4, minTick: 4200, queue: 2, food: 6, maxBar: 4, maxFac: 3, edge: 1.4,
      order: [['barracks', 1], ['derrick', 1], ['factory', 1], ['derrick', 2], ['techlab', 1], ['barracks', 2], ['factory', 2], ['turret', 2], ['derrick', 3], ['turret', 3]] }
  };

  R.AI = class {
    constructor(sim, pid, difficulty) {
      this.sim = sim; this.pid = pid; this.cfg = CFG[difficulty] || CFG.normal;
      this.rnd = R.rng32(sim.seed ^ (0x9e3779b9 + pid));
      this.wave = this.cfg.wave; this.squad = new Set(); this.attacking = false;
      this.next = 20 + pid * 3; this.lastDefend = -999;
    }
    cmd(c) { c.player = this.pid; this.sim.command(c); }
    update() {
      if (this.sim.tick < this.next) return;
      this.next = this.sim.tick + this.cfg.period;
      this.think();
    }
    clear(tx, ty, w, h) {
      const s = this.sim;
      if (tx < 0 || ty < 0 || tx + w > s.W || ty + h > s.H) return false;
      for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (s.block[y * s.W + x]) return false;
      return true;
    }
    // nearest legal site to (cx,cy) that keeps a one-tile lane around the building
    spot(type, cx, cy, rmax) {
      const s = this.sim, d = s.players[this.pid].defs.buildings[type];
      const ores = s.ents.filter(e => e.kind === 'ore');
      let best = null, bd = 1e9;
      for (let ty = Math.max(1, (cy - rmax) | 0); ty <= Math.min(s.H - d.h - 1, cy + rmax); ty++)
        for (let tx = Math.max(1, (cx - rmax) | 0); tx <= Math.min(s.W - d.w - 1, cx + rmax); tx++) {
          const mx = tx + d.w / 2, my = ty + d.h / 2;
          let dd = Math.hypot(mx - cx, my - cy);
          if (dd >= bd) continue;
          if (type !== 'hq') for (const o of ores) if (Math.hypot(o.x - mx, o.y - my) < 4.5) { dd += 8; break; }
          if (dd >= bd || !this.clear(tx - 1, ty - 1, d.w + 2, d.h + 2) || s.canPlace(this.pid, type, tx, ty)) continue;
          best = { tx, ty }; bd = dd;
        }
      return best;
    }
    seepSpot(home) {
      const s = this.sim;
      let best = null, bd = 1e9;
      for (const e of s.ents) {
        if (e.kind !== 'seep' || e.covered) continue;
        const d = Math.hypot(e.x - home.x, e.y - home.y);
        if (d < bd && !s.canPlace(this.pid, 'derrick', e.tx, e.ty)) { bd = d; best = { tx: e.tx, ty: e.ty }; }
      }
      return best;
    }

    think() {
      const sim = this.sim, pid = this.pid, p = sim.players[pid], U = p.defs.units, B = p.defs.buildings, cfg = this.cfg;
      const cnt = {}, blds = [], workers = [], army = [], hqs = [], foes = [];
      let foeArmy = 0;
      for (const e of sim.ents) {
        if (e.dead || e.owner < 0) continue;
        if (e.owner !== pid) { if (e.kind === 'building') foes.push(e); else if (e.def.dmg) foeArmy += e.def.supply; continue; }
        if (e.kind === 'building') { blds.push(e); cnt[e.type] = (cnt[e.type] || 0) + 1; if (e.type === 'hq' && e.built) hqs.push(e); }
        else if (e.type === 'worker') workers.push(e); else army.push(e);
      }
      if (!blds.length) return;
      const home = hqs[0] || blds[0];
      const foeHome = foes.find(e => e.type === 'hq') || foes[0] || { x: sim.W - home.x, y: sim.H - home.y };
      let dx = foeHome.x - home.x, dy = foeHome.y - home.y;
      const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      let cash = p.cash, oil = p.oil;
      const la = p.lastAttack;
      const threat = la && sim.tick - la.tick < 100 && blds.some(b => Math.hypot(b.x - la.x, b.y - la.y) < 12);

      // --- economy ---
      for (const w of workers) if (w.order.type === 'idle') {
        const o = sim.nearestOre(w.x, w.y, 999);
        if (o) this.cmd({ type: 'gather', ids: [w.id], target: o.id });
      }
      let queuedWorkers = 0;
      for (const h of hqs) queuedWorkers += h.queue.length;
      for (const h of hqs) {
        if (workers.length + queuedWorkers >= cfg.workers || h.queue.length >= 2 || cash < U.worker.cash || p.used >= p.cap) continue;
        this.cmd({ type: 'train', building: h.id, utype: 'worker' }); cash -= U.worker.cash; queuedWorkers++;
      }

      // --- construction ---
      const pending = blds.filter(b => !b.built);
      let reserve = 0;
      const build = (type, s) => {
        const d = B[type];
        if (cash >= d.cash && oil >= (d.oil || 0)) { this.cmd({ type: 'build', btype: type, tx: s.tx, ty: s.ty }); cash -= d.cash; oil -= d.oil || 0; }
        else reserve = d.cash;
      };
      if (hqs.length && pending.length < 2) {
        const ore = sim.nearestOre(home.x, home.y, 999);
        const oreFar = ore && hqs.every(h => Math.hypot(h.x - ore.x, h.y - ore.y) > 14);
        if (p.cap < R.MAX_FOOD && p.cap - p.used <= cfg.food && !pending.some(b => b.type === 'farm')) {
          const s = this.spot('farm', home.x - dx * 3, home.y - dy * 3, 12);
          if (s) build('farm', s);
        } else if (oreFar && !pending.some(b => b.type === 'hq')) {
          const s = this.spot('hq', ore.x, ore.y, 7);
          if (s) build('hq', s);
        } else {
          let planned = false;
          for (const [type, n] of cfg.order) {
            if ((cnt[type] || 0) >= n) continue;
            if (B[type].req && !sim.has(pid, B[type].req)) continue;
            const s = type === 'derrick' ? this.seepSpot(home)
              : type === 'turret' ? this.spot(type, home.x + dx * 6, home.y + dy * 6, 8)
              : this.spot(type, home.x, home.y, 13);
            if (!s) continue;
            build(type, s);
            planned = true;
            break;
          }
          // build order finished and cash piling up: add production
          if (!planned && cash > 700) {
            const type = oil > 150 && (cnt.factory || 0) < cfg.maxFac ? 'factory' : (cnt.barracks || 0) < cfg.maxBar ? 'barracks' : null;
            const s = type && this.spot(type, home.x, home.y, 14);
            if (s) build(type, s);
          }
        }
      }
      if (threat) reserve = 0;

      // --- production ---
      const tech = sim.has(pid, 'techlab');
      const stage = sim.nearestFree(home.x + dx * 11, home.y + dy * 11);
      let used = p.used;
      // factories get first call on cash so armor is not starved by infantry
      const prod = blds.filter(b => b.type === 'factory').concat(blds.filter(b => b.type === 'barracks'));
      for (const b of prod) {
        if (!b.built) continue;
        if (!b.rally) this.cmd({ type: 'rally', building: b.id, x: stage.x, y: stage.y });
        if (b.queue.length >= cfg.queue) continue;
        const r = this.rnd();
        let pick;
        if (b.type === 'barracks') pick = r < 0.6 ? 'rifle' : 'rocket';
        else if (tech) pick = r < 0.2 ? 'buggy' : r < 0.55 ? 'tank' : r < 0.75 ? 'artillery' : p.unique;
        else pick = r < 0.3 ? 'buggy' : 'tank';
        const d = U[pick];
        if (used + d.supply > p.cap || oil < (d.oil || 0)) continue;
        if (cash - d.cash < reserve) {
          if (b.type === 'factory') reserve += d.cash;   // save up for armor instead of spending it all on infantry
          continue;
        }
        this.cmd({ type: 'train', building: b.id, utype: pick });
        cash -= d.cash; oil -= d.oil || 0; used += d.supply;
      }

      // --- military ---
      for (const id of this.squad) if (!sim.byId.has(id)) this.squad.delete(id);
      const homeArmy = army.filter(u => !this.squad.has(u.id));
      if (threat && sim.tick - this.lastDefend >= 60) {
        const ids = army.filter(u => !u.target && (!this.squad.has(u.id) || Math.hypot(u.x - la.x, u.y - la.y) < 20)).map(u => u.id);
        if (ids.length) this.cmd({ type: 'amove', ids, x: la.x, y: la.y });
        this.lastDefend = sim.tick;
      }
      if (this.attacking && !this.squad.size) { this.attacking = false; this.wave = Math.min(30, this.wave + cfg.grow); }
      let mySupply = 0;
      for (const u of homeArmy) mySupply += u.def.supply;
      // only commit when the force is a match for the enemy army, or we are maxed / rich
      const ready = mySupply >= foeArmy * cfg.edge || p.used >= R.MAX_FOOD - 6 || cash > 2500;
      if (!this.attacking && !threat && homeArmy.length >= this.wave && sim.tick >= cfg.minTick && ready) {
        this.attacking = true;
        for (const u of homeArmy) this.squad.add(u.id);
      } else if (this.attacking && !threat && homeArmy.length >= Math.max(4, this.wave >> 1)) {
        for (const u of homeArmy) this.squad.add(u.id);
      }
      if (this.attacking && foes.length) {
        const sq = army.filter(u => this.squad.has(u.id));
        if (sq.length) {
          let cx = 0, cy = 0;
          for (const u of sq) { cx += u.x; cy += u.y; }
          cx /= sq.length; cy /= sq.length;
          let tgt = foes[0], bd = 1e9;
          for (const f of foes) { const d = Math.hypot(f.x - cx, f.y - cy); if (d < bd) { bd = d; tgt = f; } }
          const ids = sq.filter(u => u.order.type === 'idle' && !u.target).map(u => u.id);
          if (ids.length) this.cmd({ type: 'amove', ids, x: tgt.x, y: tgt.y });
        }
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
