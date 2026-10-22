// Instanced grass blades with wind, rooted on the terrain.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const GRASS_VERT_COMMON = /* glsl */`
attribute float aH;
varying float vH;
varying vec3 vGWorld;
uniform float uTime;
uniform float uWind;
uniform float uFade;
uniform vec2 uWindDir;
uniform float uSurge;
float gh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(gh12(i), gh12(i+vec2(1,0)), f.x), mix(gh12(i+vec2(0,1)), gh12(i+vec2(1,1)), f.x), f.y); }
`;

export function makeBladeGeometry(segments = 4, curve = 0.25) {
  const pos = [], aH = [], idx = [], nrm = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const w = 0.5 * (1 - Math.pow(t, 1.6)) + 0.02;
    const z = curve * t * t;
    if (i < segments) {
      pos.push(-w, t, z, w, t, z);
      aH.push(t, t);
      nrm.push(-0.15, 1, -0.35, 0.15, 1, -0.35);
    } else {
      pos.push(0, t, z);
      aH.push(t);
      nrm.push(0, 1, -0.35);
    }
  }
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
  g.setIndex(idx);
  return g;
}

export function createGrass({
  count, heightFn, accept, radius = 30, center = [0, 0], seed = 3,
  width = [0.012, 0.022], height = [0.18, 0.5], colors, windStrength = 1, fadeDist = 28,
  roughness = 0.85, curve = 0.25, surge = 0, cluster = null,
}) {
  const rng = mulberry32(seed);
  const geo = makeBladeGeometry(4, curve);
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: windStrength },
    uFade: { value: fadeDist },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
    uSurge: { value: surge },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GRASS_VERT_COMMON)
      .replace('#include <project_vertex>', /* glsl */`
        vec4 wpos = instanceMatrix * vec4(transformed, 1.0);
        wpos = modelMatrix * wpos;
        vec3 root = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
        float dist = length(root.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(uFade * 0.65, uFade, dist);
        wpos.y = root.y + (wpos.y - root.y) * fade;
        float gust = gvn(root.xz * 0.15 - uWindDir * uTime * 1.6) * 0.8 + gvn(root.xz * 0.6 - uWindDir * uTime * 3.0) * 0.35;
        float sway = sin(uTime * 2.1 + root.x * 1.7 + root.z * 1.3) * 0.25;
        vec2 bend = uWindDir * (gust + sway * 0.4) * uWind;
        // underwater surge: back-and-forth
        bend += uWindDir * sin(uTime * 0.9 + root.x * 0.2) * uSurge;
        float hb = aH * aH;
        float bladeLen = length(wpos.xyz - root);
        wpos.xz += bend * hb * bladeLen * 0.9;
        wpos.y -= length(bend) * hb * bladeLen * 0.35;
        vH = aH;
        vGWorld = wpos.xyz;
        vec4 mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH; varying vec3 vGWorld;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.5, 1.12, smoothstep(0.0, 1.0, vH));`)
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        vec3 normal = normalize(vNormal);
        vec3 nonPerturbedNormal = normal;`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 8) {
    tries++;
    // denser near the centre
    const rr = radius * Math.pow(rng(), 1.15);
    const th = rng() * Math.PI * 2;
    let x = center[0] + Math.cos(th) * rr, z = center[1] + Math.sin(th) * rr;
    if (cluster) { const c = cluster(x, z, rng); if (!c) continue; x = c[0]; z = c[1]; }
    const a = accept ? accept(x, z, rng) : 1;
    if (a <= 0 || rng() > a) continue;
    const y = heightFn(x, z);
    const h = (height[0] + (height[1] - height[0]) * Math.pow(rng(), 1.3)) * (0.55 + 0.45 * a);
    const w = width[0] + (width[1] - width[0]) * rng();
    e.set((rng() - 0.5) * 0.35, rng() * Math.PI * 2, (rng() - 0.5) * 0.35);
    q.setFromEuler(e);
    s.set(w, h, h);
    p.set(x, y - 0.01, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(placed, m);
    colors(col, x, z, rng);
    mesh.setColorAt(placed, col);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.uniforms = uniforms;
  return mesh;
}
