// Sound: synthesized weapon/UI effects (Web Audio) and spoken lines (browser speech synthesis).
// No audio files. Everything is generated at runtime.
(function () {
  'use strict';
  const R = window.RTS;

  const Snd = R.Snd = {
    ctx: null, out: null, buf: null, level: 2, last: {}, lastVoice: 0, lastLine: '',   // level: 2 all, 1 effects only, 0 mute
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      try {
        const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.out = c.createGain(); this.out.gain.value = 0.55;
        const comp = c.createDynamicsCompressor(); this.out.connect(comp); comp.connect(c.destination);
        this.buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const d = this.buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { this.ctx = null; }
    },
    // oscillator sweep
    tone(f1, f2, dur, type, vol, delay) {
      const c = this.ctx, t = c.currentTime + (delay || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
    },
    // filtered noise burst with a filter sweep
    noise(dur, vol, ftype, f1, f2, delay, q) {
      const c = this.ctx, t = c.currentTime + (delay || 0), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.buf; s.loop = true;
      f.type = ftype; f.Q.value = q || 0.8; f.frequency.setValueAtTime(f1, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    },
    play(n) {
      const c = this.ctx;
      if (!c || !this.level || c.state !== 'running') return;
      const now = c.currentTime, gap = n === 'shot' ? 0.045 : 0.09;
      if (now - (this.last[n] || -1) < gap) return;
      this.last[n] = now;
      switch (n) {
        case 'shot': this.noise(0.07, 0.22, 'bandpass', 2400, 900, 0, 1.2); this.tone(260, 90, 0.05, 'square', 0.05); break;
        case 'cannon': this.noise(0.28, 0.5, 'lowpass', 1400, 140); this.tone(130, 38, 0.28, 'sine', 0.55); break;
        case 'rocket': this.noise(0.5, 0.2, 'bandpass', 500, 2600, 0, 1.5); this.tone(180, 420, 0.3, 'sawtooth', 0.03); break;
        case 'flame': this.noise(0.45, 0.16, 'bandpass', 900, 350, 0, 0.7); break;
        case 'arty': this.noise(0.55, 0.6, 'lowpass', 700, 70); this.tone(85, 28, 0.55, 'sine', 0.7); this.noise(0.12, 0.2, 'highpass', 3000, 1500); break;
        case 'boom': this.noise(0.6, 0.5, 'lowpass', 1600, 60); this.tone(100, 30, 0.5, 'sine', 0.5); break;
        case 'bigboom': this.noise(1.2, 0.7, 'lowpass', 2200, 45); this.tone(75, 24, 1.0, 'sine', 0.8); this.noise(0.5, 0.25, 'bandpass', 900, 200, 0.12); break;
        case 'die': this.noise(0.18, 0.2, 'bandpass', 900, 300); break;
        case 'click': this.tone(700, 520, 0.04, 'sine', 0.12); break;
        case 'place': this.tone(160, 70, 0.12, 'triangle', 0.3); this.noise(0.1, 0.15, 'lowpass', 800, 200, 0.05); break;
        case 'done': this.tone(523, 523, 0.12, 'triangle', 0.14); this.tone(659, 659, 0.12, 'triangle', 0.14, 0.1); this.tone(784, 784, 0.2, 'triangle', 0.14, 0.2); break;
        case 'unit': this.tone(660, 660, 0.07, 'triangle', 0.12); this.tone(880, 880, 0.1, 'triangle', 0.12, 0.07); break;
        case 'alert': for (let k = 0; k < 3; k++) { this.tone(640, 640, 0.14, 'square', 0.07, k * 0.3); this.tone(470, 470, 0.14, 'square', 0.07, k * 0.3 + 0.15); } break;
        case 'err': this.tone(170, 140, 0.14, 'square', 0.08); break;
      }
    },
    // Spoken line. kind 'ack' = unit chatter (dropped if someone is already talking), 'eva' = announcer (takes priority).
    say(text, kind, pitch, rate) {
      const ss = window.speechSynthesis;
      if (this.level < 2 || !ss || !text) return;
      const now = performance.now();
      if (kind === 'ack') { if (ss.speaking || now - this.lastVoice < 1400) return; }
      else { if (text === this.lastLine && now - this.lastVoice < 4000) return; ss.cancel(); }
      this.lastVoice = now; this.lastLine = text;
      const u = new SpeechSynthesisUtterance(text);
      if (!this.voice) this.voice = ss.getVoices().find(v => /^en[-_]US/i.test(v.lang) && v.localService) || ss.getVoices().find(v => /^en/i.test(v.lang)) || null;
      if (this.voice) u.voice = this.voice;
      u.pitch = pitch || 1; u.rate = rate || 1.1; u.volume = kind === 'ack' ? 0.7 : 0.9;
      ss.speak(u);
    },
    // a random line from a list, spoken in a faction's voice
    ack(faction, group) {
      const v = (R.FACTIONS[faction] || {}).voice;
      if (!v || !v[group]) return;
      const lines = v[group];
      this.say(lines[(Math.random() * lines.length) | 0], 'ack', v.pitch, v.rate);
    },
    cycle() {
      this.level = (this.level + 2) % 3;
      if (this.level < 2 && window.speechSynthesis) window.speechSynthesis.cancel();
      return ['Sound off', 'Sound effects only (voices off)', 'Sound and voices on'][this.level];
    }
  };
})();
