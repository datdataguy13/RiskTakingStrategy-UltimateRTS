// Canvas renderer: terrain, entities, effects, fog of war, minimap. All art is procedural.
(function () {
  'use strict';
  const R = window.RTS, T = R.TILE;

  const PALETTES = {
    grass: { ground: [98, 31, 27], hueVar: 22, litVar: 9, water: [207, 50, 27], shore: 'rgba(214,201,150,.55)', glint: 'rgba(255,255,255,.07)',
      speckA: 'rgba(255,255,200,.07)', speckB: 'rgba(0,0,0,.09)', tree: [118, 38, 15], rock: [30, 6, 38],
      road: 'rgba(96,78,50,.55)', roadLite: 'rgba(150,125,85,.45)', rut: 'rgba(60,45,25,.35)' },
    desert: { ground: [38, 42, 50], hueVar: 10, litVar: 12, water: [188, 48, 31], shore: 'rgba(110,90,55,.5)', glint: 'rgba(255,255,255,.1)',
      speckA: 'rgba(255,245,210,.12)', speckB: 'rgba(90,60,20,.12)', tree: [95, 40, 24], rock: [22, 30, 36],
      road: 'rgba(120,92,58,.5)', roadLite: 'rgba(205,180,130,.35)', rut: 'rgba(80,58,30,.35)' },
    snow: { ground: [208, 16, 76], hueVar: 8, litVar: 10, water: [212, 42, 30], shore: 'rgba(225,240,255,.75)', glint: 'rgba(255,255,255,.14)',
      speckA: 'rgba(255,255,255,.3)', speckB: 'rgba(90,110,140,.1)', tree: [150, 28, 15], rock: [215, 8, 42],
      road: 'rgba(110,100,92,.5)', roadLite: 'rgba(150,140,128,.4)', rut: 'rgba(70,62,55,.35)' }
  };

  R.Renderer = class {
    constructor(canvas, mm, sim, me) {
      this.cv = canvas; this.g = canvas.getContext('2d');
      this.mm = mm; this.mg = mm.getContext('2d');
      this.sim = sim; this.me = me;
      this.cam = { x: 0, y: 0 }; this.fx = []; this.pings = []; this.time = 0; this.fogV = -1; this.frame = 0;
      this.buildTerrain();
      this.fogCv = document.createElement('canvas'); this.fogCv.width = sim.W; this.fogCv.height = sim.H;
      this.fogG = this.fogCv.getContext('2d'); this.fogImg = this.fogG.createImageData(sim.W, sim.H);
      this.mmTerrain = document.createElement('canvas'); this.mmTerrain.width = mm.width; this.mmTerrain.height = mm.height;
      this.mmTerrain.getContext('2d').drawImage(this.terrain, 0, 0, mm.width, mm.height);
      this.resize();
    }
    resize() {
      const d = window.devicePixelRatio || 1;
      this.vw = window.innerWidth; this.vh = window.innerHeight; this.dpr = d;
      this.cv.width = Math.round(this.vw * d); this.cv.height = Math.round(this.vh * d);
      this.clampCam();
    }
    clampCam() {
      const s = this.sim, c = this.cam;
      c.x = Math.max(0, Math.min(s.W * T - this.vw, c.x));
      c.y = Math.max(-44, Math.min(s.H * T - this.vh + 244, c.y));
    }
    center(x, y) { this.cam.x = x * T - this.vw / 2; this.cam.y = y * T - (this.vh - 200) / 2; this.clampCam(); }
    onScreen(x, y, m) {
      const c = this.cam; m = m || 64;
      return x * T > c.x - m && x * T < c.x + this.vw + m && y * T > c.y - m && y * T < c.y + this.vh + m;
    }

    buildTerrain() {
      const s = this.sim, W = s.W, H = s.H, c = document.createElement('canvas');
      c.width = W * T; c.height = H * T;
      const g = c.getContext('2d'), rnd = R.rng32(s.seed + 99), ter = s.terrain;
      const P = PALETTES[s.theme] || PALETTES.grass;
      const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : ter[y * W + x];
      const big = R.noiseGrid(rnd, W, 7), fine = R.noiseGrid(rnd, W, 2.2);
      // ground: smooth large patches + fine variation, drawn in half-tile blocks so no checkerboard
      const h2 = T / 2;
      for (let y = 0; y < H * 2; y++) for (let x = 0; x < W * 2; x++) {
        const tx = x >> 1, ty = y >> 1, n = big(x / 2, y / 2) * 0.7 + fine(x / 2, y / 2) * 0.3;
        if (ter[ty * W + tx] === 1) g.fillStyle = `hsl(${P.water[0]},${P.water[1]}%,${P.water[2] + (n - 0.5) * 7}%)`;
        else g.fillStyle = `hsl(${P.ground[0] + (n - 0.5) * P.hueVar},${P.ground[1] + (n - 0.5) * 10}%,${P.ground[2] + (n - 0.5) * P.litVar + (rnd() - 0.5) * 1.5}%)`;
        g.fillRect(x * h2, y * h2, h2, h2);
      }
      const onLand = (x, y) => at((x / T) | 0, (y / T) | 0) !== 1;
      for (let i = 0; i < W * H * 3; i++) {   // speckle
        const x = rnd() * W * T, y = rnd() * H * T;
        if (!onLand(x, y)) continue;
        g.fillStyle = rnd() < 0.5 ? P.speckA : P.speckB;
        g.fillRect(x, y, 2 + rnd() * 3, 1.5 + rnd() * 2);
      }
      for (let i = 0; i < W * H * 0.7; i++) {   // theme detail
        const x = rnd() * W * T, y = rnd() * H * T;
        if (!onLand(x, y)) continue;
        if (s.theme === 'desert') {          // dune ripples
          g.strokeStyle = rnd() < 0.5 ? 'rgba(255,240,200,.16)' : 'rgba(90,60,20,.13)'; g.lineWidth = 1.5;
          const len = 14 + rnd() * 26;
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len / 2, y - 4 - rnd() * 4, x + len, y + rnd() * 3); g.stroke();
        } else if (s.theme === 'snow') {     // drifts
          g.fillStyle = rnd() < 0.6 ? 'rgba(255,255,255,.22)' : 'rgba(110,140,180,.13)';
          g.beginPath(); g.ellipse(x, y, 8 + rnd() * 16, 3 + rnd() * 4, rnd() * 0.6 - 0.3, 0, 7); g.fill();
        } else {                             // grass tufts
          g.strokeStyle = rnd() < 0.5 ? 'rgba(20,50,10,.3)' : 'rgba(190,220,120,.16)'; g.lineWidth = 1;
          g.beginPath();
          for (let k = -1; k <= 1; k++) { g.moveTo(x + k * 2, y); g.lineTo(x + k * 3.5, y - 4 - rnd() * 3); }
          g.stroke();
        }
      }
      // supply road between the two bases
      if (s.road && s.road.length > 1) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        const line = () => { g.beginPath(); g.moveTo(9.5 * T, 10.5 * T); for (const p of s.road) g.lineTo(p.x * T, p.y * T); g.stroke(); };
        g.strokeStyle = P.road; g.lineWidth = 24; line();
        g.strokeStyle = P.roadLite; g.lineWidth = 15; line();
        g.strokeStyle = P.rut; g.lineWidth = 1.5; g.setLineDash([9, 7]);
        g.save(); g.translate(-4, -4); line(); g.translate(8, 8); line(); g.restore();
        g.setLineDash([]); g.lineCap = 'butt'; g.lineJoin = 'miter';
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {   // shorelines
        if (ter[y * W + x] !== 1) continue;
        g.fillStyle = P.shore;
        if (at(x, y - 1) !== 1) g.fillRect(x * T, y * T, T, 4);
        if (at(x, y + 1) !== 1) g.fillRect(x * T, y * T + T - 4, T, 4);
        if (at(x - 1, y) !== 1) g.fillRect(x * T, y * T, 4, T);
        if (at(x + 1, y) !== 1) g.fillRect(x * T + T - 4, y * T, 4, T);
        g.fillStyle = P.glint;
        g.fillRect(x * T + rnd() * 16, y * T + 6 + rnd() * 18, 10 + rnd() * 8, 2);
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = ter[y * W + x], px = x * T, py = y * T;
        if (t === 2) {
          for (let k = 0; k < 3; k++) {
            const cx = px + 8 + rnd() * 16, cy = py + 8 + rnd() * 16, r = 9 + rnd() * 6;
            g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(cx + 3, cy + 4, r, 0, 7); g.fill();
            const col = `hsl(${P.tree[0] + rnd() * 20},${P.tree[1] + rnd() * 10}%,${P.tree[2] + rnd() * 7}%)`;
            if (s.theme === 'desert') {        // palm: radiating fronds
              g.strokeStyle = col; g.lineWidth = 3.5; g.lineCap = 'round';
              for (let a = 0; a < 6; a++) { const an = a * 1.047 + rnd(); g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(an) * r * 0.7, cy + Math.sin(an) * r * 0.7 - 2, cx + Math.cos(an) * r, cy + Math.sin(an) * r); g.stroke(); }
              g.lineCap = 'butt'; g.fillStyle = '#5a4020'; g.beginPath(); g.arc(cx, cy, 2.5, 0, 7); g.fill();
            } else if (s.theme === 'snow') {   // pine with snow cap
              g.fillStyle = col; g.beginPath();
              for (let a = 0; a < 8; a++) { const an = a * 0.785, rr = a % 2 ? r * 0.55 : r; g.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr); }
              g.closePath(); g.fill();
              g.fillStyle = 'rgba(245,250,255,.85)'; g.beginPath(); g.arc(cx - 1, cy - 1, r * 0.42, 0, 7); g.fill();
            } else {
              g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
              g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.45, 0, 7); g.fill();
            }
          }
        } else if (t === 3) {
          g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(px + 18, py + 20, 13, 9, 0, 0, 7); g.fill();
          g.fillStyle = `hsl(${P.rock[0]},${P.rock[1]}%,${P.rock[2] + rnd() * 10}%)`;
          g.beginPath(); g.moveTo(px + 4, py + 22); g.lineTo(px + 9, py + 8); g.lineTo(px + 20, py + 4); g.lineTo(px + 28, py + 14); g.lineTo(px + 25, py + 26); g.lineTo(px + 10, py + 28); g.closePath(); g.fill();
          g.fillStyle = s.theme === 'snow' ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.14)';
          g.beginPath(); g.moveTo(px + 9, py + 8); g.lineTo(px + 20, py + 4); g.lineTo(px + 17, py + 14); g.closePath(); g.fill();
        }
      }
      this.terrain = c; this.tg = g;
    }
    // permanent battle scar painted into the ground
    scorch(x, y, size) {
      const g = this.tg, px = x * T, py = y * T, r = Math.max(10, size * T * 0.8);
      const gr = g.createRadialGradient(px, py, r * 0.15, px, py, r);
      gr.addColorStop(0, 'rgba(15,12,10,.6)'); gr.addColorStop(0.6, 'rgba(30,24,18,.3)'); gr.addColorStop(1, 'rgba(30,24,18,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill();
      g.fillStyle = 'rgba(10,8,6,.5)';
      for (let k = 0; k < 6; k++) { const a = k * 1.1 + x * 7 + y * 3, d = r * (0.3 + 0.5 * ((k * 37 % 10) / 10)); g.fillRect(px + Math.cos(a) * d, py + Math.sin(a) * d, 2.5, 2.5); }
    }

    // ----- sim events -> effects -----
    onEvent(ev) {
      const s = this.sim, me = s.players[this.me];
      const seen = (x, y) => me.visible[(y | 0) * s.W + (x | 0)] === 1;
      switch (ev.type) {
        case 'bullet': if (seen(ev.x, ev.y) || seen(ev.tx, ev.ty)) { this.fx.push({ k: 'tracer', x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, t: 0, life: 0.09 }); if (this.onScreen(ev.x, ev.y)) R.Snd.play('shot'); } break;
        case 'beam': if (seen(ev.x, ev.y) || seen(ev.tx, ev.ty)) { this.fx.push({ k: 'beam', x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, t: 0, life: 0.3 }); } break;
        case 'fire': if (seen(ev.x, ev.y)) { this.fx.push({ k: 'flash', x: ev.x, y: ev.y, t: 0, life: 0.1 }); if (this.onScreen(ev.x, ev.y)) R.Snd.play(ev.dtype === 'rocket' ? 'rocket' : ev.dtype === 'explosive' ? 'arty' : 'cannon'); } break;
        case 'boom': if (seen(ev.x, ev.y)) { this.fx.push({ k: 'boom', x: ev.x, y: ev.y, size: ev.size, t: 0, life: 0.35 }); if (ev.size > 0.5) { this.scorch(ev.x, ev.y, ev.size * 0.6); if (this.onScreen(ev.x, ev.y)) R.Snd.play('boom'); } } break;
        case 'death':
          if (seen(ev.x, ev.y)) {
            this.fx.push({ k: 'boom', x: ev.x, y: ev.y, size: ev.size, t: 0, life: ev.bld ? 0.8 : 0.5 });
            if (ev.bld || ev.size > 0.7) this.scorch(ev.x, ev.y, ev.size);
            if (this.onScreen(ev.x, ev.y)) R.Snd.play(ev.bld ? 'bigboom' : ev.size > 0.7 ? 'boom' : 'die');
          }
          break;
      }
    }
    ping(x, y, col) { this.pings.push({ x, y, col, t: 0 }); }

    // ----- drawing helpers -----
    // pl = { color (team), hull (faction camo), emblem }
    drawUnit(g, u, x, y, pl) {
      const r = u.def.r * T, col = pl.color, hull = pl.hull || '#4a4f57';
      g.save(); g.translate(x, y);
      if (u.def.air) {
        g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(9, 16, r * 1.2, r * 0.6, 0, 0, 7); g.fill();
        g.translate(0, -7 + Math.sin(this.time * 3 + u.id) * 1.5);
      } else {
        g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(2, 3, r * 1.1, r * 0.9, 0, 0, 7); g.fill();
      }
      g.rotate(u.facing);
      g.lineWidth = 1.5; g.strokeStyle = '#0c0e11';
      const dark = 'rgba(0,0,0,.35)', gun = '#16181b';
      const tracks = (len, wid) => {
        g.fillStyle = '#1e2126'; g.fillRect(-len, -wid, len * 2, wid * 2);
        g.fillStyle = '#34383e';
        for (let k = -len + 3; k < len - 2; k += 5) { g.fillRect(k, -wid, 2, 3); g.fillRect(k, wid - 3, 2, 3); }
      };
      switch (u.type) {
        case 'worker':
          g.fillStyle = col; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.stroke();
          g.fillStyle = '#f2c230'; g.beginPath(); g.arc(0, 0, r * 0.55, 0, 7); g.fill();
          g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-r * 0.55, -1, r * 1.1, 2);
          if (u.carry) { g.fillStyle = '#ffd84a'; g.fillRect(-r - 4, -3, 6, 6); g.strokeRect(-r - 4, -3, 6, 6); }
          if (u.order && u.order.type === 'build' && !u.path) {
            const ph = this.time * 9 + u.id;
            g.fillStyle = '#3a3f46'; g.fillRect(r * 0.6, -1.5, r * 0.9, 3);
            g.fillStyle = `rgba(255,${200 + 55 * Math.sin(ph * 3) | 0},120,.95)`; g.beginPath(); g.arc(r * 1.6, 0, 2.5 + 1.5 * Math.abs(Math.sin(ph)), 0, 7); g.fill();
            g.fillStyle = '#fff6c8';
            for (let k = 0; k < 4; k++) { const a = ph * 1.7 + k * 1.9, d = 3 + ((ph * 2 + k * 2.3) % 6); g.fillRect(r * 1.6 + Math.cos(a) * d, Math.sin(a) * d, 1.5, 1.5); }
          }
          break;
        case 'rifle':
          g.fillStyle = gun; g.fillRect(r * 0.2, -1.5, r * 1.4, 3);
          g.fillStyle = col; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.stroke();
          g.fillStyle = hull; g.beginPath(); g.arc(-r * 0.1, 0, r * 0.55, 0, 7); g.fill();
          g.strokeStyle = dark; g.lineWidth = 1; g.stroke();
          break;
        case 'rocket':
          g.fillStyle = col; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.stroke();
          g.fillStyle = hull; g.beginPath(); g.arc(-r * 0.1, 0, r * 0.5, 0, 7); g.fill();
          g.fillStyle = '#3a4a2e'; g.fillRect(-r * 0.8, r * 0.25, r * 2.4, 5); g.strokeRect(-r * 0.8, r * 0.25, r * 2.4, 5);
          g.fillStyle = '#d24a2a'; g.fillRect(r * 1.6 - 3, r * 0.25, 3, 5);
          break;
        case 'buggy':
          g.fillStyle = '#121416';
          for (const [wx, wy] of [[-0.75, -1], [0.75, -1], [-0.75, 1], [0.75, 1]]) g.fillRect(wx * r - r * 0.32, wy * r - 2.5, r * 0.64, 5);
          g.fillStyle = hull; g.fillRect(-r * 1.25, -r * 0.8, r * 2.5, r * 1.6); g.strokeRect(-r * 1.25, -r * 0.8, r * 2.5, r * 1.6);
          g.fillStyle = col; g.fillRect(-r * 0.35, -r * 0.6, r * 0.95, r * 1.2);
          g.fillStyle = 'rgba(170,215,255,.6)'; g.fillRect(r * 0.6, -r * 0.6, r * 0.25, r * 1.2);
          g.fillStyle = gun; g.beginPath(); g.arc(-r * 0.6, 0, r * 0.3, 0, 7); g.fill(); g.fillRect(-r * 0.6, -1.5, r * 1.5, 3);
          break;
        case 'tank': case 'juggernaut': {
          const big = u.type === 'juggernaut';
          tracks(r * 1.25, r);
          g.fillStyle = hull; g.fillRect(-r * 1.12, -r * 0.7, r * 2.24, r * 1.4); g.strokeRect(-r * 1.12, -r * 0.7, r * 2.24, r * 1.4);
          g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(-r * 1.12, r * 0.25, r * 2.24, r * 0.45);
          g.fillStyle = gun;
          if (big) { g.fillRect(0, -r * 0.36, r * 1.8, 4); g.fillRect(0, r * 0.36 - 4, r * 1.8, 4); } else g.fillRect(0, -2, r * 1.75, 4);
          g.fillStyle = col; g.beginPath();
          if (big) g.rect(-r * 0.75, -r * 0.55, r * 1.25, r * 1.1); else g.arc(-r * 0.1, 0, r * 0.56, 0, 7);
          g.fill(); g.stroke();
          g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.arc(-r * 0.25, -r * 0.18, r * 0.2, 0, 7); g.fill();
          break;
        }
        case 'artillery':
          tracks(r * 1.2, r * 0.95);
          g.fillStyle = hull; g.fillRect(-r * 1.1, -r * 0.68, r * 2.0, r * 1.36); g.strokeRect(-r * 1.1, -r * 0.68, r * 2.0, r * 1.36);
          g.fillStyle = col; g.fillRect(-r * 1.0, -r * 0.5, r * 1.0, r);  g.strokeRect(-r * 1.0, -r * 0.5, r * 1.0, r);
          g.fillStyle = gun; g.fillRect(-r * 0.3, -2.5, r * 2.5, 5); g.fillRect(r * 2.0, -3.5, 4, 7);
          break;
        case 'drone':
          g.fillStyle = col; g.beginPath();
          g.moveTo(r * 0.25, -r * 1.7); g.lineTo(r * 0.55, -r * 1.7); g.lineTo(r * 0.3, 0); g.lineTo(r * 0.55, r * 1.7); g.lineTo(r * 0.25, r * 1.7); g.lineTo(-r * 0.15, 0);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#c9ced4'; g.beginPath();
          g.moveTo(r * 1.3, 0); g.quadraticCurveTo(r * 1.1, -r * 0.3, r * 0.2, -r * 0.24); g.lineTo(-r * 1.2, -r * 0.12); g.lineTo(-r * 1.2, r * 0.12); g.lineTo(r * 0.2, r * 0.24); g.quadraticCurveTo(r * 1.1, r * 0.3, r * 1.3, 0);
          g.closePath(); g.fill(); g.stroke();
          g.fillStyle = col; g.beginPath(); g.moveTo(-r * 0.95, 0); g.lineTo(-r * 1.4, -r * 0.6); g.lineTo(-r * 1.25, 0); g.lineTo(-r * 1.4, r * 0.6); g.closePath(); g.fill(); g.stroke();
          g.fillStyle = '#eee'; g.fillRect(r * 0.15, -r * 1.05, r * 0.4, 3); g.fillRect(r * 0.15, r * 1.05 - 3, r * 0.4, 3);
          break;
        case 'barrage':
          g.fillStyle = '#121416';
          for (const wx of [-0.85, -0.25, 0.75]) { g.fillRect(wx * r - r * 0.25, -r - 2, r * 0.5, 4); g.fillRect(wx * r - r * 0.25, r - 2, r * 0.5, 4); }
          g.fillStyle = hull; g.fillRect(-r * 1.3, -r * 0.75, r * 2.6, r * 1.5); g.strokeRect(-r * 1.3, -r * 0.75, r * 2.6, r * 1.5);
          g.fillStyle = col; g.fillRect(r * 0.55, -r * 0.7, r * 0.7, r * 1.4); g.strokeRect(r * 0.55, -r * 0.7, r * 0.7, r * 1.4);
          g.fillStyle = 'rgba(170,215,255,.6)'; g.fillRect(r * 1.05, -r * 0.55, r * 0.15, r * 1.1);
          g.fillStyle = '#2a2d31'; g.fillRect(-r * 1.15, -r * 0.6, r * 1.5, r * 1.2); g.strokeRect(-r * 1.15, -r * 0.6, r * 1.5, r * 1.2);
          g.fillStyle = '#0a0a0a';
          for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) { g.beginPath(); g.arc(-r * 0.9 + a * r * 0.5, -r * 0.28 + b * r * 0.56, r * 0.16, 0, 7); g.fill(); }
          break;
      }
      g.restore();
    }
    emblem(g, kind, cx, cy, s) {
      const star = (x, y, ro, ri) => {
        g.beginPath();
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? ri : ro; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.closePath(); g.fill();
      };
      g.save(); g.lineWidth = Math.max(1, s * 0.08); g.strokeStyle = '#0e1013';
      if (kind === 'star') {
        g.fillStyle = '#1d3a78'; g.beginPath(); g.arc(cx, cy, s, 0, 7); g.fill(); g.stroke();
        g.fillStyle = '#f4f6f8'; star(cx, cy, s * 0.82, s * 0.33);
      } else if (kind === 'redstar') {
        g.fillStyle = '#f4f6f8'; g.beginPath(); g.arc(cx, cy, s, 0, 7); g.fill(); g.stroke();
        g.fillStyle = '#d8262c'; star(cx, cy, s * 0.85, s * 0.34);
      } else {
        const sh = () => { g.beginPath(); g.moveTo(cx - s * 0.85, cy - s); g.lineTo(cx + s * 0.85, cy - s); g.lineTo(cx + s * 0.85, cy + s * 0.1); g.quadraticCurveTo(cx + s * 0.8, cy + s * 0.75, cx, cy + s * 1.05); g.quadraticCurveTo(cx - s * 0.8, cy + s * 0.75, cx - s * 0.85, cy + s * 0.1); g.closePath(); };
        g.save(); sh(); g.clip();
        g.fillStyle = '#f4f6f8'; g.fillRect(cx - s, cy - s, s * 2, s * 0.7);
        g.fillStyle = '#2550b0'; g.fillRect(cx - s, cy - s * 0.3, s * 2, s * 0.7);
        g.fillStyle = '#d8262c'; g.fillRect(cx - s, cy + s * 0.4, s * 2, s * 0.8);
        g.restore();
        sh(); g.strokeStyle = '#e0b040'; g.lineWidth = Math.max(1.5, s * 0.14); g.stroke();
      }
      g.restore();
    }
    drawBuilding(g, b, pl) {
      const x = b.tx * T, y = b.ty * T, w = b.w * T, h = b.h * T, cx = x + w / 2, cy = y + h / 2, col = pl.color, hull = pl.hull || '#4a4f57';
      g.save();
      if (!b.built) g.globalAlpha = 0.45 + 0.4 * b.progress;
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 5, y + 7, w - 4, h - 4);
      g.fillStyle = '#33373d'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = hull; g.globalAlpha *= 0.55; g.fillRect(x + 2, y + 2, w - 4, h - 4); g.globalAlpha = b.built ? 1 : 0.45 + 0.4 * b.progress;
      g.strokeStyle = '#0e1013'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      g.lineWidth = 1.5;
      const dark = 'rgba(0,0,0,.3)', lite = 'rgba(255,255,255,.18)';
      switch (b.type) {
        case 'hq':
          g.fillStyle = col; g.fillRect(x + 9, y + 9, w - 18, h - 18); g.strokeRect(x + 9, y + 9, w - 18, h - 18);
          g.fillStyle = dark; g.fillRect(x + 18, y + 18, w - 36, h - 36);
          this.emblem(g, pl.emblem, cx, cy, 17);
          g.fillStyle = '#16181b'; for (const [ox, oy] of [[6, 6], [w - 10, 6], [6, h - 10], [w - 10, h - 10]]) g.fillRect(x + ox, y + oy, 4, 4);
          break;
        case 'farm':
          g.fillStyle = '#6a5730'; g.fillRect(x + 5, y + 5, w - 10, h - 10);
          g.strokeStyle = '#9dbb45'; g.lineWidth = 3;
          for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x + 9, y + 11 + k * 10.5); g.lineTo(x + w - 9, y + 11 + k * 10.5); g.stroke(); }
          g.lineWidth = 1.5; g.strokeStyle = '#0e1013';
          g.fillStyle = col; g.fillRect(x + w - 26, y + 6, 20, 18); g.strokeRect(x + w - 26, y + 6, 20, 18);
          g.fillStyle = lite; g.fillRect(x + w - 26, y + 6, 20, 5);
          break;
        case 'barracks':
          g.fillStyle = col; g.fillRect(x + 7, y + 7, w - 14, h - 14); g.strokeRect(x + 7, y + 7, w - 14, h - 14);
          g.fillStyle = lite; g.fillRect(x + 7, y + 7, w - 14, (h - 14) / 2);
          g.fillStyle = '#16181b'; g.fillRect(cx - 1, y + 7, 2, h - 14); g.fillRect(cx - 8, y + h - 19, 16, 12);
          this.emblem(g, pl.emblem, x + 20, y + 20, 7);
          break;
        case 'derrick':
          g.fillStyle = '#23262b'; g.fillRect(x + 8, y + 8, w - 16, h - 16);
          g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
          g.moveTo(x + 10, y + h - 10); g.lineTo(cx, y + 10); g.lineTo(x + w - 10, y + h - 10);
          g.moveTo(x + 17, y + h - 24); g.lineTo(x + w - 17, y + h - 24); g.moveTo(x + 13, y + h - 14); g.lineTo(x + w - 13, y + h - 14); g.stroke();
          g.fillStyle = '#0a0a0a'; g.beginPath(); g.arc(cx, cy + 8 + (b.built ? Math.sin(this.time * 4 + b.id) * 5 : 0), 5, 0, 7); g.fill();
          break;
        case 'factory':
          g.fillStyle = col; g.fillRect(x + 8, y + 8, w - 16, h - 16); g.strokeStyle = '#0e1013'; g.strokeRect(x + 8, y + 8, w - 16, h - 16);
          for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? dark : lite; g.fillRect(x + 8 + k * (w - 16) / 4, y + 8, (w - 16) / 4, h - 42); }
          g.fillStyle = '#16181b'; g.fillRect(cx - 16, y + h - 30, 32, 22);
          g.fillStyle = '#555b63'; for (let k = 0; k < 4; k++) g.fillRect(cx - 14, y + h - 28 + k * 5, 28, 2);
          g.fillStyle = '#16181b'; g.beginPath(); g.arc(x + w - 18, y + 18, 6, 0, 7); g.fill();
          this.emblem(g, pl.emblem, x + 20, y + 20, 8);
          break;
        case 'techlab':
          g.fillStyle = col; g.fillRect(x + 7, y + 7, w - 14, h - 14); g.strokeRect(x + 7, y + 7, w - 14, h - 14);
          g.fillStyle = '#16181b'; g.beginPath(); g.arc(cx, cy, 17, 0, 7); g.fill();
          g.fillStyle = `rgba(160,235,255,${b.built ? 0.65 + 0.3 * Math.sin(this.time * 3 + b.id) : 0.3})`; g.beginPath(); g.arc(cx, cy, 13, 0, 7); g.fill();
          g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(cx - 4, cy - 4, 4, 0, 7); g.fill();
          break;
        case 'turret':
          g.fillStyle = '#22252a'; g.beginPath(); g.arc(cx, cy, 13, 0, 7); g.fill();
          g.translate(cx, cy); g.rotate(b.facing);
          g.fillStyle = '#16181b'; g.fillRect(0, -3, 20, 6);
          g.fillStyle = col; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill(); g.stroke();
          break;
      }
      g.restore();
      if (!b.built) {
        g.strokeStyle = 'rgba(255,214,90,.8)'; g.lineWidth = 1; g.setLineDash([5, 4]); g.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5); g.setLineDash([]);
        this.bar(g, x + 4, y + h - 9, w - 8, b.progress, '#ffd65a');
      }
    }
    // Damage shows as fire: the lower the building's health, the more and the bigger the flames.
    drawFire(g, b) {
      const f = b.hp / b.maxHp;
      if (!b.built || f >= 0.8) return;
      const hurt = Math.min(1, (0.8 - f) / 0.7), area = b.w * b.h;          // 0 = just damaged, 1 = about to fall
      const n = Math.max(1, Math.round((0.6 + hurt * 2.4) * Math.sqrt(area)));
      const rnd = R.rng32(b.id * 7919 + 13), x0 = b.tx * T, y0 = b.ty * T, w = b.w * T, h = b.h * T, t = this.time;
      const spots = [];
      for (let k = 0; k < n; k++) spots.push({ x: x0 + w * (0.18 + 0.64 * rnd()), y: y0 + h * (0.3 + 0.55 * rnd()), ph: rnd() * 6.3, k: 0.75 + 0.5 * rnd() });
      spots.sort((a, c) => a.y - c.y);
      for (const sp of spots) {
        const size = (7 + 15 * hurt) * sp.k * Math.min(1.5, 0.75 + 0.2 * Math.sqrt(area));
        // smoke column
        for (let k = 0; k < 4; k++) {
          const u = (t * 0.45 + sp.ph + k * 0.25) % 1, r = size * (0.45 + 0.9 * u);
          g.fillStyle = `rgba(28,26,24,${(0.42 + 0.2 * hurt) * (1 - u)})`;
          g.beginPath(); g.arc(sp.x + Math.sin(t * 1.3 + sp.ph + k) * 3 + u * size * 0.9, sp.y - size * 0.9 - u * size * 3.2, r, 0, 7); g.fill();
        }
        // ground glow, then three nested flickering tongues
        g.fillStyle = `rgba(255,120,30,${0.18 + 0.12 * Math.sin(t * 9 + sp.ph)})`; g.beginPath(); g.ellipse(sp.x, sp.y, size * 1.3, size * 0.7, 0, 0, 7); g.fill();
        const layers = [['#d8351c', 1], ['#ff8a1e', 0.72], ['#ffe27a', 0.42]];
        for (let i = 0; i < 3; i++) {
          const s2 = size * layers[i][1], fl = Math.sin(t * (11 + i * 3) + sp.ph * (i + 1)), sway = Math.sin(t * 6 + sp.ph + i) * s2 * 0.22;
          const hh = s2 * (1.9 + 0.35 * fl);
          g.fillStyle = layers[i][0]; g.beginPath();
          g.moveTo(sp.x - s2 * 0.62, sp.y);
          g.quadraticCurveTo(sp.x - s2 * 0.75, sp.y - hh * 0.45, sp.x + sway, sp.y - hh);
          g.quadraticCurveTo(sp.x + s2 * 0.75, sp.y - hh * 0.45, sp.x + s2 * 0.62, sp.y);
          g.quadraticCurveTo(sp.x, sp.y + s2 * 0.35, sp.x - s2 * 0.62, sp.y);
          g.fill();
        }
        // embers
        g.fillStyle = '#ffd27a';
        for (let k = 0; k < 2; k++) { const u = (t * 0.9 + sp.ph * 2 + k * 0.5) % 1; g.globalAlpha = 1 - u; g.fillRect(sp.x + Math.sin(sp.ph + k * 3 + u * 5) * size * 0.6, sp.y - size - u * size * 2.5, 2, 2); }
        g.globalAlpha = 1;
      }
    }
    flag(g, x, y, col) {
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x + 1, y + 1, 6, 3, 0, 0, 7); g.fill();
      g.strokeStyle = '#0e1013'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 24); g.stroke();
      g.strokeStyle = '#e8eaee'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 24); g.stroke();
      const wv = Math.sin(this.time * 5) * 2;
      g.fillStyle = col; g.strokeStyle = '#0e1013'; g.lineWidth = 1.2; g.beginPath();
      g.moveTo(x + 1, y - 24); g.quadraticCurveTo(x + 8, y - 26 + wv, x + 15, y - 21 - wv); g.lineTo(x + 15, y - 12 - wv); g.quadraticCurveTo(x + 8, y - 16 + wv, x + 1, y - 14); g.closePath(); g.fill(); g.stroke();
    }
    bar(g, x, y, w, f, col) {
      g.fillStyle = '#0b0d0f'; g.fillRect(x - 1, y - 1, w + 2, 6);
      g.fillStyle = col || (f > 0.6 ? '#4fd165' : f > 0.3 ? '#f0c33c' : '#ee4b4b');
      g.fillRect(x, y, Math.max(0, w * f), 4);
    }

    draw(alpha, ui, dt) {
      const g = this.g, s = this.sim, me = s.players[this.me], W = s.W, cam = this.cam;
      this.time += dt; this.frame++;
      const cx = Math.round(cam.x), cy = Math.round(cam.y);
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = '#000'; g.fillRect(0, 0, this.vw, this.vh);
      g.translate(-cx, -cy);
      g.drawImage(this.terrain, 0, 0);
      const vis = (x, y) => me.visible[(y | 0) * W + (x | 0)] === 1;
      const exp = (x, y) => me.explored[(y | 0) * W + (x | 0)] === 1;
      const sel = ui.sel;
      const units = [], blds = [];

      for (const e of s.ents) {
        if (e.dead || !this.onScreen(e.x, e.y, 110)) continue;
        if (e.kind === 'seep') {
          if (e.covered || !exp(e.x, e.y)) continue;
          const px = e.x * T, py = e.y * T;
          g.fillStyle = 'rgba(8,8,10,.8)';
          g.beginPath(); g.ellipse(px, py, 26, 20, 0.3, 0, 7); g.fill();
          g.beginPath(); g.ellipse(px - 14, py + 12, 12, 8, 0, 0, 7); g.fill();
          g.beginPath(); g.ellipse(px + 16, py - 12, 10, 7, 0, 0, 7); g.fill();
          g.fillStyle = 'rgba(120,110,160,.35)'; g.beginPath(); g.ellipse(px - 6, py - 5, 9, 4, 0.3, 0, 7); g.fill();
          const bub = (this.time * 0.7 + e.id * 0.37) % 1;
          g.strokeStyle = `rgba(190,190,210,${0.6 * (1 - bub)})`; g.lineWidth = 1.5; g.beginPath(); g.arc(px + 6, py + 4, 2 + bub * 7, 0, 7); g.stroke();
        } else if (e.kind === 'ore') {
          if (!exp(e.x, e.y)) continue;
          const rnd = R.rng32(e.id * 977);
          g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(e.x * T + 3, e.y * T + 6, 30, 24, 0, 0, 7); g.fill();
          for (let k = 0; k < 9; k++) {
            const px = e.tx * T + 10 + rnd() * 44, py = e.ty * T + 10 + rnd() * 44, r = 7 + rnd() * 7;
            g.fillStyle = `hsl(${42 + rnd() * 8},${70 + rnd() * 20}%,${42 + rnd() * 16}%)`;
            g.beginPath(); g.moveTo(px, py - r); g.lineTo(px + r, py); g.lineTo(px, py + r * 0.8); g.lineTo(px - r, py); g.closePath(); g.fill();
            g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.moveTo(px, py - r); g.lineTo(px + r * 0.4, py - r * 0.2); g.lineTo(px - r * 0.5, py - r * 0.1); g.closePath(); g.fill();
          }
        } else if (e.kind === 'building') { if (e.owner === this.me || exp(e.x, e.y)) blds.push(e); }
        else if (e.owner === this.me || vis(e.x, e.y)) units.push(e);
      }
      for (const b of blds) this.drawBuilding(g, b, s.players[b.owner]);
      for (const u of units) {
        u._x = (u.px + (u.x - u.px) * alpha) * T; u._y = (u.py + (u.y - u.py) * alpha) * T;
        if (sel.has(u.id)) {
          g.strokeStyle = u.owner === this.me ? '#6dff8a' : '#ff5a5a'; g.lineWidth = 1.5;
          g.beginPath(); g.ellipse(u._x, u._y + 2, u.def.r * T + 5, u.def.r * T + 3, 0, 0, 7); g.stroke();
        }
      }
      units.sort((a, b) => (a.def.air | 0) - (b.def.air | 0));   // aircraft on top
      for (const u of units) this.drawUnit(g, u, u._x, u._y, s.players[u.owner]);
      for (const b of blds) if (b.owner === this.me || vis(b.x, b.y)) this.drawFire(g, b);

      for (const p of s.proj) {
        if (p.delay > 0 || !vis(p.x, p.y)) continue;
        const x = (p.px + (p.x - p.px) * alpha) * T, y = (p.py + (p.y - p.py) * alpha) * T, a = Math.atan2(p.ty - p.y, p.tx - p.x);
        g.save(); g.translate(x, y); g.rotate(a);
        if (p.look === 'rocket') { g.fillStyle = 'rgba(255,200,120,.5)'; g.fillRect(-16, -1.5, 12, 3); g.fillStyle = '#eee'; g.fillRect(-5, -2, 9, 4); }
        else if (p.dtype === 'explosive') { g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill(); g.fillStyle = 'rgba(255,170,60,.6)'; g.fillRect(-12, -1.5, 9, 3); }
        else { g.fillStyle = '#ffe9a8'; g.fillRect(-6, -1.5, 10, 3); }
        g.restore();
      }

      // effects
      const fx = this.fx; let n = 0;
      for (const f of fx) {
        f.t += dt;
        if (f.t >= f.life) continue;
        fx[n++] = f;
        const k = f.t / f.life;
        if (f.k === 'tracer') {
          g.strokeStyle = `rgba(255,236,160,${0.9 * (1 - k)})`; g.lineWidth = 1.5;
          g.beginPath(); g.moveTo(f.x * T, f.y * T); g.lineTo(f.tx * T, f.ty * T); g.stroke();
        } else if (f.k === 'beam') {
          g.strokeStyle = `rgba(140,230,255,${0.5 * (1 - k)})`; g.lineWidth = 7; g.beginPath(); g.moveTo(f.x * T, f.y * T); g.lineTo(f.tx * T, f.ty * T); g.stroke();
          g.strokeStyle = `rgba(255,255,255,${1 - k})`; g.lineWidth = 2; g.stroke();
        } else if (f.k === 'flash') {
          g.fillStyle = `rgba(255,220,130,${1 - k})`; g.beginPath(); g.arc(f.x * T, f.y * T, 9, 0, 7); g.fill();
        } else {
          const r = f.size * T * (0.4 + 0.8 * k);
          g.fillStyle = `rgba(255,${200 - 120 * k | 0},${90 - 80 * k | 0},${0.85 * (1 - k)})`; g.beginPath(); g.arc(f.x * T, f.y * T, r, 0, 7); g.fill();
          g.fillStyle = `rgba(40,36,32,${0.5 * (1 - k)})`; g.beginPath(); g.arc(f.x * T + 3, f.y * T - 4 - 14 * k, r * 0.7, 0, 7); g.fill();
        }
      }
      fx.length = n;

      // fog of war
      if (this.fogV !== s.fogV) {
        this.fogV = s.fogV;
        const d = this.fogImg.data;
        for (let i = 0, j = 3; i < W * s.H; i++, j += 4) d[j] = me.visible[i] ? 0 : me.explored[i] ? 125 : 255;
        this.fogG.putImageData(this.fogImg, 0, 0);
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fogCv, 0, 0, W * T, s.H * T);

      // overlays above the fog
      for (const b of blds) {
        const selected = sel.has(b.id);
        if (selected) {
          g.strokeStyle = b.owner === this.me ? '#6dff8a' : '#ff5a5a'; g.lineWidth = 2; g.strokeRect(b.tx * T, b.ty * T, b.w * T, b.h * T);
          if (b.rally && b.owner === this.me) {
            g.strokeStyle = 'rgba(109,255,138,.7)'; g.lineWidth = 1.5; g.setLineDash([6, 5]);
            g.beginPath(); g.moveTo(b.x * T, b.y * T); g.lineTo(b.rally.x * T, b.rally.y * T); g.stroke(); g.setLineDash([]);
            this.flag(g, b.rally.x * T, b.rally.y * T, me.color);
          }
        }
        if (b.built && (selected || b.hp < b.maxHp) && (b.owner === this.me || vis(b.x, b.y))) this.bar(g, b.tx * T + 4, b.ty * T - 8, b.w * T - 8, b.hp / b.maxHp);
      }
      for (const u of units) if (sel.has(u.id) || u.hp < u.maxHp) { const w = u.def.r * T * 2 + 6; this.bar(g, u._x - w / 2, u._y - u.def.r * T - 10, w, u.hp / u.maxHp); }
      for (const id of sel) {
        const e = s.byId.get(id);
        if (e && (e.kind === 'ore' || e.kind === 'seep')) { g.strokeStyle = '#ffe27a'; g.lineWidth = 2; g.strokeRect(e.tx * T, e.ty * T, 2 * T, 2 * T); }
      }
      if (ui.ghost) {
        const gh = ui.ghost, d = me.defs.buildings[gh.type];
        g.fillStyle = gh.ok ? 'rgba(90,255,130,.35)' : 'rgba(255,70,70,.4)';
        g.fillRect(gh.tx * T, gh.ty * T, d.w * T, d.h * T);
        g.strokeStyle = gh.ok ? '#6dff8a' : '#ff5a5a'; g.lineWidth = 2; g.strokeRect(gh.tx * T, gh.ty * T, d.w * T, d.h * T);
        if (d.range) { g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.arc((gh.tx + d.w / 2) * T, (gh.ty + d.h / 2) * T, d.range * T, 0, 7); g.stroke(); }
      }
      n = 0;
      for (const p of this.pings) {
        p.t += dt; if (p.t >= 0.45) continue; this.pings[n++] = p;
        g.strokeStyle = p.col; g.globalAlpha = 1 - p.t / 0.45; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x * T, p.y * T, 14 - 24 * p.t, 0, 7); g.stroke(); g.globalAlpha = 1;
      }
      this.pings.length = n;

      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (ui.box) {
        const b = ui.box;
        g.fillStyle = 'rgba(109,255,138,.12)'; g.strokeStyle = '#6dff8a'; g.lineWidth = 1;
        g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); g.strokeRect(b.x0 + 0.5, b.y0 + 0.5, b.x1 - b.x0, b.y1 - b.y0);
      }
      if (this.frame % 4 === 0) this.drawMinimap(ui);
    }

    drawMinimap(ui) {
      const g = this.mg, s = this.sim, me = s.players[this.me], W = s.W, mw = this.mm.width, k = mw / W;
      g.drawImage(this.mmTerrain, 0, 0);
      for (const e of s.ents) {
        if (e.dead) continue;
        const i = (e.y | 0) * W + (e.x | 0);
        if (e.kind === 'ore') { if (me.explored[i]) { g.fillStyle = '#ffd84a'; g.fillRect(e.tx * k, e.ty * k, 2 * k, 2 * k); } }
        else if (e.kind === 'seep') { if (me.explored[i] && !e.covered) { g.fillStyle = '#0a0a0a'; g.fillRect(e.tx * k, e.ty * k, 2 * k, 2 * k); } }
        else if (e.kind === 'building') { if (e.owner === this.me || me.explored[i]) { g.fillStyle = s.players[e.owner].color; g.fillRect(e.tx * k, e.ty * k, e.w * k, e.h * k); } }
        else if (e.owner === this.me || me.visible[i]) { g.fillStyle = s.players[e.owner].color; g.fillRect(e.x * k - 1.5, e.y * k - 1.5, 3, 3); }
      }
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fogCv, 0, 0, mw, mw);
      if (ui.alert && ui.alert.t > 0) {
        g.strokeStyle = '#ff4b4b'; g.lineWidth = 2;
        g.beginPath(); g.arc(ui.alert.x * k, ui.alert.y * k, 4 + (this.time * 20) % 12, 0, 7); g.stroke();
      }
      g.strokeStyle = '#fff'; g.lineWidth = 1;
      g.strokeRect(this.cam.x / T * k + 0.5, this.cam.y / T * k + 0.5, this.vw / T * k, (this.vh - 200) / T * k);
    }
  };

  // ----- icons: the same procedural art, rendered small, cached as data URLs -----
  const iconCache = new Map(), defsCache = {};
  let fake = null;
  function iconCanvas(fn) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!fake) { fake = Object.create(R.Renderer.prototype); fake.time = 0.4; }
    fn(g, fake);
    return c.toDataURL();
  }
  R.icon = function (fid, type, color) {
    const f = R.FACTIONS[fid], key = fid + ':' + type + ':' + (color || '');
    if (iconCache.has(key)) return iconCache.get(key);
    const d = defsCache[fid] || (defsCache[fid] = R.makeDefs(fid));
    const pl = { color: color || f.color, hull: f.hull, emblem: f.emblem };
    const url = iconCanvas((g, rd) => {
      if (d.units[type]) {
        const u = { type, def: d.units[type], facing: -Math.PI / 4, id: 0, carry: 0 }, r = u.def.r * T, sc = Math.min(2.8, 64 / (r * 2.8));
        g.translate(32, 33); g.scale(sc, sc); rd.drawUnit(g, u, 0, 0, pl);
      } else {
        const bd = d.buildings[type], sc = 60 / (Math.max(bd.w, bd.h) * T);
        g.translate(2 + (60 - bd.w * T * sc) / 2, 1 + (60 - bd.h * T * sc) / 2); g.scale(sc, sc);
        rd.drawBuilding(g, { type, def: bd, tx: 0, ty: 0, w: bd.w, h: bd.h, built: true, progress: 1, facing: -0.6, id: 1 }, pl);
      }
    });
    iconCache.set(key, url);
    return url;
  };
  R.emblemIcon = function (fid) {
    const key = 'emblem:' + fid;
    if (!iconCache.has(key)) iconCache.set(key, iconCanvas((g, rd) => rd.emblem(g, R.FACTIONS[fid].emblem, 32, 31, 28)));
    return iconCache.get(key);
  };
})();
