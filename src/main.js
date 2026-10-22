// Dry Stack — entry point: menu, world building, game loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { Physics } from './physics.js';
import { STONE_TYPES, generateStone, getStoneMaterial, sharedUniforms } from './stones.js';
import { SkySystem } from './sky.js';
import { sampleHeightfield } from './terrain.js';
import { WallSpec, Guides } from './wall.js';
import { Countryside, REGIONS } from './env/countryside.js';
import { City } from './env/city.js';
import { Underwater } from './env/underwater.js';
import { Interaction } from './interaction.js';
import { SoundScape } from './audio.js';
import { analyseWall } from './analysis.js';
import { makeSteps } from './tutorial.js';
import { UI } from './ui.js';
import { mulberry32, rand } from './noise.js';

const $ = (s) => document.querySelector(s);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ------------------------------------------------------------------ config
const params = new URLSearchParams(location.search);
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
const cfg = {
  stone: params.get('stone') || 'newengland',
  setting: params.get('setting') || 'countryside',
  mode: params.get('mode') || 'lesson',
  length: parseFloat(params.get('len') || '3'),
  time: params.get('time') || 'afternoon',
  quality: params.get('q') || (isMobile ? 'low' : 'high'),
};
if (!STONE_TYPES[cfg.stone]) cfg.stone = 'newengland';

// ------------------------------------------------------------------ grading pass
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.32 }, uGrain: { value: 0.035 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain; uniform vec3 uTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVig * 2.2;
      c.rgb *= v * uTint;
      c.rgb += (h(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

// ------------------------------------------------------------------ Game
class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.stats = { placed: 0, weathered: null };
    this.paused = false;
    this.lessonIdx = 0;
    this.showJointMarkers = false;
    this.time = cfg.time;
  }

  async build(audio) {
    const cfg = this.cfg;
    const setLoad = async (t) => { $('#loadText').textContent = t; await nextFrame(); };
    await setLoad('Clearing the ground…');

    const canvas = $('#c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.maxPR = Math.min(window.devicePixelRatio, cfg.quality === 'high' ? 1.75 : cfg.quality === 'medium' ? 1.25 : 1);
    renderer.setPixelRatio(this.maxPR);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = cfg.setting === 'underwater' ? 1.05 : 0.92;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 5000);
    this.camera = camera;

    const underwater = cfg.setting === 'underwater';
    this.physics = new Physics();
    this.physics.setUnderwater(underwater);

    // wall spec uses the environment's ground (without trench)
    const ctx = { scene, renderer, physics: this.physics, quality: cfg.quality, typeKey: cfg.stone };
    const EnvClass = cfg.setting === 'city' ? City : underwater ? Underwater : Countryside;
    // spec needs heightFn; create env first with a placeholder spec
    const spec = new WallSpec({ length: cfg.length, height: 1.0, heightFn: () => 0 });
    ctx.spec = spec;
    const env = new EnvClass(ctx);
    spec.heightFn = env.baseHeight;
    this.spec = spec;
    this.env = env;

    await setLoad(underwater ? 'Sinking the line…' : cfg.setting === 'city' ? 'Clearing the lot…' : 'Walking the old wall…');
    env.build();

    // physics ground
    const hf = sampleHeightfield(env.height, 18, 0.075);
    this.physics.addHeightfield(hf.H, hf.n, hf.n, 18, 18);
    // outer catch plane so nothing falls forever
    this.physics.addBox(60, 0.5, 60, 0, -3, 0);

    // sky + lights
    if (!underwater) {
      const R = REGIONS[cfg.stone];
      this.sky = new SkySystem(renderer, scene, { turbidity: cfg.setting === 'city' ? 7.5 : R.turbidity, cloudCover: R.clouds });
    }
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sm = cfg.quality === 'high' ? 4096 : cfg.quality === 'medium' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    const ext = cfg.length / 2 + 5.5;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.5; sc.far = 80;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.045;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ee, 0x5a4a32, 0.55);
    scene.add(this.hemi);
    this.applyTime(this.time, true);

    // guides
    this.guides = new Guides(scene, spec, { underwater });

    // stones
    await setLoad(underwater ? 'Lowering the stone…' : 'Carting the stone…');
    this.stones = [];
    await this.makePile();
    await setLoad('Letting it settle…');
    for (let i = 0; i < 5; i++) {
      for (let k = 0; k < 70; k++) this.physics.world.step();
      await nextFrame();
    }
    this.syncAll(true);

    // camera + controls
    camera.position.set(1.6, spec.ground(0) + 1.75, 4.3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, spec.ground(0) + 0.35, 0);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 0.7; controls.maxDistance = 24;
    controls.maxPolarAngle = 1.5;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.screenSpacePanning = false;
    controls.addEventListener('start', () => { this.controlsActive = true; });
    controls.addEventListener('end', () => { this.controlsActive = false; });
    this.controls = controls;

    // post-processing
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: cfg.quality === 'low' ? 0 : 4 });
    const composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (cfg.quality !== 'low') {
      const gtao = new GTAOPass(scene, camera, size.x / 2, size.y / 2);
      const gtaoSetSize = gtao.setSize.bind(gtao);
      gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
      gtao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: cfg.quality === 'high' ? 16 : 8, distanceFallOff: 1 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      gtao.blendIntensity = underwater ? 0.6 : 0.9;
      composer.addPass(gtao);
      this.gtao = gtao;
    }
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    if (underwater) this.grade.uniforms.uTint.value.set(0.96, 1.02, 1.04);
    composer.addPass(this.grade);
    this.composer = composer;

    // interaction, UI, audio, lesson
    this.ui = new UI(this);
    this.ui.setPlace(`${STONE_TYPES[cfg.stone].name} · ${env.name}`);
    this.interaction = new Interaction(this);
    this.audio = audio;
    this.steps = makeSteps(spec, STONE_TYPES[cfg.stone].name);
    this.physics.onImpact = null;
    this.makeJointMarkers();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    $('#timeLabel').textContent = { morning: 'Morning', afternoon: 'Afternoon', golden: 'Golden hour' }[this.time];

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.metrics = analyseWall(this);
    this.lastAnalysis = 0;
  }

  // ---------------------------------------------------------------- stones
  counts() {
    const L = this.cfg.length;
    return {
      foundation: Math.round(L * 6.5) + 2,
      builder: Math.round(L * 34) + 6,
      through: Math.max(2, Math.round(L / 0.9) + 1),
      cope: Math.ceil(L / 0.115) + 3,
      hearting: Math.round(L * 55),
    };
  }

  addStone(cls, seed, x, z, yaw, opts = {}) {
    const data = generateStone(this.cfg.stone, cls, seed);
    const mat = getStoneMaterial(this.cfg.stone);
    const mesh = new THREE.Mesh(data.geometry, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.tilt || 0, yaw, opts.roll || 0, 'YXZ'));
    // rest height: lowest point of the rotated hull over the ground
    let minY = Infinity;
    const v = new THREE.Vector3();
    const hp = data.hullPoints;
    for (let i = 0; i < hp.length; i += 3) { v.set(hp[i], hp[i + 1], hp[i + 2]).applyQuaternion(q); minY = Math.min(minY, v.y); }
    const y = (opts.y ?? this.env.height(x, z)) - minY + 0.006;
    const stone = { ...data, mesh, cls, seed };
    this.physics.addStone(stone, x, y, z, { x: q.x, y: q.y, z: q.z, w: q.w }, STONE_TYPES[this.cfg.stone].friction);
    mesh.userData.stone = stone;
    stone.prevV = new THREE.Vector3();
    stone.lastSound = 0;
    this.stones.push(stone);
    return stone;
  }

  async makePile() {
    const L = this.cfg.length, rng = mulberry32(4242 + L * 10);
    const n = this.counts();
    let seed = 1000;
    const half = L / 2;
    // footings close to the trench, alternating sides
    for (let i = 0; i < n.foundation; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2), per = Math.ceil(n.foundation / 2);
      const x = -half - 0.2 + (k + 0.5) * ((L + 0.4) / per) + rand(rng, -0.06, 0.06);
      const z = side * (0.98 + rand(rng, -0.05, 0.12));
      this.addStone('foundation', seed++, x, z, rand(rng, -0.5, 0.5) + Math.PI / 2 * (rng() < 0.5 ? 0 : 1));
    }
    await nextFrame();
    // builders in rows behind
    const cols = Math.max(6, Math.round((L + 1.6) / 0.42));
    let placed = 0;
    for (let row = 0; placed < n.builder; row++) {
      for (let c = 0; c < cols && placed < n.builder; c++) {
        for (const side of [1, -1]) {
          if (placed >= n.builder) break;
          const x = -half - 0.8 + (c + 0.5) * ((L + 1.6) / cols) + rand(rng, -0.05, 0.05);
          const z = side * (1.5 + row * 0.38 + rand(rng, -0.05, 0.05));
          this.addStone('builder', seed++, x, z, rng() * Math.PI * 2);
          placed++;
        }
      }
      if (row % 2 === 1) await nextFrame();
    }
    // throughs and copes at the ends
    for (let i = 0; i < n.through; i++) {
      const end = i % 2 ? 1 : -1;
      this.addStone('through', seed++, end * (half + 1.0 + Math.floor(i / 2) * 0.32), -1.0 - rand(rng, 0, 0.2), Math.PI / 2 + rand(rng, -0.1, 0.1));
    }
    for (let i = 0; i < n.cope; i++) {
      const end = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const x = end * (half + 0.95 + (k % 4) * 0.34), z = 0.95 + Math.floor(k / 4) * 0.5;
      this.addStone('cope', seed++, x, z, Math.PI / 2 + rand(rng, -0.15, 0.15));
    }
    await nextFrame();
    // hearting heaps behind the builders on both sides
    const builderRows = Math.ceil(n.builder / (cols * 2));
    const heapZ = 1.5 + builderRows * 0.38 + 0.45;
    const heaps = [[-half * 0.4, heapZ], [half * 0.4, -heapZ], [half * 0.6, heapZ], [-half * 0.6, -heapZ]];
    for (let i = 0; i < n.hearting; i++) {
      const [hx, hz] = heaps[i % heaps.length];
      const r = 0.42 * Math.sqrt(rng()), th = rng() * Math.PI * 2;
      const x = hx + Math.cos(th) * r, z = hz + Math.sin(th) * r;
      const cone = (0.42 - r) * 0.55;
      this.addStone('hearting', seed++, x, z, rng() * 6.28, { y: this.env.height(x, z) + cone + rng() * 0.25, tilt: rand(rng, -1, 1), roll: rand(rng, -1, 1) });
    }
    this.seed = seed;
    this.heaps = heaps;
  }

  syncAll(force = false) {
    for (const s of this.stones) {
      if (!force && s.body.isSleeping()) continue;
      const t = s.body.translation(), r = s.body.rotation();
      s.mesh.position.set(t.x, t.y, t.z);
      s.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  // velocity-change impact detection, every physics substep
  detectImpacts() {
    const now = this.elapsed;
    const camR = this._camR || (this._camR = new THREE.Vector3());
    camR.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const held = this.interaction.held;
    for (const s of this.stones) {
      const b = s.body;
      if (b.isSleeping()) { s.prevV.set(0, 0, 0); continue; }
      const v = b.linvel();
      const dvx = v.x - s.prevV.x, dvy = v.y - s.prevV.y, dvz = v.z - s.prevV.z;
      s.prevV.set(v.x, v.y, v.z);
      if (s === held) continue;
      const dv = Math.hypot(dvx, dvy, dvz);
      if (dv < 0.3 || now - s.lastSound < 0.07) continue;
      s.lastSound = now;
      const t = b.translation();
      const rel = new THREE.Vector3(t.x, t.y, t.z).sub(this.camera.position);
      const dist = rel.length();
      const pan = rel.dot(camR) / Math.max(1, dist);
      const att = 1 / (1 + dist / 4);
      const touch = this.physics.touching(s);
      const ground = touch.ground && touch.stones.length === 0;
      const strength = Math.min(1, dv * Math.sqrt(s.mass) / 5.5);
      const size = Math.cbrt(s.size.x * s.size.y * s.size.z);
      this.audio.impact(strength, size, STONE_TYPES[this.cfg.stone].sound, ground, pan, att);
    }
  }

  onStonePlaced() { this.lastAnalysis = -10; }

  // ---------------------------------------------------------------- light
  applyTime(time, initial = false) {
    this.time = time;
    const env = this.env;
    if (this.cfg.setting === 'underwater') {
      this.sun.color.set(0xd6f6f0); this.sun.intensity = 3.8;
      this.sun.position.set(4, 30, 6);
      this.hemi.color.set(0x8fdce0); this.hemi.groundColor.set(0x6a7a5a); this.hemi.intensity = 1.3;
      this.scene.environmentIntensity = 0.7;
      return;
    }
    const [el, az] = env.sunFor(time);
    const sunDir = this.sky.setSun(el, az);
    this.sunDir = sunDir.clone();
    const warm = new THREE.Color(1.0, 0.62, 0.36), noon = new THREE.Color(1.0, 0.96, 0.9);
    const f = THREE.MathUtils.smoothstep(el, 2, 35);
    this.sun.color.copy(warm).lerp(noon, f);
    this.sun.intensity = 2.9 + 0.9 * f;
    this.hemi.color.set(0x8fa8d0).lerp(new THREE.Color(0xc8d8f0), f);
    this.hemi.groundColor.set(0x4a3c28);
    this.hemi.intensity = 0.28 + 0.32 * f;
    this.scene.environmentIntensity = 0.32 + 0.3 * f;
    this.renderer.toneMappingExposure = 0.88 + (1 - f) * 0.12;
    const R = REGIONS[this.cfg.stone];
    const fogCol = new THREE.Color(0.86, 0.7, 0.56).lerp(new THREE.Color(0.7, 0.78, 0.88), f);
    if (this.cfg.setting === 'city') fogCol.lerp(new THREE.Color(0.75, 0.7, 0.66), 0.4);
    this.scene.fog = new THREE.FogExp2(fogCol, this.cfg.setting === 'city' ? 0.0045 : R.fog);
    if (env.setTime) env.setTime(time);
    if (!initial) this.ui?.toast({ morning: 'Morning', afternoon: 'Afternoon', golden: 'Golden hour' }[time], 1400);
  }

  placeSun() {
    if (this.cfg.setting === 'underwater') { this.sun.target.position.set(0, 0, 0); return; }
    const c = this.controls.target;
    this.sun.position.copy(this.sunDir).multiplyScalar(30).add(new THREE.Vector3(c.x, 0, 0));
    this.sun.target.position.set(c.x, 0, 0);
  }

  // ---------------------------------------------------------------- actions
  action(a) {
    if (a === 'hearting') this.pourHearting();
    else if (a === 'cart') this.moreStone();
    else if (a === 'weather') this.weather();
    else if (a === 'time') {
      const order = ['morning', 'afternoon', 'golden'];
      const t = order[(order.indexOf(this.time) + 1) % 3];
      this.applyTime(t);
      $('#timeLabel').textContent = { morning: 'Morning', afternoon: 'Afternoon', golden: 'Golden hour' }[t];
    } else if (a === 'sound') {
      this.audio.setEnabled(!this.audio.enabled);
      $('#soundLabel').textContent = this.audio.enabled ? 'Sound' : 'Muted';
    } else if (a === 'photo') this.togglePhoto();
    else if (a === 'menu') location.href = location.pathname;
  }

  holdAction(a) {
    const it = this.interaction;
    if (!it.held) return;
    const UP = new THREE.Vector3(0, 1, 0);
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0); camRight.y = 0; camRight.normalize();
    const camFwd = new THREE.Vector3().crossVectors(UP, camRight).normalize();
    if (a === 'ccw') it.rotateWorld(UP, Math.PI / 12);
    else if (a === 'cw') it.rotateWorld(UP, -Math.PI / 12);
    else if (a === 'tip') it.rotateWorld(camRight, Math.PI / 2);
    else if (a === 'roll') it.rotateWorld(camFwd, Math.PI / 2);
    else if (a === 'into') it.turnIntoWall();
    else if (a === 'edge') it.standOnEdge();
    else if (a === 'drop') it.release();
  }

  togglePhoto() {
    this.photo = !this.photo;
    this.ui.setPhoto(this.photo);
    if (this.photo) this.ui.toast('Photo mode — press P to return', 1800);
  }

  onKey(e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'h' && !this.interaction.held) this.pourHearting();
    else if (k === 'p') this.togglePhoto();
    else if (k === 'n') this.ui.togglePanel();
    else if (k === 'm') this.action('sound');
    else if (k === 'u' && this.snapshot) this.restoreSnapshot();
  }

  pourHearting() {
    const hit = this.interaction.castPointer();
    if (!hit) return;
    const p = hit.point;
    const spec = this.spec;
    const avail = this.stones.filter((s) => {
      if (s.cls !== 'hearting' || s === this.interaction.held) return false;
      const t = s.body.translation();
      return !(Math.abs(t.x) < spec.L / 2 + 0.3 && Math.abs(t.z) < spec.base / 2 + 0.2);
    });
    if (!avail.length) { this.ui.toast('The hearting heaps are empty — tip another load.'); return; }
    avail.sort((a, b) => {
      const ta = a.body.translation(), tb = b.body.translation();
      return (ta.y - tb.y) * -1; // take from the top of the heaps
    });
    const take = avail.slice(0, 7);
    take.forEach((s, i) => {
      const a = (i / take.length) * Math.PI * 2;
      s.body.setTranslation({ x: p.x + Math.cos(a) * 0.06, y: p.y + 0.18 + i * 0.07, z: p.z + Math.sin(a) * 0.06 }, true);
      s.body.setLinvel({ x: 0, y: -0.4, z: 0 }, true);
      s.body.setAngvel({ x: rand(Math.random, -3, 3), y: rand(Math.random, -3, 3), z: rand(Math.random, -3, 3) }, true);
      s.prevV.set(0, -0.4, 0);
    });
    this.audio.scrape(0.5);
    this.stats.placed++;
    this.lastAnalysis = -10;
  }

  moreStone() {
    const rng = mulberry32(this.seed * 7);
    const L = this.cfg.length;
    const half = L / 2;
    for (let i = 0; i < 24; i++) {
      const side = i % 2 ? 1 : -1;
      const x = rand(rng, -half - 0.6, half + 0.6), z = side * rand(rng, 1.4, 2.4);
      const cls = i % 8 === 0 ? 'foundation' : i % 11 === 5 ? 'through' : 'builder';
      this.addStone(cls, this.seed++, x, z, rng() * 6.28, { y: this.env.height(x, z) + 0.6 + rng() * 0.6, tilt: rand(rng, -0.6, 0.6) });
    }
    for (let i = 0; i < 40; i++) {
      const [hx, hz] = this.heaps[i % this.heaps.length];
      const x = hx + rand(rng, -0.3, 0.3), z = hz + rand(rng, -0.3, 0.3);
      this.addStone('hearting', this.seed++, x, z, rng() * 6.28, { y: this.env.height(x, z) + 0.5 + rng() * 0.5, tilt: rand(rng, -1, 1) });
    }
    this.ui.toast('Another load tipped off the cart.');
  }

  weather() {
    if (this.weathering) return;
    if (this.interaction.held) this.interaction.release();
    const spec = this.spec;
    this.snapshot = this.stones.map((s) => ({ s, t: { ...s.body.translation() }, r: { ...s.body.rotation() } }));
    const inWall = this.stones.filter((s) => { const t = s.body.translation(); return Math.abs(t.x) < spec.L / 2 + 0.2 && Math.abs(t.z) < spec.base / 2 + 0.15; });
    if (inWall.length < 5) { this.ui.toast('Build some wall first.'); this.snapshot = null; return; }
    this.weathering = { t: 0, inWall, start: inWall.map((s) => ({ ...s.body.translation() })) };
    const msgs = ['Frost heaves the footings…', 'Autumn rain, a hundred times over…', 'A heifer leans her whole weight on it…', 'Snow load, thaw, and settle…'];
    msgs.forEach((m, i) => setTimeout(() => this.ui.toast(m, 1700), i * 1700));
  }

  updateWeather(dt) {
    const w = this.weathering;
    if (!w) return;
    const prev = w.t;
    w.t += dt;
    const spec = this.spec;
    if (w.t < 6.8 && Math.floor(prev * 5) !== Math.floor(w.t * 5)) {
      const phase = Math.floor(w.t / 1.7);
      for (const s of w.inWall) {
        const m = s.mass;
        const t = s.body.translation();
        const yRel = t.y - spec.ground(t.x);
        let ix = rand(Math.random, -1, 1) * 0.08, iy = 0, iz = rand(Math.random, -1, 1) * 0.08;
        if (phase === 0 && yRel < 0.25) iy = 0.35;           // frost heave from below
        if (phase === 2) iz += (t.z > 0 ? -1 : 1) * 0.05 + 0.12 * Math.sign(Math.sin(t.x * 3)); // leaning cattle
        if (phase === 3) iy = -0.15;                            // snow load
        s.body.applyImpulse({ x: ix * m, y: iy * m, z: iz * m }, true);
      }
    }
    if (w.t > 9) {
      let moved = 0, fell = 0;
      w.inWall.forEach((s, i) => {
        const a = w.start[i], b = s.body.translation();
        const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (b.y < a.y - 0.18 || Math.abs(b.z) > spec.base / 2 + 0.2) fell++;
        else if (d > 0.06) moved++;
      });
      const n = w.inWall.length;
      let verdict;
      if (fell === 0 && moved <= Math.max(1, n * 0.03)) verdict = 'Not a stone out of place. It will outlast you.';
      else if (fell <= Math.max(1, n * 0.03)) verdict = `${fell} stone${fell === 1 ? '' : 's'} came down, ${moved} shifted. A gap to mend in spring.`;
      else verdict = `${fell} stones fell and ${moved} shifted. Look for running joints, traced stones and loose hearting.`;
      this.stats.weathered = verdict;
      this.ui.toast(`${verdict}<br><small style="font-family:var(--sans);font-size:12px;color:var(--ink-3)">Press U to put the wall back as it was.</small>`, 7000);
      this.weathering = null;
      this.lastAnalysis = -10;
    }
  }

  restoreSnapshot() {
    if (!this.snapshot) return;
    for (const { s, t, r } of this.snapshot) {
      s.body.setTranslation(t, true); s.body.setRotation(r, true);
      s.body.setLinvel({ x: 0, y: 0, z: 0 }, true); s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      s.body.sleep();
    }
    this.syncAll(true);
    this.snapshot = null;
    this.ui.toast('The wall is as you left it.', 1800);
  }

  // ---------------------------------------------------------------- lesson
  lessonStep(d) {
    this.lessonIdx = THREE.MathUtils.clamp(this.lessonIdx + d, 0, this.steps.length - 1);
    if (d > 0 && this.lessonIdx === this.steps.length - 1 && this._finished) {
      this.ui.setTab('notes');
    }
    if (d > 0 && this._lastIdx === this.steps.length - 1) { this._finished = true; this.ui.toast('That is a wall. Keep building, or start another.', 3000); }
    this._lastIdx = this.lessonIdx;
    this.lastAnalysis = -10;
  }

  makeJointMarkers() {
    this.jointMarkers = [];
    const geo = new THREE.BoxGeometry(0.012, 1, 0.012);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.85, depthTest: true });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, mat); m.visible = false; this.scene.add(m); this.jointMarkers.push(m);
    }
  }

  updateJointMarkers() {
    const pts = this.showJointMarkers ? this.metrics.runningAt : [];
    this.jointMarkers.forEach((m, i) => {
      const p = pts[i];
      m.visible = !!p;
      if (p) { m.position.set(p.x, p.y, p.z); m.scale.y = Math.max(0.12, p.h * 0.9); }
    });
  }

  // ---------------------------------------------------------------- loop
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  moveCamera(dt) {
    const keys = this.interaction.keys;
    const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
    const r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    if (!f && !r) return;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const mv = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).multiplyScalar(dt * 2.2);
    const tg = this.controls.target.clone().add(mv);
    tg.x = THREE.MathUtils.clamp(tg.x, -this.spec.L / 2 - 5, this.spec.L / 2 + 5);
    tg.z = THREE.MathUtils.clamp(tg.z, -5, 5);
    const d = tg.clone().sub(this.controls.target);
    d.y = this.spec.ground(tg.x) + 0.35 - this.controls.target.y;
    this.controls.target.add(d);
    this.camera.position.add(d);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    const t = this.elapsed;
    this.interaction.update(dt);
    this.updateWeather(dt);
    this.physics.step(dt, (h) => this.interaction.steer(h), () => this.detectImpacts());
    this.syncAll();
    this.moveCamera(dt);
    this.controls.update();
    this.camera.updateMatrixWorld();
    // keep the camera above ground
    const gy = this.env.height(this.camera.position.x, this.camera.position.z) + 0.25;
    if (this.camera.position.y < gy) this.camera.position.y = gy;
    this.env.update(dt, t, this.camera);
    if (this.sky) this.sky.update(t);
    this.placeSun();
    sharedUniforms.uTime.value = t;
    this.grade.uniforms.uTime.value = t % 10;

    if (t - this.lastAnalysis > 1.0) {
      this.lastAnalysis = t;
      this.metrics = analyseWall(this);
      const m = this.metrics;
      const line = THREE.MathUtils.clamp(Math.round((Math.max(m.height, 0) + 0.12) / 0.05) * 0.05, 0.15, this.spec.H);
      if (Math.abs(line - this.guides.lineY) > 0.01) this.guides.setLineHeight(line);
      if (this.cfg.mode === 'lesson') {
        const st = this.steps[this.lessonIdx];
        this.ui.renderLesson(this.steps, this.lessonIdx, st.check(m, this));
      }
      if (this.ui.tab === 'notes') this.ui.renderNotes(m, this.spec);
      this.updateJointMarkers();
    }
    if (!params.get('norender')) this.composer.render(dt);
    this.adapt(dt);
  }

  // keep the frame rate up by trading resolution
  adapt(dt) {
    if (params.get('still')) return;
    this._fa = (this._fa || 0) + dt; this._fn = (this._fn || 0) + 1;
    if (this._fa < 2.5) return;
    const avg = this._fa / this._fn;
    this._fa = 0; this._fn = 0;
    const pr = this.renderer.getPixelRatio();
    let next = pr;
    if (avg > 1 / 32 && pr > 0.6) next = Math.max(0.6, pr - 0.2);
    else if (avg < 1 / 55 && pr < this.maxPR) next = Math.min(this.maxPR, pr + 0.1);
    if (Math.abs(next - pr) > 0.01) { this.renderer.setPixelRatio(next); this.resize(); }
  }

  run() {
    if (params.get('still')) { this.frame(); return; } // test hook: render on demand
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}

// ------------------------------------------------------------------ menu
function seg(id, key) {
  const el = $(id);
  el.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === String(cfg[key]));
    b.addEventListener('click', () => {
      cfg[key] = key === 'length' ? parseFloat(b.dataset.v) : b.dataset.v;
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
  });
}

function buildMenu() {
  const wrap = $('#stoneCards');
  for (const t of Object.values(STONE_TYPES)) {
    const b = document.createElement('button');
    b.className = 'card stone' + (t.key === cfg.stone ? ' on' : '');
    b.dataset.v = t.key;
    b.innerHTML = `<span class="thumb" data-thumb="${t.key}"></span><b>${t.name}</b><span class="region">${t.region}</span>`;
    b.addEventListener('click', () => {
      cfg.stone = t.key;
      wrap.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c === b));
      blurb.textContent = t.blurb;
    });
    wrap.appendChild(b);
  }
  const blurb = document.createElement('p');
  blurb.className = 'stone-blurb';
  blurb.textContent = STONE_TYPES[cfg.stone].blurb;
  wrap.after(blurb);
  document.querySelectorAll('#settingCards .card').forEach((c) => {
    c.classList.toggle('on', c.dataset.v === cfg.setting);
    c.addEventListener('click', () => {
      cfg.setting = c.dataset.v;
      document.querySelectorAll('#settingCards .card').forEach((x) => x.classList.toggle('on', x === c));
    });
  });
  seg('#modeSeg', 'mode'); seg('#lenSeg', 'length'); seg('#timeSeg', 'time'); seg('#qualSeg', 'quality');
}

// Little studio renders of each stone for the menu.
function renderThumbs() {
  const W = 360, H = 270;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 20);
  cam.position.set(0.62, 0.46, 0.78); cam.lookAt(0.02, 0.06, 0.05);
  for (const t of Object.values(STONE_TYPES)) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15130f);
    const key = new THREE.DirectionalLight(0xfff1dc, 3.2); key.position.set(1.5, 2.5, 1.2); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -1; key.shadow.camera.right = 1; key.shadow.camera.top = 1; key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0005;
    scene.add(key, new THREE.HemisphereLight(0xb8c8e0, 0x3a3026, 1.0));
    const rim = new THREE.DirectionalLight(0xc8d8ff, 1.2); rim.position.set(-2, 1, -1.5); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a251f, roughness: 1 }));
    floor.receiveShadow = true; scene.add(floor);
    const mat = getStoneMaterial(t.key);
    const place = [['foundation', -0.18, -0.05, 0.4], ['builder', 0.25, 0.18, 1.7], ['builder', 0.2, -0.22, 2.6], ['hearting', -0.05, 0.28, 0.2], ['hearting', 0.02, 0.33, 1.0]];
    place.forEach(([cls, x, z, yaw], i) => {
      const d = generateStone(t.key, cls, 50 + i * 13 + t.key.length);
      const m = new THREE.Mesh(d.geometry, mat);
      m.rotation.y = yaw;
      m.position.set(x, -d.min.y, z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    });
    r.render(scene, cam);
    const url = canvas.toDataURL('image/jpeg', 0.88);
    document.querySelectorAll(`[data-thumb="${t.key}"]`).forEach((el) => { el.style.backgroundImage = `url(${url})`; });
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  r.dispose();
  r.forceContextLoss();
}

async function begin(audio) {
  $('#menu').classList.add('hidden');
  $('#loading').classList.remove('hidden');
  const game = new Game(cfg);
  window.game = game;
  try {
    await game.build(audio);
  } catch (err) {
    console.error(err);
    $('#loadText').textContent = 'Something went wrong building the scene: ' + err.message;
    return;
  }
  $('#loading').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  const region = cfg.stone;
  audio.start(game.env.audio, region).catch((e) => console.warn('audio', e));
  window.addEventListener('pointerdown', () => audio.ctx && audio.ctx.resume(), { once: true });
  game.run();
  const url = new URL(location.href);
  for (const [k, v] of Object.entries({ stone: cfg.stone, setting: cfg.setting, mode: cfg.mode, len: cfg.length, time: cfg.time, q: cfg.quality })) url.searchParams.set(k, v);
  history.replaceState(null, '', url);
  game.ui.toast(cfg.mode === 'lesson' ? 'Take your time. The wall will wait.' : 'The pile is yours.', 2600);
}

(async function main() {
  buildMenu();
  const physReady = Physics.init();
  try { renderThumbs(); } catch (e) { console.warn('thumbs', e); }
  await physReady;
  const btn = $('#begin');
  btn.disabled = false; btn.textContent = 'Begin';
  btn.addEventListener('click', () => {
    const audio = new SoundScape();
    audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); // unlock within the gesture
    begin(audio);
  });
  if (params.get('go') === '1') btn.click();
})();
