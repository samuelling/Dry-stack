// All sound is synthesised: wind, grass, birds, crickets, city hum, the sea —
// and the clack and knock of stone on stone (modal synthesis).

const rnd = (a, b) => a + (b - a) * Math.random();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class SoundScape {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voices = 0;
    this.lastImpact = 0;
    this.impactBudget = 0;
  }

  async start(profile, region) {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.profile = profile;
    this.region = region;
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(0.9, c.currentTime, 1.5);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master.connect(comp).connect(c.destination);
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.makeIR(profile === 'underwater' ? 2.6 : profile === 'city' ? 1.6 : 0.9, profile === 'underwater' ? 0.5 : 1);
    this.revSend = c.createGain();
    this.revSend.gain.value = profile === 'underwater' ? 0.7 : profile === 'city' ? 0.35 : 0.18;
    this.revSend.connect(this.reverb).connect(this.master);
    // impact bus (muffled underwater)
    this.fxBus = c.createGain();
    if (profile === 'underwater') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
      this.fxBus.connect(lp); lp.connect(this.master); lp.connect(this.revSend);
    } else {
      this.fxBus.connect(this.master); this.fxBus.connect(this.revSend);
    }
    this.noise = this.makeNoise('white');
    this.brown = this.makeNoise('brown');
    this.pink = this.makeNoise('pink');
    this.ambience = c.createGain();
    this.ambience.gain.value = 1;
    this.ambience.connect(this.master);
    this.ambience.connect(this.revSend);
    if (profile === 'field') this.startField();
    else if (profile === 'city') this.startCity();
    else this.startUnderwater();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.3);
  }

  makeNoise(kind) {
    const c = this.ctx, len = c.sampleRate * 6;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
    return buf;
  }

  makeIR(seconds, bright) {
    const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const w = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
        lp = lp + (w - lp) * (bright > 0.8 ? 0.6 : 0.15);
        d[i] = lp;
      }
      // a few early reflections
      for (let k = 0; k < 6; k++) { const i = Math.floor(c.sampleRate * rnd(0.01, 0.09)); d[i] += rnd(-0.5, 0.5); }
    }
    return buf;
  }

  loopNoise(buf, filterType, freq, q, gain, dest = this.ambience) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    src.loopStart = Math.random() * 2;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(dest);
    src.start(0, Math.random() * 5);
    return { src, f, g };
  }

  panner(pan) {
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    return p;
  }

  // ------------------------------------------------------------ field
  startField() {
    const wind = this.loopNoise(this.brown, 'lowpass', 420, 0.5, 0.22);
    const hiss = this.loopNoise(this.pink, 'bandpass', 4200, 0.5, 0.025);
    const leaves = this.loopNoise(this.pink, 'bandpass', 1800, 0.8, 0.012);
    const gust = () => {
      const t = this.ctx.currentTime;
      const g = rnd(0.25, 1.0);
      wind.g.gain.setTargetAtTime(0.1 + 0.32 * g, t, rnd(1.0, 2.5));
      wind.f.frequency.setTargetAtTime(280 + 420 * g, t, 1.5);
      hiss.g.gain.setTargetAtTime(0.008 + 0.05 * g * g, t, 1.2);
      leaves.g.gain.setTargetAtTime(0.004 + 0.03 * g * g, t, 1.0);
      this.gustT = setTimeout(gust, rnd(2500, 7000));
    };
    gust();
    const uk = ['cotswold', 'welsh', 'yorkshire', 'aran'].includes(this.region);
    const birds = uk
      ? (this.region === 'aran' ? [this.skylark, this.gull, this.wren, this.robin] :
        this.region === 'cotswold' ? [this.robin, this.wren, this.rook, this.robin, this.woodpigeon] :
          [this.curlew, this.robin, this.wren, this.rook, this.skylark])
      : [this.chickadee, this.whiteThroat, this.chickadee, this.blueJay, this.crow, this.songTrill, this.whiteThroat];
    const sched = () => {
      if (this.enabled) pick(birds).call(this, rnd(-0.9, 0.9), rnd(0.25, 1));
      this.birdT = setTimeout(sched, rnd(2200, 9000));
    };
    this.birdT = setTimeout(sched, 1500);
    if (!uk) this.crickets();
  }

  whistle(t, f0, f1, dur, gain, dest, vib = 0, type = 'sine') {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vib) {
      const l = c.createOscillator(); l.frequency.value = rnd(18, 28);
      const lg = c.createGain(); lg.gain.value = vib;
      l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.3));
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  birdOut(pan, dist) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.11 * dist;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000 + 6000 * dist;
    g.connect(lp).connect(this.panner(pan)).connect(this.ambience);
    return g;
  }

  chickadee(pan, d) { // "fee-bee"
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    const n = Math.random() < 0.5 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 1.6;
      this.whistle(tt, 3950, 3900, 0.32, 0.5, o);
      this.whistle(tt + 0.4, 3420, 3380, 0.38, 0.45, o, 12);
    }
  }
  whiteThroat(pan, d) { // "Old Sam Peabody, Peabody, Peabody"
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    const base = rnd(3000, 3400);
    this.whistle(t, base, base, 0.75, 0.45, o, 6);
    this.whistle(t + 0.85, base * 1.26, base * 1.26, 0.55, 0.45, o, 6);
    for (let i = 0; i < 3; i++) {
      this.whistle(t + 1.5 + i * 0.36, base * 1.4, base * 1.38, 0.13, 0.4, o);
      this.whistle(t + 1.66 + i * 0.36, base * 1.26, base * 1.25, 0.15, 0.4, o);
    }
  }
  blueJay(pan, d) {
    const o = this.birdOut(pan, d * 0.6), t = this.ctx.currentTime + 0.05;
    for (let i = 0; i < 2; i++) {
      this.whistle(t + i * 0.42, 2300, 1500, 0.3, 0.18, o, 90, 'sawtooth');
      this.whistle(t + i * 0.42, 3300, 2400, 0.3, 0.08, o, 120, 'square');
    }
  }
  crow(pan, d) {
    const o = this.birdOut(pan, d * 0.4), t = this.ctx.currentTime + 0.05;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 2.5;
    bp.connect(o);
    const n = Math.floor(rnd(2, 5));
    for (let i = 0; i < n; i++) this.whistle(t + i * 0.55, 640, 520, 0.36, 0.7, bp, 30, 'sawtooth');
  }
  songTrill(pan, d) {
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) this.whistle(t + i * 0.2, 4200, 3600, 0.1, 0.35, o);
    for (let i = 0; i < 14; i++) this.whistle(t + 0.7 + i * 0.045, 5200, 3000, 0.035, 0.25, o);
    this.whistle(t + 1.4, 3000, 2600, 0.25, 0.3, o, 40);
  }
  robin(pan, d) { // European robin: silvery wistful warble
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    let tt = t;
    const n = Math.floor(rnd(6, 12));
    for (let i = 0; i < n; i++) {
      const f = rnd(2600, 6500), dur = rnd(0.05, 0.18);
      this.whistle(tt, f, f * rnd(0.75, 1.3), dur, 0.3, o, Math.random() < 0.3 ? 60 : 0);
      tt += dur + rnd(0.02, 0.09);
    }
  }
  wren(pan, d) {
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    let tt = t;
    for (let ph = 0; ph < 4; ph++) {
      const f = rnd(4000, 6500), n = Math.floor(rnd(5, 12));
      for (let i = 0; i < n; i++) { this.whistle(tt, f, f * 0.8, 0.03, 0.28, o); tt += 0.045; }
      tt += 0.05;
    }
  }
  rook(pan, d) { this.crow(pan, d * 0.8); }
  woodpigeon(pan, d) {
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    const pat = [0.5, 0.9, 0.35, 0.35, 0.7];
    let tt = t;
    for (const p of pat) { this.whistle(tt, 480, 420, p * 0.6, 0.4, o, 4); tt += p * 0.75; }
  }
  curlew(pan, d) {
    const o = this.birdOut(pan, d * 0.6), t = this.ctx.currentTime + 0.05;
    for (let i = 0; i < 3; i++) this.whistle(t + i * 0.7, 1700, 2500, 0.5, 0.35, o, 10);
    this.whistle(t + 2.2, 2300, 2900, 1.6, 0.35, o, 140);
  }
  skylark(pan, d) {
    const o = this.birdOut(pan, d * 0.5), t = this.ctx.currentTime + 0.05;
    let tt = t;
    const end = t + rnd(4, 8);
    while (tt < end) { const f = rnd(3000, 6000), dur = rnd(0.03, 0.1); this.whistle(tt, f, f * rnd(0.8, 1.25), dur, 0.18, o, Math.random() < 0.5 ? 80 : 0); tt += dur + 0.012; }
  }
  gull(pan, d) {
    const o = this.birdOut(pan, d * 0.4), t = this.ctx.currentTime + 0.05;
    this.whistle(t, 1100, 1700, 0.45, 0.3, o, 0, 'triangle');
    for (let i = 0; i < 5; i++) this.whistle(t + 0.6 + i * 0.22, 1500, 1100, 0.14, 0.25, o, 0, 'triangle');
  }

  crickets() {
    const c = this.ctx;
    const out = c.createGain(); out.gain.value = 0.012;
    out.connect(this.ambience);
    const chirpers = [0, 1, 2].map((i) => {
      const o = c.createOscillator(); o.frequency.value = 4400 + i * 230;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(g).connect(this.panner(rnd(-0.8, 0.8))).connect(out);
      o.start();
      return { g, rate: rnd(0.45, 0.7) };
    });
    let next = c.currentTime + 0.2;
    const tick = () => {
      const now = c.currentTime;
      while (next < now + 1.2) {
        for (const ch of chirpers) {
          if (Math.random() < 0.15) continue;
          const t0 = next + Math.random() * 0.25;
          for (let p = 0; p < 3; p++) {
            const tp = t0 + p * 0.03;
            ch.g.gain.setValueAtTime(0, tp);
            ch.g.gain.linearRampToValueAtTime(1, tp + 0.006);
            ch.g.gain.linearRampToValueAtTime(0, tp + 0.022);
          }
        }
        next += 0.6;
      }
      this.cricketT = setTimeout(tick, 500);
    };
    tick();
  }

  // ------------------------------------------------------------ city
  startCity() {
    const rumble = this.loopNoise(this.brown, 'lowpass', 170, 0.7, 0.32);
    this.loopNoise(this.pink, 'bandpass', 700, 0.5, 0.03);
    this.loopNoise(this.pink, 'highpass', 5000, 0.5, 0.006);
    const swell = () => {
      rumble.g.gain.setTargetAtTime(rnd(0.22, 0.42), this.ctx.currentTime, 2);
      this.swellT = setTimeout(swell, rnd(3000, 8000));
    };
    swell();
    const car = () => {
      if (this.enabled) this.carPass();
      this.carT = setTimeout(car, rnd(5000, 16000));
    };
    this.carT = setTimeout(car, 3000);
    const birds = [this.sparrow, this.sparrow, this.pigeon, this.robinAm];
    const sched = () => {
      if (this.enabled) pick(birds).call(this, rnd(-0.9, 0.9), rnd(0.3, 1));
      this.birdT = setTimeout(sched, rnd(2500, 9000));
    };
    this.birdT = setTimeout(sched, 2000);
  }
  carPass() {
    const c = this.ctx, t = c.currentTime;
    const dur = rnd(3.5, 6);
    const src = c.createBufferSource(); src.buffer = this.pink; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.6;
    f.frequency.setValueAtTime(350, t); f.frequency.linearRampToValueAtTime(900, t + dur * 0.5); f.frequency.linearRampToValueAtTime(300, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + dur * 0.5); g.gain.linearRampToValueAtTime(0, t + dur);
    const p = c.createStereoPanner(); const dir = Math.random() < 0.5 ? -1 : 1;
    p.pan.setValueAtTime(-0.9 * dir, t); p.pan.linearRampToValueAtTime(0.9 * dir, t + dur);
    const tire = c.createBiquadFilter(); tire.type = 'lowpass'; tire.frequency.value = 200;
    const g2 = c.createGain(); g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.3, t + dur * 0.5); g2.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(f).connect(g).connect(p).connect(this.ambience);
    src.connect(tire).connect(g2).connect(p);
    src.start(t, Math.random() * 3); src.stop(t + dur + 0.1);
  }
  sparrow(pan, d) {
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    const n = Math.floor(rnd(2, 7));
    for (let i = 0; i < n; i++) { const tt = t + i * rnd(0.18, 0.3); this.whistle(tt, 4400, 3200, 0.05, 0.3, o); this.whistle(tt + 0.05, 3200, 3900, 0.05, 0.25, o); }
  }
  pigeon(pan, d) {
    const o = this.birdOut(pan, d), t = this.ctx.currentTime + 0.05;
    this.whistle(t, 330, 380, 0.25, 0.5, o, 9);
    this.whistle(t + 0.3, 400, 320, 0.55, 0.6, o, 12);
    this.whistle(t + 0.95, 340, 300, 0.3, 0.4, o, 9);
  }
  robinAm(pan, d) { // American robin "cheerily cheer-up"
    const o = this.birdOut(pan, d * 0.8), t = this.ctx.currentTime + 0.05;
    for (let i = 0; i < 5; i++) { const f = rnd(2300, 3100); this.whistle(t + i * 0.42, f, f * rnd(0.8, 1.2), 0.24, 0.3, o, 25); }
  }

  // ------------------------------------------------------------ underwater
  startUnderwater() {
    const deep = this.loopNoise(this.brown, 'lowpass', 140, 0.6, 0.5);
    const surge = this.loopNoise(this.pink, 'lowpass', 500, 0.4, 0.05);
    const breath = () => {
      const t = this.ctx.currentTime;
      surge.g.gain.setTargetAtTime(rnd(0.02, 0.12), t, 1.8);
      deep.g.gain.setTargetAtTime(rnd(0.35, 0.6), t, 2.5);
      this.swellT = setTimeout(breath, rnd(3500, 6500));
    };
    breath();
    // snapping shrimp crackle
    const c = this.ctx;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const sg = c.createGain(); sg.gain.value = 0.11;
    hp.connect(sg).connect(this.ambience);
    const click = c.createBuffer(1, 64, c.sampleRate);
    const cd = click.getChannelData(0);
    for (let i = 0; i < 64; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / 8);
    let next = c.currentTime + 0.1;
    const tick = () => {
      const now = c.currentTime;
      while (next < now + 0.6) {
        const s = c.createBufferSource(); s.buffer = click;
        const g = c.createGain(); g.gain.value = Math.pow(Math.random(), 3);
        s.connect(g).connect(this.panner(rnd(-1, 1))).connect(hp);
        s.start(next);
        next += rnd(0.005, 0.08);
      }
      this.shrimpT = setTimeout(tick, 300);
    };
    tick();
    const bubbles = () => {
      if (this.enabled) {
        const t = c.currentTime;
        const o = this.birdOut(rnd(-0.7, 0.7), rnd(0.2, 0.7));
        const n = Math.floor(rnd(3, 14));
        for (let i = 0; i < n; i++) { const f = rnd(300, 900); this.whistle(t + i * rnd(0.05, 0.16), f, f * 2.2, 0.04, 0.6, o); }
      }
      this.bubT = setTimeout(bubbles, rnd(3000, 11000));
    };
    this.bubT = setTimeout(bubbles, 2500);
  }

  // ------------------------------------------------------------ stone
  // strength: 0..1, size: characteristic metres, ring: stone resonance factor,
  // ground: hit soil/sand rather than stone, pan: -1..1, dist attenuation 0..1
  impact(strength, size, ring = 1, ground = false, pan = 0, att = 1) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    if (this.voices > 26) return;
    const amp = Math.min(1, strength) * att;
    if (amp < 0.015) return;
    this.voices++;
    const out = c.createGain(); out.gain.value = amp * (ground ? 0.55 : 0.75);
    const p = this.panner(pan);
    out.connect(p).connect(this.fxBus);
    const f0 = Math.min(6000, Math.max(220, 300 / Math.max(0.04, size))) * rnd(0.92, 1.08);
    const ratios = [1, 1.47 + Math.random() * 0.2, 2.21 + Math.random() * 0.3, 3.05 + Math.random() * 0.3, 4.2 + Math.random() * 0.4];
    const decayBase = (ground ? 0.018 : 0.06) * ring * (0.7 + 0.6 * Math.min(1, size * 3));
    let end = t;
    ratios.forEach((r, i) => {
      if (ground && i > 2) return;
      const fq = f0 * r * (ground ? 0.55 : 1);
      if (fq > 16000) return;
      const o = c.createOscillator();
      o.frequency.value = fq;
      const g = c.createGain();
      const dec = decayBase / (1 + i * 0.6);
      const a = (0.5 / (1 + i * 0.9)) * (ground ? 0.5 : 1);
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec * 6);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dec * 6 + 0.02);
      end = Math.max(end, t + dec * 6);
    });
    // contact transient
    const s = c.createBufferSource(); s.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = ground ? 'lowpass' : 'bandpass';
    bp.frequency.value = ground ? 380 + 600 * Math.min(1, size) : f0 * 2.2; bp.Q.value = ground ? 0.7 : 1.2;
    const ng = c.createGain();
    const nd = ground ? 0.06 : 0.012;
    ng.gain.setValueAtTime(ground ? 1.4 : 0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + nd * 4);
    s.connect(bp).connect(ng).connect(out);
    s.start(t, Math.random() * 4); s.stop(t + nd * 4 + 0.02);
    // body thump for big stones
    if (size > 0.3 && amp > 0.15) {
      const o = c.createOscillator(); o.frequency.setValueAtTime(110 / size, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      const g = c.createGain(); g.gain.setValueAtTime(0.9 * amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.25);
    }
    setTimeout(() => { this.voices--; }, (end - t) * 1000 + 120);
  }

  // walling hammer on stone: a bright steel ping over a dry crack
  hammer(strength = 0.7, ring = 1, broke = true) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const out = c.createGain(); out.gain.value = 0.55 * strength;
    out.connect(this.fxBus);
    for (const [f, a, d] of [[2650, 0.35, 0.22], [4120, 0.22, 0.15], [6900, 0.1, 0.08], [1320, 0.18, 0.12]]) {
      const o = c.createOscillator(); o.frequency.value = f * rnd(0.97, 1.03);
      const g = c.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d * ring);
      o.connect(g).connect(out); o.start(t); o.stop(t + d * ring + 0.02);
    }
    const s = c.createBufferSource(); s.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = broke ? 1800 : 3200; bp.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.setValueAtTime(broke ? 1.6 : 0.6, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + (broke ? 0.09 : 0.03));
    s.connect(bp).connect(ng).connect(out); s.start(t, Math.random() * 4); s.stop(t + 0.12);
    const o = c.createOscillator(); o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const g = c.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.12);
  }

  // a stone rocking on two points: a hollow knock
  tock(amount = 0.5, size = 0.25) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const f = Math.min(1600, 260 / Math.max(0.05, size));
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.05);
    const g = c.createGain(); g.gain.setValueAtTime(0.5 * amount, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.fxBus); o.start(t); o.stop(t + 0.09);
  }

  scrape(amount = 0.3) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.pink;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = rnd(900, 1800); f.Q.value = 0.9;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25 * amount, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    s.connect(f).connect(g).connect(this.fxBus);
    s.start(t, Math.random() * 4); s.stop(t + 0.3);
  }

  stop() {
    for (const k of ['gustT', 'birdT', 'cricketT', 'swellT', 'carT', 'shrimpT', 'bubT']) clearTimeout(this[k]);
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}
