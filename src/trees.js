// Procedural deciduous trees (trunk + branches + lumpy foliage clumps), instanced.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3, mulberry32, rand } from './noise.js';
import { NOISE_GLSL } from './glsl.js';

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

function clump(center, radius, rng, color) {
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
      const g = clump(new THREE.Vector3(), Math.max(0.5, rr), rng, color);
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
    leaves.push(clump(c, crownR * rand(rng, 0.36, 0.55), rng, color));
  }
  if (kind === 'pine') woods.push(branch(top, new THREE.Vector3(top.x, H * 0.95, top.z), r0 * 0.75, r0 * 0.15));
  const wood = mergeGeometries(woods);
  const leaf = mergeGeometries(leaves);
  return { wood, leaf, kind };
}

export function makeLeafMaterial(uTime) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vLeafPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 iw = vec3(0.0);
        #ifdef USE_INSTANCING
          iw = instanceMatrix[3].xyz;
        #endif
        float sway = sin(uTime * 1.3 + iw.x * 0.3 + position.y * 0.4) * 0.04 * max(position.y - 2.0, 0.0) * 0.1;
        transformed.x += sway; transformed.z += sway * 0.6;
        vLeafPos = position + iw * 0.37;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE_GLSL + '\nvarying vec3 vLeafPos;\n' + /* glsl */`
        vec3 leafBump(vec3 surf_pos, vec3 surf_norm, float h){
          vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
          vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
          float det = dot(sx, R1);
          vec3 grad = sign(det) * (dFdx(h) * R1 + dFdy(h) * R2);
          return normalize(abs(det) * surf_norm - grad);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lf = snoise(vLeafPos * 5.0);
        float lf2 = snoise(vLeafPos * 13.0);
        diffuseColor.rgb *= 0.8 + 0.3 * lf + 0.15 * lf2;
        float holes = smoothstep(0.55, 0.75, snoise(vLeafPos * 9.0));
        diffuseColor.rgb *= 1.0 - holes * 0.55;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = leafBump(-vViewPosition, normal, (snoise(vLeafPos * 6.0) * 0.6 + snoise(vLeafPos * 15.0) * 0.4) * 0.12);`);
  };
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
    for (const im of [wood, leaf]) {
      im.castShadow = shadows; im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  });
  return group;
}
