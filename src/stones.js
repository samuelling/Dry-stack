// Procedural stone generation: six regional walling stones.
// Each stone is a star-shaped surface r(d): a superellipsoid intersected with
// bedding planes and random fracture planes, combined with a soft-min so the
// edges are as rounded as the rock type is weathered, plus surface noise.
// Physics uses a convex hull sampled from the same function.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
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

// ---------------------------------------------------------------------------
// Salvage-yard materials. Whole units are built from real dimensions with their real
// mass (not a stone's density), real-ish friction and restitution. Rubble-sized
// fill (hearting/pinning) uses the same radial shape pipeline as stone.
const SALVAGE_SHAPE = { h: 0.8, round: 0.04, p: 3.0, cuts: [4, 7], cutDepth: [0.62, 0.9], bed: 0, noise: 0.035, freq: 2.0, detail: 0.008, asym: 0.2, taper: 0.1 };
STONE_TYPES.brick = {
  key: 'brick', group: 'salvage', envKey: 'newengland',
  name: 'Red Clay Brick', region: 'Reclaimed · builders\' merchant',
  blurb: 'Fired clay, 215 × 102 × 65 mm and about 2.7 kg each. Dead uniform and grippy, but with nothing irregular to lock into. Dry, it stays up only if you break the joints, keep it square and make it thick. Brick bats stand in for hearting.',
  unit: { kind: 'brick' }, countScale: 1.8, layout: 0.7,
  shape: SALVAGE_SHAPE,
  variants: [
    { w: 4, a: 0x8c3a2a, b: 0xa9553c, speckle: 0.25, band: 0.0, rust: 0.1 },
    { w: 2, a: 0x7a3326, b: 0x9a4a35, speckle: 0.3, band: 0.0, rust: 0.15 },
    { w: 1, a: 0x3d4a5c, b: 0x56667c, speckle: 0.15, band: 0.0, rust: 0.05 },   // engineering blue
    { w: 1, a: 0xb89a5c, b: 0xd1b779, speckle: 0.2, band: 0.0, rust: 0.05 },   // London stock
  ],
  lichen: 0.05, roughness: 0.9, friction: 0.65, restitution: 0.05, density: 1900, bedFreq: 0, bedAmt: 0, pits: 0.12, grain: 0.8, sharpMix: 0.0,
  lichenTint: [0x8f9a74, 0xb0b59a, 0xc09040], copes: false, sound: 1.25,
};
STONE_TYPES.cinder = {
  key: 'cinder', group: 'salvage', envKey: 'newengland',
  name: 'Cinder Block', region: 'Hollow concrete masonry',
  blurb: 'Hollow concrete block, 390 × 190 × 190 mm, about 16 kg. Big and quick to lay and grippy, but a dry stack has only its own weight to hold it. The cores are for show here: stones rest on the rim, not inside.',
  unit: { kind: 'cinder' }, countScale: 0.9, layout: 1.0,
  shape: SALVAGE_SHAPE,
  variants: [
    { w: 3, a: 0x58585a, b: 0x727274, speckle: 0.2, band: 0.0, rust: 0.05 },
    { w: 2, a: 0x66665f, b: 0x7f7f76, speckle: 0.2, band: 0.0, rust: 0.04 },
    { w: 1, a: 0x4a4c4f, b: 0x626466, speckle: 0.2, band: 0.0, rust: 0.08 },
  ],
  lichen: 0.15, roughness: 0.95, friction: 0.7, restitution: 0.03, density: 1400, bedFreq: 0, bedAmt: 0, pits: 0.55, grain: 1.0, sharpMix: 0.0,
  lichenTint: [0x9fa38a, 0xbdbfae, 0xb59038], copes: false, sound: 0.75,
};
STONE_TYPES.sandbag = {
  key: 'sandbag', group: 'salvage', envKey: 'newengland',
  name: 'Sandbags', region: 'Flood duty · damp sand in woven sacks',
  blurb: 'About 20 kg of damp sand in a woven sack. Real bags slump into each other and lock. Here they are rigid pillows with plenty of grip, no bounce and heavy damping. They do not slump into each other the way real bags do, so keep the courses staggered and the stack low. Heavy, and no friend to your back.',
  unit: { kind: 'sandbag' }, countScale: 0.8, layout: 1.35,
  shape: SALVAGE_SHAPE,
  variants: [
    { w: 3, a: 0xa48d5e, b: 0xbba578, speckle: 0.25, band: 0.5, rust: 0.1 },    // burlap
    { w: 2, a: 0x6b6e48, b: 0x858a5c, speckle: 0.2, band: 0.5, rust: 0.05 },   // olive canvas
    { w: 1, a: 0xb7b3a4, b: 0xd0ccbd, speckle: 0.2, band: 0.5, rust: 0.12 },   // dirty poly
  ],
  lichen: 0.0, roughness: 1.0, friction: 0.9, restitution: 0.0, density: 1600, damp: [1.3, 2.6], bedFreq: 85, bedAmt: 0.5, pits: 0.0, grain: 0.2, sharpMix: 0.0,
  lichenTint: [0x8f9a74, 0xb0b59a, 0xc09040], copes: false, sound: 0.3,
};
STONE_TYPES.crt = {
  key: 'crt', group: 'salvage', envKey: 'newengland',
  name: 'CRT Monitors', region: 'E-waste · 15 to 19 inch',
  blurb: 'Cathode-ray tube monitors, around 16 kg each. Glass-heavy at the front and smooth plastic on plastic, which is not much grip. Rigid hulls, so they will tip and slide like the real thing. Nobody has ever built a good wall from these.',
  unit: { kind: 'crt' }, countScale: 0.6, layout: 1.3,
  shape: SALVAGE_SHAPE,
  variants: [
    { w: 3, a: 0x8f8974, b: 0x9d9782, speckle: 0.0, band: 0.0, rust: 0.0 },   // beige
    { w: 2, a: 0x5f6163, b: 0x6e7072, speckle: 0.0, band: 0.0, rust: 0.0 },   // grey
    { w: 1, a: 0x1c1d1f, b: 0x2a2b2d, speckle: 0.0, band: 0.0, rust: 0.0 },   // black
  ],
  lichen: 0.0, smooth: 1, roughness: 0.42, friction: 0.4, restitution: 0.12, density: 1100, bedFreq: 0, bedAmt: 0, pits: 0.0, grain: 0.05, sharpMix: 0.0,
  lichenTint: [0x8f9a74, 0xb0b59a, 0xc09040], copes: false, sound: 0.6,
};

STONE_TYPES.doll = {
  key: 'doll', group: 'salvage', envKey: 'newengland',
  name: 'Doll Heads', region: 'Attic, estate sale and flea market',
  blurb: 'Porcelain and vinyl doll heads, a hundred-odd grams each, with the odd mannequin among them. Smooth, round and slightly slippery, so they roll if given half a chance. Stand each one on its neck and keep the faces turned out. Whatever is built from them will watch you work.',
  unit: { kind: 'doll' }, countScale: 2.2, layout: 0.55,
  shape: SALVAGE_SHAPE,
  variants: [
    { w: 4, a: 0xc8a48d, b: 0x3a2412, speckle: 0.0, band: 0.0, rust: 0.0 },   // bisque, brown hair
    { w: 3, a: 0xcf9b86, b: 0xb08a4a, speckle: 0.0, band: 0.0, rust: 0.0 },   // pink vinyl, blond
    { w: 2, a: 0xb3a07d, b: 0x1c1410, speckle: 0.0, band: 0.0, rust: 0.0 },   // yellowed, black hair
    { w: 2, a: 0x8a5a3e, b: 0x140d09, speckle: 0.0, band: 0.0, rust: 0.0 },
    { w: 1, a: 0xb98466, b: 0x6e3a20, speckle: 0.0, band: 0.0, rust: 0.0 },
  ],
  lichen: 0.0, smooth: 1, face: 1, roughness: 0.32, friction: 0.5, restitution: 0.18, density: 1500, damp: [0.2, 1.1], bedFreq: 0, bedAmt: 0, pits: 0.0, grain: 0.05, sharpMix: 0.0,
  lichenTint: [0x8f9a74, 0xb0b59a, 0xc09040], copes: false, sound: 1.5,
};

// Size classes (meters): [length, width(into-wall depth), height] ranges before type scaling.
export const SIZE_CLASSES = {
  foundation: { L: [0.5, 0.72], W: [0.32, 0.46], H: [0.2, 0.3], detail: 22 },
  builder:    { L: [0.26, 0.46], W: [0.18, 0.3], H: [0.11, 0.2], detail: 16 },
  through:    { L: [0.68, 0.84], W: [0.2, 0.3], H: [0.1, 0.16], detail: 18 },
  cope:       { L: [0.36, 0.46], W: [0.24, 0.32], H: [0.08, 0.13], detail: 16 },
  hearting:   { L: [0.05, 0.12], W: [0.04, 0.09], H: [0.03, 0.07], detail: 5 },
  pinning:    { L: [0.06, 0.14], W: [0.04, 0.085], H: [0.012, 0.026], detail: 7 },
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
  const small = cls === 'hearting' || cls === 'pinning';
  const blocky = !small && charR < 0.3;
  const flat = !small && charR > 0.78;
  if (flat) H *= 0.68;
  if (cls === 'pinning') {
    H *= 0.75 + sh.h * 0.4;
  } else if (cls !== 'hearting') {
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
  let taperX = rand(rng, -1, 1) * (sh.taper || 0), taperZ = rand(rng, -1, 1) * (sh.taper || 0) * 0.6;
  if (cls === 'pinning') taperX = (rng() < 0.5 ? -1 : 1) * rand(rng, 0.5, 0.8); // a wedge
  const bedded = sh.bed > 0 && !small;
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
    if (i === 0 && !small) n = new THREE.Vector3(rand(rng, -0.2, 0.2), rand(rng, -0.15, 0.15), rng() < 0.5 ? 1 : -1).normalize();
    const sup = Math.sqrt((ex * n.x) ** 2 + (eyS * n.y) ** 2 + (ez * n.z) ** 2);
    planes.push({ n, h: sup * rand(rng, ...sh.cutDepth) });
  }
  const k = sh.round * (blocky ? 0.6 : 1) * Math.min(ex, ey, ez) * 2.0 + 0.0015;
  const seed = rng() * 100;
  const noiseAmp = sh.noise * (cls === 'hearting' ? 1.6 : cls === 'pinning' ? 0.6 : 1);
  const cuts = []; // fresh faces knocked off with the hammer: {n, h}
  const floorR = Math.min(ex, ey, ez) * 0.25;
  let lastFresh = 0;

  // polynomial smooth-min with a tight radius, for crisp fresh arrises
  const smin = (a, b, k2) => { const h = Math.max(k2 - Math.abs(a - b), 0) / k2; return Math.min(a, b) - h * h * k2 * 0.25; };

  function r(dx, dy, dz) {
    let rr = rWeathered(dx, dy, dz);
    lastFresh = 0;
    if (cuts.length) {
      let tc = Infinity;
      for (const c of cuts) {
        const nd = c.n.x * dx + c.n.y * dy + c.n.z * dz;
        if (nd > 1e-4) tc = Math.min(tc, c.h / nd);
      }
      if (tc < Infinity) {
        // dressed faces: flat, with the faint ripple of hammer blows
        tc *= 1 + 0.004 * N(dx * 14 + seed, dy * 14, dz * 14);
        const before = rr;
        rr = smin(rr, tc, 0.004);
        lastFresh = THREE.MathUtils.clamp((before - rr) / 0.002, 0, 1);
      }
    }
    return Math.max(rr, floorR);
  }

  function rWeathered(dx, dy, dz) {
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
    return rr;
  }
  return { r, rWeathered, cuts, fresh: () => lastFresh, L, W, H };
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
  if (type.unit && cls !== 'hearting' && cls !== 'pinning') return generateUnit(type, cls, rng);
  const shape = makeShape(type, cls, rng);
  const variant = pickVariant(type, rng);
  const ca = linear(variant.a), cb = linear(variant.b);
  const jit = 1 + (rng() - 0.5) * 0.18;
  const hueShift = (rng() - 0.5) * 0.05;
  ca.offsetHSL(hueShift, 0, 0).multiplyScalar(jit);
  cb.offsetHSL(hueShift, 0, 0).multiplyScalar(jit);
  const small = cls === 'hearting' || cls === 'pinning';
  const lich = type.lichen * rand(rng, 0.4, 1.3) * (small ? 0.4 : 1);
  const look = { ca, cb, sd: rng(), speckle: variant.speckle, rust: variant.rust, lich };
  const st = {
    density: type.density, restitution: type.restitution,
    shape, look, cls, type: typeKey, band: variant.band, cuts: 0,
    detail: perf.lite ? Math.max(4, Math.round(SIZE_CLASSES[cls].detail * 0.5)) : SIZE_CLASSES[cls].detail, hullDetail: small ? 1 : 3,
  };
  buildStoneGeometry(st);
  return st;
}

// ---------------------------------------------------------------------------
// Manufactured units
const clamp = THREE.MathUtils.clamp;

// A box with filleted edges, built face by face so every flat face is truly flat and the fillets get
// their own thin bands. tx/ty/tz are the vertex ticks along each axis (sorted, symmetric extremes
// at +-half size); `mod(pos, faceAxis)` may recess a vertex and/or return a colour override.
function ticksFor(half, r, extra = []) {
  const t = new Set([-half, half, -half + r, half - r, ...extra, ...extra.map((x) => -x)]);
  return [...t].filter((x) => x >= -half - 1e-9 && x <= half + 1e-9).sort((a, b) => a - b);
}

function roundedBoxFaces(half, r, ticks, mod) {
  const pos = [], nor = [], col = [];
  const hin = half.map((h) => h - r);
  const P = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
  const idx = [];
  const push = (v, extra) => {
    C.set(clamp(v.x, -hin[0], hin[0]), clamp(v.y, -hin[1], hin[1]), clamp(v.z, -hin[2], hin[2]));
    D.copy(v).sub(C);
    const len = D.length();
    if (len > 1e-9) D.multiplyScalar(1 / len);
    P.copy(C).addScaledVector(D, r);
    pos.push(P.x, P.y, P.z); nor.push(D.x, D.y, D.z);
    col.push(extra);
    return pos.length / 3 - 1;
  };
  for (let a = 0; a < 3; a++) {
    for (const sgn of [1, -1]) {
      const ua = (a + 1) % 3, va = (a + 2) % 3;
      const tu = ticks[ua], tv = ticks[va];
      const ids = [];
      for (let j = 0; j < tv.length; j++) {
        const row = [];
        for (let i = 0; i < tu.length; i++) {
          const v = new THREE.Vector3();
          v.setComponent(a, sgn * half[a]); v.setComponent(ua, tu[i]); v.setComponent(va, tv[j]);
          row.push(push(v, mod ? mod(v, a, sgn) : null));
        }
        ids.push(row);
      }
      for (let j = 0; j < tv.length - 1; j++) for (let i = 0; i < tu.length - 1; i++) {
        const a0 = ids[j][i], b0 = ids[j][i + 1], c0 = ids[j + 1][i + 1], d0 = ids[j + 1][i];
        if (sgn > 0) idx.push(a0, b0, c0, a0, c0, d0); else idx.push(a0, c0, b0, a0, d0, c0);
      }
    }
  }
  return { pos, nor, col, idx };
}

function finishUnit(st, built, look, opts = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(built.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(built.nor, 3));
  geo.setIndex(built.idx);
  lookAttributes(geo, look, new Float32Array(built.pos.length / 3));
  if (built.recolor) built.recolor(geo);
  geo.userData.band = st.band;
  const pos = geo.attributes.position, v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const seen = new Set(), hp = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    min.min(v); max.max(v);
    const key = `${Math.round(v.x * 4000)},${Math.round(v.y * 4000)},${Math.round(v.z * 4000)}`;
    if (!seen.has(key)) { seen.add(key); if (!opts.skipHull || opts.skipHull(v)) hp.push(v.x, v.y, v.z); }
  }
  geo.computeBoundingSphere();
  st.geometry = geo;
  st.hullPoints = new Float32Array(hp);
  st.size = new THREE.Vector3().subVectors(max, min);
  st.min = min; st.max = max;
  return st;
}

function unitBase(type, cls, rng, label, mass) {
  const variant = pickVariant(type, rng);
  const ca = linear(variant.a), cb = linear(variant.b);
  const jit = 1 + (rng() - 0.5) * 0.14, hueShift = (rng() - 0.5) * 0.03;
  ca.offsetHSL(hueShift, 0, 0).multiplyScalar(jit); cb.offsetHSL(hueShift, 0, 0).multiplyScalar(jit);
  const look = { ca, cb, sd: rng(), speckle: variant.speckle, rust: variant.rust, lich: type.lichen * rand(rng, 0.3, 1.2) };
  return {
    look, cls, type: type.key, band: variant.band, cuts: 0, shape: { cuts: [] }, noDress: true,
    label, massKg: mass, density: type.density, restitution: type.restitution, damp: type.damp,
    detail: 4, hullDetail: 1,
  };
}

function generateUnit(type, cls, rng) {
  switch (type.unit.kind) {
    case 'brick': return makeBrick(type, cls, rng);
    case 'cinder': return makeCinder(type, cls, rng);
    case 'sandbag': return makeSandbag(type, cls, rng);
    case 'crt': return makeCRT(type, cls, rng);
    case 'doll': return makeDoll(type, cls, rng);
  }
}

function makeBrick(type, cls, rng) {
  const bat = rng() < 0.18;
  const L = bat ? 0.1075 : 0.215, H = 0.065, W = 0.1025;
  const mass = 1900 * L * H * W * rand(rng, 0.97, 1.03);
  const st = unitBase(type, cls, rng, bat ? 'Half brick' : 'Brick', mass);
  const r = 0.0025;
  const half = [L / 2, H / 2, W / 2];
  const ticks = [ticksFor(half[0], r), ticksFor(half[1], r), ticksFor(half[2], r)];
  return finishUnit(st, roundedBoxFaces(half, r, ticks), st.look);
}

// Hollow block: filleted box for the outside, with two cores drawn as real recesses in the faces.
function makeCinder(type, cls, rng) {
  const half = rng() < 0.2;
  const L = half ? 0.19 : 0.397, H = 0.194, W = 0.194;
  const mass = (half ? 8.2 : 16) * rand(rng, 0.96, 1.04);
  const st = unitBase(type, cls, rng, half ? 'Half block' : 'Cinder block', mass);
  // outline with core holes, extruded along y
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, -W / 2); shape.lineTo(L / 2, -W / 2); shape.lineTo(L / 2, W / 2); shape.lineTo(-L / 2, W / 2); shape.closePath();
  const cw = 0.082, ch = 0.1, web = 0.03;
  const cores = half ? [0] : [-1, 1];
  for (const k of cores) {
    const cx = half ? 0 : k * 0.095;
    const hw = half ? 0.05 : 0.06, hd = ch / 2;
    const hole = new THREE.Path();
    hole.moveTo(cx - hw, -hd); hole.lineTo(cx - hw, hd); hole.lineTo(cx + hw, hd); hole.lineTo(cx + hw, -hd); hole.closePath();
    shape.holes.push(hole);
  }
  let g = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);          // extrusion (z) -> up (y)
  g.translate(0, -H / 2, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const built = { pos: Array.from(pos.array), nor: Array.from(g.attributes.normal.array), idx: [...Array(pos.count).keys()] };
  // hull from the outer shell only: skip the core walls
  const hx = L / 2 + 0.003, hz = W / 2 + 0.003;
  return finishUnit(st, built, st.look, { skipHull: (v) => Math.abs(v.x) > hx - 0.008 || Math.abs(v.z) > hz - 0.008 });
}

// A pillow: superellipsoid, gathered at the ends and flat underneath.
function makeSandbag(type, cls, rng) {
  const L = rand(rng, 0.52, 0.64), W = rand(rng, 0.3, 0.38), H = rand(rng, 0.11, 0.15);
  const ex = L / 2, ey = H / 2, ez = W / 2, p = 2.5, seed = rng() * 100;
  const volume = L * W * H * 0.5;
  const mass = type.density * volume * rand(rng, 0.92, 1.08);
  const st = unitBase(type, cls, rng, 'Sandbag', mass);
  const rr = (dx, dy, dz, eyd) => Math.pow(Math.pow(Math.abs(dx / ex), p) + Math.pow(Math.abs(dy / eyd), p) + Math.pow(Math.abs(dz / ez), p), -1 / p);
  st.shape = {
    cuts: [], fresh: () => 0,
    r(dx, dy, dz) {
      let r0 = rr(dx, dy, dz, ey);
      const xr = (dx * r0) / ex, zr = (dz * r0) / ez;
      const eyd = ey * (1 - 0.5 * xr * xr * (0.8 + 0.2 * Math.abs(zr)));   // ends gathered
      r0 = rr(dx, dy, dz, eyd);
      if (dy < -1e-4) r0 = Math.min(r0, (0.86 * eyd) / -dy);               // settled flat on the ground
      if (dy > 1e-4) r0 = Math.min(r0, (0.9 * eyd) / dy);                   // and a flattened top
      return r0 * (1 + 0.05 * N(dx * 2.2 + seed, dy * 2.2, dz * 2.2)) + 0.0;
    },
  };
  st.detail = perf.lite ? 8 : 14; st.hullDetail = 3;
  buildStoneGeometry(st);
  return st;
}

// CRT: a bezel box with a recessed dark glass face, and a tapering tube behind it.
function makeCRT(type, cls, rng) {
  const s = [0.9, 1.0, 1.1][Math.floor(rng() * 3)];              // 15", 17", 19"
  const W = 0.4 * s, H = 0.385 * s, D1 = 0.17 * s, D2 = 0.22 * s;  // front bezel box, rear tube
  const mass = 16 * s ** 3 * rand(rng, 0.95, 1.05);
  const st = unitBase(type, cls, rng, `CRT monitor (${Math.round(17 * s)}")`, mass);
  const r = 0.008 * s;
  const sw = 0.165 * s, sh = 0.13 * s, step = 0.004;
  const zf = D1 / 2;
  // front box centred at z=0, tube behind it at -z
  const half = [W / 2, H / 2, D1 / 2];
  const ticks = [
    ticksFor(half[0], r, [sw, sw + 0.003 * s]),
    ticksFor(half[1], r, [sh, sh + 0.003 * s]),
    ticksFor(half[2], r),
  ];
  const screen = (v, a, sgn) => a === 2 && sgn > 0 && Math.abs(v.x) <= sw + 1e-6 && Math.abs(v.y) <= sh + 1e-6;
  const built = roundedBoxFaces(half, r, ticks, (v, a, sgn) => screen(v, a, sgn) ? { dz: -step, col: 'glass' } : null);
  // apply recess + colours
  const screenIdx = [];
  for (let i = 0; i < built.col.length; i++) if (built.col[i] && built.col[i].col === 'glass') { built.pos[i * 3 + 2] += -step; screenIdx.push(i); }
  built.recolor = (geo) => {
    const A = geo.attributes.aColA, B = geo.attributes.aColB, S = geo.attributes.aStone;
    for (const i of screenIdx) { A.setXYZ(i, 0.006, 0.008, 0.007); B.setXYZ(i, 0.012, 0.015, 0.013); S.setXYZ(i, 0.5, 0, 0, 0); }
  };
  // rear case: boxy and flush with the bezel on top and bottom for half its depth, then tapering to the neck
  const rear = (() => {
    const wA = W * 0.92, yb = -H / 2 + 0.0005, yt = H / 2 - 0.002, wB = W * 0.45, hB = H * 0.5;
    const z0 = -D1 / 2, z1 = z0 - D2 * 0.5, z2 = z0 - D2;
    const ring = (w, top, z) => [[-w / 2, yb, z], [w / 2, yb, z], [w / 2, top, z], [-w / 2, top, z]];
    const v = [...ring(wA, yt, z0), ...ring(wA, yt, z1), ...ring(wB, yb + hB, z2)];
    const faces = [[4, 5, 1, 0], [5, 6, 2, 1], [6, 7, 3, 2], [7, 4, 0, 3], [8, 9, 5, 4], [9, 10, 6, 5], [10, 11, 7, 6], [11, 8, 4, 7], [11, 10, 9, 8]];
    return { v, faces };
  })();
  const nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const f of rear.faces) {
    const q = f.map((i) => new THREE.Vector3(...rear.v[i]));
    e1.subVectors(q[1], q[0]); e2.subVectors(q[3], q[0]); nrm.crossVectors(e1, e2).normalize();
    const flip = nrm.dot(new THREE.Vector3(q[0].x, q[0].y, q[0].z - (-D1 / 2 - D2 / 2))) < 0;
    const base = built.pos.length / 3;
    for (const p of q) { built.pos.push(p.x, p.y, p.z); const n = flip ? nrm.clone().negate() : nrm; built.nor.push(n.x, n.y, n.z); built.col.push(null); }
    if (!flip) built.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else built.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  // centre on the centre of mass: front box (heavy glass) and tube by volume
  const vf = W * H * D1 * 1.6, vt = D2 * W * 0.92 * H * 0.5 * 0.45 * 0.8;
  const cz = (vt * (-D1 / 2 - D2 * 0.4)) / (vf + vt);
  for (let i = 2; i < built.pos.length; i += 3) built.pos[i] -= cz;
  // yaw so the screen faces +z, with the monitor sitting on its base
  return finishUnit(st, built, st.look);
}

// Doll head: an egg-shaped skull with a nose and a short neck cut flat, so it can stand upright.
// The face (eyes, brows, lips, hair) is painted in the shader from the object-space position.
function makeDoll(type, cls, rng) {
  const mannequin = rng() < 0.07;
  const sc = mannequin ? rand(rng, 1.7, 1.95) : rand(rng, 0.88, 1.28);
  const mass = (mannequin ? 0.22 : 0.2) * sc ** 3 * rand(rng, 0.9, 1.1);
  const st = unitBase(type, cls, rng, mannequin ? 'Mannequin head' : 'Doll head', mass);
  st.look.speckle = sc;                       // the shader reads the head scale from here
  const ax = 0.052, ay = 0.062, az = 0.058, seed = rng() * 100;
  const neckR = 0.023, neckY = 0.082;
  st.shape = {
    cuts: [], fresh: () => 0,
    r(dx, dy, dz) {
      const q = (ex, ey, ez) => Math.pow(dx * dx / (ex * ex) + dy * dy / (ey * ey) + dz * dz / (ez * ez), -0.5);
      let r0 = q(ax, ay, az);
      const yn = Math.max(0, -dy * r0 / ay);
      r0 = q(ax * (1 - 0.3 * yn), ay, az * (1 - 0.12 * yn));                  // jaw narrows toward the chin
      if (dz > 0) r0 *= 1 + 0.07 * Math.exp(-((dx * r0 / 0.011) ** 2 + ((dy * r0 + 0.006) / 0.016) ** 2)) * Math.min(1, dz * 2);   // nose
      if (dy < -0.25) {
        const hxz = Math.hypot(dx, dz);
        const rn = Math.min(neckR / Math.max(hxz, 1e-4), neckY / -dy);       // short neck, flat at the bottom
        r0 = Math.max(r0, rn);
      }
      return r0 * sc * (1 + 0.006 * N(dx * 3 + seed, dy * 3, dz * 3));
    },
  };
  st.detail = perf.lite ? 9 : 16; st.hullDetail = 3;
  buildStoneGeometry(st);
  return st;
}

function lookAttributes(geo, look, freshArr) {
  const n = geo.attributes.position.count;
  const aColA = new Float32Array(n * 3), aColB = new Float32Array(n * 3), aStone = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    aColA[i * 3] = look.ca.r; aColA[i * 3 + 1] = look.ca.g; aColA[i * 3 + 2] = look.ca.b;
    aColB[i * 3] = look.cb.r; aColB[i * 3 + 1] = look.cb.g; aColB[i * 3 + 2] = look.cb.b;
    aStone[i * 4] = look.sd; aStone[i * 4 + 1] = look.speckle; aStone[i * 4 + 2] = look.rust; aStone[i * 4 + 3] = look.lich;
  }
  geo.setAttribute('aColA', new THREE.BufferAttribute(aColA, 3));
  geo.setAttribute('aColB', new THREE.BufferAttribute(aColB, 3));
  geo.setAttribute('aStone', new THREE.BufferAttribute(aStone, 4));
  geo.setAttribute('aFresh', new THREE.BufferAttribute(freshArr || new Float32Array(n), 1));
}

// (Re)build render mesh + physics hull from the stone's shape function.
export function buildStoneGeometry(st) {
  const { shape } = st;
  const geo = unitSphere(st.detail).clone();
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const fresh = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const rr = shape.r(v.x, v.y, v.z);
    fresh[i] = shape.fresh();
    v.multiplyScalar(rr);
    pos.setXYZ(i, v.x, v.y, v.z);
    min.min(v); max.max(v);
  }
  geo.computeVertexNormals();
  lookAttributes(geo, st.look, fresh);
  geo.userData.band = st.band;
  // physics hull: coarse sampling of the same surface, plus extra samples on fresh faces
  const hullBase = unitSphere(st.hullDetail);
  const pts = [];
  for (let i = 0; i < hullBase.attributes.position.count; i++) {
    v.fromBufferAttribute(hullBase.attributes.position, i).normalize();
    v.multiplyScalar(shape.r(v.x, v.y, v.z));
    pts.push(v.x, v.y, v.z);
  }
  for (const c of shape.cuts) {
    // corners of the dressed face so the hull keeps it flat
    for (let i = 0; i < pos.count; i += 7) if (fresh[i] > 0.9) pts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    break;
  }
  if (st.geometry) st.geometry.dispose();
  st.geometry = geo;
  st.hullPoints = new Float32Array(pts);
  st.size = new THREE.Vector3().subVectors(max, min);
  st.min = min; st.max = max;
  geo.computeBoundingSphere();
  return st;
}

// Fraction of the stone's volume beyond a plane. Mesh vertices sit at roughly
// even solid angles, so each stands for a cone of volume ∝ r³.
export function cutFraction(st, n, h) {
  const pos = st.geometry.attributes.position;
  let tot = 0, cut = 0;
  for (let i = 0; i < pos.count; i += 2) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.hypot(x, y, z);
    const r3 = r * r * r;
    tot += r3;
    const nd = (n.x * x + n.y * y + n.z * z) / r;
    if (nd > 1e-4) {
      const tc = h / nd;
      if (tc < r) cut += r3 - Math.max(0, tc) ** 3;
    }
  }
  return tot ? cut / tot : 0;
}

// Knock a piece off with the hammer. Plane in stone-local space: points with
// n·p > h are removed. Returns the flake as a new stone-like object (or null
// for dust), with its geometry centred on its own centroid.
export function dressStone(st, n, h) {
  const old = st.geometry.attributes.position;
  const v = new THREE.Vector3();
  let beyond = 0;
  const flakePts = [];
  for (let i = 0; i < old.count; i++) {
    v.fromBufferAttribute(old, i);
    const d = v.dot(n) - h;
    if (d > 0) { beyond++; flakePts.push(v.clone(), v.clone().addScaledVector(n, -d)); }
  }
  const frac = cutFraction(st, n, h);
  if (beyond === 0) return { removed: 0 };
  if (frac > 0.42) return { refused: true, frac };
  st.shape.cuts.push({ n: n.clone(), h });
  st.cuts++;
  buildStoneGeometry(st);
  // flake
  if (flakePts.length < 12) return { removed: frac, flake: null };
  const fmin = new THREE.Vector3(Infinity, Infinity, Infinity), fmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of flakePts) { fmin.min(p); fmax.max(p); }
  const fsize = new THREE.Vector3().subVectors(fmax, fmin);
  if (Math.max(fsize.x, fsize.y, fsize.z) < 0.022) return { removed: frac, flake: null, dust: true };
  let geo;
  try { geo = new ConvexGeometry(flakePts); } catch (e) { return { removed: frac, flake: null, dust: true }; }
  geo.deleteAttribute('uv');
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  // centroid of the points (good enough as an origin)
  for (const p of flakePts) c.add(p);
  c.divideScalar(flakePts.length);
  geo.translate(-c.x, -c.y, -c.z);
  const fp = geo.attributes.position;
  const fresh = new Float32Array(fp.count);
  const hc = h - c.dot(n);
  for (let i = 0; i < fp.count; i++) { v.fromBufferAttribute(fp, i); fresh[i] = Math.abs(v.dot(n) - hc) < 0.0015 ? 1 : 0.15; }
  lookAttributes(geo, { ...st.look, lich: st.look.lich * 0.6 }, fresh);
  geo.computeBoundingSphere();
  // hull points (subsample)
  const hp = [];
  const step = Math.max(1, Math.floor(fp.count / 90));
  for (let i = 0; i < fp.count; i += step) hp.push(fp.getX(i), fp.getY(i), fp.getZ(i));
  const lmin = fmin.clone().sub(c), lmax = fmax.clone().sub(c);
  const flake = {
    geometry: geo, hullPoints: new Float32Array(hp), size: fsize, min: lmin, max: lmax,
    cls: 'shard', type: st.type, band: st.band, look: st.look, centroid: c, shape: null, density: st.density, restitution: st.restitution,
  };
  return { removed: frac, flake };
}

// ---------------------------------------------------------------------------
// Material: procedural rock shading in object space, so the texture sticks to
// each stone as it tumbles.

const materialCache = new Map();
export const perf = { lite: false };

export const sharedUniforms = {
  uTime: { value: 0 },
  uCaustic: { value: 0 },
  uWet: { value: 0 },
};


// Painted doll face, in head units (about 0.1 m across), looking along +z.
const FACE_GLSL = `
  vec3 faceColor(vec3 p, vec3 skin, vec3 hair, float sc, float seed, vec3 base) {
    vec3 q = p / max(sc, 0.2);
    vec3 col = skin;
    float fz = smoothstep(0.0, 0.018, q.z);
    float hairLine = 0.031 + 2.2 * q.x * q.x;
    float hairAmt = max(smoothstep(-0.002, 0.003, q.y - hairLine), smoothstep(0.003, -0.002, q.z) * step(-0.058, q.y));
    float face = fz * (1.0 - hairAmt);
    vec3 irisCol = fract(seed * 5.17) < 0.34 ? vec3(0.03, 0.09, 0.35) : (fract(seed * 5.17) < 0.67 ? vec3(0.07, 0.035, 0.012) : vec3(0.04, 0.17, 0.06));
    float missing = step(0.92, fract(seed * 7.31)), side = step(0.5, fract(seed * 3.7)) * 2.0 - 1.0;
    for (int k = 0; k < 2; k++) {
      float sx = k == 0 ? -1.0 : 1.0;
      vec2 d = vec2(q.x - sx * 0.021, q.y - 0.010);
      float r = length(d);
      float gone = missing * step(0.0, sx * side);
      col = mix(col, vec3(0.75, 0.72, 0.68), smoothstep(0.0076, 0.0068, r) * face);
      col = mix(col, irisCol, smoothstep(0.0046, 0.004, r) * face);
      col = mix(col, vec3(0.004), smoothstep(0.0023, 0.0019, r) * face);
      col = mix(col, vec3(0.004), smoothstep(0.0078, 0.0068, r) * face * gone);
      col = mix(col, vec3(0.03, 0.015, 0.01), smoothstep(0.0007, 0.0002, abs(r - 0.0081)) * step(-0.002, d.y) * face);
      // brow
      float bx = q.x - sx * 0.021;
      float by = q.y - (0.0275 + 0.25 * bx * sx * 0.0 - 0.9 * bx * bx);
      col = mix(col, hair * 0.7, smoothstep(0.0016, 0.0009, abs(by)) * smoothstep(0.011, 0.009, abs(bx)) * face);
      // cheek blush
      float cr = length(vec2(q.x - sx * 0.031, q.y + 0.014));
      col = mix(col, vec3(0.5, 0.16, 0.15), smoothstep(0.014, 0.0, cr) * 0.38 * face);
    }
    // lips
    vec2 lp = vec2(q.x / 0.0135, (q.y + 0.0285 + 0.9 * q.x * q.x) / 0.0042);
    col = mix(col, vec3(0.42, 0.035, 0.05), smoothstep(1.0, 0.82, length(lp)) * face);
    col = mix(col, vec3(0.25, 0.01, 0.02), smoothstep(0.06, 0.02, abs(lp.y)) * smoothstep(1.0, 0.8, abs(lp.x)) * face);
    // nostrils
    col = mix(col, col * 0.55, smoothstep(0.0022, 0.0012, length(vec2(abs(q.x) - 0.0055, q.y + 0.0105))) * face);
    // hair, with a little strand variation
    float strands = 0.8 + 0.35 * snoise(vec3(q.x * 90.0, q.y * 18.0, q.z * 90.0));
    col = mix(col, hair * strands, hairAmt);
    return col;
  }`;

// Cheap stone shading for phones: two noise lookups, no bump, no fine grain.
const LITE_COLOR = `#include <color_fragment>
  {
    float seed = vStone.x;
    float fresh = clamp(vFresh, 0.0, 1.0);
    float speck = vStone.y, rust = vStone.z * (1.0 - fresh), lich = clamp(vStone.w, 0.0, 1.0) * (1.0 - fresh);
    vec3 p = vObjPos * 6.0 + seed * 37.0;
    float n1 = fbm3(p * 0.55);
    vec3 col = mix(vColA, vColB, smoothstep(-0.45, 0.5, n1));
    col *= 1.0 + sin(vObjPos.y * uBedFreq * 6.2831 + n1 * 4.0) * 0.05 * max(uBedAmt, 0.0);
    float ln = snoise(p * 3.2 + seed * 50.0) * 0.6 + snoise(p * 9.0 + seed) * 0.3;
    float thr = mix(0.62, 0.22, lich);
    float lm = smoothstep(thr, thr + 0.18, ln);
    col = mix(col, mix(uLichA, uLichB, 0.5 + 0.5 * n1) * 0.9, lm * 0.5);
    col *= 0.94 + 0.1 * snoise(vObjPos * 40.0);
    col = mix(col, col * vec3(1.2, 0.85, 0.62), smoothstep(0.1, 0.7, n1) * rust * 0.6);
    vec3 freshCol = mix(vColB, vec3(dot(vColB, vec3(0.333))), 0.25) * 1.18;
    col = mix(col, freshCol, fresh * 0.85);
    col = mix(col, mix(vColA, vColB, 0.5) * (0.97 + 0.06 * n1), uSmooth);
    if (uFace > 0.5) col = faceColor(vObjPos, vColA, vColB, vStone.y, vStone.x, col);
    gLichen = lm * (1.0 - uSmooth); gHeight = 0.0; gRoughAdd = lm * 0.08 + fresh * 0.05;
    gCutLine = 0.0;
    if (uCutOn > 0.5) {
      float sd = dot(uCut.xyz, vObjPos) - uCut.w;
      if (sd > 0.0) col = mix(col, vec3(0.95, 0.55, 0.28), 0.42);
      gCutLine = 1.0 - smoothstep(0.0, 0.0022, abs(sd));
    }
    diffuseColor.rgb = col;
  }`;

export function getStoneMaterial(typeKey) {
  if (materialCache.has(typeKey)) return materialCache.get(typeKey);
  const mat = makeStoneMaterial(typeKey);
  materialCache.set(typeKey, mat);
  return mat;
}

// A separate instance (same compiled program) with its own uniforms — used to
// show the hammer's cut on just one stone.
export function makeStoneMaterial(typeKey) {
  const t = STONE_TYPES[typeKey];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: t.roughness, metalness: 0.0 });
  const lt = t.lichenTint.map((h) => new THREE.Color(h));
  const uniforms = {
    uBedFreq: { value: t.bedFreq },
    uBedAmt: { value: t.bedAmt },
    uPits: { value: t.pits },
    uGrain: { value: t.grain },
    uSmooth: { value: t.smooth ?? 0 },
    uFace: { value: t.face ?? 0 },
    uSharpMix: { value: t.sharpMix },
    uLichA: { value: lt[0] }, uLichB: { value: lt[1] }, uLichC: { value: lt[2] },
    uRough: { value: t.roughness },
    uHighlight: { value: 0 },
    uCut: { value: new THREE.Vector4(0, 1, 0, 1) },
    uCutOn: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aColA; attribute vec3 aColB; attribute vec4 aStone; attribute float aFresh; attribute float aFit;
        varying vec3 vObjPos; varying vec3 vColA; varying vec3 vColB; varying vec4 vStone;
        varying vec3 vWPos; varying vec3 vWNormal; varying float vFresh; varying float vFit;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObjPos = position; vColA = aColA; vColB = aColB; vStone = aStone; vFresh = aFresh; vFit = aFit;`)
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
        ${FACE_GLSL}
        ${BUMP_GLSL}
        ${CAUSTIC_GLSL}
        uniform float uSmooth, uFace; uniform float uBedFreq, uBedAmt, uPits, uGrain, uSharpMix, uRough, uHighlight, uWet;
        uniform vec3 uLichA, uLichB, uLichC;
        uniform vec4 uCut; uniform float uCutOn;
        varying vec3 vObjPos; varying vec3 vColA; varying vec3 vColB; varying vec4 vStone;
        varying vec3 vWPos; varying vec3 vWNormal; varying float vFresh; varying float vFit;
        float gHeight; float gLichen; float gRoughAdd; float gCutLine;`)
      .replace('#include <color_fragment>', perf.lite ? LITE_COLOR : `#include <color_fragment>
        {
          vec3 p = vObjPos * 6.0 + vStone.x * 37.0;
          float seed = vStone.x;
          float fresh = clamp(vFresh, 0.0, 1.0);
          float speck = vStone.y, rust = vStone.z * (1.0 - fresh), lich = clamp(vStone.w, 0.0, 1.0) * (1.0 - fresh);
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
          col *= mix(0.84 + 0.16 * smoothstep(-0.5, 0.3, cav), 1.0, fresh);
          // freshly dressed face: the unweathered heart of the stone, lighter and cleaner
          vec3 freshCol = mix(vColB, vec3(dot(vColB, vec3(0.333))), 0.25) * 1.18 * (0.95 + 0.1 * snoise(vObjPos * 40.0));
          col = mix(col, freshCol * (0.9 + 0.2 * mixT), fresh * 0.85);
          // height for bump
          gHeight = fbm5(p * 1.3) * 0.0028
                  + snoise(vObjPos * 90.0) * 0.00028 * (0.5 + uGrain) * lodHi
                  + snoise(vObjPos * 32.0 + 3.0) * 0.00035 * lodMid + abs(snoise(vObjPos * 14.0 + 9.0)) * 0.0006
                  - pit * 0.0025
                  + bands * 0.0003 * bandAmt * lodMid
                  + gLichen * 0.0005
                  + fresh * abs(snoise(vObjPos * 55.0 + 4.0)) * 0.0007 * lodMid;
          gRoughAdd = gLichen * 0.08 + pit * 0.05 + fresh * 0.05;
          // moulded or painted units: clean, even colour with no stone texture
          col = mix(col, mix(vColA, vColB, 0.5) * (0.97 + 0.06 * n1), uSmooth);
          if (uFace > 0.5) col = faceColor(vObjPos, vColA, vColB, vStone.y, vStone.x, col);
          gHeight *= 1.0 - uSmooth; gLichen *= 1.0 - uSmooth;
          // hammer cut preview
          gCutLine = 0.0;
          if (uCutOn > 0.5) {
            float sd = dot(uCut.xyz, vObjPos) - uCut.w;
            if (sd > 0.0) col = mix(col, vec3(0.95, 0.55, 0.28), 0.42);
            gCutLine = 1.0 - smoothstep(0.0, 0.0022, abs(sd));
          }
          col *= 1.0 - uWet * 0.08;
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(uRough + gRoughAdd - uWet * 0.25, 0.25, 1.0);`)
      .replace('#include <normal_fragment_maps>', perf.lite ? '#include <normal_fragment_maps>' : `#include <normal_fragment_maps>
        normal = bumpNormal(-vViewPosition, normal, gHeight * 6.0, faceDirection);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uCaustic > 0.0) {
          float up = clamp(vWNormal.y * 0.8 + 0.2, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * causticPattern(vWPos) * uCaustic * up;
        }
        totalEmissiveRadiance += vec3(1.0, 0.8, 0.4) * uHighlight * 0.04;
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.4) * gCutLine * 1.6;
        // fit light: where the held stone will bear (green) and where it gaps (amber)
        totalEmissiveRadiance += vec3(0.35, 0.95, 0.45) * max(vFit, 0.0) * 0.55 + vec3(1.0, 0.55, 0.18) * max(-vFit, 0.0) * 0.4;`);
  };
  mat.customProgramCacheKey = () => 'stone-' + typeKey + (perf.lite ? '-lite' : '');
  return mat;
}

export function clearMaterialCache() {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
}
