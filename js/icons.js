// Unit portraits: side-view drawings for the command card and info panel.
// Each faction gets its own take on every unit so the icon tells you who they are:
// Liberty = modern kit and optics, Iron Bear = heavy steel, Vanguard = improvised and massed.
(function () {
  'use strict';
  const R = window.RTS, INK = '#0c0e11';

  const LOOK = {
    liberty:  { body: '#b9a878', dark: '#8c7e58', lite: '#d3c493', uniform: '#a3946c', skin: '#e3b890', sky: ['#31486b', '#18222f'] },
    bear:     { body: '#5f6b54', dark: '#414a3a', lite: '#7c8a6e', uniform: '#5c6851', skin: '#e6c3a2', sky: ['#4a4334', '#1d1b17'] },
    dragon:   { body: '#74877f', dark: '#4f605a', lite: '#93a69d', uniform: '#6f8379', skin: '#e2b98f', sky: ['#1f4a44', '#131f1d'] },
    vanguard: { body: '#66743f', dark: '#49542c', lite: '#86955a', uniform: '#8b8350', skin: '#dcb088', sky: ['#5a2f2c', '#1f1514'] }
  };

  // ----- primitives -----
  const fin = (g, fill, stroke) => { if (fill) { g.fillStyle = fill; g.fill(); } if (stroke !== false) { g.strokeStyle = INK; g.stroke(); } };
  const rect = (g, x, y, w, h, fill, stroke) => { g.beginPath(); g.rect(x, y, w, h); fin(g, fill, stroke); };
  const circ = (g, x, y, r, fill, stroke) => { g.beginPath(); g.arc(x, y, r, 0, 7); fin(g, fill, stroke); };
  const poly = (g, pts, fill, stroke) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); fin(g, fill, stroke); };
  const line = (g, x0, y0, x1, y1, w, col) => { g.save(); g.lineWidth = w || 1.2; g.strokeStyle = col || INK; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore(); };
  const star = (g, x, y, r, fill) => { g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fillStyle = fill; g.fill(); };
  const at = (g, x, y, rot, fn) => { g.save(); g.translate(x, y); g.rotate(rot); fn(); g.restore(); };
  const wheel = (g, x, y, r) => { circ(g, x, y, r, '#15171a'); circ(g, x, y, r * 0.45, '#646a72', false); };
  const track = (g, x0, x1, y0, y1, n) => {
    const r = (y1 - y0) / 2;
    g.beginPath(); g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.arc(x1 - r, y0 + r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(x0 + r, y1); g.arc(x0 + r, y0 + r, r, Math.PI / 2, -Math.PI / 2); g.closePath(); fin(g, '#1b1d21');
    for (let k = 0; k < n; k++) circ(g, x0 + r + (x1 - x0 - 2 * r) * k / (n - 1), y0 + r, r * 0.62, '#5d636b', false);
  };

  // ----- infantry: head-and-shoulders, facing right -----
  function soldier(g, c, o) {
    poly(g, [[11, 66], [15, 49], [24, 44], [40, 44], [49, 49], [53, 66]], o.uniform || c.uniform);
    if (o.vest) { rect(g, 21, 47, 22, 20, o.vest); rect(g, 24, 55, 6, 7, 'rgba(0,0,0,.28)'); rect(g, 34, 55, 6, 7, 'rgba(0,0,0,.28)'); }
    if (o.sash) poly(g, [[20, 46], [25, 44], [44, 64], [38, 64]], o.sash);
    rect(g, 14, 51, 6, 5, c.team);
    rect(g, 28, 37, 8, 8, c.skin, false);
    circ(g, 32, 29, 9.5, c.skin);
    rect(g, 36.5, 27.5, 2.2, 2.2, INK, false);
    const h = o.hat;
    g.beginPath();
    if (h === 'modern') {        // high-cut combat helmet, goggles, radio mic
      g.arc(32, 28, 11, Math.PI, 0); g.lineTo(43, 29.5); g.lineTo(30, 29.5); g.lineTo(30, 35); g.lineTo(21, 35); g.closePath(); fin(g, c.body);
      rect(g, 33, 19.5, 9, 4.5, '#22262b'); rect(g, 34.5, 20.5, 6, 2.2, '#7fd0ff', false);
      line(g, 29, 34, 39, 36.5, 1.3); circ(g, 39.5, 36.5, 1.4, INK, false);
    } else if (h === 'steel') {  // deep steel pot with a brim
      g.arc(32, 28.5, 11.8, Math.PI, 0); g.lineTo(46, 31); g.lineTo(19, 31); g.closePath(); fin(g, c.dark);
      star(g, 33, 23, 4, c.team); line(g, 27, 31, 30, 38, 1.2);
    } else if (h === 'cap') {    // soft field cap, big badge
      g.moveTo(21.5, 28.5); g.lineTo(22.5, 19.5); g.lineTo(40, 18); g.lineTo(42.5, 25.5); g.lineTo(49, 27.5); g.lineTo(49, 29.5); g.lineTo(21.5, 29.5); g.closePath(); fin(g, o.capCol || c.uniform);
      star(g, 37, 22.5, 3.6, '#e02a2a');
    } else if (h === 'digital') { // covered helmet in pixel camo, red badge
      g.arc(32, 28.5, 11.5, Math.PI, 0); g.lineTo(43.5, 31); g.lineTo(21, 33); g.lineTo(20.5, 28.5); g.closePath(); fin(g, c.body);
      for (const [x, y] of [[24, 22], [30, 19.5], [36, 24], [27, 27], [39, 20.5]]) rect(g, x, y, 3.2, 2.6, c.dark, false);
      rect(g, 31.5, 23.5, 4, 4, '#d8262c', false); star(g, 33.5, 25.5, 1.7, '#f7d038'); line(g, 26, 33, 30, 38.5, 1.2);
    } else if (h === 'hardhat') {
      g.arc(32, 27.5, 11, Math.PI, 0); g.lineTo(47.5, 27.5); g.lineTo(47.5, 30.5); g.lineTo(21, 30.5); g.closePath(); fin(g, o.hatCol || '#f2c230');
      line(g, 32, 16.5, 32, 27, 1.2, 'rgba(0,0,0,.35)'); rect(g, 34, 31, 8, 3.2, 'rgba(140,215,255,.85)');
    } else if (h === 'ushanka') {
      g.moveTo(20.5, 28.5); g.lineTo(21.5, 18.5); g.lineTo(42.5, 18.5); g.lineTo(43.5, 28.5); g.closePath(); fin(g, '#6f5a45');
      rect(g, 20.5, 26, 7, 12, '#6f5a45'); rect(g, 28, 22, 15, 6.5, '#8b745c'); star(g, 36, 25, 3, c.team);
    } else {                     // flat worker's cap
      g.moveTo(21, 28.5); g.lineTo(23, 20.5); g.lineTo(38, 19.5); g.lineTo(42.5, 24.5); g.lineTo(49.5, 27.5); g.lineTo(49.5, 29); g.lineTo(21, 29.5); g.closePath(); fin(g, '#56606c');
    }
  }
  const WEAPON = {
    m4(g) { at(g, 31, 54, -0.5, () => {
      rect(g, -27, -3, 9, 6, '#2a2e34'); rect(g, 10, -1.2, 15, 2.4, '#1a1c20'); rect(g, -19, -2.8, 30, 5.6, '#2a2e34');
      rect(g, -4, 2.5, 4.5, 8.5, '#1a1c20'); rect(g, -9, -7, 10, 4, '#1a1c20'); rect(g, -7.5, -6, 3, 2, '#ff5a4a', false); }); },
    ak(g) { at(g, 31, 54, -0.5, () => {
      poly(g, [[-28, -3.5], [-18, -2.5], [-18, 2.5], [-28, 4.5]], '#96602c'); rect(g, 12, -1.2, 14, 2.4, '#1a1c20'); rect(g, -18, -2.8, 22, 5.6, '#2a2e34');
      rect(g, 4, -3, 9, 6, '#96602c'); poly(g, [[-5, 2.5], [0, 2.5], [5, 11.5], [0.5, 13]], '#1a1c20'); rect(g, 23, -4, 1.5, 3, '#1a1c20', false); }); },
    javelin(g) { at(g, 31, 41, -0.1, () => {
      rect(g, -21, -5, 44, 10, '#4c5c3c'); rect(g, -26, -7.5, 7, 15, '#17191c'); rect(g, 22, -7.5, 7, 15, '#17191c');
      rect(g, 1, 4, 11, 10, '#2a2e34'); circ(g, 9, 9, 2.6, '#7fd0ff'); }); },
    rpg(g) { at(g, 29, 41, -0.1, () => {
      poly(g, [[-22, -2.6], [-29, -5.5], [-29, 5.5], [-22, 2.6]], '#2a2e34'); rect(g, -22, -2.6, 37, 5.2, '#3a3e44'); rect(g, -9, -3.4, 11, 6.8, '#96602c');
      poly(g, [[15, -2.2], [20, -6.5], [27, -5.5], [34, 0], [27, 5.5], [20, 6.5], [15, 2.2]], '#55733c'); rect(g, -1, 2.6, 3.2, 7.5, '#2a2e34'); }); },
    bullpup(g) { at(g, 31, 54, -0.5, () => {   // magazine behind the grip, carry handle on top
      poly(g, [[-26, -3.2], [6, -3.2], [10, -1.5], [10, 2], [-26, 3.4]], '#2a2e34'); rect(g, 10, -1.2, 13, 2.4, '#1a1c20');
      poly(g, [[-20, 3], [-15, 3], [-12, 11.5], [-17, 12.5]], '#1a1c20'); rect(g, -4, 3, 3.5, 6.5, '#1a1c20');
      g.beginPath(); g.moveTo(-10, -3.2); g.lineTo(-7, -7.5); g.lineTo(3, -7.5); g.lineTo(5, -3.2); g.lineWidth = 1.8; g.strokeStyle = '#1a1c20'; g.stroke(); g.lineWidth = 1.3; }); },
    hj(g) { at(g, 31, 41, -0.1, () => {        // fat sealed launch tube on a shoulder rest
      rect(g, -22, -5.5, 46, 11, '#6a7f72'); rect(g, -22, -5.5, 5, 11, '#d8262c'); rect(g, 19, -5.5, 5, 11, '#d8262c');
      rect(g, -4, 5.5, 9, 8, '#2a2e34'); circ(g, 2.5, 9.5, 2.2, '#f7d038'); }); },
    shovel(g) { at(g, 47, 54, 0.45, () => { rect(g, -1.8, -12, 3.6, 22, '#96602c'); poly(g, [[-6, -12], [6, -12], [6, -19], [0, -25], [-6, -19]], '#aeb5bd'); }); },
    wrench(g) { at(g, 47, 53, 0.55, () => {
      rect(g, -2.3, -15, 4.6, 24, '#c3c9d1'); g.beginPath(); g.arc(0, -18, 6.5, 2.3, 7.1); g.lineTo(0, -17); g.closePath(); fin(g, '#c3c9d1'); }); },
    hammer(g) { at(g, 47, 54, 0.45, () => { rect(g, -2, -15, 4, 25, '#96602c'); rect(g, -8, -22, 16, 8, '#3a3e44'); }); },
    pick(g) { at(g, 46, 55, 0.4, () => {
      rect(g, -2, -17, 4, 27, '#96602c');
      g.beginPath(); g.moveTo(-14, -11); g.quadraticCurveTo(0, -25, 14, -11); g.lineTo(12, -9.5); g.quadraticCurveTo(0, -19, -12, -9.5); g.closePath(); fin(g, '#aeb5bd'); }); }
  };

  // ----- vehicles: side view, facing right, ground at y = 56 -----
  function tank(g, c, o) {
    track(g, 7, 57, 45, 56, 6);
    poly(g, [[5, 45], [9, 37], [52, 37], [60, 42], [58, 45]], c.body);
    if (o.skirt) { rect(g, 9, 43, 47, 4.5, c.dark); for (let x = 18; x < 56; x += 9) line(g, x, 43, x, 47.5, 1); }
    if (o.drums) { rect(g, 4, 34.5, 8, 5.5, c.dark); rect(g, 13, 34.5, 8, 5.5, c.dark); }
    const by = o.by;
    rect(g, o.bx, by - 1.6, o.len, 3.2, '#22262b'); rect(g, o.bx + o.len * 0.45, by - 2.4, 6, 4.8, '#22262b'); rect(g, o.bx + o.len - 2, by - 2.2, 3, 4.4, '#22262b');
    g.beginPath();
    if (o.turret === 'wedge') { g.moveTo(11, 37); g.lineTo(11, 29.5); g.lineTo(21, 26.5); g.lineTo(40, 26.5); g.lineTo(49, 33); g.lineTo(49, 37); g.closePath(); }
    else if (o.turret === 'dome') { g.ellipse(31, 37, 15, 10.5, 0, Math.PI, 0); g.closePath(); }
    else if (o.turret === 'arrow') { g.moveTo(10, 37); g.lineTo(10, 28); g.lineTo(34, 28); g.lineTo(46, 32.5); g.lineTo(38, 37); g.closePath(); }
    else { g.ellipse(30, 37, 10.5, 8.5, 0, Math.PI, 0); g.closePath(); }
    fin(g, c.lite);
    if (o.turret === 'arrow') {   // arrow-shaped armor blocks, laser dazzler box, roof gun
      poly(g, [[34, 28], [46, 32.5], [38, 37], [36, 32.5]], c.dark); for (let k = 0; k < 3; k++) rect(g, 13 + k * 6.5, 30, 5, 4.5, c.body);
      rect(g, 20, 24, 6, 4, c.dark); rect(g, 27, 24.5, 9, 1.8, '#22262b', false); line(g, 13, 28, 12, 14, 1); star(g, 31, 33, 2.6, '#f7d038');
      return;
    }
    if (o.turret === 'wedge') { rect(g, 24, 23, 7, 3.5, c.dark); line(g, 15, 29, 13, 13, 1); rect(g, 30, 21.2, 9, 1.8, '#22262b', false); rect(g, 15, 31, 9, 3.5, c.team); }
    else if (o.turret === 'dome') { for (let k = 0; k < 4; k++) rect(g, 33 + k * 3.2, 31 + k * 1.3, 3, 3.6, c.dark); rect(g, 26, 25, 6, 2.5, c.dark); star(g, 24, 32, 3.6, c.team); poly(g, [[3, 40], [3, 36.5], [12, 36.5], [12, 40]], '#6f5a45'); }
    else { rect(g, 27, 26.5, 6, 3, c.dark); line(g, 30, 26, 37, 20.5, 1.6); circ(g, 37.5, 20.5, 1.2, INK, false); star(g, 29, 33, 3.2, '#e02a2a'); line(g, 22, 33, 22, 30, 1); line(g, 22, 30, 38, 30, 1); }
  }
  function juggernaut(g, c) {
    track(g, 3, 61, 43, 57, 7);
    poly(g, [[2, 43], [6, 32], [55, 32], [63, 39], [61, 43]], c.body);
    rect(g, 6, 40, 52, 5, c.dark); for (let x = 14; x < 58; x += 8) line(g, x, 40, x, 45, 1);
    for (const y of [19.5, 26]) { rect(g, 44, y - 1.9, 18, 3.8, '#22262b'); rect(g, 58.5, y - 2.8, 4.5, 5.6, '#22262b'); }
    poly(g, [[10, 32], [12, 15], [41, 15], [49, 22], [49, 32]], c.lite);
    for (let k = 0; k < 4; k++) rect(g, 15 + k * 6.5, 17.5, 5, 4.5, c.dark);
    star(g, 30, 27, 4.6, c.team); rect(g, 22, 11.5, 8, 3.5, c.dark); line(g, 14, 15, 12, 4, 1);
  }
  function spg(g, c, o) {
    track(g, 7, 57, 45, 56, 6);
    poly(g, [[5, 45], [8, 38], [55, 38], [59, 45]], c.body);
    const gun = (len, brake) => { rect(g, 0, -2, len, 4, '#22262b'); rect(g, len * 0.3, -2.8, 5, 5.6, '#22262b'); if (brake) rect(g, len - 4, -3.4, 5.5, 6.8, '#22262b'); };
    if (o.turret) {
      at(g, 36, 28, -o.ang, () => gun(o.len, o.brake));
      poly(g, [[8, 38], [8, 21], [35, 21], [41, 28], [41, 38]], c.lite);
      rect(g, 12, 25, 9, 4, c.team); if (o.rack) { rect(g, 9, 17.5, 16, 3.5, c.dark); line(g, 30, 21, 28, 8, 1); } else { star(g, 30, 30, 3.8, c.team); rect(g, 3, 24, 5, 11, c.dark); }
    } else {                     // no turret: a huge gun on an open hull
      at(g, 20, 33, -o.ang, () => { gun(o.len, true); rect(g, -6, -3.5, 14, 7, c.dark); });
      poly(g, [[14, 38], [17, 30], [25, 30], [27, 38]], c.lite);
      poly(g, [[2, 46], [6, 38], [9, 38], [6, 50]], c.dark); circ(g, 34, 34, 3, c.skin); rect(g, 31, 30, 6, 2.5, c.uniform); star(g, 21, 41.5, 3, '#e02a2a');
    }
  }
  const VEH = {
    jeep(g, c) {                 // armored 4x4 with a roof gun and antenna
      poly(g, [[6, 49], [6, 36], [14, 36], [18, 27], [40, 27], [46, 36], [58, 38], [59, 49]], c.body);
      poly(g, [[20, 35], [22, 29.5], [29, 29.5], [29, 35]], '#8fd0f5'); poly(g, [[31, 35], [31, 29.5], [39, 29.5], [43, 35]], '#8fd0f5');
      rect(g, 26, 22, 9, 5, c.dark); rect(g, 33, 23, 14, 2.2, '#22262b'); line(g, 12, 36, 9, 12, 1); rect(g, 8, 39, 9, 4, c.team);
      wheel(g, 17, 50, 7); wheel(g, 48, 50, 7);
    },
    btr(g, c) {                  // eight-wheeled armored carrier
      poly(g, [[3, 44], [7, 33], [47, 33], [61, 40], [56, 48], [7, 48]], c.body);
      rect(g, 44, 35.5, 7, 2.5, '#8fd0f5'); for (const x of [14, 24]) rect(g, x, 37, 5, 3, c.dark);
      g.beginPath(); g.moveTo(23, 33); g.lineTo(26, 26); g.lineTo(34, 26); g.lineTo(37, 33); g.closePath(); fin(g, c.lite);
      rect(g, 35, 27.5, 16, 2.2, '#22262b'); star(g, 39, 40.5, 3.4, c.team);
      for (const x of [11, 23, 39, 51]) wheel(g, x, 51, 5.5);
    },
    technical(g, c) {            // pickup truck with a heavy machine gun bolted in the bed
      poly(g, [[4, 48], [4, 39], [29, 39], [31, 30], [43, 30], [48, 39], [59, 41], [60, 48]], '#d8d2c0');
      poly(g, [[33, 38], [34.5, 32.5], [41.5, 32.5], [45, 38]], '#8fd0f5'); rect(g, 4, 43, 25, 2.5, c.team, false);
      line(g, 17, 39, 13, 31, 1.6); line(g, 17, 39, 21, 31, 1.6); rect(g, 12, 27.5, 20, 3.4, '#22262b'); rect(g, 8, 26.5, 6, 5.4, '#22262b');
      circ(g, 9, 22, 3.6, c.skin); rect(g, 5.5, 18.5, 7.5, 2.8, c.uniform); rect(g, 6, 25, 6, 13, c.uniform);
      wheel(g, 15, 50, 6.5); wheel(g, 49, 50, 6.5);
    },
    sixwheel(g, c) {             // 6x6 scout with a remote autocannon turret
      poly(g, [[4, 46], [6, 35], [42, 33], [54, 36], [61, 42], [58, 48], [6, 48]], c.body);
      poly(g, [[44, 39], [44, 35.5], [52, 37], [56, 40]], '#8fd0f5'); rect(g, 8, 38, 14, 4, c.team);
      poly(g, [[20, 34], [22, 27], [33, 27], [36, 33.5]], c.lite); rect(g, 34, 28.5, 17, 2.2, '#22262b'); rect(g, 24, 23.5, 5, 3.5, c.dark);
      for (const [x, y] of [[12, 44], [28, 43], [36, 45]]) rect(g, x, y, 3.2, 2.6, c.dark, false);
      star(g, 28, 40, 2.8, '#f7d038'); for (const x of [13, 31, 50]) wheel(g, x, 51, 5.8);
    },
    flame(g, c) {                // flamethrower tank: fuel drums on the back, a jet of fire out front
      track(g, 5, 47, 45, 56, 5);
      poly(g, [[3, 45], [7, 37], [43, 37], [50, 42], [48, 45]], c.body);
      for (const x of [5, 14]) { g.beginPath(); g.roundRect(x, 27, 8, 10, 3); fin(g, '#c8202a'); line(g, x, 32, x + 8, 32, 1); }
      g.beginPath(); g.ellipse(30, 37, 9, 7.5, 0, Math.PI, 0); g.closePath(); fin(g, c.lite);
      rect(g, 37, 31, 9, 4.4, '#22262b'); rect(g, 45, 30, 3, 6.4, '#e8892a'); star(g, 29, 33.5, 2.8, '#f7d038');
      const jet = (len, wid, col) => { g.beginPath(); g.moveTo(48, 33); g.quadraticCurveTo(48 + len * 0.5, 33 - wid, 48 + len, 28); g.quadraticCurveTo(48 + len * 0.7, 33 + wid * 0.6, 48, 34); g.closePath(); g.fillStyle = col; g.fill(); };
      jet(17, 13, '#d8351c'); jet(14, 9, '#ff8a1e'); jet(9, 5, '#ffe27a');
    },
    heli(g, c, o) {              // transport helicopter; o.tilt = tiltrotor, o.tandem = twin-rotor heavy lifter
      g.fillStyle = 'rgba(255,255,255,.06)'; for (const y of [50, 56]) g.fillRect(0, y, 64, 1.5);
      if (o.tandem) {
        g.beginPath(); g.moveTo(6, 40); g.lineTo(8, 27); g.lineTo(14, 22); g.lineTo(18, 30); g.lineTo(44, 30); g.lineTo(48, 24); g.lineTo(55, 26); g.quadraticCurveTo(62, 34, 58, 42); g.lineTo(10, 43); g.closePath(); fin(g, c.body);
        rect(g, 51, 31, 6, 5, '#8fd0f5'); for (const x of [22, 30, 38]) circ(g, x, 35, 1.8, '#8fd0f5'); rect(g, 12, 33, 6, 8, c.dark); rect(g, 22, 39, 20, 2.5, c.team, false);
        for (const [x, y] of [[13, 21], [50, 23]]) { line(g, x, y, x, y - 4, 2); line(g, x - 13, y - 4.5, x + 13, y - 4.5, 2.2); }
        wheel(g, 18, 46, 3); wheel(g, 48, 46, 3); star(g, 46, 37.5, 2.6, '#f7d038');
      } else {
        g.beginPath(); g.moveTo(4, 30); g.lineTo(24, 31); g.lineTo(28, 25); g.lineTo(46, 25); g.quadraticCurveTo(60, 30, 58, 39); g.lineTo(26, 42); g.lineTo(22, 35); g.lineTo(4, 33); g.closePath(); fin(g, c.body);
        poly(g, [[4, 33], [2, 22], [7, 22], [10, 30]], c.team); poly(g, [[47, 28], [55, 31], [56, 36], [47, 36]], '#8fd0f5'); rect(g, 31, 30, 9, 9, c.dark); rect(g, 12, 31, 9, 2, c.team, false);
        if (o.tilt) { for (const x of [20, 42]) { rect(g, x - 2.5, 16, 5, 11, c.lite); line(g, x - 11, 15.5, x + 11, 15.5, 2.2); } rect(g, 18, 24, 26, 2.5, c.lite); }
        else { line(g, 36, 25, 36, 20, 2.2); line(g, 12, 19.5, 60, 19.5, 2.4); line(g, 4, 27, 4, 17, 1.6); circ(g, 4, 22, 1.4, INK, false); star(g, 27, 35, 2.8, c.team); }
        wheel(g, 30, 45, 3); wheel(g, 50, 44, 3);
      }
      for (const [x, y] of [[22, 52], [34, 55]]) { g.beginPath(); g.moveTo(x - 5, y - 3); g.quadraticCurveTo(x, y - 11, x + 5, y - 3); g.closePath(); fin(g, '#e9ecef'); line(g, x - 4.5, y - 3, x, y + 3, 0.8); line(g, x + 4.5, y - 3, x, y + 3, 0.8); circ(g, x, y + 4, 1.6, c.uniform); }
    },
    biplane(g, c) {              // rugged old biplane dropping jumpers
      g.fillStyle = 'rgba(255,255,255,.06)'; for (const y of [50, 56]) g.fillRect(0, y, 64, 1.5);
      g.beginPath(); g.moveTo(5, 31); g.lineTo(40, 28); g.quadraticCurveTo(56, 28, 57, 34); g.quadraticCurveTo(54, 40, 40, 40); g.lineTo(6, 34); g.closePath(); fin(g, c.body);
      poly(g, [[5, 33], [2, 21], [8, 21], [13, 30]], c.team); rect(g, 22, 19, 30, 3.5, c.lite); rect(g, 24, 37.5, 26, 3.5, c.lite);
      for (const x of [28, 46]) line(g, x, 22.5, x, 37.5, 1.4); line(g, 28, 22.5, 46, 37.5, 0.8); poly(g, [[40, 31], [48, 31], [50, 35], [40, 35]], '#8fd0f5');
      line(g, 59, 23, 59, 45, 2.6, 'rgba(20,22,26,.55)'); circ(g, 58, 34, 2.2, '#22262b'); star(g, 20, 32.5, 2.8, '#e02a2a'); line(g, 40, 40, 38, 46, 1.4); wheel(g, 38, 47, 3);
      for (const [x, y] of [[14, 50], [27, 54]]) { g.beginPath(); g.moveTo(x - 5, y - 3); g.quadraticCurveTo(x, y - 11, x + 5, y - 3); g.closePath(); fin(g, '#e9ecef'); line(g, x - 4.5, y - 3, x, y + 3, 0.8); line(g, x + 4.5, y - 3, x, y + 3, 0.8); circ(g, x, y + 4, 1.6, c.uniform); }
    },
    drone(g, c) {                // long-winged armed drone, seen from the side in flight
      g.beginPath(); g.moveTo(8, 32); g.quadraticCurveTo(30, 27, 46, 27); g.quadraticCurveTo(58, 24, 61, 30); g.quadraticCurveTo(58, 35, 46, 35); g.lineTo(10, 35); g.closePath(); fin(g, '#c9ced4');
      poly(g, [[10, 33], [3, 21], [7, 21], [15, 31]], c.team); poly(g, [[10, 34], [4, 43], [8, 43], [15, 35]], c.team);
      line(g, 6, 26, 6, 40, 1.4); poly(g, [[22, 32], [48, 34], [44, 37], [16, 37]], '#9aa1a9');
      for (const x of [24, 34]) { rect(g, x, 39.5, 12, 3, '#f2f2f2'); poly(g, [[x + 12, 39.5], [x + 15, 41], [x + 12, 42.5]], '#d03a2a'); line(g, x + 5, 37, x + 5, 39.5, 1); }
      circ(g, 54, 35.5, 2.6, '#22262b'); star(g, 30, 31, 2.6, c.team);
    },
    barrage(g, c) {              // rocket truck mid-salvo
      rect(g, 5, 42, 54, 4.5, c.dark);
      poly(g, [[43, 42], [43, 29], [53, 29], [58, 35], [59, 42]], c.body); poly(g, [[48, 35], [48, 31], [52.5, 31], [55.5, 35]], '#8fd0f5');
      at(g, 12, 39, -0.42, () => {
        rect(g, 0, -11, 30, 12, c.lite);
        for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) rect(g, 3 + k * 6.6, -9.3 + r * 5, 5, 3.4, '#17191c');
        rect(g, 30, -9.5, 3, 9, c.dark);
      });
      line(g, 14, 41, 22, 33, 1.8); star(g, 50, 38.5, 2.6, '#e02a2a');
      at(g, 46, 18, -0.42, () => { rect(g, 0, -1.5, 11, 3, '#f2f2f2'); poly(g, [[11, -1.5], [15, 0], [11, 1.5]], '#d03a2a'); poly(g, [[0, -1.5], [-11, 0], [0, 1.5]], '#ffb347', false); });
      for (const x of [12, 23, 50]) wheel(g, x, 50.5, 6);
    }
  };

  // what each faction's version of a unit looks like
  const SPEC = {
    liberty: {
      worker: ['man', { hat: 'hardhat', vest: '#f08a24' }, 'wrench'],
      rifle: ['man', { hat: 'modern', vest: '#7d7152' }, 'm4'],
      rocket: ['man', { hat: 'modern', vest: '#7d7152' }, 'javelin'],
      buggy: ['jeep'], drone: ['drone'], transport: ['heli', { tilt: 1 }],
      tank: ['tank', { turret: 'wedge', skirt: 1, bx: 47, by: 31, len: 16 }],
      artillery: ['spg', { turret: 1, rack: 1, ang: 0.3, len: 27 }]
    },
    bear: {
      worker: ['man', { hat: 'ushanka', uniform: '#4f5f78' }, 'hammer'],
      rifle: ['man', { hat: 'steel' }, 'ak'],
      rocket: ['man', { hat: 'steel' }, 'rpg'],
      buggy: ['btr'], juggernaut: ['juggernaut'], transport: ['heli', {}],
      tank: ['tank', { turret: 'dome', skirt: 1, bx: 43, by: 31.5, len: 20 }],
      artillery: ['spg', { turret: 1, brake: 1, ang: 0.42, len: 28 }]
    },
    dragon: {
      worker: ['man', { hat: 'hardhat', hatCol: '#e9edf0', vest: '#d8e23a' }, 'shovel'],
      rifle: ['man', { hat: 'digital', vest: '#56675f' }, 'bullpup'],
      rocket: ['man', { hat: 'digital', vest: '#56675f' }, 'hj'],
      buggy: ['sixwheel'], flame: ['flame'], transport: ['heli', { tandem: 1 }],
      tank: ['tank', { turret: 'arrow', skirt: 1, bx: 44, by: 32, len: 18 }],
      artillery: ['spg', { turret: 1, brake: 1, rack: 1, ang: 0.52, len: 30 }]
    },
    vanguard: {
      worker: ['man', { hat: 'flatcap', uniform: '#5c6672' }, 'pick'],
      rifle: ['pair', { hat: 'cap' }, 'ak'],
      rocket: ['man', { hat: 'cap', sash: '#6b4a2a' }, 'rpg'],
      buggy: ['technical'], barrage: ['barrage'], transport: ['biplane'],
      tank: ['tank', { turret: 'small', drums: 1, bx: 38, by: 32, len: 16 }],
      artillery: ['spg', { ang: 0.4, len: 42 }]
    }
  };

  function portrait(g, fid, type, color) {
    const f = R.FACTIONS[fid], c = Object.assign({ team: color || f.color }, LOOK[fid] || LOOK.liberty);
    const sp = (SPEC[fid] || {})[type];
    if (!sp) return false;
    // plate
    g.save(); g.beginPath(); g.roundRect(1, 1, 62, 62, 7); g.clip();
    const bg = g.createLinearGradient(0, 0, 0, 64); bg.addColorStop(0, c.sky[0]); bg.addColorStop(1, c.sky[1]);
    g.fillStyle = bg; g.fillRect(0, 0, 64, 64);
    g.lineWidth = 1.3; g.lineJoin = 'round';
    const kind = sp[0];
    if (kind === 'man' || kind === 'pair') {
      if (kind === 'pair') {       // conscripts come in twos
        g.save(); g.translate(-13, 6); g.scale(0.86, 0.86); g.globalAlpha = 0.92; soldier(g, c, sp[1]); g.restore();
        g.save(); g.translate(11, 0); soldier(g, c, sp[1]); g.translate(-6, 0); WEAPON[sp[2]](g); g.restore();
      } else { soldier(g, c, sp[1]); WEAPON[sp[2]](g); }
    } else {
      if (type !== 'drone' && type !== 'transport') { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 55, 64, 9); g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 55, 64, 1); }
      if (kind === 'tank') tank(g, c, sp[1]); else if (kind === 'spg') spg(g, c, sp[1]); else if (kind === 'juggernaut') juggernaut(g, c); else VEH[kind](g, c, sp[1]);
    }
    g.restore();
    R.Renderer.prototype.emblem.call(null, g, f.emblem, 10.5, 10.5, 6.5);
    g.strokeStyle = c.team; g.lineWidth = 2; g.beginPath(); g.roundRect(1, 1, 62, 62, 7); g.stroke();
    return true;
  }

  const cache = new Map(), spriteIcon = R.icon;
  R.icon = function (fid, type, color) {
    const key = fid + ':' + type + ':' + (color || '');
    if (cache.has(key)) return cache.get(key);
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); g.scale(2, 2);
    const url = portrait(g, fid, type, color) ? cv.toDataURL() : spriteIcon(fid, type, color);
    cache.set(key, url);
    return url;
  };
})();
