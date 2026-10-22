// A vacant lot between brick rowhouses — a wall in the middle of the city.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3, fbm3, mulberry32, rand } from '../noise.js';
import { buildTerrainGeometry } from '../terrain.js';
import { makeGroundMaterial } from '../ground.js';
import { createGrass } from '../grass.js';
import { makeTreeTemplate, makeLeafMaterial, makeBarkMaterial, instanceTrees } from '../trees.js';
import { trenchOffset } from '../wall.js';
import { NOISE_GLSL, BUMP_GLSL } from '../glsl.js';

const N = makeNoise3(515);
const LOT = { x0: -8, x1: 8, z0: -6, z1: 5.5 };
const Q = { high: { grass: 60000, trees: 1 }, medium: { grass: 30000, trees: 1 }, low: { grass: 12000, trees: 0.6 } };

function facadeMaterial(uTime, nightGlow) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uGlow = nightGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBld; attribute vec3 aBase; varying vec4 vBld; varying vec3 vBase; varying vec3 vFPos; varying vec3 vFNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBld = aBld; vBase = aBase; vFPos = (modelMatrix*vec4(transformed,1.0)).xyz; vFNorm = normalize(mat3(modelMatrix)*normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        ${BUMP_GLSL}
        uniform float uGlow;
        varying vec4 vBld; varying vec3 vBase; varying vec3 vFPos; varying vec3 vFNorm;
        float fH; float fRough; float fMetal; vec3 fEmit;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vFNorm);
          float seed = vBld.x; float kind = vBld.y; float floorH = vBld.z; float bay = vBld.w;
          float u = abs(n.z) > 0.5 ? vFPos.x * sign(n.z) : -vFPos.z * sign(n.x);
          float v = vFPos.y - vBase.y;
          fH = 0.0; fRough = 0.85; fMetal = 0.0; fEmit = vec3(0.0);
          vec3 c;
          bool roof = n.y > 0.5;
          // material
          vec3 brickA = kind < 0.5 ? vec3(0.42, 0.16, 0.10) : (kind < 1.5 ? vec3(0.30, 0.19, 0.14) : vec3(0.55, 0.47, 0.36));
          if (kind > 2.5) brickA = vec3(0.2, 0.23, 0.26);
          vec2 bc = vec2(u / 0.205, v / 0.0762);
          float row = floor(bc.y);
          bc.x += mod(row, 2.0) * 0.5;
          vec2 bid = floor(bc);
          vec2 bf = fract(bc);
          float mortar = 1.0 - smoothstep(0.0, 0.06, min(min(bf.x, 1.0 - bf.x) * 2.7, min(bf.y, 1.0 - bf.y)));
          float bh = hash12(bid + seed * 17.0);
          vec3 brick = brickA * (0.78 + 0.4 * bh) * (0.9 + 0.12 * snoise(vec3(vFPos * 3.0)));
          if (kind > 0.5 && kind < 1.5) { // brownstone: smooth ashlar blocks
            vec2 ac = vec2(u / 0.9, v / 0.45); ac.x += mod(floor(ac.y), 2.0) * 0.5;
            vec2 af = fract(ac);
            mortar = 1.0 - smoothstep(0.0, 0.02, min(min(af.x, 1.0 - af.x) * 0.5, min(af.y, 1.0 - af.y)));
            brick = brickA * (0.85 + 0.25 * fbm3(vec3(vFPos * 1.5))) ;
          }
          vec3 mort = vec3(0.55, 0.52, 0.47);
          c = mix(brick, mort, mortar * 0.85);
          fH = -mortar * 0.003 + bh * 0.0006;
          // grime streaks from rain
          float streak = fbm3(vec3(u * 3.0, v * 0.15, seed));
          c *= 0.85 + 0.15 * smoothstep(-0.5, 0.5, streak);
          c *= mix(0.7, 1.0, smoothstep(0.0, 1.2, v));
          // windows (street facades only: |n.z| > 0.5 and not the party walls)
          bool facade = abs(n.z) > 0.5 && vBld.w > 0.0;
          if (facade && kind < 2.5) {
            float fl = floor(v / floorH);
            float fv = fract(v / floorH);
            float bu = u / bay;
            float bi = floor(bu);
            float fu = fract(bu);
            float win = step(0.3, fu) * step(fu, 0.7) * step(0.28, fv) * step(fv, 0.86) * step(0.5, fl);
            float frame = win * (1.0 - step(0.32, fu) * step(fu, 0.68) * step(0.3, fv) * step(fv, 0.84));
            float lintel = step(0.27, fu) * step(fu, 0.73) * step(0.86, fv) * step(fv, 0.93) * step(0.5, fl);
            float sill = step(0.28, fu) * step(fu, 0.72) * step(0.24, fv) * step(fv, 0.28) * step(0.5, fl);
            vec3 stoneTrim = vec3(0.62, 0.58, 0.5);
            c = mix(c, stoneTrim * (0.9 + 0.1 * snoise(vFPos*4.0)), max(lintel, sill));
            fH += (lintel + sill) * 0.01;
            if (win > 0.5) {
              float glassId = hash12(vec2(bi, fl) + seed * 31.0);
              vec3 glass = vec3(0.05, 0.06, 0.07);
              // muntin bars
              float mb = step(0.495, fract((fv - 0.28) / 0.58 * 2.0)) * step(fract((fv - 0.28) / 0.58 * 2.0), 0.525);
              float mu = step(0.49, fract((fu - 0.3) / 0.4 * 2.0)) * step(fract((fu - 0.3) / 0.4 * 2.0), 0.51);
              float shade = step(0.62, glassId) * step(fv, 0.58 + glassId * 0.25);
              c = glass;
              c = mix(c, vec3(0.32, 0.28, 0.24), shade * 0.7);
              fH = 0.0;
              fRough = 0.06; fMetal = 0.6;
              float lit = step(0.55, hash12(vec2(bi * 3.1, fl * 7.7) + seed));
              fEmit = vec3(1.0, 0.72, 0.42) * lit * uGlow * (0.7 + 0.6 * glassId) * (1.0 - shade * 0.5);
              c = mix(c, vec3(0.85, 0.85, 0.8), max(mb, mu) * 0.9);
              if (max(mb, mu) > 0.5) { fRough = 0.6; fMetal = 0.0; fEmit = vec3(0.0); }
            }
            c = mix(c, vec3(0.88, 0.86, 0.8), frame);
            if (frame > 0.5) { fRough = 0.5; fMetal = 0.0; }
            // ground floor: door bay
            if (fl < 0.5) {
              float door = step(0.38, fract(u / (bay * 3.0))) * step(fract(u / (bay * 3.0)), 0.5) * step(fv, 0.75);
              c = mix(c, vec3(0.12, 0.09, 0.07), door);
              float shop = step(0.55, fract(u / (bay * 3.0))) * step(fract(u / (bay * 3.0)), 0.95) * step(0.2, fv) * step(fv, 0.7);
              if (shop > 0.5) { c = vec3(0.04, 0.05, 0.06); fRough = 0.05; fMetal = 0.7; fEmit = vec3(1.0, 0.8, 0.55) * uGlow * 0.6 * step(0.4, hash12(vec2(bi, seed))); }
            }
          }
          if (kind > 2.5) { // glass tower curtain wall
            vec2 g = vec2(u / 1.5, v / 3.6);
            vec2 gf = fract(g);
            float mull = 1.0 - step(0.05, gf.x) * step(gf.y, 0.93);
            c = mix(vec3(0.08, 0.1, 0.12), vec3(0.3, 0.32, 0.33), mull);
            fRough = mix(0.08, 0.5, mull); fMetal = mix(0.85, 0.3, mull);
            float lit = step(0.6, hash12(floor(g) + seed));
            fEmit = vec3(1.0, 0.9, 0.75) * lit * uGlow * 0.6 * (1.0 - mull);
          }
          if (roof) { c = vec3(0.16, 0.16, 0.17) * (0.8 + 0.3 * snoise(vFPos * 0.5)); fRough = 0.95; fMetal = 0.0; fEmit = vec3(0.0); }
          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpNormal(-vViewPosition, normal, fH * 8.0, faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmit;');
  };
  mat.customProgramCacheKey = () => 'facade';
  return mat;
}

function boxWithAttrs(w, h, d, x, y, z, bld, base) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 4), b = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a.set(bld, i * 4); b.set(base, i * 3); }
  g.setAttribute('aBld', new THREE.BufferAttribute(a, 4));
  g.setAttribute('aBase', new THREE.BufferAttribute(b, 3));
  return g;
}

function ghostSignTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(232,222,196,0.55)';
  g.fillRect(40, 40, 944, 432);
  g.fillStyle = 'rgba(70,40,30,0.75)';
  g.font = 'bold 120px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('DRY GOODS', 512, 200);
  g.font = 'italic 64px Georgia, serif';
  g.fillText('& Notions · Est. 1887', 512, 300);
  g.font = 'bold 54px Georgia, serif';
  g.fillText('SECOND FLOOR', 512, 400);
  // weathering
  const img = g.getImageData(0, 0, 1024, 512);
  const n = makeNoise3(3);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 1024; x++) {
    const i = (y * 1024 + x) * 4;
    const w = 0.55 + 0.45 * (fbm3(n, x / 90, y / 60, 0.5, 4) * 0.5 + 0.5);
    const brickRow = (Math.floor(y / 12) % 2 === 0) ? 1 : 0.85;
    img.data[i + 3] *= Math.max(0, Math.min(1, w * 1.1 - 0.25)) * brickRow;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class City {
  constructor(ctx) {
    this.ctx = ctx;
    this.spec = ctx.spec;
    this.name = 'A vacant lot between rowhouses';
    this.audio = 'city';
    this.underwater = false;
    this.baseHeight = (x, z) => {
      const inLot = x > LOT.x0 && x < LOT.x1 && z > LOT.z0 && z < LOT.z1;
      if (inLot) return 0.04 + 0.03 * fbm3(N, x / 6, 0.5, z / 6, 2);
      const street = (z > 7 && z < 16) || (Math.abs(x) > 26 && Math.abs(x) < 35);
      return street ? -0.15 : 0.0;
    };
    this.height = (x, z) => this.baseHeight(x, z) + trenchOffset(this.spec, x, z);
  }

  build() {
    const { scene, quality, physics } = this.ctx;
    const rng = mulberry32(31);
    this.uTime = { value: 0 };
    this.glow = { value: 0 };

    const tg = buildTerrainGeometry(this.height, { radius: 700, n: quality === 'low' ? 300 : 420, a: 4.6 });
    const gm = makeGroundMaterial('city', { grassA: 0x52702c, grassB: 0x7d8040, soil: 0x3b2e24, wallL: this.spec.L, wallW: this.spec.base });
    gm.userData.uniforms.uCity.value.set(LOT.x0, LOT.x1, LOT.z0, LOT.z1);
    const ground = new THREE.Mesh(tg, gm);
    ground.receiveShadow = true;
    scene.add(ground);

    // curbs (granite)
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 0.75 });
    const curbs = [];
    for (const z of [7.0, 16.0]) {
      const g = new THREE.BoxGeometry(52, 0.17, 0.16); g.translate(0, -0.075, z + (z < 10 ? 0.0 : 0.0)); curbs.push(g);
    }
    // lot edging stones
    const edges = [
      [LOT.x1 - LOT.x0, 0.12, 0.12, 0, LOT.z1], [LOT.x1 - LOT.x0, 0.12, 0.12, 0, LOT.z0],
      [0.12, 0.12, LOT.z1 - LOT.z0, LOT.x0, (LOT.z0 + LOT.z1) / 2], [0.12, 0.12, LOT.z1 - LOT.z0, LOT.x1, (LOT.z0 + LOT.z1) / 2],
    ];
    for (const [w, h, d, x, z] of edges) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, 0.04, z); curbs.push(g); }
    const curbMesh = new THREE.Mesh(mergeGeometries(curbs.map((g) => { g.deleteAttribute('uv'); return g; })), curbMat);
    curbMesh.receiveShadow = true; curbMesh.castShadow = true;
    scene.add(curbMesh);

    // buildings
    const blds = [], cornices = [];
    const addRow = (x0, x1, zFront, facing, depth, floorsRange, kindsW) => {
      let x = x0;
      while (x < x1) {
        const w = rand(rng, 5.5, 8.5);
        const floors = Math.floor(rand(rng, ...floorsRange));
        const fh = rand(rng, 3.1, 3.5);
        const h = floors * fh + rand(rng, 0.3, 0.9);
        const kr = rng();
        const kind = kr < kindsW[0] ? 0 : kr < kindsW[0] + kindsW[1] ? 1 : 2;
        const cz = zFront - facing * depth / 2;
        const bay = w / Math.max(2, Math.round(w / 2.2));
        blds.push(boxWithAttrs(w - 0.04, h, depth, x + w / 2, 0, cz, [rng(), kind, fh, bay], [x, 0, zFront]));
        // cornice
        const cg = new THREE.BoxGeometry(w, 0.45, 0.5); cg.translate(x + w / 2, h - 0.1, zFront + facing * 0.2); cg.deleteAttribute('uv');
        cornices.push(cg);
        const cg2 = new THREE.BoxGeometry(w, 0.12, 0.3); cg2.translate(x + w / 2, fh * 1.0 - 0.1, zFront + facing * 0.12); cg2.deleteAttribute('uv');
        cornices.push(cg2);
        x += w;
      }
    };
    // behind the lot (facing +z toward the lot is the back... treat as facade facing +z)
    addRow(-60, 60, LOT.z0 - 0.6, 1, 12, [3, 5], [0.55, 0.25]);
    // across the street, facing -z
    addRow(-60, 60, 17.6, -1, 12, [3, 6], [0.5, 0.3]);
    // side neighbours (party walls face the lot)
    blds.push(boxWithAttrs(14, 11.5, LOT.z1 - LOT.z0 + 0.6, LOT.x0 - 7.2, 0, (LOT.z0 + LOT.z1) / 2, [0.31, 0, 3.3, 2.3], [LOT.x0, 0, LOT.z1]));
    blds.push(boxWithAttrs(14, 14.5, LOT.z1 - LOT.z0 + 0.6, LOT.x1 + 7.2, 0, (LOT.z0 + LOT.z1) / 2, [0.71, 2, 3.4, 2.3], [LOT.x1, 0, LOT.z1]));
    // their street facades (front faces)
    // towers in the distance
    for (let i = 0; i < 40; i++) {
      const ang = rand(rng, 0, Math.PI * 2), r = rand(rng, 90, 320);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const w = rand(rng, 18, 40), d = rand(rng, 18, 40), h = rand(rng, 25, 140) * (r < 140 ? 0.6 : 1);
      blds.push(boxWithAttrs(w, h, d, x, -0.2, z, [rng(), rng() < 0.6 ? 3 : 0, 3.6, 2.5], [x - w / 2, 0, z]));
    }
    // mid-rise blocks filling the gaps
    for (let i = 0; i < 60; i++) {
      const ang = rand(rng, 0, Math.PI * 2), r = rand(rng, 40, 110);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (Math.abs(z) < 32 && Math.abs(x) < 62) continue;
      const w = rand(rng, 12, 24), d = rand(rng, 12, 24), h = rand(rng, 10, 30);
      blds.push(boxWithAttrs(w, h, d, x, -0.2, z, [rng(), Math.floor(rng() * 3), 3.3, 2.2], [x - w / 2, 0, z]));
    }
    const facade = new THREE.Mesh(mergeGeometries(blds), facadeMaterial(this.uTime, this.glow));
    facade.castShadow = true; facade.receiveShadow = true;
    scene.add(facade);
    const corn = new THREE.Mesh(mergeGeometries(cornices), new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 0.7 }));
    corn.castShadow = true; corn.receiveShadow = true;
    scene.add(corn);

    // ghost sign on the party wall facing the lot (right neighbour's west face at x = LOT.x1 + 0.2)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.5), new THREE.MeshStandardMaterial({ map: ghostSignTexture(), transparent: true, roughness: 0.95, depthWrite: false }));
    sign.position.set(LOT.x1 + 0.19, 8.6, -0.5);
    sign.rotation.y = -Math.PI / 2;
    sign.receiveShadow = true;
    scene.add(sign);

    // iron railing along the lot front, with a gate gap
    const picket = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5);
    const pickets = [];
    for (let x = LOT.x0 + 0.1; x < LOT.x1; x += 0.13) {
      if (Math.abs(x - 2.5) < 0.7) continue;
      const g = picket.clone(); g.translate(x, 0.6, LOT.z1 - 0.05); pickets.push(g);
    }
    for (const y of [0.15, 1.05]) { const g = new THREE.CylinderGeometry(0.015, 0.015, LOT.x1 - LOT.x0, 5); g.rotateZ(Math.PI / 2); g.translate(0, y, LOT.z1 - 0.05); pickets.push(g); }
    const rail = new THREE.Mesh(mergeGeometries(pickets.map((g) => { g.deleteAttribute('uv'); return g; })), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.6 }));
    rail.castShadow = true;
    scene.add(rail);

    // street lamps
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.7 });
    this.lampGlass = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffc070, emissiveIntensity: 0, roughness: 0.3 });
    const poleGs = [], headGs = [];
    for (let x = -42; x <= 42; x += 14) {
      for (const z of [6.4, 16.7]) {
        const p = new THREE.CylinderGeometry(0.06, 0.09, 4.2, 8); p.translate(x, 2.1, z); poleGs.push(p);
        const hdg = new THREE.CylinderGeometry(0.16, 0.22, 0.5, 8); hdg.translate(x, 4.4, z); headGs.push(hdg);
      }
    }
    const poles = new THREE.Mesh(mergeGeometries(poleGs), lampMat); poles.castShadow = true; scene.add(poles);
    scene.add(new THREE.Mesh(mergeGeometries(headGs), this.lampGlass));
    this.lampLight = new THREE.PointLight(0xffc27a, 0, 18, 1.6);
    this.lampLight.position.set(0, 4.2, 6.4);
    scene.add(this.lampLight);

    // hydrant + bench
    const hyd = new THREE.Group();
    const hm = new THREE.MeshStandardMaterial({ color: 0xb02a1f, roughness: 0.5 });
    const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.6, 12), hm); h1.position.y = 0.3;
    const h2 = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hm); h2.position.y = 0.6;
    const h3 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), hm); h3.rotation.z = Math.PI / 2; h3.position.y = 0.42;
    hyd.add(h1, h2, h3); hyd.position.set(-5.5, 0, 6.6); hyd.traverse((o) => { o.castShadow = true; });
    scene.add(hyd);
    const bench = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 });
    for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 0.09), wood); s.position.set(0, 0.45, -0.18 + i * 0.11); bench.add(s); }
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 0.03), wood); s.position.set(0, 0.62 + i * 0.12, -0.24); bench.add(s); }
    for (const x of [-0.8, 0.8]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.5), lampMat); l.position.set(x, 0.23, -0.05); bench.add(l); }
    bench.position.set(5.6, 0.04, 4.6); bench.rotation.y = Math.PI;
    bench.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    scene.add(bench);

    // lawn grass in the lot
    const spec = this.spec;
    const blades = [0x4f702a, 0x5e7d30, 0x6f8238, 0x8a8a48].map((h) => new THREE.Color(h));
    this.grass = createGrass({
      count: Q[quality].grass, heightFn: this.height, radius: 11, seed: 8,
      height: [0.08, 0.3], width: [0.01, 0.018],
      accept: (x, z) => {
        if (!(x > LOT.x0 + 0.1 && x < LOT.x1 - 0.1 && z > LOT.z0 + 0.1 && z < LOT.z1 - 0.1)) return 0;
        if (Math.abs(z) < spec.base / 2 + 0.12 && Math.abs(x) < spec.L / 2 + 0.35) return 0;
        const worn = (1 - Math.min(1, Math.max(0, (Math.abs(z) - 1.6) / 2))) * (1 - Math.min(1, Math.max(0, (Math.abs(x) - spec.L / 2 - 1.2) / 1.8)));
        return 1 - worn * 0.6;
      },
      colors: (c, x, z, r) => { c.copy(blades[Math.floor(r() * blades.length)]); c.offsetHSL(0, 0, (r() - 0.5) * 0.08); },
      windStrength: 0.25, fadeDist: 30,
    });
    scene.add(this.grass);

    // street trees
    const leafMat = makeLeafMaterial(this.uTime);
    const tpls = [0, 1, 2].map((i) => makeTreeTemplate(500 + i, { kind: 'maple', height: [8, 11], palette: (c, r) => { c.set([0xc9921f, 0x7d8a2e, 0xb3541c][i]); c.offsetHSL((r() - 0.5) * 0.04, 0, (r() - 0.5) * 0.08); } }));
    const pl = [];
    for (let x = -49; x <= 49; x += 9) for (const z of [6.2, 16.9]) if (rng() < 0.85 * Q[quality].trees) pl.push({ x: x + rand(rng, -0.5, 0.5), z, s: rand(rng, 0.8, 1.05), rot: rng() * 6.28, t: Math.floor(rng() * 3) });
    pl.push({ x: -6.2, z: -4.6, s: 0.9, rot: 0.4, t: 2 }); // ailanthus-ish volunteer in the lot
    const trees = instanceTrees(tpls, pl, this.baseHeight, leafMat, { default: makeBarkMaterial(0x3e3730) });
    scene.add(trees);

    // physics: street-side curb and the neighbouring building walls keep stones in the lot
    physics.addBox(0.1, 3, (LOT.z1 - LOT.z0) / 2, LOT.x0 - 0.25, 3, (LOT.z0 + LOT.z1) / 2);
    physics.addBox(0.1, 3, (LOT.z1 - LOT.z0) / 2, LOT.x1 + 0.25, 3, (LOT.z0 + LOT.z1) / 2);
    physics.addBox((LOT.x1 - LOT.x0) / 2, 3, 0.1, 0, 3, LOT.z0 - 0.7);
  }

  sunFor(time) {
    return { morning: [18, -40], afternoon: [38, 18], golden: [9, 12] }[time] || [38, 18];
  }

  setTime(time) {
    const g = time === 'golden' ? 1 : time === 'morning' ? 0.15 : 0.0;
    this.glow.value = g;
    this.lampGlass.emissiveIntensity = g * 3;
    this.lampLight.intensity = g * 6;
  }

  update(dt, t) {
    this.uTime.value = t;
    this.grass.userData.uniforms.uTime.value = t;
  }
}
