// Rolling countryside — the landscape adapts to the region the stone comes from.
import * as THREE from 'three';
import { makeNoise3, fbm3, mulberry32, rand, smoothstep } from '../noise.js';
import { buildTerrainGeometry } from '../terrain.js';
import { makeGroundMaterial } from '../ground.js';
import { createGrass } from '../grass.js';
import { makeTreeTemplate, makeLeafMaterial, makeBarkMaterial, instanceTrees } from '../trees.js';
import { buildOldWalls } from '../oldwalls.js';
import { trenchOffset } from '../wall.js';
import { NOISE_GLSL } from '../glsl.js';

const N = makeNoise3(2024);

const hexes = (arr) => arr.map((h) => new THREE.Color(h));

export const REGIONS = {
  newengland: {
    title: 'Upland pasture, Worcester County', hill: 26, mountain: 0, sea: false,
    ground: { grassA: 0x5d6a2c, grassB: 0x9a8a4c, grassC: 0x3e4a20, soil: 0x3b2c20 },
    blades: hexes([0x5f7030, 0x8a8a42, 0xa39556, 0x6b7a35, 0x7d6f3a]),
    leaves: [[0xb3301b, 3], [0xd2601c, 3], [0xdba426, 3], [0x7a7a2a, 2], [0x8e5527, 2]],
    pines: 0.25, birches: 0.15, trees: 1.0, forest: 1.0, highCol: 0x6b5a3a, highStart: 999, rockAmt: 0,
    fog: 0.0021, turbidity: 6, clouds: 0.38,
  },
  pennsylvania: {
    title: 'Farm fields, Bucks County', hill: 18, mountain: 0, sea: false,
    ground: { grassA: 0x63702f, grassB: 0xa0904e, grassC: 0x46521f, soil: 0x4a3322 },
    blades: hexes([0x667634, 0x93904a, 0xa6995a, 0x707c36]),
    leaves: [[0xc9921f, 3], [0xb3541c, 2], [0x8a4f26, 2], [0x8a8a2c, 2], [0xa63320, 1]],
    pines: 0.1, birches: 0.05, trees: 0.8, forest: 0.7, highCol: 0x6b5a3a, highStart: 999, rockAmt: 0,
    fog: 0.0022, turbidity: 7, clouds: 0.42,
  },
  cotswold: {
    title: 'Sheep pasture above Bibury', hill: 20, mountain: 0, sea: false,
    ground: { grassA: 0x4f7428, grassB: 0x7e8a3c, grassC: 0x3a5a1e, soil: 0x5a4430 },
    blades: hexes([0x4f7a2a, 0x5f8a32, 0x6f8a38, 0x86904a]),
    leaves: [[0x55692a, 4], [0x6e7a2c, 3], [0x9c8f2e, 2], [0xb07a2a, 1]],
    pines: 0.05, birches: 0.0, trees: 0.6, forest: 0.45, highCol: 0x6b5a3a, highStart: 999, rockAmt: 0,
    fog: 0.0026, turbidity: 4.5, clouds: 0.5,
  },
  welsh: {
    title: 'Hill farm below Yr Wyddfa', hill: 40, mountain: 220, sea: false,
    ground: { grassA: 0x4d6e2a, grassB: 0x7a7a40, grassC: 0x37521f, soil: 0x3a2f26 },
    blades: hexes([0x4c7428, 0x5b7c30, 0x7a7c40, 0x8a6a38]),
    leaves: [[0x4f6526, 3], [0x7a7a2c, 2], [0x9c6a2a, 1]],
    pines: 0.3, birches: 0.1, trees: 0.25, forest: 0.15, highCol: 0x8a5a33, highStart: 12, rockAmt: 0,
    fog: 0.0019, turbidity: 3.5, clouds: 0.58,
  },
  yorkshire: {
    title: 'Dale side, Swaledale', hill: 40, mountain: 110, sea: false,
    ground: { grassA: 0x4f6f2a, grassB: 0x7d7d42, grassC: 0x3a541f, soil: 0x3b2d22 },
    blades: hexes([0x4f7429, 0x5f7a30, 0x7b7c42, 0x8c7a44]),
    leaves: [[0x55682a, 3], [0x7c7a2c, 2], [0xa0822e, 1]],
    pines: 0.0, birches: 0.05, trees: 0.25, forest: 0.1, highCol: 0x5e4040, highStart: 9, rockAmt: 0,
    fog: 0.0021, turbidity: 4, clouds: 0.55,
  },
  aran: {
    title: 'Small fields on Inis Mór', hill: 6, mountain: 0, sea: true,
    ground: { grassA: 0x557a2e, grassB: 0x8a8f50, grassC: 0x3f5d22, soil: 0x40352a, rockCol: 0x9fa19c },
    blades: hexes([0x557d2f, 0x678a36, 0x8a9050, 0x7d8a48]),
    leaves: [[0x4f6526, 1]],
    pines: 0, birches: 0, trees: 0.05, forest: 0.0, highCol: 0x6b5a3a, highStart: 999, rockAmt: 0.55,
    fog: 0.0016, turbidity: 3, clouds: 0.5,
  },
};

const Q = { lite: { grass: 7000, trees: 36, wall: 1100 }, high: { grass: 170000, trees: 420, wall: 7500 }, medium: { grass: 70000, trees: 230, wall: 4500 }, low: { grass: 25000, trees: 100, wall: 2500 } };

export class Countryside {
  constructor(ctx) {
    this.ctx = ctx;
    this.region = REGIONS[ctx.typeKey];
    this.name = this.region.title;
    this.audio = 'field';
    this.underwater = false;
    this.spec = ctx.spec;
    const R = this.region;
    this.baseHeight = (x, z) => {
      const r = Math.hypot(x, z);
      let h = 0.035 * x + 0.22 * fbm3(N, x / 22, 0.5, z / 22, 3);
      const amp = smoothstep(12, 230, r) * R.hill;
      h += amp * (fbm3(N, x / 170, 3, z / 170, 4) + 0.28 * fbm3(N, x / 55, 7, z / 55, 3) + 0.25);
      if (R.mountain) {
        const ridge = 1 - Math.abs(fbm3(N, x / 420, 11, z / 420, 4) * 1.6);
        h += smoothstep(160, 650, r) * R.mountain * Math.max(0, ridge) * (0.6 + 0.4 * fbm3(N, x / 90, 2, z / 90, 3));
      }
      if (R.sea) h -= smoothstep(240, 360, r) * 22;
      return h;
    };
    this.height = (x, z) => this.baseHeight(x, z) + trenchOffset(this.spec, x, z);
  }

  build() {
    const { scene, quality, typeKey } = this.ctx;
    const R = this.region;
    const q = Q[quality];
    const rng = mulberry32(77);
    this.uTime = { value: 0 };

    // terrain
    const tg = buildTerrainGeometry(this.height, { radius: 900, n: quality === 'lite' ? 150 : quality === 'low' ? 260 : 380, a: 5.2 });
    const tm = makeGroundMaterial('field', { ...R.ground, highCol: R.highCol, highStart: R.highStart, rockAmt: R.rockAmt, wallL: this.spec.L, wallW: this.spec.base });
    const terrain = new THREE.Mesh(tg, tm);
    terrain.receiveShadow = true;
    scene.add(terrain);
    this.terrain = terrain;

    // sea for Aran
    if (R.sea) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x1b3947, roughness: 0.18, metalness: 0.1 }));
      sea.position.y = -3.5;
      const su = this.uTime;
      sea.material.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = su;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaPos = (modelMatrix*vec4(transformed,1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + NOISE_GLSL + '\nvarying vec3 vSeaPos; uniform float uTime;')
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            { vec2 p = vSeaPos.xz * 0.05;
              float e = 0.5;
              float h0 = fbm3(vec3(p, uTime*0.05));
              float hx = fbm3(vec3(p + vec2(0.02,0.0), uTime*0.05));
              float hz = fbm3(vec3(p + vec2(0.0,0.02), uTime*0.05));
              vec3 nW = normalize(vec3((h0-hx)*e*20.0, 1.0, (h0-hz)*e*20.0));
              normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz); }`);
      };
      scene.add(sea);
    }

    // grass
    const spec = this.spec;
    const blades = R.blades;
    this.grass = createGrass({
      count: q.grass, heightFn: this.height, radius: 30, seed: 5,
      height: [0.1, 0.38], width: [0.016, 0.03],
      accept: (x, z) => {
        if (Math.abs(z) < spec.base / 2 + 0.12 && Math.abs(x) < spec.L / 2 + 0.35) return 0;
        // old wall line beyond the gap
        if (Math.abs(z) < 0.45 && Math.abs(x) > spec.L / 2 + 0.2 && Math.abs(x) < 34) return 0.15;
        // trampled work area
        const worn = (1 - smoothstep(2.0, 4.0, Math.abs(z))) * (1 - smoothstep(spec.L / 2 + 1.5, spec.L / 2 + 3.5, Math.abs(x)));
        return 1 - worn * 0.55;
      },
      colors: (c, x, z, r) => {
        c.copy(blades[Math.floor(r() * blades.length)]);
        const n = fbm3(N, x * 0.08, 4, z * 0.08, 2);
        c.offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.08 + n * 0.06);
      },
      windStrength: 0.55, fadeDist: 32,
    });
    scene.add(this.grass);

    // old walls continuing from the gap, plus field boundaries
    const L = spec.L;
    const meander = (start, dir, len, step, wob, seed) => {
      const pts = [start];
      let [x, z] = start;
      let ang = Math.atan2(dir[1], dir[0]);
      const r2 = mulberry32(seed);
      for (let s = 0; s < len; s += step) {
        if (s > 14) ang += (r2() - 0.5) * wob;
        x += Math.cos(ang) * step; z += Math.sin(ang) * step;
        pts.push([x, z]);
      }
      return pts;
    };
    const paths = [
      [[L / 2 + 0.32, 0], [16, 0], ...meander([16, 0], [1, 0], 340, 12, 0.12, 1).slice(1)],
      [[-L / 2 - 0.32, 0], [-16, 0], ...meander([-16, 0], [-1, 0], 340, 12, 0.12, 2).slice(1)],
      meander([-34, -260], [0.05, 1], 520, 14, 0.1, 3),
      meander([46, 240], [-0.02, -1], 480, 14, 0.12, 4),
      meander([-280, -60], [1, 0.02], 560, 16, 0.08, 5),
      meander([-250, 70], [1, -0.03], 520, 16, 0.1, 6),
      meander([120, -300], [0.1, 1], 600, 18, 0.1, 7),
    ];
    this.oldWalls = buildOldWalls({
      paths, heightFn: this.baseHeight, typeKey, maxStones: q.wall, height: spec.H * 0.95,
      physics: this.ctx.physics, nearCollide: 6, tumble: typeKey === 'newengland' ? 0.45 : 0.25,
    });
    scene.add(this.oldWalls);

    // trees
    const leafMat = makeLeafMaterial(this.uTime);
    const bark = { default: makeBarkMaterial(0x4a4038), birch: makeBarkMaterial(0xd8d4c8), pine: makeBarkMaterial(0x3d3026) };
    const pal = R.leaves;
    const pickLeaf = (r) => {
      const tot = pal.reduce((s, p) => s + p[1], 0);
      let v = r() * tot;
      for (const p of pal) { v -= p[1]; if (v <= 0) return p[0]; }
      return pal[0][0];
    };
    const templates = [];
    for (let i = 0; i < 9; i++) {
      const base = new THREE.Color(pickLeaf(rng));
      templates.push(makeTreeTemplate(100 + i, {
        kind: 'maple', height: [9, 15],
        palette: (c, r) => { c.copy(base); c.offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.1, (r() - 0.5) * 0.08); if (r() < 0.15) c.set(pickLeaf(r)); },
      }));
    }
    const birchT = templates.length;
    for (let i = 0; i < 3; i++) templates.push(makeTreeTemplate(200 + i, { kind: 'birch', height: [8, 12], palette: (c, r) => { c.set(R.birches > 0.1 ? 0xd9b02a : 0x7a8a30); c.offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.08); } }));
    const pineT = templates.length;
    for (let i = 0; i < 3; i++) templates.push(makeTreeTemplate(300 + i, { kind: 'pine', height: [12, 20], palette: (c, r) => { c.set(0x26361f); c.offsetHSL(0, 0, (r() - 0.5) * 0.04); } }));

    const placements = [];
    const pickT = (r) => {
      const u = r();
      if (u < R.pines) return pineT + Math.floor(r() * 3);
      if (u < R.pines + R.birches) return birchT + Math.floor(r() * 3);
      return Math.floor(r() * 9);
    };
    const budget = Math.round(q.trees * Math.max(0.12, R.trees));
    // shade tree near the work
    if (R.trees > 0.2) placements.push({ x: -6.8, z: -5.2, s: 1.15, rot: 1.2, t: 0 });
    // hedgerow trees along walls
    for (const path of paths) {
      for (let k = 1; k < path.length - 1 && placements.length < budget * 0.45; k++) {
        if (rng() > 0.55 * R.trees) continue;
        const [x, z] = path[k];
        if (Math.hypot(x, z) < 12) continue;
        placements.push({ x: x + rand(rng, -2.5, 2.5), z: z + rand(rng, -2.5, 2.5), s: rand(rng, 0.8, 1.25), rot: rng() * 6.28, t: pickT(rng) });
      }
    }
    // woodland masses
    let tries = 0;
    while (placements.length < budget && tries < budget * 30) {
      tries++;
      const r = rand(rng, 70, 520), th = rng() * Math.PI * 2;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      const mask = fbm3(N, x / 140, 20, z / 140, 3);
      if (mask < 0.12 - R.forest * 0.15) continue;
      if (this.baseHeight(x, z) < -1.5) continue;
      placements.push({ x, z, s: rand(rng, 0.85, 1.4) * (1 + r / 600), rot: rng() * 6.28, t: pickT(rng) });
    }
    // a few lone field trees
    for (let i = 0; i < 6 * R.trees; i++) {
      const r = rand(rng, 25, 90), th = rng() * Math.PI * 2;
      placements.push({ x: Math.cos(th) * r, z: Math.sin(th) * r, s: rand(rng, 1.0, 1.4), rot: rng() * 6.28, t: Math.floor(rng() * 9) });
    }
    this.trees = instanceTrees(templates, placements, this.baseHeight, leafMat, bark);
    scene.add(this.trees);

  }

  sunFor(time) {
    return { morning: [14, -70], afternoon: [30, 35], golden: [6, 70] }[time] || [30, 35];
  }

  update(dt, t) {
    this.uTime.value = t;
    this.grass.userData.uniforms.uTime.value = t;
  }
}
