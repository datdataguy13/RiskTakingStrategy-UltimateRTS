// Multiplayer client. DOM-free: the WebSocket implementation is injected, so the
// same code runs in the browser and in the Node test (test/net-test.js).
//
// Model: the server is the clock. Every 100 ms it broadcasts a "turn" holding all
// commands it received since the last one. Each client applies the turn's commands
// and advances its own copy of the simulation by exactly TICKS_PER_TURN ticks.
// Same commands on the same ticks, on a deterministic sim, keeps every copy identical.
// Computer players run inside each client (the `pre` hook, called before every tick).
// If the connection drops, the same Net can connect again and be handed the turns it missed.
(function (G) {
  'use strict';
  const R = G.RTS;
  const TICKS_PER_TURN = 2, HASH_EVERY = 20;

  R.Net = class {
    constructor(WS) {
      this.WS = WS; this.ws = null; this.handlers = {};
      this.q = []; this.sub = 0; this.turn = 0; this.recv = 0; this.acc = 0; this.desync = false;
      this.pre = null;      // called before every tick: computer players think here
      this.onCmd = null;    // called for every command as it is applied: the replay recorder
    }
    on(type, fn) { this.handlers[type] = fn; return this; }
    emit(type, m) { const f = this.handlers[type]; if (f) f(m); }
    connect(url) {
      return new Promise((resolve, reject) => {
        let open = false;
        const ws = this.ws = new this.WS(url);
        ws.onopen = () => { open = true; resolve(); };
        ws.onerror = () => { if (!open) reject(new Error('Could not reach the game server')); };
        ws.onclose = () => { if (open && this.ws === ws) this.emit('close'); };
        ws.onmessage = e => {
          if (this.ws !== ws) return;
          let m; try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'turn') { if (m.n === this.recv + 1) { this.recv = m.n; this.q.push(m); } }
          else {
            if (m.t === 'desync') this.desync = true;
            if (m.t === 'resume') this.fill(m);
            this.emit(m.t, m);
          }
        };
      });
    }
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    close() { this.handlers = {}; const ws = this.ws; this.ws = null; if (ws) try { ws.close(); } catch (e) { /* already closed */ } }
    // After a reconnect the server lists the turns that carried commands since `from`; the rest were empty.
    fill(m) {
      const byN = new Map(m.turns);
      for (let n = this.recv + 1; n <= m.to; n++) this.q.push({ t: 'turn', n, c: byN.get(n) || [] });
      this.recv = Math.max(this.recv, m.to);
    }
    cmd(c) { this.send({ t: 'cmd', c }); }
    reset() { this.q = []; this.sub = 0; this.turn = 0; this.recv = 0; this.acc = 0; this.desync = false; }

    // Run as many sim ticks as real time and received turns allow. Calls onTick after each.
    advance(sim, dt, onTick) {
      const lag = this.q.length, step = 1 / R.TPS;
      const fast = lag > 20;                                 // far behind (just rejoined, or the tab was asleep): run flat out
      this.acc += dt * (lag > 4 ? 2 : lag > 2 ? 1.3 : 1);    // a little behind: speed up gently
      const t0 = Date.now(), max = fast ? 4000 : 12;
      let n = 0;
      while ((fast || this.acc >= step) && n < max && sim.winner < 0) {
        if (this.sub === 0) {
          if (!this.q.length) { this.acc = 0; break; }       // waiting for the server
          const t = this.q.shift();
          for (const c of t.c) { sim.command(c); if (this.onCmd) this.onCmd(c); }
          this.turn = t.n;
        }
        if (this.pre) this.pre();
        sim.step();
        this.sub = (this.sub + 1) % TICKS_PER_TURN;
        if (this.sub === 0 && this.turn % HASH_EVERY === 0) this.send({ t: 'hash', n: this.turn, h: sim.hash() });
        if (onTick) onTick();
        n++;
        if (!fast) this.acc -= step;
        else if (this.sub === 0 && (this.q.length <= 4 || Date.now() - t0 > 12)) break;
      }
      if (fast || n === 12) this.acc = 0;
      return n;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
