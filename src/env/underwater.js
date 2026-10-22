// Kelp shallows: a wall on the seabed, with caustics, light shafts and drifting particles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise3, fbm3, mulberry32, rand, smoothstep } from '../noise.js';
import { buildTerrainGeometry } from '../terrain.js';
import { makeGroundMaterial } from '../ground.js';
import { createGrass } from '../grass.js';
import { trenchOffset } from '../wall.js';
import { generateStone, getStoneMaterial, sharedUniforms } from '../stones.js';
import { NOISE_GLSL } from '../glsl.js';

const N = makeNoise3(808);
const Q = { high: { kelp: 1600, grass: 50000, snow: 5000, fish: 140 }, medium: { kelp: 900, grass: 25000, snow: 2500, fish: 90 }, low: { kelp: 400, grass: 9000, snow: 1200, fish: 50 } };
export const WATER_COLOR = new THREE.Color(0x0e5363);
const SURFACE_Y = 9;

export class Underwater {
  constructor(ctx) {
    this.ctx = ctx;
    this.spec = ctx.spec;
    this.name = 'Kelp shallows, nine metres down';
    this.audio = 'underwater';
    this.underwater = true;
    this.baseHeight = (x, z) => {
      const r = Math.hypot(x, z);
      let h = 0.12 * fbm3(N, x / 9, 0.3, z / 9, 3) + 0.02 * x;
      h += smoothstep(10, 120, r) * (fbm3(N, x / 60, 2, z / 60, 4) * 5 + 1.5);
      return h;
    };
    this.height = (x, z) => this.baseHeight(x, z) + trenchOffset(this.spec, x, z, 0.05);
  }

  build() {
    const { scene, quality, renderer } = this.ctx;
    const q = Q[quality];
    const rng = mulberry32(12);
    this.uTime = { value: 0 };
    scene.fog = new THREE.FogExp2(WATER_COLOR.clone().multiplyScalar(0.9), 0.055);

    // background gradient dome
    const bgMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: this.uTime, uTop: { value: new THREE.Color(0x5fc4cf) }, uMid: { value: WATER_COLOR.clone() }, uBot: { value: new THREE.Color(0x03141c) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w*0.99999; }',
      fragmentShader: `${NOISE_GLSL}
        uniform vec3 uTop, uMid, uBot; uniform float uTime; varying vec3 vD;
        void main(){
          float y = vD.y;
          vec3 c = mix(uMid, uTop, smoothstep(0.05, 0.95, y));
          c = mix(c, uBot, smoothstep(0.0, -0.6, y));
          // Snell's window shimmer overhead
          float w = smoothstep(0.62, 0.9, y);
          vec2 p = vD.xz / max(y, 0.2) * 3.0;
          float s = snoise(vec3(p, uTime * 0.4)) * 0.5 + 0.5;
          c += vec3(0.6, 0.85, 0.85) * w * (0.4 + 0.6 * s) * 0.6;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const bg = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), bgMat);
    bg.renderOrder = -10;
    scene.add(bg);

    // environment for reflections: render the dome alone
    const envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), bgMat);
    envScene.add(envDome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;

    // seabed
    const tg = buildTerrainGeometry(this.height, { radius: 400, n: quality === 'low' ? 260 : 360, a: 4.4 });
    const sand = new THREE.Mesh(tg, makeGroundMaterial('sand', { sand: 0xa38f69, wallL: this.spec.L, wallW: this.spec.base }));
    sand.receiveShadow = true;
    scene.add(sand);

    // water surface seen from below
    const surfMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: '#include <fog_pars_vertex>\nvarying vec3 vW; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix*wp; gl_Position = projectionMatrix*mvPosition;\n#include <fog_vertex>\n}',
      fragmentShader: `${NOISE_GLSL}
        #include <fog_pars_fragment>
        uniform float uTime; varying vec3 vW;
        void main(){
          vec2 p = vW.xz * 0.25;
          float n = snoise(vec3(p, uTime * 0.3)) * 0.6 + snoise(vec3(p * 2.7, uTime * 0.5)) * 0.4;
          float bright = pow(1.0 - abs(n), 4.0);
          vec3 c = mix(vec3(0.35, 0.75, 0.78), vec3(0.95, 1.0, 0.95), bright);
          gl_FragColor = vec4(c, 0.75);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 1, 1).rotateX(Math.PI / 2), surfMat);
    this.surface.position.y = SURFACE_Y;
    scene.add(this.surface);

    // light shafts
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: this.uTime },
      vertexShader: 'varying vec2 vUv; varying float vSeed; attribute float aSeed; void main(){ vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0);} ',
      fragmentShader: `${NOISE_GLSL}
        uniform float uTime; varying vec2 vUv; varying float vSeed;
        void main(){
          float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
          float fall = smoothstep(0.0, 0.7, vUv.y);
          float flick = 0.5 + 0.5 * snoise(vec3(vUv.x * 3.0 + vSeed * 10.0, vUv.y * 0.5, uTime * 0.25 + vSeed));
          float a = edge * fall * flick * 0.07;
          gl_FragColor = vec4(vec3(0.75, 0.95, 0.9) * a, a);
        }`,
    });
    const shaftGeo = new THREE.PlaneGeometry(1.6, 16, 1, 1);
    shaftGeo.translate(0, -8, 0);
    const ns = 26;
    const seeds = new Float32Array(ns);
    for (let i = 0; i < ns; i++) seeds[i] = rng();
    shaftGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    this.shafts = new THREE.InstancedMesh(shaftGeo, shaftMat, ns);
    this.shaftPos = [];
    for (let i = 0; i < ns; i++) this.shaftPos.push(new THREE.Vector3(rand(rng, -14, 14), SURFACE_Y, rand(rng, -14, 14)));
    this.shafts.frustumCulled = false;
    scene.add(this.shafts);

    // seagrass meadow
    const spec = this.spec;
    this.grass = createGrass({
      count: q.grass, heightFn: this.height, radius: 30, seed: 14,
      height: [0.25, 0.75], width: [0.012, 0.02], curve: 0.1,
      accept: (x, z) => {
        if (Math.abs(z) < 2.6 && Math.abs(x) < spec.L / 2 + 2.6) return 0;
        return smoothstep(-0.05, 0.25, fbm3(N, x * 0.12, 4, z * 0.12, 3));
      },
      colors: (c, x, z, r) => { c.setHex([0x3f6b3a, 0x557a3a, 0x6b7a3f, 0x4d6a4a][Math.floor(r() * 4)]); c.offsetHSL(0, 0, (r() - 0.5) * 0.06); },
      windStrength: 0.0, surge: 0.45, fadeDist: 26,
    });
    scene.add(this.grass);

    // kelp
    const kelpGeo = new THREE.PlaneGeometry(0.13, 1, 1, 16);
    kelpGeo.translate(0, 0.5, 0);
    const kelpMat = new THREE.MeshStandardMaterial({ color: 0x8a7330, roughness: 0.55, side: THREE.DoubleSide });
    const ku = this.uTime;
    kelpMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = ku;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; varying float vKH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vKH = uv.y;
          vec3 iw = instanceMatrix[3].xyz;
          float ph = iw.x * 0.37 + iw.z * 0.21;
          float h = uv.y;
          transformed.x += (sin(uTime * 0.8 + ph + h * 2.5) * 0.35 + sin(uTime * 0.37 + ph * 2.0) * 0.4) * h * h;
          transformed.z += cos(uTime * 0.6 + ph * 1.3 + h * 2.0) * 0.25 * h * h;
          transformed.x += sin(h * 18.0 + ph) * 0.03 * h; // ruffled blade edge`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vKH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(0.5, 1.25, vKH);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * (0.12 + 0.35 * vKH);');
    };
    const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, q.kelp);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let k = 0, tries = 0;
    while (k < q.kelp && tries < q.kelp * 20) {
      tries++;
      const r = rand(rng, 4.5, 45), th = rng() * Math.PI * 2;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      if (Math.abs(z) < 3.2 && Math.abs(x) < spec.L / 2 + 3.5) continue;
      if (fbm3(N, x / 14, 8, z / 14, 3) < 0.05) continue;
      const hgt = rand(rng, 2.5, 7.5);
      for (let b = 0; b < 5 && k < q.kelp; b++) {
        qq.setFromEuler(new THREE.Euler(rand(rng, -0.15, 0.15), rng() * Math.PI, rand(rng, -0.15, 0.15)));
        s.set(rand(rng, 0.7, 1.4), hgt * rand(rng, 0.6, 1.0), 1);
        const bx = x + rand(rng, -0.25, 0.25), bz = z + rand(rng, -0.25, 0.25);
        p.set(bx, this.height(bx, bz) - 0.05, bz);
        m.compose(p, qq, s);
        kelp.setMatrixAt(k++, m);
      }
    }
    kelp.count = k;
    kelp.castShadow = true; kelp.receiveShadow = true;
    kelp.frustumCulled = false;
    scene.add(kelp);

    // boulders
    const bm = getStoneMaterial(this.ctx.typeKey);
    for (let i = 0; i < 22; i++) {
      const st = generateStone(this.ctx.typeKey, 'foundation', 7000 + i);
      const mesh = new THREE.Mesh(st.geometry, bm);
      const r = rand(rng, 7, 40), th = rng() * Math.PI * 2;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      const sc = rand(rng, 2, 6);
      mesh.scale.setScalar(sc);
      mesh.position.set(x, this.height(x, z) + st.size.y * sc * 0.25, z);
      mesh.rotation.set(rand(rng, -0.3, 0.3), rng() * 6, rand(rng, -0.3, 0.3));
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
    }

    // marine snow
    const snowN = q.snow;
    const sp = new Float32Array(snowN * 3), ss = new Float32Array(snowN);
    for (let i = 0; i < snowN; i++) { sp[i * 3] = rand(rng, -15, 15); sp[i * 3 + 1] = rand(rng, -1, 9); sp[i * 3 + 2] = rand(rng, -15, 15); ss[i] = rng(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aS', new THREE.BufferAttribute(ss, 1));
    const snowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: this.uTime, uCam: { value: new THREE.Vector3() }, uPR: { value: renderer.getPixelRatio() } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uPR; attribute float aS; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.2 + aS * 30.0) * 0.4 + uTime * 0.05;
          p.y -= uTime * (0.02 + aS * 0.03);
          p.z += cos(uTime * 0.17 + aS * 20.0) * 0.4;
          // wrap around the camera
          vec3 rel = mod(p - uCam + 15.0, 30.0) - 15.0;
          rel.y = mod(p.y - uCam.y + 5.0, 10.0) - 5.0;
          vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = (1.0 + aS * 2.5) * uPR * 18.0 / d;
          vA = smoothstep(18.0, 3.0, d) * (0.25 + 0.4 * aS);
        }`,
      fragmentShader: 'varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)) * vA; gl_FragColor = vec4(vec3(0.85,0.95,0.9), a); }',
    });
    this.snow = new THREE.Points(sg, snowMat);
    this.snow.frustumCulled = false;
    scene.add(this.snow);

    // a school of fish
    const fishGeo = (() => {
      const body = new THREE.SphereGeometry(1, 12, 8);
      body.scale(0.11, 0.035, 0.025);
      const tail = new THREE.ConeGeometry(0.03, 0.06, 4);
      tail.rotateZ(Math.PI / 2); tail.scale(1, 1, 0.3); tail.translate(-0.12, 0, 0);
      body.deleteAttribute('uv'); tail.deleteAttribute('uv');
      return mergeGeometries([body, tail]);
    })();
    const fishMat = new THREE.MeshStandardMaterial({ color: 0x9fb4b8, roughness: 0.3, metalness: 0.7 });
    fishMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
          transformed.z += sin(uTime * 9.0 + ph + position.x * 25.0) * 0.02 * smoothstep(0.05, -0.15, position.x);`);
    };
    this.fish = new THREE.InstancedMesh(fishGeo, fishMat, q.fish);
    this.fish.castShadow = true;
    this.fish.frustumCulled = false;
    this.fishData = [];
    for (let i = 0; i < q.fish; i++) this.fishData.push({ off: new THREE.Vector3(rand(rng, -1.5, 1.5), rand(rng, -0.8, 0.8), rand(rng, -1.5, 1.5)), ph: rng() * 6.28, sp: rand(rng, 0.9, 1.1) });
    scene.add(this.fish);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);

    sharedUniforms.uCaustic.value = 0.8;
    sharedUniforms.uWet.value = 1;
  }

  sunFor() { return [70, 30]; }

  update(dt, t, camera) {
    this.uTime.value = t;
    sharedUniforms.uTime.value = t;
    this.grass.userData.uniforms.uTime.value = t;
    this.surface.material.uniforms.uTime.value = t;
    this.snow.material.uniforms.uCam.value.copy(camera.position);
    // shafts: billboard around vertical axis toward camera, slight lean
    const m = this._m, q = this._q, s = this._s;
    for (let i = 0; i < this.shaftPos.length; i++) {
      const p = this.shaftPos[i];
      const ang = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
      q.setFromEuler(new THREE.Euler(0.12, ang, 0.05, 'YXZ'));
      s.set(1 + Math.sin(t * 0.3 + i) * 0.3, 1, 1);
      m.compose(p, q, s);
      this.shafts.setMatrixAt(i, m);
    }
    this.shafts.instanceMatrix.needsUpdate = true;
    // fish school circling the work
    const R = 9, cx = Math.cos(t * 0.06) * R, cz = Math.sin(t * 0.06) * R;
    const cy = 2.2 + Math.sin(t * 0.13) * 0.8;
    const dir = new THREE.Vector3(-Math.sin(t * 0.06), 0, Math.cos(t * 0.06));
    const ang = Math.atan2(-dir.z, dir.x);
    for (let i = 0; i < this.fishData.length; i++) {
      const f = this.fishData[i];
      const wob = Math.sin(t * 0.7 * f.sp + f.ph);
      this._p.set(cx + f.off.x + wob * 0.3, cy + f.off.y + Math.cos(t * 0.5 + f.ph) * 0.15, cz + f.off.z + Math.sin(t * 0.6 + f.ph) * 0.3);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang + wob * 0.15);
      s.set(1, 1, 1);
      m.compose(this._p, q, s);
      this.fish.setMatrixAt(i, m);
    }
    this.fish.instanceMatrix.needsUpdate = true;
  }
}
