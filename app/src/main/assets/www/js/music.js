/* Open Card — original 8-bit background music, synthesised live with Web Audio.
   Pulse-wave lead + arpeggio, triangle bass and noise drums, like classic game consoles. */
(function () {
  'use strict';
  const OC = window.OpenCard;

  const BPM = 104;
  const STEP = 60 / BPM / 4; // one 16th note in seconds

  /* ----- score (16 bars, 8th-note durations for the melody) ----- */
  const CHORDS = ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G', 'F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'G7'];
  const CHORD_NOTES = {
    C: ['C3', 'E3', 'G3'], Am: ['A2', 'C3', 'E3'], F: ['F2', 'A2', 'C3'], G: ['G2', 'B2', 'D3'],
    Dm: ['D3', 'F3', 'A3'], Em: ['E3', 'G3', 'B3'], G7: ['G2', 'B2', 'D3', 'F3'],
  };
  const MELODY = [
    'E5 1 G5 1 C6 2 B5 1 G5 1 A5 2',
    'G5 2 E5 2 - 1 E5 1 D5 1 C5 1',
    'A4 1 C5 1 F5 2 E5 1 F5 1 A5 2',
    'G5 4 - 2 D5 1 F5 1',
    'E5 1 G5 1 C6 2 D6 1 C6 1 B5 2',
    'A5 2 C6 2 E6 2 D6 1 C6 1',
    'D6 2 A5 2 F5 2 E5 1 D5 1',
    'B4 2 D5 2 G5 3 - 1',
    'A5 1 A5 1 G5 1 A5 1 C6 2 A5 2',
    'B5 1 B5 1 A5 1 B5 1 D6 2 B5 2',
    'G5 2 E5 1 G5 1 B5 2 G5 2',
    'A5 3 G5 1 E5 2 C5 2',
    'F5 1 A5 1 C6 1 F6 1 E6 2 C6 2',
    'D6 1 B5 1 G5 1 B5 1 D6 2 F6 2',
    'E6 3 D6 1 C6 2 G5 2',
    'B5 2 D6 2 G5 2 - 2',
  ];

  const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (n) => {
    const m = /^([A-G])(#|b)?(\d)$/.exec(n);
    return 12 * (+m[3] + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  };
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /** Build the event list for one loop: {step, len, inst, m, vel} */
  function buildScore() {
    const ev = [];
    MELODY.forEach((bar, b) => {
      const t = bar.split(' ');
      let s = b * 16;
      for (let i = 0; i < t.length; i += 2) {
        const len = +t[i + 1] * 2;
        if (t[i] !== '-') ev.push({ step: s, len: len - 0.3, inst: 'lead', m: midi(t[i]), vel: 1 });
        s += len;
      }
    });
    CHORDS.forEach((ch, b) => {
      const notes = CHORD_NOTES[ch].map(midi);
      const root = notes[0];
      for (let k = 0; k < 16; k++) {
        const s = b * 16 + k;
        // arpeggio: 16ths through the chord, an octave up
        ev.push({ step: s, len: 0.8, inst: 'arp', m: notes[k % notes.length] + 24, vel: k % 4 === 0 ? 1 : 0.7 });
        // bass: walking root / octave / fifth on 8ths
        if (k % 2 === 0) {
          const pat = [0, 12, 7, 12, 0, 12, 7, 10];
          ev.push({ step: s, len: 1.7, inst: 'bass', m: root - 12 + pat[k / 2] + 12, vel: 1 });
        }
        // drums
        if (k === 0 || k === 8) ev.push({ step: s, inst: 'kick' });
        if (k === 4 || k === 12) ev.push({ step: s, inst: 'snare' });
        if (k % 2 === 0) ev.push({ step: s, inst: 'hat', vel: k % 4 === 2 ? 1 : 0.6 });
      }
    });
    const byStep = {};
    for (const e of ev) (byStep[e.step] = byStep[e.step] || []).push(e);
    return { byStep, length: CHORDS.length * 16 };
  }

  const music = {
    ctx: null,
    playing: false,
    timer: null,
    score: buildScore(),
    loop: 0,
    step: 0,
    nextTime: 0,

    init() {
      if (this.ctx) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);
      // gentle low-pass so the square waves aren't harsh
      this.tone = ctx.createBiquadFilter();
      this.tone.type = 'lowpass';
      this.tone.frequency.value = 5200;
      this.tone.connect(this.master);
      this.pulse25 = this.pulseWave(0.25);
      this.pulse125 = this.pulseWave(0.125);
      const len = ctx.sampleRate * 0.5;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    },
    pulseWave(duty) {
      const n = 48;
      const real = new Float32Array(n), imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      return this.ctx.createPeriodicWave(real, imag);
    },
    volume() {
      return { low: 0.15, medium: 0.3, high: 0.48 }[OC.settings.volume] || 0.3;
    },

    /* ----- instruments ----- */
    voice(t, dur, f, wave, gain, attack = 0.005, release = 0.04) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      if (typeof wave === 'string') o.type = wave; else o.setPeriodicWave(wave);
      o.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.setValueAtTime(gain * 0.75, t + Math.max(attack, dur * 0.4));
      g.gain.linearRampToValueAtTime(0, t + dur + release);
      o.connect(g).connect(this.tone);
      o.start(t);
      o.stop(t + dur + release + 0.02);
      return o;
    },
    noiseHit(t, dur, gain, type, f, q = 1) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = f;
      filt.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filt).connect(g).connect(this.tone);
      src.start(t, Math.random() * 0.3);
      src.stop(t + dur + 0.02);
    },
    play(e, t) {
      const alt = this.loop % 2 === 1; // every other loop: thinner lead, softer drums
      const sparse = alt && e.step < 8 * 16;
      switch (e.inst) {
        case 'lead': {
          const o = this.voice(t, e.len * STEP, freq(e.m), alt ? this.pulse125 : this.pulse25, 0.22, 0.008, 0.06);
          // light vibrato on long notes
          if (e.len > 4) {
            const lfo = this.ctx.createOscillator();
            const lg = this.ctx.createGain();
            lfo.frequency.value = 5.5;
            lg.gain.value = freq(e.m) * 0.006;
            lfo.connect(lg).connect(o.frequency);
            lfo.start(t + 0.15);
            lfo.stop(t + e.len * STEP + 0.1);
          }
          break;
        }
        case 'arp':
          this.voice(t, e.len * STEP, freq(e.m), this.pulse125, 0.045 * e.vel, 0.002, 0.02);
          break;
        case 'bass':
          this.voice(t, e.len * STEP, freq(e.m), 'triangle', 0.32, 0.004, 0.03);
          break;
        case 'kick': {
          if (sparse) break;
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          o.frequency.setValueAtTime(140, t);
          o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
          g.gain.setValueAtTime(0.5, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
          o.connect(g).connect(this.tone);
          o.start(t);
          o.stop(t + 0.16);
          break;
        }
        case 'snare':
          if (!sparse) this.noiseHit(t, 0.12, 0.16, 'bandpass', 1800, 0.7);
          break;
        case 'hat':
          this.noiseHit(t, 0.035, (sparse ? 0.05 : 0.07) * e.vel, 'highpass', 7000);
          break;
      }
    },
    tick() {
      const ctx = this.ctx;
      while (this.nextTime < ctx.currentTime + 0.15) {
        const evs = this.score.byStep[this.step];
        if (evs) for (const e of evs) this.play(e, this.nextTime);
        this.nextTime += STEP;
        this.step++;
        if (this.step >= this.score.length) {
          this.step = 0;
          this.loop++;
        }
      }
    },

    /* ----- public controls ----- */
    start() {
      if (!this.init()) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.playing) return;
      this.playing = true;
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(this.volume(), t + 0.6);
      this.nextTime = t + 0.08;
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 30);
      this.tick();
    },
    stop() {
      if (!this.ctx || !this.playing) return;
      this.playing = false;
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 0.25);
      setTimeout(() => { if (!this.playing) clearInterval(this.timer); }, 300);
    },
    setVolume() {
      if (this.ctx && this.playing) this.master.gain.setTargetAtTime(this.volume(), this.ctx.currentTime, 0.1);
    },
    /** Apply the saved on/off setting (called after a user gesture or setting change). */
    sync() {
      if (OC.settings.music && !this.hidden) this.start();
      else this.stop();
      document.querySelectorAll('.music-btn').forEach((b) => {
        b.classList.toggle('off', !OC.settings.music);
        b.title = OC.settings.music ? 'Music on (tap to mute)' : 'Music off (tap to play)';
      });
    },
    toggle() {
      OC.settings.music = !OC.settings.music;
      OC.saveSettings();
      this.sync();
      OC.ui.toast(OC.settings.music ? 'Music on' : 'Music off', 1100);
    },
    /** Pause while the app is in the background. */
    appPaused(paused) {
      this.hidden = paused;
      if (!this.ctx) return;
      if (paused) {
        this.stop();
        this.ctx.suspend();
      } else if (OC.settings.music) {
        this.ctx.resume();
        this.start();
      }
    },
  };
  OC.music = music;

  // Browsers only allow audio after the first touch, so start on the first interaction.
  const firstGesture = () => {
    window.removeEventListener('pointerdown', firstGesture, true);
    music.sync();
  };
  window.addEventListener('pointerdown', firstGesture, true);
  document.addEventListener('visibilitychange', () => music.appPaused(document.hidden));
})();
