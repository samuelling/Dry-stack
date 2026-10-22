// Procedural stone generation: six regional walling stones.
// Each stone is a star-shaped surface r(d): a superellipsoid intersected with
// bedding planes and random fracture planes, combined with a soft-min so the
// edges are as rounded as the rock type is weathered, plus surface noise.
// Physics uses a convex hull sampled from the same function.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3, mulberry32, rand } from './noise.js';
import { NOISE_GLSL, BUMP_GLSL, CAUSTIC_GLSL } from './glsl.js';

const N = makeNoise3(7);

export const STONE_TYPES = {
  newengland: {
    key: 'newengland',
    name: 'New England Fieldstone',
    region: 'Massachusetts · New Hampshire · Vermont',
    blurb: 'Glacial till — granite, gneiss and schist that farmers prised out of their pastures for two hundred years. Rounded by ice, seldom flat. Every stone is a negotiation.',
    shape: { h: 0.8, round: 0.13, p: 2.1, cuts: [3, 6], cutDepth: [0.6, 0.92], bed: 0, noise: 0.085, freq: 1.25, detail: 0.01, asym: 0.25, taper: 0.3 },
    variants: [
      { w: 3, a: 0x6b665f, b: 0x8f887d, speckle: 0.85, band: 0.0, rust: 0.2 },  // grey granite
      { w: 2, a: 0x776a62, b: 0x9a887b, speckle: 0.8, band: 0.0, rust: 0.15 },  // pink granite
      { w: 2, a: 0x54504a, b: 0x857e74, speckle: 0.3, band: 0.8, rust: 0.25 },  // gneiss
      { w: 2, a: 0x42423c, b: 0x5f5e56, speckle: 0.4, band: 0.5, rust: 0.4 },   // schist
      { w: 1, a: 0x8f887d, b: 0xaea597, speckle: 0.1, band: 0.1, rust: 0.55 },  // quartzite
    ],
    lichen: 0.5, roughness: 0.82, friction: 0.82, bedFreq: 9, bedAmt: 0.0, pits: 0.0, grain: 0.5, sharpMix: 0.0,
    lichenTint: [0x9a9c7a, 0xb3b195, 0xc59a3a], copes: false, sound: 1.0,
  },
  pennsylvania: {
    key: 'pennsylvania',
    name: 'Pennsylvania Fieldstone',
    region: 'Bucks · Lancaster · Chester counties',
    blurb: 'Brown and buff sandstone off the Appalachian ridges, stained with rusty iron. Flatter beds than New England stone — it lays down kindly in courses.',
    shape: { h: 0.6, round: 0.1, p: 2.6, cuts: [3, 6], cutDepth: [0.66, 0.92], bed: 0.85, noise: 0.05, freq: 1.5, detail: 0.008, asym: 0.2, taper: 0.25 },
    variants: [
      { w: 3, a: 0x7a6449, b: 0x9c8263, speckle: 0.15, band: 0.4, rust: 0.45 },
      { w: 2, a: 0x5f4632, b: 0x836448, speckle: 0.12, band: 0.5, rust: 0.6 },
      { w: 2, a: 0x6e4630, b: 0x926443, speckle: 0.1, band: 0.3, rust: 0.7 },
      { w: 1, a: 0x5c5b55, b: 0x7b776d, speckle: 0.2, band: 0.4, rust: 0.35 },
    ],
    lichen: 0.4, roughness: 0.88, friction: 0.85, bedFreq: 14, bedAmt: 0.5, pits: 0.05, grain: 0.7, sharpMix: 0.0,
    lichenTint: [0x9b9c7c, 0xb6b49a, 0xc98e35], copes: false, sound: 0.85,
  },
  cotswold: {
    key: 'cotswold',
    name: 'Cotswold Limestone',
    region: 'Gloucestershire · Oxfordshire',
    blurb: 'Honey-gold Jurassic oolite that splits into thin, flat beds. Easy courses and crisp joints; the walls are finished with a row of copes set on edge like books on a shelf.',
    shape: { h: 0.42, round: 0.05, p: 3.4, cuts: [4, 7], cutDepth: [0.68, 0.93], bed: 0.9, noise: 0.03, freq: 1.8, detail: 0.006, asym: 0.2, taper: 0.15 },
    variants: [
      { w: 3, a: 0x9c7c48, b: 0xbea26c, speckle: 0.05, band: 0.6, rust: 0.25 },
      { w: 2, a: 0xa48f69, b: 0xc4b28c, speckle: 0.05, band: 0.5, rust: 0.15 },
      { w: 2, a: 0x7f7666, b: 0xa0957f, speckle: 0.05, band: 0.5, rust: 0.1 },
    ],
    lichen: 0.6, roughness: 0.9, friction: 0.8, bedFreq: 22, bedAmt: 0.65, pits: 0.18, grain: 0.25, sharpMix: 0.0,
    lichenTint: [0xa2a283, 0xcfccb8, 0xd7962c], copes: true, sound: 0.9,
  },
  welsh: {
    key: 'welsh',
    name: 'Welsh Slate',
    region: 'Gwynedd · Eryri (Snowdonia)',
    blurb: 'Cambrian slate, blue-grey through heather-purple, cleaving into thin plates. Laid in tight courses with long overlaps; slippery underfoot and underhand.',
    shape: { h: 0.22, round: 0.025, p: 4.2, cuts: [4, 8], cutDepth: [0.62, 0.92], bed: 0.95, noise: 0.018, freq: 2.0, detail: 0.003, asym: 0.25, taper: 0.2 },
    variants: [
      { w: 3, a: 0x3c4147, b: 0x50565d, speckle: 0.02, band: 0.85, rust: 0.12 },
      { w: 2, a: 0x433b41, b: 0x564b53, speckle: 0.02, band: 0.85, rust: 0.08 },
      { w: 1, a: 0x404743, b: 0x535c56, speckle: 0.02, band: 0.8, rust: 0.1 },
    ],
    lichen: 0.3, roughness: 0.55, friction: 0.58, bedFreq: 60, bedAmt: 0.9, pits: 0.0, grain: 0.15, sharpMix: 0.0,
    lichenTint: [0x93967c, 0xbfbfae, 0xc4882e], copes: true, sound: 1.25,
  },
  yorkshire: {
    key: 'yorkshire',
    name: 'Yorkshire Gritstone',
    region: 'The Pennines · Dales',
    blurb: 'Coarse millstone grit: a sooty, near-black weathered skin over buff sandstone. Blocky and grippy — the stone of the moorland walls that run straight up the fellside.',
    shape: { h: 0.72, round: 0.08, p: 3.2, cuts: [3, 6], cutDepth: [0.68, 0.94], bed: 0.86, noise: 0.04, freq: 1.6, detail: 0.01, asym: 0.2, taper: 0.2 },
    variants: [
      { w: 3, a: 0x3a3530, b: 0x86765a, speckle: 0.5, band: 0.25, rust: 0.2 },
      { w: 2, a: 0x403a33, b: 0x8f7d5e, speckle: 0.5, band: 0.25, rust: 0.25 },
      { w: 1, a: 0x423d37, b: 0x736b5e, speckle: 0.5, band: 0.2, rust: 0.15 },
    ],
    lichen: 0.45, roughness: 0.95, friction: 0.95, bedFreq: 11, bedAmt: 0.25, pits: 0.1, grain: 1.0, sharpMix: 1.0,
    lichenTint: [0xa5a674, 0xbdbd98, 0xb88a35], copes: true, sound: 0.8,
  },
  aran: {
    key: 'aran',
    name: 'Aran Limestone',
    region: 'Inis Mór · The Burren',
    blurb: 'Pale Carboniferous limestone, etched by rain into solution pits and runnels. Clean grey blocks crusted with white and orange lichen, under a wide Atlantic sky.',
    shape: { h: 0.74, round: 0.09, p: 2.8, cuts: [3, 6], cutDepth: [0.66, 0.93], bed: 0.82, noise: 0.05, freq: 1.5, detail: 0.01, asym: 0.22, taper: 0.2 },
    variants: [
      { w: 3, a: 0x767874, b: 0x989a95, speckle: 0.05, band: 0.15, rust: 0.05 },
      { w: 2, a: 0x666c6f, b: 0x8a8f8f, speckle: 0.05, band: 0.15, rust: 0.05 },
    ],
    lichen: 0.75, roughness: 0.85, friction: 0.8, bedFreq: 8, bedAmt: 0.15, pits: 0.8, grain: 0.3, sharpMix: 0.0,
    lichenTint: [0xd9d9d0, 0xbfc4b8, 0xd6862a], copes: true, sound: 1.05,
  },
};

// Size classes (meters): [length, width(into-wall depth), height] ranges before type scaling.
export const SIZE_CLASSES = {
  foundation: { L: [0.5, 0.72], W: [0.32, 0.46], H: [0.2, 0.3], detail: 22 },
  builder:    { L: [0.26, 0.46], W: [0.18, 0.3], H: [0.11, 0.2], detail: 16 },
  through:    { L: [0.68, 0.84], W: [0.2, 0.3], H: [0.1, 0.16], detail: 18 },
  cope:       { L: [0.36, 0.46], W: [0.24, 0.32], H: [0.08, 0.13], detail: 16 },
  hearting:   { L: [0.05, 0.12], W: [0.04, 0.09], H: [0.03, 0.07], detail: 5 },
};

function pickVariant(type, rng) {
  const tot = type.variants.reduce((s, v) => s + v.w, 0);
  let r = rng() * tot;
  for (const v of type.variants) { r -= v.w; if (r <= 0) return v; }
  return type.variants[0];
}

function randomUnit(rng) {
  const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th));
}

// Build the radius function for one stone.
function makeShape(type, cls, rng) {
  const sc = SIZE_CLASSES[cls];
  const sh = type.shape;
  let L = rand(rng, ...sc.L), W = rand(rng, ...sc.W), H = rand(rng, ...sc.H);
  // character: some stones blocky, some flat, most just stone-shaped
  const charR = rng();
  const blocky = cls !== 'hearting' && charR < 0.3;
  const flat = cls !== 'hearting' && charR > 0.78;
  if (flat) H *= 0.68;
  if (cls !== 'hearting') {
    H *= sh.h * (cls === 'cope' ? 1.0 : 1.15);
    if (cls === 'cope') { H = Math.max(H, 0.06); }
  } else {
    H *= 0.7 + sh.h * 0.5;
  }
  if (cls === 'through' || cls === 'cope') { /* keep long */ }
  // Half extents: x = length, y = height (bed), z = width.
  const ex = L / 2, ey = H / 2, ez = W / 2;
  const p = sh.p * rand(rng, 0.9, 1.1) * (blocky ? 1.35 : 1);
  const as = sh.asym || 0;
  const exP = ex * rand(rng, 1 - as * 0.3, 1 + as * 0.2), exN = ex * rand(rng, 1 - as, 1);
  const ezP = ez * rand(rng, 1 - as * 0.3, 1 + as * 0.2), ezN = ez * rand(rng, 1 - as, 1);
  const taperX = rand(rng, -1, 1) * (sh.taper || 0), taperZ = rand(rng, -1, 1) * (sh.taper || 0) * 0.6;
  const bedded = sh.bed > 0 && cls !== 'hearting';
  const eyS = bedded ? ey / sh.bed : ey;
  const planes = [];
  if (bedded) {
    const tilt = 0.07;
    const n1 = new THREE.Vector3(rand(rng, -tilt, tilt), 1, rand(rng, -tilt, tilt)).normalize();
    const n2 = new THREE.Vector3(rand(rng, -tilt, tilt), -1, rand(rng, -tilt, tilt)).normalize();
    planes.push({ n: n1, h: ey * rand(rng, 0.96, 1.04) }, { n: n2, h: ey * rand(rng, 0.96, 1.04) });
  }
  const nc = Math.floor(rand(rng, sh.cuts[0], sh.cuts[1] + 0.999)) + (blocky ? 2 : 0);
  for (let i = 0; i < nc; i++) {
    let n = randomUnit(rng);
    if (bedded) { n.y *= 0.35; n.normalize(); } // fractures roughly across the beds
    // Faces of builders: favour a flattish face on the long sides (that's what wallers look for)
    if (i === 0 && cls !== 'hearting') n = new THREE.Vector3(rand(rng, -0.2, 0.2), rand(rng, -0.15, 0.15), rng() < 0.5 ? 1 : -1).normalize();
    const sup = Math.sqrt((ex * n.x) ** 2 + (eyS * n.y) ** 2 + (ez * n.z) ** 2);
    planes.push({ n, h: sup * rand(rng, ...sh.cutDepth) });
  }
  const k = sh.round * (blocky ? 0.6 : 1) * Math.min(ex, ey, ez) * 2.0 + 0.0015;
  const seed = rng() * 100;
  const noiseAmp = sh.noise * (cls === 'hearting' ? 1.6 : 1);

  function r(dx, dy, dz) {
    const exd = dx > 0 ? exP : exN, ezd = dz > 0 ? ezP : ezN;
    const eyd = eyS * (1 + taperX * dx + taperZ * dz);
    const s = Math.pow(Math.abs(dx / exd), p) + Math.pow(Math.abs(dy / eyd), p) + Math.pow(Math.abs(dz / ezd), p);
    const ts = Math.pow(s, -1 / p);
    let tmin = ts;
    const ts_list = [ts];
    for (const pl of planes) {
      const nd = pl.n.x * dx + pl.n.y * dy + pl.n.z * dz;
      if (nd > 1e-4) { const t = pl.h / nd; ts_list.push(t); if (t < tmin) tmin = t; }
    }
    // soft-min (log-sum-exp) for rounded arrises
    let sum = 0;
    for (const t of ts_list) sum += Math.exp(-(t - tmin) / k);
    let rr = tmin - k * Math.log(sum);
    const n1 = N(dx * sh.freq + seed, dy * sh.freq, dz * sh.freq);
    const n2 = N(dx * sh.freq * 2.3 + seed, dy * sh.freq * 2.3 + 5, dz * sh.freq * 2.3);
    const n3 = N(dx * 7 + seed, dy * 7, dz * 7);
    rr *= 1 + noiseAmp * (n1 * 0.7 + n2 * 0.3) + sh.detail * n3;
    return Math.max(rr, Math.min(ex, ey, ez) * 0.25);
  }
  return { r, L, W, H };
}

const sphereCache = new Map();
function unitSphere(detail) {
  if (!sphereCache.has(detail)) {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    sphereCache.set(detail, g);
  }
  return sphereCache.get(detail);
}

const linear = (hex) => new THREE.Color(hex); // three converts sRGB hex -> linear working space

export function generateStone(typeKey, cls, seed) {
  const type = STONE_TYPES[typeKey];
  const rng = mulberry32(seed);
  const shape = makeShape(type, cls, rng);
  const detail = SIZE_CLASSES[cls].detail;
  const base = unitSphere(detail);
  const geo = base.clone();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const rr = shape.r(v.x, v.y, v.z);
    v.multiplyScalar(rr);
    pos.setXYZ(i, v.x, v.y, v.z);
    min.min(v); max.max(v);
  }
  geo.computeVertexNormals();

  // Per-stone shading attributes
  const variant = pickVariant(type, rng);
  const ca = linear(variant.a), cb = linear(variant.b);
  const jit = 1 + (rng() - 0.5) * 0.18;
  const hueShift = (rng() - 0.5) * 0.05;
  ca.offsetHSL(hueShift, 0, 0).multiplyScalar(jit);
  cb.offsetHSL(hueShift, 0, 0).multiplyScalar(jit);
  const n = pos.count;
  const aColA = new Float32Array(n * 3), aColB = new Float32Array(n * 3), aStone = new Float32Array(n * 4);
  const lich = type.lichen * rand(rng, 0.4, 1.3) * (cls === 'hearting' ? 0.4 : 1);
  const sd = rng();
  for (let i = 0; i < n; i++) {
    aColA.set([ca.r, ca.g, ca.b], i * 3);
    aColB.set([cb.r, cb.g, cb.b], i * 3);
    aStone.set([sd, variant.speckle, variant.rust, lich], i * 4);
  }
  geo.setAttribute('aColA', new THREE.BufferAttribute(aColA, 3));
  geo.setAttribute('aColB', new THREE.BufferAttribute(aColB, 3));
  geo.setAttribute('aStone', new THREE.BufferAttribute(aStone, 4));
  geo.userData.band = variant.band;

  // Physics hull points from a coarse sampling of the same surface.
  const hullBase = unitSphere(cls === 'hearting' ? 1 : 3);
  const hp = new Float32Array(hullBase.attributes.position.count * 3);
  for (let i = 0; i < hullBase.attributes.position.count; i++) {
    v.fromBufferAttribute(hullBase.attributes.position, i).normalize();
    v.multiplyScalar(shape.r(v.x, v.y, v.z));
    hp[i * 3] = v.x; hp[i * 3 + 1] = v.y; hp[i * 3 + 2] = v.z;
  }
  const size = new THREE.Vector3().subVectors(max, min);
  geo.computeBoundingSphere();
  return { geometry: geo, hullPoints: hp, size, min, max, cls, type: typeKey, band: variant.band };
}

// ---------------------------------------------------------------------------
// Material: procedural rock shading in object space, so the texture sticks to
// each stone as it tumbles.

const materialCache = new Map();
export const sharedUniforms = {
  uTime: { value: 0 },
  uCaustic: { value: 0 },
  uWet: { value: 0 },
};

export function getStoneMaterial(typeKey) {
  if (materialCache.has(typeKey)) return materialCache.get(typeKey);
  const t = STONE_TYPES[typeKey];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: t.roughness, metalness: 0.0 });
  const lt = t.lichenTint.map((h) => new THREE.Color(h));
  const uniforms = {
    uBedFreq: { value: t.bedFreq },
    uBedAmt: { value: t.bedAmt },
    uPits: { value: t.pits },
    uGrain: { value: t.grain },
    uSharpMix: { value: t.sharpMix },
    uLichA: { value: lt[0] }, uLichB: { value: lt[1] }, uLichC: { value: lt[2] },
    uRough: { value: t.roughness },
    uHighlight: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aColA; attribute vec3 aColB; attribute vec4 aStone;
        varying vec3 vObjPos; varying vec3 vColA; varying vec3 vColB; varying vec4 vStone;
        varying vec3 vWPos; varying vec3 vWNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObjPos = position; vColA = aColA; vColB = aColB; vStone = aStone;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        wp4 = modelMatrix * wp4;
        vWPos = wp4.xyz;
        mat3 nm = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          nm = nm * mat3(instanceMatrix);
        #endif
        vWNormal = normalize(nm * normal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        ${BUMP_GLSL}
        ${CAUSTIC_GLSL}
        uniform float uBedFreq, uBedAmt, uPits, uGrain, uSharpMix, uRough, uHighlight, uWet;
        uniform vec3 uLichA, uLichB, uLichC;
        varying vec3 vObjPos; varying vec3 vColA; varying vec3 vColB; varying vec4 vStone;
        varying vec3 vWPos; varying vec3 vWNormal;
        float gHeight; float gLichen; float gRoughAdd;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vObjPos * 6.0 + vStone.x * 37.0;
          float seed = vStone.x;
          float speck = vStone.y, rust = vStone.z, lich = clamp(vStone.w, 0.0, 1.0);
          float px = length(fwidth(vObjPos)) * 0.4;
          float lodHi = 1.0 - smoothstep(0.0009, 0.0028, px);
          float lodMid = 1.0 - smoothstep(0.0025, 0.008, px);
          // large tonal variation
          float n1 = fbm3(p * 0.55);
          float mixT = smoothstep(-0.45, 0.5, n1);
          // gritstone: dark weathered skin broken by fresh buff patches
          float skin = smoothstep(-0.38, 0.02, fbm3(p * 0.45 + 11.0) + snoise(vObjPos * 18.0) * 0.06);
          mixT = mix(mixT, (1.0 - skin) * 0.85 + 0.1 + 0.08 * n1, uSharpMix);
          vec3 col = mix(vColA, vColB, mixT);
          // bedding / banding along local y (bed planes), warped
          float warp = fbm3(p * 0.4 + 3.0) * 1.6;
          float bands = sin(vObjPos.y * uBedFreq * 6.2831 + warp * 3.0);
          float bandAmt = max(uBedAmt, 0.0);
          col *= 1.0 + bands * 0.06 * bandAmt * lodMid;
          // gneiss/schist foliation
          float fol = sin(dot(vObjPos, normalize(vec3(0.3, 1.0, 0.2))) * 55.0 + warp * 7.0 + snoise(vObjPos * 9.0) * 2.0);
          col = mix(col, col * (0.88 + 0.18 * smoothstep(0.3, 0.8, fol)), (1.0 - speck) * 0.3 * (1.0 - bandAmt) * lodMid);
          // crystals / grains — fade out when smaller than a pixel
          float g1 = snoise(vObjPos * 150.0 + seed * 13.0);
          float g2 = snoise(vObjPos * 210.0 + 7.0);
          float darkC = smoothstep(0.5, 0.75, g1) * speck;
          float lightC = smoothstep(0.55, 0.8, g2) * speck;
          col = mix(col, col * (1.0 - 0.08 * speck), 1.0 - lodHi);
          col = mix(col, col * 0.45, darkC * 0.8 * lodHi);
          col = mix(col, min(col * 1.4 + 0.03, vec3(1.0)), lightC * 0.6 * lodHi);
          col *= 1.0 + snoise(vObjPos * 70.0) * 0.07 * uGrain * lodMid;
          // iron staining
          float rs = smoothstep(0.2, 0.75, fbm3(p * 0.9 + 21.0));
          col = mix(col, col * vec3(1.22, 0.85, 0.6), rs * rust * 0.75);
          // solution pits (limestone)
          float pitN = snoise(vObjPos * 26.0 + seed * 5.0);
          float pit = smoothstep(0.45, 0.75, pitN) * uPits;
          col *= 1.0 - pit * 0.35;
          // lichen: patchy crusts with rosette edges
          float ln = fbm3(p * 1.2 + seed * 50.0) + snoise(vObjPos * 30.0 + seed) * 0.08 * lodMid;
          float thr = mix(0.5, -0.02, lich);
          float lmask = smoothstep(thr, thr + 0.06, ln) * smoothstep(-0.35, 0.25, snoise(vObjPos * 38.0 + seed * 3.0) + (ln - thr) * 3.0);
          float lsel = snoise(vObjPos * 3.0 + seed * 9.0);
          vec3 lc = mix(uLichA, uLichB, smoothstep(-0.3, 0.3, lsel)) * (0.9 + 0.15 * snoise(vObjPos * 60.0) * lodHi);
          float orange = smoothstep(0.6, 0.72, snoise(vObjPos * 10.0 + seed * 21.0)) * smoothstep(0.1, 0.3, ln) * lich;
          gLichen = lmask;
          col = mix(col, lc, gLichen * 0.8);
          col = mix(col, uLichC, orange * 0.75);
          // dirt in hollows
          float cav = fbm3(p * 2.5 + 5.0);
          col *= 0.84 + 0.16 * smoothstep(-0.5, 0.3, cav);
          // height for bump
          gHeight = fbm5(p * 1.3) * 0.0035
                  + snoise(vObjPos * 90.0) * 0.00028 * (0.5 + uGrain) * lodHi
                  + snoise(vObjPos * 32.0 + 3.0) * 0.0012 * lodMid + abs(snoise(vObjPos * 14.0 + 9.0)) * 0.0012
                  - pit * 0.0025
                  + bands * 0.0003 * bandAmt * lodMid
                  + gLichen * 0.0005;
          gRoughAdd = gLichen * 0.08 + pit * 0.05;
          col *= 1.0 - uWet * 0.08;
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(uRough + gRoughAdd - uWet * 0.25, 0.25, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = bumpNormal(-vViewPosition, normal, gHeight * 6.0, faceDirection);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uCaustic > 0.0) {
          float up = clamp(vWNormal.y * 0.8 + 0.2, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * causticPattern(vWPos) * uCaustic * up;
        }
        totalEmissiveRadiance += vec3(1.0, 0.8, 0.4) * uHighlight * 0.04;`);
  };
  mat.customProgramCacheKey = () => 'stone-' + typeKey;
  materialCache.set(typeKey, mat);
  return mat;
}

export function clearMaterialCache() {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
}
