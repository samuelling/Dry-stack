// Procedural deciduous trees (trunk + branches + lumpy foliage clumps), instanced.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3, mulberry32, rand } from './noise.js';
import { NOISE_GLSL } from './glsl.js';
import { BINS } from './foliage.js';

const NZ = makeNoise3(91);

// ---------------------------------------------------------------------------------------------
// Wood: curved, tapering tubes grown recursively (trunk -> limbs -> branches -> twigs).
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const GOLDEN = 2.399963;

class Wood {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  // points: Vector3[], radii: number[]; uScale = how many bark repeats around the circumference
  tube(points, radii, sides = 6) {
    const n = points.length;
    const T = V3(), N = V3(), B = V3(), P = V3();
    let acc = 0;
    const base = this.pos.length / 3;
    const circ = Math.PI * 2 * radii[0];
    const uS = Math.max(1, Math.round(circ / 0.28));
    for (let i = 0; i < n; i++) {
      T.subVectors(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]).normalize();
      if (i === 0) { N.set(Math.abs(T.y) < 0.9 ? 0 : 1, Math.abs(T.y) < 0.9 ? 1 : 0, 0); N.addScaledVector(T, -N.dot(T)).normalize(); }
      else N.addScaledVector(T, -N.dot(T)).normalize();
      B.crossVectors(T, N);
      if (i > 0) acc += points[i].distanceTo(points[i - 1]);
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const dx = N.x * c + B.x * s, dy = N.y * c + B.y * s, dz = N.z * c + B.z * s;
        this.pos.push(points[i].x + dx * radii[i], points[i].y + dy * radii[i], points[i].z + dz * radii[i]);
        this.nor.push(dx, dy, dz);
        this.uv.push((j / sides) * uS, acc / 0.45);
      }
    }
    const row = sides + 1;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * row + j, b = a + row;
      this.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

// A limb: wandering, optionally bending up (tropism > 0) or drooping (< 0), tapering from rS to rE.
function growLimb(wood, start, dir, len, rS, rE, rng, { wander = 0.12, tropism = 0, sides = 6, segLen = 0.9 } = {}) {
  const segs = Math.max(3, Math.round(len / segLen));
  const pts = [start.clone()], rad = [rS];
  const d = dir.clone().normalize(), p = start.clone();
  for (let s = 1; s <= segs; s++) {
    d.x += rand(rng, -wander, wander); d.z += rand(rng, -wander, wander); d.y += rand(rng, -wander, wander) * 0.5 + tropism;
    d.normalize();
    p.addScaledVector(d, len / segs);
    pts.push(p.clone());
    rad.push(rS + (rE - rS) * Math.pow(s / segs, 0.8));
  }
  wood.tube(pts, rad, sides);
  return { pts, rad };
}

function randUnit(rng) {
  const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return V3(s * Math.cos(th), u, s * Math.sin(th));
}

// ---------------------------------------------------------------------------------------------
// Foliage: cards carrying a painted cluster of leaves. Lit with soft, crown-shaped normals.
const ATLAS_TILES = 3;   // 0 broadleaf (lobed), 1 birch, 2 conifer sprig
class Cards {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.bin = []; this.idx = []; }
  add(c, nC, upRef, w, h, tile, tone, bin, nOut, mixOut) {
    const t2 = V3().copy(upRef).addScaledVector(nC, -upRef.dot(nC));
    if (t2.lengthSq() < 1e-4) t2.set(1, 0, 0).addScaledVector(nC, -nC.x);
    t2.normalize();
    const t1 = V3().crossVectors(t2, nC).normalize();
    const nf = V3().copy(nC).multiplyScalar(1 - mixOut).addScaledVector(nOut, mixOut).normalize();
    const e = 2 / (512 * ATLAS_TILES), u0 = tile / ATLAS_TILES + e, u1 = (tile + 1) / ATLAS_TILES - e;
    const base = this.pos.length / 3;
    for (const [sx, sy, u, v] of [[-1, -1, u0, 0], [1, -1, u1, 0], [1, 1, u1, 1], [-1, 1, u0, 1]]) {
      this.pos.push(c.x + t1.x * sx * w / 2 + t2.x * sy * h / 2, c.y + t1.y * sx * w / 2 + t2.y * sy * h / 2, c.z + t1.z * sx * w / 2 + t2.z * sy * h / 2);
      this.nor.push(nf.x, nf.y, nf.z);
      this.uv.push(u, v);
      this.col.push(tone[0], tone[1], tone[2]);
      this.bin.push(bin);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBin', new THREE.Float32BufferAttribute(this.bin, 1));
    g.setIndex(this.idx);
    return g;
  }
}

// Painted leaf atlas (grey-scale luminance + alpha; the hue comes from the senescence model).
let _atlas = null;
function leafAtlas() {
  if (_atlas) return _atlas;
  const T = 512, W = T * ATLAS_TILES;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = T;
  const g = cv.getContext('2d');
  const rng = mulberry32(4242);
  const gray = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;

  const mapleLobes = [[0, 1.0, 0.30], [0.8, 0.82, 0.26], [-0.8, 0.82, 0.26], [1.6, 0.52, 0.22], [-1.6, 0.52, 0.22]];
  function maple(x, y, size, rot, tone) {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(size, size);
    g.beginPath(); g.moveTo(0, 0.03);
    for (let a = -2.55; a <= 2.55; a += 0.04) {
      let r = 0.26;
      for (const [c, amp, w] of mapleLobes) r += amp * 0.6 * Math.exp(-(((a - c) / w) ** 2));
      r += 0.025 * Math.sin(a * 19);
      g.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    }
    g.closePath(); g.fillStyle = gray(tone); g.fill();
    g.strokeStyle = gray(tone * 0.58); g.lineWidth = 0.022; g.lineCap = 'round';
    g.beginPath();
    for (const [c, amp] of mapleLobes) { g.moveTo(0, 0); g.lineTo(Math.sin(c) * 0.74 * amp, -Math.cos(c) * 0.74 * amp); }
    g.stroke();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0.02, 0.34); g.lineWidth = 0.035; g.stroke();
    g.restore();
  }
  function ovate(x, y, size, rot, tone) {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(size, size);
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(0.62, -0.1, 0.55, -0.72, 0, -1.0);
    g.bezierCurveTo(-0.55, -0.72, -0.62, -0.1, 0, 0);
    g.fillStyle = gray(tone); g.fill();
    g.strokeStyle = gray(tone * 0.6); g.lineWidth = 0.04; g.beginPath(); g.moveTo(0, 0.05); g.lineTo(0, -0.92); g.stroke();
    g.restore();
  }
  // tile 0: broadleaf spray — leaves on a few arching stems
  for (let i = 0; i < 26; i++) {
    const sz = rand(rng, 46, 64);
    const x = rand(rng, sz * 1.0, T - sz * 1.0), y = rand(rng, sz * 1.0, T - sz * 1.0);
    maple(x, y, sz, rng() * 6.283, rand(rng, 185, 245));
  }
  // tile 1: small birch leaves
  g.save(); g.translate(T, 0);
  for (let i = 0; i < 70; i++) {
    const sz = rand(rng, 28, 42);
    ovate(rand(rng, sz, T - sz), rand(rng, sz, T - sz), sz, rng() * 6.283, rand(rng, 185, 245));
  }
  g.restore();
  // tile 2: conifer sprig, drawn along the card's v axis
  g.save(); g.translate(T * 2, 0);
  g.lineCap = 'round';
  for (let s = 0; s < 3; s++) {
    const ox = 256 + (s - 1) * 130, lean = rand(rng, -26, 26);
    for (let i = 0; i < 60; i++) {
      const t = i / 59, y = 500 - t * 480, x = ox + lean * t;
      const len = (40 + 60 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.1))) * (s === 1 ? 1.15 : 0.9);
      for (const side of [-1, 1]) {
        const ang = rand(rng, 0.55, 1.1), tone = rand(rng, 150, 235);
        g.strokeStyle = gray(tone); g.lineWidth = rand(rng, 3.2, 4.6);
        g.beginPath(); g.moveTo(x, y);
        g.lineTo(x + side * Math.sin(ang) * len, y - Math.cos(ang) * len * 0.8 + 6);
        g.stroke();
      }
    }
    g.strokeStyle = gray(120); g.lineWidth = 4; g.beginPath(); g.moveTo(ox, 505); g.lineTo(ox + lean, 20); g.stroke();
  }
  g.restore();

  const img = g.getImageData(0, 0, W, T).data;
  const out = new Uint8Array(W * T * 4);
  for (let y = 0; y < T; y++) {
    const src = (T - 1 - y) * W * 4;        // flip: canvas top row becomes v = 1
    for (let x = 0; x < W; x++) {
      const i = src + x * 4, o = (y * W + x) * 4;
      const a = img[i + 3];
      if (a < 8) { out[o] = out[o + 1] = out[o + 2] = 185; out[o + 3] = 0; }
      else { out[o] = img[i]; out[o + 1] = img[i + 1]; out[o + 2] = img[i + 2]; out[o + 3] = a; }
    }
  }
  const tex = new THREE.DataTexture(out, W, T, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _atlas = tex;
  return tex;
}

const KIND = {
  maple: { trunk: 0.30, r: 0.018, crown: 0.36, np: [5, 7], tropism: 0.06, card: 1.15, tile: 0 },
  birch: { trunk: 0.52, r: 0.011, crown: 0.24, np: [7, 10], tropism: -0.10, card: 0.8, tile: 1 },
};

export function makeTreeTemplate(seed, { palette, kind = 'maple', height = [9, 14], detail = 1, lod = 0 }) {
  const rng = mulberry32(seed);
  const H = rand(rng, ...height);
  const wood = new Wood(), cards = new Cards();
  const tone = new THREE.Color();
  if (kind === 'pine') return makePine(rng, H, wood, cards, palette, detail, lod);
  const P = KIND[kind] || KIND.maple;
  const sc = H / 12;
  const trunkH = H * P.trunk, r0 = H * P.r, crownR = H * P.crown;
  const sides = lod ? 5 : 9;
  // trunk with a little lean, taper and a flared foot
  const tp = [], tr = [];
  const nSeg = lod ? 5 : 9, lx = rand(rng, -1, 1), lz = rand(rng, -1, 1);
  for (let i = 0; i <= nSeg; i++) {
    const t = i / nSeg, y = -0.35 + (trunkH + 0.35) * t;
    tp.push(V3(Math.sin(t * 2.4 + lx) * 0.3 * sc * t + lx * 0.25 * t * t, y, Math.cos(t * 1.9 + lz) * 0.26 * sc * t + lz * 0.25 * t * t));
    tr.push(r0 * (1 - 0.36 * t) * (1 + 1.2 * Math.exp(-Math.max(y, 0) / 0.55)));
  }
  wood.tube(tp, tr, sides);
  const top = tp[nSeg].clone();
  if (!lod) for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng(), c = Math.cos(a), s = Math.sin(a), rr = r0 * 1.2;
    wood.tube([V3(c * rr * 0.4, 0.3, s * rr * 0.4), V3(c * (rr + 0.35), 0.06, s * (rr + 0.35)), V3(c * (rr + 0.9), -0.28, s * (rr + 0.9))].map((p) => p.add(tp[0])), [r0 * 0.6, r0 * 0.34, r0 * 0.1], 5);
  }
  const crownC = V3(top.x, trunkH + (H - trunkH) * 0.52, top.z);
  const anchors = [];   // {p, d}: where leaf clusters hang
  const np = Math.floor(rand(rng, P.np[0], P.np[1] + 0.999));
  const limbs = [];
  for (let i = 0; i < np; i++) {
    const u = np > 1 ? i / (np - 1) : 0;
    const f = 0.6 + 0.4 * u, ti = f * nSeg, i0 = Math.min(nSeg - 1, Math.floor(ti));
    const at = tp[i0].clone().lerp(tp[i0 + 1], ti - i0);
    const elev = (1.2 - 0.75 * Math.pow(u, 0.8)) * rand(rng, 0.88, 1.12), az = i * GOLDEN + rand(rng, -0.3, 0.3);
    const dir = V3(Math.sin(elev) * Math.cos(az), Math.cos(elev), Math.sin(elev) * Math.sin(az));
    const len = crownR * rand(rng, 0.95, 1.3) * (1.05 - 0.3 * u);
    const rS = r0 * rand(rng, 0.45, 0.58) * (1 - 0.25 * u);
    const L = growLimb(wood, at, dir, len, rS, rS * 0.18, rng, { wander: 0.1, tropism: P.tropism * 0.5, sides: lod ? 4 : 6, segLen: 1.1 * sc });
    limbs.push({ ...L, len });
    anchors.push({ p: L.pts[L.pts.length - 1], d: dir });
    anchors.push({ p: L.pts[Math.floor(L.pts.length * 0.65)], d: dir });
  }
  // central leader
  {
    const L = growLimb(wood, top, V3(rand(rng, -0.2, 0.2), 1, rand(rng, -0.2, 0.2)), Math.max(1, H * 0.96 - top.y), r0 * 0.5, r0 * 0.08, rng, { wander: 0.1, tropism: 0.02, sides: lod ? 4 : 6, segLen: 1.1 * sc });
    anchors.push({ p: L.pts[L.pts.length - 1], d: V3(0, 1, 0) });
  }
  if (!lod) {
    // secondary branches and twigs
    for (const L of limbs) {
      const nsec = Math.floor(rand(rng, 3, 5.99));
      for (let k = 0; k < nsec; k++) {
        const t = rand(rng, 0.25, 0.9), idx = Math.min(L.pts.length - 2, Math.floor(t * (L.pts.length - 1)));
        const T = V3().subVectors(L.pts[idx + 1], L.pts[idx]).normalize();
        const d = T.clone().multiplyScalar(0.6).addScaledVector(randUnit(rng), 0.75).add(V3(0, 0.3, 0)).normalize();
        const len = L.len * (1.0 - t * 0.6) * 0.5;
        const rS = L.rad[idx] * 0.62;
        const S = growLimb(wood, L.pts[idx], d, len, rS, rS * 0.2, rng, { wander: 0.14, tropism: P.tropism, sides: 5, segLen: 0.8 * sc });
        anchors.push({ p: S.pts[S.pts.length - 1], d });
        const ntw = Math.floor(rand(rng, 2.5, 4.99));
        for (let q = 0; q < ntw; q++) {
          const tt = rand(rng, 0.3, 1), j = Math.min(S.pts.length - 2, Math.floor(tt * (S.pts.length - 1)));
          const dd = d.clone().multiplyScalar(0.55).addScaledVector(randUnit(rng), 0.9).normalize();
          const tl = rand(rng, 0.9, 1.9) * sc, tr0 = Math.max(0.012, S.rad[j] * 0.5);
          const Tw = growLimb(wood, S.pts[j], dd, tl, tr0, 0.006, rng, { wander: 0.18, tropism: P.tropism * 1.2, sides: 4, segLen: 0.7 * sc });
          anchors.push({ p: Tw.pts[Tw.pts.length - 1], d: dd });
        }
      }
    }
  }
  // leaf cards
  const perAnchor = Math.max(1, Math.round((lod ? 3 : 7) * Math.max(detail, 0.7)));
  const cardW = P.card * sc * (lod ? 2.1 : 1.3) * (kind === 'birch' ? 1 : 1.05);
  const add = (c) => {
    const outward = V3().subVectors(c, crownC);
    const dist = Math.min(1.15, outward.length() / crownR);
    outward.normalize();
    const nC = randUnit(rng).addScaledVector(outward, 0.55).normalize();
    const hgt = THREE.MathUtils.clamp((c.y - trunkH) / Math.max(0.1, H - trunkH), 0, 1);
    const rad = THREE.MathUtils.clamp(Math.hypot(c.x - top.x, c.z - top.z) / (crownR * 1.2), 0, 1);
    const bin = Math.min(BINS - 1, Math.floor(THREE.MathUtils.clamp(0.08 + 0.5 * rad + 0.42 * hgt, 0, 0.999) * BINS));
    palette(tone, rng);
    const shade = THREE.MathUtils.clamp(0.52 + 0.5 * THREE.MathUtils.smoothstep(dist, 0.15, 1.0) + 0.3 * THREE.MathUtils.clamp((c.y - crownC.y) / crownR, -0.6, 0.7), 0.45, 1.4) * rand(rng, 0.9, 1.1);
    const w = cardW * rand(rng, 0.8, 1.25);
    cards.add(c, nC, randUnit(rng), w, w, P.tile, [tone.r * shade, tone.g * shade, tone.b * shade], bin, outward, 0.6);
  };
  const spread = (kind === 'birch' ? 0.55 : 0.8) * sc * (lod ? 1.5 : 1);
  for (const a of anchors) for (let k = 0; k < perAnchor; k++) add(a.p.clone().addScaledVector(randUnit(rng), spread * rand(rng, 0.2, 1)).addScaledVector(a.d, rand(rng, -0.1, 0.5) * spread));
  const nFill = Math.round((lod ? 50 : 130) * Math.max(detail, 0.7));
  for (let k = 0; k < nFill; k++) {
    const d = randUnit(rng);
    add(crownC.clone().add(V3(d.x * crownR * rand(rng, 0.35, 1.0), d.y * crownR * 0.75 * rand(rng, 0.3, 1.0), d.z * crownR * rand(rng, 0.35, 1.0))));
  }
  return { wood: wood.geometry(), leaf: cards.geometry(), kind };
}

function makePine(rng, H, wood, cards, palette, detail, lod) {
  const tone = new THREE.Color();
  const trunkH = H * 0.16, r0 = H * 0.014, crownR = H * 0.19;
  const sc = H / 16;
  const tp = [], tr = [];
  const lean = rand(rng, -0.25, 0.25);
  for (let i = 0; i <= 8; i++) { const t = i / 8; tp.push(V3(lean * t * t * sc, -0.35 + (H * 0.97 + 0.35) * t, 0)); tr.push(r0 * (1 - 0.88 * Math.pow(t, 0.9)) * (1 + Math.exp(-(t * H) / 0.6))); }
  wood.tube(tp, tr, lod ? 5 : 8);
  const nL = Math.round((lod ? 9 : 16) * Math.max(0.6, detail));
  let az = rng() * 6.28;
  for (let li = 0; li < nL; li++) {
    const t = li / (nL - 1), y = trunkH + (H * 0.93 - trunkH) * t;
    const rr = crownR * (1.12 - 0.98 * Math.pow(t, 0.9)) * rand(rng, 0.9, 1.1);
    const n = (lod ? 4 : 6) + (t < 0.5 ? 2 : 0);
    az += GOLDEN;
    const trunkAt = V3(lean * t * t * sc * 0.9, y, 0);
    for (let k = 0; k < n; k++) {
      const a = az + (k / n) * Math.PI * 2 + rand(rng, -0.2, 0.2), c = Math.cos(a), s = Math.sin(a);
      const droop = 0.28 * rr;
      const pts = [trunkAt.clone(), trunkAt.clone().add(V3(c * rr * 0.4, droop * 0.35 - 0.04, s * rr * 0.4)), trunkAt.clone().add(V3(c * rr * 0.75, -droop * 0.45, s * rr * 0.75)), trunkAt.clone().add(V3(c * rr, -droop * 0.3 + 0.05 * rr, s * rr))];
      if (!lod) wood.tube(pts, [r0 * 0.22, r0 * 0.16, r0 * 0.09, r0 * 0.03], 4);
      // sprig cards along the limb, long axis pointing outward and a little down
      const outward = V3(c, -0.22, s).normalize();
      const upRef = outward;
      for (const f of lod ? [0.7] : [0.45, 0.8]) {
        const p = pts[0].clone().lerp(pts[3], f).add(V3(0, -0.12 * rr * f, 0));
        const nC = V3(0, 1, 0).addScaledVector(outward, -0.25).normalize();
        const hgt = t;
        palette(tone, rng);
        const shade = THREE.MathUtils.clamp(0.7 + 0.5 * (1 - f) * 0 + 0.35 * (0.5 - Math.abs(0.5 - hgt)) + rand(rng, -0.12, 0.12), 0.5, 1.3);
        const w = Math.max(1.1, rr * 0.7) * (lod ? 1.5 : 1), h = Math.max(1.4, rr * 0.8) * (lod ? 1.5 : 1);
        cards.add(p.addScaledVector(outward, h * 0.2), nC, upRef, w, h, 2, [tone.r * shade, tone.g * shade, tone.b * shade], 0, V3(c, 0.25, s).normalize(), 0.45);
      }
    }
  }
  // crowning spire: crossed vertical cards
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    palette(tone, rng);
    cards.add(V3(lean * sc, H * 0.93, 0), V3(Math.cos(a), 0, Math.sin(a)), V3(0, 1, 0), 1.1 * sc, H * 0.16, 2, [tone.r * 0.9, tone.g * 0.9, tone.b * 0.9], 0, V3(Math.cos(a), 0.3, Math.sin(a)).normalize(), 0.3);
  }
  return { wood: wood.geometry(), leaf: cards.geometry(), kind: 'pine' };
}

// Foliage senescence in GLSL. The colour of every vertex comes from a look-up texture
// (species x canopy exposure x day of year) written by FoliageModel; `aInst` carries the instance's
// species row (-1 = evergreen) and its personal timing offset in days.
const FOLIAGE_DECL = /* glsl */`
  attribute float aBin; attribute vec2 aInst;
  uniform sampler2D uFolTex; uniform float uFolRows; uniform float uDay;
  varying float vRemain;
  vec4 foliageAt(float row, float bin, float doy) {
    float u = (clamp(doy, 1.0, 366.0) - 0.5) / 366.0;
    float v = (row * ${BINS}.0 + bin + 0.5) / uFolRows;
    return texture2D(uFolTex, vec2(u, v));
  }`;
const FOLIAGE_VERT = /* glsl */`
  vRemain = 1.0;
  if (aInst.x > -0.5) {
    vec4 f = foliageAt(aInst.x, aBin, uDay + aInst.y);
    // the baked vertex colour only supplies shading (darker undersides, clump-to-clump variation);
    // the hue comes from the model
    float shade = clamp(dot(vColor, vec3(0.3333)) / 0.075, 0.45, 1.6);
    vColor = f.rgb * 0.62 * shade;
    vRemain = f.a;
  }`;

export function makeLeafMaterial(uTime, fol = null) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, map: leafAtlas(), alphaTest: 0.45, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    if (fol) { shader.uniforms.uFolTex = { value: fol.tex }; shader.uniforms.uFolRows = { value: fol.rows }; shader.uniforms.uDay = fol.uDay; }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vLeafPos;' + (fol ? FOLIAGE_DECL : ''))
      .replace('#include <color_vertex>', '#include <color_vertex>' + (fol ? FOLIAGE_VERT : ''))
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 iw = vec3(0.0);
        #ifdef USE_INSTANCING
          iw = instanceMatrix[3].xyz;
        #endif
        float sway = sin(uTime * 1.3 + iw.x * 0.3 + position.y * 0.4) * 0.04 * max(position.y - 2.0, 0.0) * 0.1;
        transformed.x += sway; transformed.z += sway * 0.6;
        vLeafPos = position + iw * 0.37;
        ${fol ? 'if (vRemain < 0.01) transformed = vec3(0.0);' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL + '\nvarying vec3 vLeafPos;' + (fol ? '\nvarying float vRemain;' : '') + '\n' + /* glsl */`
        vec3 leafBump(vec3 surf_pos, vec3 surf_norm, float h){
          vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
          vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
          float det = dot(sx, R1);
          vec3 grad = sign(det) * (dFdx(h) * R1 + dFdy(h) * R2);
          return normalize(abs(det) * surf_norm - grad);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${fol ? `if (vRemain < 0.995) { float dn = snoise(vLeafPos * 9.0) * 0.5 + 0.5; if (vRemain < 0.01 || dn > vRemain) discard; }` : ''}
        float lf = snoise(vLeafPos * 1.7);
        diffuseColor.rgb *= (0.88 + 0.2 * lf) * 1.25;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = leafBump(-vViewPosition, normal, (snoise(vLeafPos * 6.0) * 0.6 + snoise(vLeafPos * 15.0) * 0.4) * 0.04);`);
  };
  mat.customProgramCacheKey = () => 'leaf-' + (fol ? 'fol' : 'plain');
  // matching shadow caster: the same dissolve, so a thinning canopy casts a thinning shadow
  if (fol) {
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafAtlas(), alphaTest: 0.45, side: THREE.DoubleSide });
    dm.onBeforeCompile = (shader) => {
      shader.uniforms.uFolTex = { value: fol.tex }; shader.uniforms.uFolRows = { value: fol.rows }; shader.uniforms.uDay = fol.uDay;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLeafPos; varying float vFall;' + FOLIAGE_DECL.replace('varying float vRemain;', ''))
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 iw = vec3(0.0);
          #ifdef USE_INSTANCING
            iw = instanceMatrix[3].xyz;
          #endif
          vLeafPos = position + iw * 0.37;
          vFall = 1.0;
          if (aInst.x > -0.5) vFall = foliageAt(aInst.x, aBin, uDay + aInst.y).a;
          if (vFall < 0.01) transformed = vec3(0.0);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + NOISE_GLSL + '\nvarying vec3 vLeafPos; varying float vFall;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vFall < 0.995) { float dn = snoise(vLeafPos * 9.0) * 0.5 + 0.5; if (vFall < 0.01 || dn > vFall) discard; }`);
    };
    mat.userData.depthMaterial = dm;
  }
  return mat;
}

export function makeBarkMaterial(color = 0x4a4038, { birch = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBk; varying float vBy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBk = uv; vBy = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL + '\nvarying vec2 vBk; varying float vBy;' + `
        float barkH(vec2 p){
          float n = snoise(vec3(p.x * ${birch ? '1.5' : '2.4'}, p.y * ${birch ? '5.0' : '0.75'}, 1.7));
          float m = snoise(vec3(p.x * 6.0, p.y * 2.2, 7.3));
          return ${birch ? 'n * 0.4 + m * 0.2' : '1.0 - abs(n) * 1.6 + m * 0.25'};
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float bh = barkH(vBk);
        ${birch ? `
        vec3 paper = vec3(0.80, 0.78, 0.72);
        float dash = smoothstep(0.35, 0.55, snoise(vec3(vBk.x * 3.0, vBk.y * 9.0, 3.1)));
        float base = 1.0 - smoothstep(0.2, 1.8, vBy);
        diffuseColor.rgb = mix(paper, vec3(0.06, 0.055, 0.05), clamp(dash * 0.85 + base * 0.8, 0.0, 1.0)) * (0.9 + 0.2 * bh);`
        : `
        diffuseColor.rgb *= 0.55 + 0.6 * clamp(bh, 0.0, 1.0);
        float lich = smoothstep(0.45, 0.75, snoise(vec3(vBk * 1.3, 11.0))) * smoothstep(0.5, 3.0, vBy);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.40, 0.25), lich * 0.45);`}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec2 e = vec2(0.01, 0.0);
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          float h = bh * ${birch ? '0.015' : '0.09'};
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
          float det = dot(sx, R1);
          normal = normalize(abs(det) * normal - sign(det) * (dFdx(h) * R1 + dFdy(h) * R2)); }`);
  };
  mat.customProgramCacheKey = () => 'bark-' + (birch ? 'b' : 'r');
  return mat;
}

// Place trees: positions [{x,z,s,rot,t}] grouped by template index
export function instanceTrees(templates, placements, heightFn, leafMat, barkMats, { shadows = true } = {}) {
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  templates.forEach((tpl, ti) => {
    const list = placements.filter((pl) => pl.t === ti);
    if (!list.length) return;
    const wood = new THREE.InstancedMesh(tpl.wood, barkMats[tpl.kind] || barkMats.default, list.length);
    const leaf = new THREE.InstancedMesh(tpl.leaf, leafMat, list.length);
    list.forEach((pl, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot);
      sc.setScalar(pl.s);
      p.set(pl.x, heightFn(pl.x, pl.z), pl.z);
      m.compose(p, q, sc);
      wood.setMatrixAt(i, m); leaf.setMatrixAt(i, m);
    });
    // per-instance foliage timing: [species row (-1 evergreen), phase in days]
    const inst = new Float32Array(list.length * 2);
    list.forEach((pl, i) => { inst[i * 2] = pl.sp ?? -1; inst[i * 2 + 1] = pl.ph ?? 0; });
    leaf.geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 2));
    if (leafMat.userData.depthMaterial) leaf.customDepthMaterial = leafMat.userData.depthMaterial;
    for (const im of [wood, leaf]) {
      im.castShadow = shadows; im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  });
  return group;
}
