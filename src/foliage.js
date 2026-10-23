// Leaf senescence for the trees: a port of the "Turning Grove" model.
//
//  * Onset: Delpierre et al. (2009) photoperiod-gated cold-degree-day clock, with the
//    Zohner et al. (2023) spring-warmth shift.
//  * Each leaf carries its own chlorophyll, carotenoid, anthocyanin and tannin pools,
//    sugar, nitrogen and abscission state; sun leaves go red, shade leaves go yellow,
//    frost browns, ginkgo-style synchronous drop is left out (no ginkgo here).
//  * Colour is rendered from pigment absorbance (see the shaders in trees.js / leaves.js).
//
// Two consumers:
//  * forest trees   -> a small colour/remain look-up texture (species x exposure bin x day of year)
//  * study saplings -> a per-leaf pigment texture (leaf x day) plus fall / leaf-out days
//
// Parameters are illustrative (tuned to plausible New England timing), not fitted to data.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const LAT = 42.36;
export const DAY0 = 152;            // Jun 1: weather + soil-water spin-up
export const VIEW0 = 182;           // Jul 1: first stored day
export const DAY1 = 349;            // Dec 15
export const NDAYS = DAY1 - VIEW0 + 1;
export const YEAR = 365;
export const BINS = 8;              // canopy exposure classes used for forest trees

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function gauss(r) { let u = 0; while (u === 0) u = r(); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ---- astronomy ----
export function photoperiod(doy, lat = LAT) {
  const th = 0.2163108 + 2 * Math.atan(0.9671396 * Math.tan(0.00860 * (doy - 186)));
  const ph = Math.asin(0.39795 * Math.cos(th));
  const L = lat * Math.PI / 180, p = 0.8333 * Math.PI / 180;
  const v = (Math.sin(p) + Math.sin(L) * Math.sin(ph)) / (Math.cos(L) * Math.cos(ph));
  return 24 - (24 / Math.PI) * Math.acos(clamp(v, -1, 1));
}
export function declination(doy) { const th = 0.2163108 + 2 * Math.atan(0.9671396 * Math.tan(0.00860 * (doy - 186))); return Math.asin(0.39795 * Math.cos(th)); }
/** Sun's noon elevation in degrees. */
export function noonElevation(doy, lat = LAT) { return 90 - lat + declination(doy) * 180 / Math.PI; }
function clearSky(doy) {
  const noon = Math.PI / 2 - LAT * Math.PI / 180 + declination(doy);
  return (photoperiod(doy) / 15.3) * Math.sin(noon) / Math.sin(Math.PI / 2 - LAT * Math.PI / 180 + 0.4091);
}

// ---- weather ----
const DEFAULTS = { seed: 7, tOffset: 0, preWarm: 0, swing: 1, sun: 0.55, rain: 1, frost: false, frostDay: 279 };

export function makeWeather(s) {
  const r = mulberry32(s.seed * 7919 + 13);
  const n = DAY1 - DAY0 + 1;
  const W = { tmin: new Float32Array(n), tmax: new Float32Array(n), tmean: new Float32Array(n), cloud: new Float32Array(n),
    rad: new Float32Array(n), rain: new Float32Array(n), soil: new Float32Array(n), P: new Float32Array(n) };
  let a = 0, cap = 140, soil = 0.72 * cap, cPrev = 0.45;
  const cloudMean = 0.78 - 0.56 * s.sun;
  for (let i = 0; i < n; i++) {
    const d = DAY0 + i, cs = Math.cos(2 * Math.PI * (d - 201) / 365);
    a = 0.7 * a + 0.714 * 2.4 * gauss(r);
    let c = clamp(0.45 * cPrev + 0.55 * cloudMean + 0.3 * gauss(r), 0, 1); cPrev = c;
    const swingDay = 8.5 * s.swing * (0.5 + 1.0 * (1 - c));
    let tmean = 11 + 12.75 * cs + s.tOffset + a + 0.8 * (c - 0.45);
    let tmax = tmean + swingDay / 2, tmin = tmean - swingDay / 2;
    const pr = clamp((c - 0.3) * 1.1, 0, 0.8) * Math.pow(s.rain, 0.75);
    let rain = r() < pr ? -Math.log(1 - r() * 0.999) * 11.5 * Math.pow(s.rain, 0.35) : 0;
    const et = (0.55 + 0.21 * Math.max(0, tmean)) * (0.5 + 0.5 * (1 - c)) * Math.sqrt(soil / cap);
    soil = clamp(soil + rain - et, 0, cap);
    W.tmin[i] = tmin; W.tmax[i] = tmax; W.tmean[i] = tmean; W.cloud[i] = c; W.rain[i] = rain; W.soil[i] = soil / cap;
    W.P[i] = photoperiod(d); W.rad[i] = clearSky(d) * (1 - 0.72 * c);
  }
  return W;
}

// ---- species ----
// Onset: once daylength < Pstart, cold-degree-days accumulate: dS = (Tb - Tmean) * (P / Pstart)
export const SPECIES = [
  { id: 'rubrum', common: 'Red maple', latin: 'Acer rubrum', shape: 'maple3', Pstart: 13.7, Tb: 20, Ycrit: 1, target: 278,
    kC: 0.065, X: 0.75, xVar: 0.15, Acap: 2.1, aVar: 0.25, kT: 0.010, kAb: 0.075, marc: 0, droughtSens: 1.2 },
  { id: 'saccharum', common: 'Sugar maple', latin: 'Acer saccharum', shape: 'maple5', Pstart: 13.5, Tb: 20, Ycrit: 1, target: 285,
    kC: 0.058, X: 1.0, xVar: 0.12, Acap: 0.85, aVar: 0.7, kT: 0.009, kAb: 0.07, marc: 0, droughtSens: 1.4 },
  { id: 'rubra', common: 'Northern red oak', latin: 'Quercus rubra', shape: 'oak', Pstart: 13.0, Tb: 18, Ycrit: 1, target: 304,
    kC: 0.042, X: 0.5, xVar: 0.2, Acap: 0.95, aVar: 0.55, kT: 0.04, kAb: 0.03, marc: 0.3, droughtSens: 0.7 },
  { id: 'liquidambar', common: 'Sweetgum', latin: 'Liquidambar styraciflua', shape: 'star', Pstart: 13.1, Tb: 19, Ycrit: 1, target: 300,
    kC: 0.048, X: 0.85, xVar: 0.45, Acap: 1.35, aVar: 0.9, kT: 0.012, kAb: 0.05, marc: 0, droughtSens: 1 },
  { id: 'papyrifera', common: 'Paper birch', latin: 'Betula papyrifera', shape: 'ovate', Pstart: 13.6, Tb: 20, Ycrit: 1, target: 285,
    kC: 0.07, X: 0.95, xVar: 0.1, Acap: 0.03, aVar: 0.3, kT: 0.018, kAb: 0.11, marc: 0, droughtSens: 1.8 },
];
export const SPECIES_INDEX = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));

function treeDrive(sp, W, s) {
  const n = W.P.length, S = new Float32Array(n);
  const Pst = sp.Pstart + 0.086 * s.preWarm;   // Zohner et al. 2023
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const P = W.P[i], T = W.tmean[i], d = DAY0 + i;
    if (d > 172 && P < Pst && T < sp.Tb) acc += (sp.Tb - T) * (P / Pst);
    if (W.soil[i] < 0.3) acc += sp.Ycrit * 0.012 * sp.droughtSens * (0.3 - W.soil[i]) / 0.3;
    S[i] = acc / sp.Ycrit;
  }
  return S;
}

// calibrate Ycrit so that a median leaf hits 50% chlorophyll on the target day of year in a default year
function halfDay(sp, W) {
  const drive = treeDrive(sp, W, DEFAULTS); let C = 1;
  for (let i = 0; i < drive.length; i++) {
    const sD = drive[i], on = smooth(0.9, 1.06, sD), light = W.rad[i] * 0.64, coldLight = light * clamp((8 - W.tmin[i]) / 10, 0, 1);
    C *= Math.exp(-sp.kC * on * (0.6 + 0.9 * clamp(sD - 1, 0, 1.5)) * (1 + 0.45 * coldLight));
    if (C < 0.5) return DAY0 + i;
  }
  return 9999;
}
let calibrated = false;
function calibrate() {
  if (calibrated) return; calibrated = true;
  const W = makeWeather(DEFAULTS);
  for (const sp of SPECIES) {
    let lo = 10, hi = 4000;
    for (let it = 0; it < 36; it++) { const mid = (lo + hi) / 2; sp.Ycrit = mid; if (halfDay(sp, W) < sp.target) lo = mid; else hi = mid; }
    sp.Ycrit = (lo + hi) / 2;
  }
}

// ---- pigments -> reflectance (linear) ----
export const ABS = { C: [2.4, 0.62, 2.6], X: [0.0, 0.3, 3.3], A: [0.12, 2.7, 1.05], T: [0.95, 1.35, 1.95] };
export const BASE = [0.86, 0.80, 0.6];
export const QSCALE = { C: 1, X: 1.25, A: 2.2, T: 1.6 };     // 8-bit storage scales (shared with the shader)
export function reflect(C, X, A, T, out) {
  out[0] = BASE[0] * Math.exp(-(ABS.C[0] * C + ABS.X[0] * X + ABS.A[0] * A + ABS.T[0] * T));
  out[1] = BASE[1] * Math.exp(-(ABS.C[1] * C + ABS.X[1] * X + ABS.A[1] * A + ABS.T[1] * T));
  out[2] = BASE[2] * Math.exp(-(ABS.C[2] * C + ABS.X[2] * X + ABS.A[2] * A + ABS.T[2] * T));
  return out;
}

/** A virtual leaf: exposure e (0 deep shade .. 1 full sun) and height fraction hgt in the crown. */
export function makeLeaf(rng, sp, e, hgt) {
  const j = gauss(rng);
  return {
    e,
    thr: clamp(1 + 0.16 * j - 0.22 * (e - 0.5), 0.6, 1.5),
    aMul: Math.exp(sp.aVar * gauss(rng) - sp.aVar * sp.aVar / 2),
    xMul: clamp(1 + sp.xVar * gauss(rng), 0.15, 1.4),
    abThr: 0.75 + rng() * 0.55,
    marc: sp.marc > 0 && rng() < sp.marc * (1.3 - 0.8 * hgt),
    dropJit: Math.floor(rng() * 3),
  };
}

/**
 * Run one leaf through the season. Returns Float32Arrays over [VIEW0..DAY1] plus onset/kill/fall days.
 * Per-leaf kinetics follow the Turning Grove engine.
 */
export function simulateLeaf(sp, l, W, drive) {
  const n = W.P.length;
  const C_ = new Float32Array(NDAYS), X_ = new Float32Array(NDAYS), A_ = new Float32Array(NDAYS), T_ = new Float32Array(NDAYS);
  let C = 1, X = sp.X * l.xMul, A = 0, T = 0, Sg = 0.6, Ab = 0, N = 0, fd = 0, fallen = -1, onset = -1, kill = -1;
  for (let i = 0; i < n; i++) {
    const d = DAY0 + i, tmin = W.tmin[i], tmax = W.tmax[i], w = W.soil[i];
    const light = W.rad[i] * (0.28 + 0.72 * l.e);
    if (fallen < 0) {
      const sDrive = drive[i] / l.thr;
      const on = smooth(0.9, 1.06, sDrive);
      if (onset < 0 && on > 0.5) onset = d;
      let dmg = 0;
      if (tmin < -1.5) { dmg = (-1.5 - tmin) * 0.2 * (0.55 + 0.45 * l.e) * (C > 0.05 ? 1 : 0.3); fd += dmg; }
      if (kill < 0 && fd > 0.7) kill = d;
      const killed = clamp(fd, 0, 1);
      const coldLight = light * clamp((8 - tmin) / 10, 0, 1);
      const rateC = sp.kC * on * (0.6 + 0.9 * clamp(sDrive - 1, 0, 1.5)) * (1 + 0.45 * coldLight) * (1 - killed * 0.9);
      const Cprev = C;
      C *= Math.exp(-rateC);
      N += 0.62 * (Cprev - C);                       // proteins dismantled -> nitrogen exported
      C *= Math.exp(-dmg * 1.6);                     // frost: chlorophyll destroyed in place
      const prod = C * light * clamp((tmax - 3) / 15, 0, 1) * 0.5;
      const expK = 0.62 * clamp((tmin + 1) / 12, 0.07, 1) * (1 - 0.85 * clamp(Ab, 0, 1));
      Sg = Sg + prod - expK * Sg;
      const cool = tmin <= -2 ? 0 : tmin < 1 ? (tmin + 2) / 3 : tmin <= 7 ? 1 : Math.max(0.12, 1 - (tmin - 7) / 9);
      const water = w < 0.12 ? 0.3 + w / 0.12 * 0.5 : w < 0.4 ? 1.18 : w > 0.85 ? 0.9 : 1;
      const metab = clamp(C * 1.8 + 0.25, 0, 1) * (1 - killed);
      A += sp.Acap * l.aMul * on * (Sg / (Sg + 0.55)) * Math.pow(light, 0.8) * cool * water * metab * 0.3;
      A *= (1 - 0.01) * (1 - 0.6 * Math.min(dmg, 1));
      X *= Math.exp(-(0.003 + 0.016 * on * clamp(1 - C * 2, 0, 1)) - dmg * 0.35);
      const drought = w < 0.15 ? (0.15 - w) / 0.15 * 0.02 * sp.droughtSens : 0;
      T += sp.kT * on * (1 - C) * (1 - C) * (0.7 + 0.6 * (1 - l.e)) + dmg * 0.55 * (0.35 + C) + drought * (0.3 + on);
      Ab += sp.kAb * on * Math.pow(1 - C, 1.5) * (1 + 0.8 * killed) + (W.rain[i] > 14 && Ab > 0.5 ? 0.06 : 0) + (drought * 0.5);
      if (Ab >= l.abThr && !(l.marc && Ab < 99)) fallen = d;
      if (l.marc && d > 330) Ab = Math.min(Ab, l.abThr * 0.98);
    } else {
      A *= 0.965; X *= 0.975; T += 0.028; C *= 0.9; Sg *= 0.8;
    }
    if (d >= VIEW0) {
      const k = d - VIEW0;
      C_[k] = C; X_[k] = X; A_[k] = A; T_[k] = T;
    }
  }
  return { C: C_, X: X_, A: A_, T: T_, fall: fallen < 0 ? 9999 : fallen, kill: kill < 0 ? 9999 : kill, onset: onset < 0 ? 9999 : onset };
}

// ---------------------------------------------------------------------------------------------
// The model the game talks to
// ---------------------------------------------------------------------------------------------
const toHalf = THREE.DataUtils.toHalfFloat;

// young spring leaves (linear reflectance): bright, yellow-green
const FRESH = [0.16, 0.46, 0.05];
export const SPRING_START = 108, SPRING_END = 150;   // leaf-out window (day of year)

export class FoliageModel {
  /**
   * @param {object} o
   * @param {number[]} o.species  indices into SPECIES used by forest trees
   * @param {number} [o.tOffset]  regional warmth offset (deg C)
   * @param {number} [o.rain]     regional rainfall multiplier
   * @param {number} [o.seed]
   */
  constructor({ species, tOffset = 0, rain = 1, seed = 7 } = {}) {
    calibrate();
    this.species = species || SPECIES.map((_, i) => i);
    this.tOffset = tOffset; this.rain = rain; this.baseSeed = seed;
    this.year = 0;
    this.rows = this.species.length * BINS;
    // forest LUT: width = day of year (1..366), height = species x bin, RGBA half float (rgb reflectance, a = fraction still on)
    this.lutW = 366;
    this.lutData = new Uint16Array(this.lutW * this.rows * 4);
    this.lutTex = new THREE.DataTexture(this.lutData, this.lutW, this.rows, THREE.RGBAFormat, THREE.HalfFloatType);
    this.lutTex.minFilter = this.lutTex.magFilter = THREE.LinearFilter;
    this.lutTex.wrapS = this.lutTex.wrapT = THREE.ClampToEdgeWrapping;
    this.lutTex.generateMipmaps = false;
    // study leaves
    this.hero = null;
    // one fixed set of virtual leaves per bin (re-simulated each year with that year's weather)
    const rng = mulberry32(2024);
    this.binLeaves = this.species.map((si) => {
      const sp = SPECIES[si];
      return Array.from({ length: BINS }, (_, b) => {
        const e = (b + 0.5) / BINS, arr = [];
        for (let k = 0; k < 10; k++) arr.push(makeLeaf(rng, sp, clamp(e + (rng() - 0.5) * 0.1, 0.03, 1), clamp(e + (rng() - 0.5) * 0.3, 0, 1)));
        return arr;
      });
    });
    this.simulateYear(0);
  }

  settings(year) {
    return { ...DEFAULTS, seed: this.baseSeed + year * 31, tOffset: this.tOffset, rain: this.rain };
  }

  /**
   * Register study leaves: [{ sp (index into SPECIES), e, hgt }]. Returns textures/attributes arrays that
   * are refilled on each simulateYear().
   */
  setHero(leaves) {
    const n = leaves.length;
    const rng = mulberry32(777);
    this.hero = {
      n, spec: leaves,
      leaves: leaves.map((l) => makeLeaf(rng, SPECIES[l.sp], l.e, l.hgt)),
      data: new Uint8Array(NDAYS * n * 4),
      fall: new Float32Array(n), bud: new Float32Array(n), onset: new Float32Array(n),
    };
    const t = new THREE.DataTexture(this.hero.data, NDAYS, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false;
    this.heroTex = t;
    // leaf-out day per leaf: lower, shadier leaves flush a bit later
    for (let i = 0; i < n; i++) this.hero.bud[i] = SPRING_START + 10 + 16 * (1 - leaves[i].e) + rng() * 8;
    this.simulateYear(this.year);
  }

  /** Re-run the season with a new year's weather and refill the textures. */
  simulateYear(year) {
    this.year = year;
    const s = this.settings(year);
    const W = this.weather = makeWeather(s);
    const drives = this.species.map((si) => treeDrive(SPECIES[si], W, s));
    const rgb = [0, 0, 0];
    const lut = this.lutData, w = this.lutW;
    const put = (row, doy, r, g, b, a) => {
      const k = (row * w + (doy - 1)) * 4;
      lut[k] = toHalf(r); lut[k + 1] = toHalf(g); lut[k + 2] = toHalf(b); lut[k + 3] = toHalf(a);
    };
    this.meanFall = new Float32Array(this.species.length);
    this.species.forEach((si, spi) => {
      const sp = SPECIES[si], drive = drives[spi];
      for (let b = 0; b < BINS; b++) {
        const leaves = this.binLeaves[spi][b], row = spi * BINS + b;
        const sims = leaves.map((l) => simulateLeaf(sp, l, W, drive));
        const NL = sims.length;
        let summer = null;
        const spring = SPRING_START + b * 2.5;           // upper canopy flushes slightly earlier
        for (let doy = 1; doy <= 366; doy++) {
          let r = 0, g = 0, bl = 0, on = 0;
          if (doy >= VIEW0 && doy <= DAY1) {
            const k = doy - VIEW0;
            for (let m = 0; m < NL; m++) {
              if (sims[m].fall <= doy) continue;
              reflect(sims[m].C[k], sims[m].X[k], sims[m].A[k], sims[m].T[k], rgb);
              r += rgb[0]; g += rgb[1]; bl += rgb[2]; on++;
            }
            if (on) { r /= on; g /= on; bl /= on; }
            put(row, doy, r, g, bl, on / NL);
            if (doy === VIEW0) summer = [r, g, bl];
          }
        }
        // before Jul 1: spring flush then summer; after Dec 15: the stragglers let go, then bare
        for (let doy = 1; doy < VIEW0; doy++) {
          const flush = smooth(spring, spring + 22, doy);
          const ripe = smooth(spring + 6, spring + 48, doy);
          put(row, doy, FRESH[0] + (summer[0] - FRESH[0]) * ripe, FRESH[1] + (summer[1] - FRESH[1]) * ripe, FRESH[2] + (summer[2] - FRESH[2]) * ripe, flush);
        }
        const last = (DAY1 - VIEW0) * 4, kLast = (row * w + (DAY1 - 1)) * 4;
        void last;
        for (let doy = DAY1 + 1; doy <= 366; doy++) {
          const k = (row * w + (DAY1 - 1)) * 4;
          const rem = Math.max(0, 1 - (doy - DAY1) / 14);
          const kk = (row * w + (doy - 1)) * 4;
          lut[kk] = lut[k]; lut[kk + 1] = lut[k + 1]; lut[kk + 2] = lut[k + 2];
          lut[kk + 3] = toHalf(THREE.DataUtils.fromHalfFloat(lut[kLast + 3]) * rem);
        }
        this.meanFall[spi] += sims.reduce((a, s2) => a + Math.min(s2.fall, 366), 0) / NL / BINS;
      }
    });
    this.lutTex.needsUpdate = true;
    if (this.hero) this.fillHero(W, drives, s);
  }

  fillHero(W, _drives, s) {
    const h = this.hero;
    const driveCache = new Map();
    const q = [255 / QSCALE.C, 255 / QSCALE.X, 255 / QSCALE.A, 255 / QSCALE.T];
    for (let i = 0; i < h.n; i++) {
      const spi = h.spec[i].sp, sp = SPECIES[spi];
      let drive = driveCache.get(spi);
      if (!drive) { drive = treeDrive(sp, W, s); driveCache.set(spi, drive); }
      const sim = simulateLeaf(sp, h.leaves[i], W, drive);
      h.fall[i] = sim.fall; h.onset[i] = sim.onset;
      const base = i * NDAYS * 4;
      for (let k = 0; k < NDAYS; k++) {
        const o = base + k * 4;
        h.data[o] = clamp(sim.C[k] * q[0], 0, 255);
        h.data[o + 1] = clamp(sim.X[k] * q[1], 0, 255);
        h.data[o + 2] = clamp(sim.A[k] * q[2], 0, 255);
        h.data[o + 3] = clamp(sim.T[k] * q[3], 0, 255);
      }
    }
    this.heroTex.needsUpdate = true;
  }

  /** Exact pigment state of a study leaf on a (fractional) day, for the readout. */
  heroState(i, doy) {
    const h = this.hero; if (!h) return null;
    const f = clamp(doy - VIEW0, 0, NDAYS - 1), k0 = Math.floor(f), k1 = Math.min(NDAYS - 1, k0 + 1), t = f - k0;
    const g = (k, c) => h.data[(i * NDAYS + k) * 4 + c] / 255;
    const m = (c, S) => (g(k0, c) * (1 - t) + g(k1, c) * t) * S;
    return { C: m(0, QSCALE.C), X: m(1, QSCALE.X), A: m(2, QSCALE.A), T: m(3, QSCALE.T), fall: h.fall[i], bud: h.bud[i], onset: h.onset[i] };
  }

  /** Weather on a day of year (null outside the simulated window). */
  weatherOn(doy) {
    const i = Math.floor(doy) - DAY0;
    if (i < 0 || i >= this.weather.P.length) return null;
    const W = this.weather;
    return { tmin: W.tmin[i], tmax: W.tmax[i], rain: W.rain[i], cloud: W.cloud[i], P: W.P[i] };
  }
}
