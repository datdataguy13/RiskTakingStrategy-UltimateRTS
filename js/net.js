// Multiplayer client. DOM-free: the WebSocket implementation is injected, so the
// same code runs in the browser and in the Node test (test/net-test.js).
//
// Model: the server is the clock. Every 100 ms it broadcasts a "turn" holding all
// commands it received since the last one. Each client applies the turn's commands
// and advances its own copy of the simulation by exactly TICKS_PER_TURN ticks.
// Same commands on the same ticks, on a deterministic sim, keeps every copy identical.
(function (G) {
  'use strict';
  const R = G.RTS;
  const TICKS_PER_TURN = 2, HASH_EVERY = 20;

  R.Net = class {
    constructor(WS) {
      this.WS = WS; this.ws = null; this.handlers = {};
      this.q = []; this.sub = 0; this.turn = 0; this.acc = 0; this.desync = false;
    }
    on(type, fn) { this.handlers[type] = fn; return this; }
    emit(type, m) { const f = this.handlers[type]; if (f) f(m); }
    connect(url) {
      return new Promise((resolve, reject) => {
        let open = false;
        const ws = this.ws = new this.WS(url);
        ws.onopen = () => { open = true; resolve(); };
        ws.onerror = () => { if (!open) reject(new Error('Could not reach the game server')); };
        ws.onclose = () => { if (open) this.emit('close'); };
        ws.onmessage = e => {
          let m; try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'turn') this.q.push(m);
          else { if (m.t === 'desync') this.desync = true; this.emit(m.t, m); }
        };
      });
    }
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    close() { this.handlers = {}; if (this.ws) try { this.ws.close(); } catch (e) { /* already closed */ } }
    cmd(c) { this.send({ t: 'cmd', c }); }
    reset() { this.q = []; this.sub = 0; this.turn = 0; this.acc = 0; this.desync = false; }

    // Run as many sim ticks as real time and received turns allow. Calls onTick after each.
    advance(sim, dt, onTick) {
      const lag = this.q.length;
      this.acc += dt * (lag > 4 ? 2 : lag > 2 ? 1.3 : 1);   // catch up if we have fallen behind
      const step = 1 / R.TPS;
      let n = 0;
      while (this.acc >= step && n < 12 && sim.winner < 0) {
        if (this.sub === 0) {
          if (!this.q.length) { this.acc = 0; break; }   // waiting for the server
          const t = this.q.shift();
          for (const c of t.c) sim.command(c);
          this.turn = t.n;
        }
        sim.step();
        this.sub = (this.sub + 1) % TICKS_PER_TURN;
        if (this.sub === 0 && this.turn % HASH_EVERY === 0) this.send({ t: 'hash', n: this.turn, h: sim.hash() });
        if (onTick) onTick();
        this.acc -= step; n++;
      }
      if (n === 12) this.acc = 0;
      return n;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
