// Procedural deciduous trees (trunk + branches + lumpy foliage clumps), instanced.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3, mulberry32, rand } from './noise.js';
import { NOISE_GLSL } from './glsl.js';
import { BINS } from './foliage.js';

const NZ = makeNoise3(91);

function branch(from, to, r0, r1) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 3, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  g.deleteAttribute('uv');
  return g;
}

function clump(center, radius, rng, color, bin = 0) {
  let g = new THREE.IcosahedronGeometry(1, 5);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const sx = rand(rng, 0.85, 1.2), sy = rand(rng, 0.7, 0.95), sz = rand(rng, 0.85, 1.2);
  const off = rng() * 50;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = NZ(v.x * 1.6 + off, v.y * 1.6, v.z * 1.6) * 0.22 + NZ(v.x * 4 + off, v.y * 4, v.z * 4) * 0.08;
    v.multiplyScalar(radius * (1 + n));
    v.x *= sx; v.y *= sy; v.z *= sz;
    if (v.y < -radius * 0.45) v.y = -radius * 0.45 + (v.y + radius * 0.45) * 0.3; // flatter undersides
    p.setXYZ(i, v.x + center.x, v.y + center.y, v.z + center.z);
  }
  g.computeVertexNormals();
  // vertex colours with a darker interior / underside
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = (p.getY(i) - center.y) / radius;
    const shade = 0.62 + 0.38 * THREE.MathUtils.smoothstep(y, -0.6, 0.8);
    cols[i * 3] = color.r * shade; cols[i * 3 + 1] = color.g * shade; cols[i * 3 + 2] = color.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.setAttribute('aBin', new THREE.BufferAttribute(new Float32Array(p.count).fill(bin), 1));
  return g;
}

export function makeTreeTemplate(seed, { palette, kind = 'maple', height = [9, 14] }) {
  const rng = mulberry32(seed);
  const H = rand(rng, ...height);
  const trunkH = H * (kind === 'birch' ? 0.5 : kind === 'pine' ? 0.22 : 0.3);
  const r0 = H * (kind === 'birch' ? 0.011 : kind === 'pine' ? 0.016 : 0.018);
  const woods = [];
  const leaves = [];
  const base = new THREE.Vector3(0, -0.3, 0);
  const top = new THREE.Vector3(rand(rng, -0.3, 0.3), trunkH, rand(rng, -0.3, 0.3));
  woods.push(branch(base, top, r0 * 1.3, r0 * 0.75));
  const crownR = H * (kind === 'birch' ? 0.24 : kind === 'pine' ? 0.18 : 0.36);
  const crownC = new THREE.Vector3(top.x, trunkH + (H - trunkH) * 0.5, top.z);
  const nb = kind === 'pine' ? 0 : Math.floor(rand(rng, 4, 7));
  const tips = [];
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + rng() * 0.6;
    const up = rand(rng, 0.5, 1.0);
    const len = rand(rng, 0.6, 1.0) * crownR * 1.3;
    const to = new THREE.Vector3(top.x + Math.cos(a) * len * 0.8, top.y + up * len, top.z + Math.sin(a) * len * 0.8);
    woods.push(branch(top, to, r0 * 0.55, r0 * 0.2));
    tips.push(to);
  }
  const color = new THREE.Color();
  const nClumps = kind === 'pine' ? 8 : Math.floor(rand(rng, 16, 24));
  for (let i = 0; i < nClumps; i++) {
    let c;
    if (kind === 'pine') {
      const t = i / (nClumps - 1);
      c = new THREE.Vector3(top.x, trunkH + (H - trunkH) * t * 0.95, top.z);
      const rr = crownR * (1.25 - t) * 1.1;
      palette(color, rng);
      const g = clump(new THREE.Vector3(), Math.max(0.5, rr), rng, color, 0);
      g.scale(1, 0.45, 1); g.translate(c.x, c.y, c.z); g.computeVertexNormals();
      leaves.push(g);
      continue;
    }
    if (i < tips.length) c = tips[i].clone();
    else {
      const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      c = crownC.clone().add(new THREE.Vector3(s * Math.cos(th), u * 0.75, s * Math.sin(th)).multiplyScalar(crownR * rand(rng, 0.25, 0.9)));
    }
    palette(color, rng);
    // canopy exposure class for the senescence model: upper and outer clumps are sunnier
    const hgt = THREE.MathUtils.clamp((c.y - trunkH) / Math.max(0.1, H - trunkH), 0, 1);
    const rad = THREE.MathUtils.clamp(Math.hypot(c.x - top.x, c.z - top.z) / (crownR * 1.2), 0, 1);
    const bin = Math.min(BINS - 1, Math.floor(THREE.MathUtils.clamp(0.08 + 0.5 * rad + 0.42 * hgt, 0, 0.999) * BINS));
    leaves.push(clump(c, crownR * rand(rng, 0.36, 0.55), rng, color, bin));
  }
  if (kind === 'pine') woods.push(branch(top, new THREE.Vector3(top.x, H * 0.95, top.z), r0 * 0.75, r0 * 0.15));
  const wood = mergeGeometries(woods);
  const leaf = mergeGeometries(leaves);
  return { wood, leaf, kind };
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
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
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
        float lf = snoise(vLeafPos * 5.0);
        float lf2 = snoise(vLeafPos * 13.0);
        diffuseColor.rgb *= 0.8 + 0.3 * lf + 0.15 * lf2;
        float holes = smoothstep(0.55, 0.75, snoise(vLeafPos * 9.0));
        diffuseColor.rgb *= 1.0 - holes * 0.55;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = leafBump(-vViewPosition, normal, (snoise(vLeafPos * 6.0) * 0.6 + snoise(vLeafPos * 15.0) * 0.4) * 0.12);`);
  };
  mat.customProgramCacheKey = () => 'leaf-' + (fol ? 'fol' : 'plain');
  // matching shadow caster: the same dissolve, so a thinning canopy casts a thinning shadow
  if (fol) {
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
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

export function makeBarkMaterial(color = 0x4a4038) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });
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
