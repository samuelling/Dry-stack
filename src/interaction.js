// Lifting, carrying, turning and setting stones. The held stone stays a
// dynamic body steered by velocity, so it still nudges and is nudged.
import * as THREE from 'three';
import { RAPIER } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Interaction {
  constructor(game) {
    this.game = game;
    this.held = null;
    this.hover = null;
    this.pointer = new THREE.Vector2();
    this.pointerPx = { x: 0, y: 0 };
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.targetQ = new THREE.Quaternion();
    this.clearance = 0.035;
    this.press = false;
    this.downAt = 0;
    this.sticky = false;
    this.surface = null;
    this.keys = new Set();
    const el = game.renderer.domElement;
    this.el = el;
    window.addEventListener('pointerdown', (e) => this.onDown(e), true);
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false, capture: true });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // landing marker
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.visible = false; ring.renderOrder = 5;
    game.scene.add(ring);
    this.ring = ring;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
    this.drop = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.35 }));
    this.drop.visible = false;
    game.scene.add(this.drop);
  }

  setPointer(e) {
    const r = this.el.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerPx = { x: e.clientX, y: e.clientY };
  }

  ray() {
    const cam = this.game.camera;
    const o = cam.position.clone();
    const d = new THREE.Vector3(this.pointer.x, this.pointer.y, 0.5).unproject(cam).sub(o).normalize();
    return { o, d };
  }

  castPointer(excludeBody = null) {
    const { o, d } = this.ray();
    const w = this.game.physics.world;
    const hit = w.castRayAndGetNormal(new RAPIER.Ray(o, d), 60, true, undefined, undefined, undefined, excludeBody || undefined);
    if (!hit) {
      // fall back to the ground plane
      const t = -o.y / d.y;
      if (t > 0 && t < 200) return { point: o.clone().addScaledVector(d, t), collider: null, normal: UP.clone() };
      return null;
    }
    const p = o.clone().addScaledVector(d, hit.timeOfImpact);
    return { point: p, collider: hit.collider, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) };
  }

  stoneUnderPointer() {
    const h = this.castPointer();
    if (!h || !h.collider) return null;
    return this.game.physics.bodies.get(h.collider.handle) || null;
  }

  onDown(e) {
    if (e.target !== this.el) return;
    if (this.game.paused) return;
    this.setPointer(e);
    if (e.button !== 0) return;
    if (this.held) {
      // click while carrying (sticky mode) sets the stone down
      e.stopPropagation();
      this.release();
      return;
    }
    const s = this.stoneUnderPointer();
    if (s) {
      e.stopPropagation();
      this.pick(s);
      this.press = true;
      this.downAt = performance.now();
      this.sticky = false;
    }
  }

  onMove(e) {
    this.setPointer(e);
    if (!this.held && e.target === this.el && !this.game.controlsActive) {
      const now = performance.now();
      if (!this._lastHover || now - this._lastHover > 50) {
        this._lastHover = now;
        this.hover = this.stoneUnderPointer();
        this.game.ui.hoverStone(this.hover, this.pointerPx);
        this.el.style.cursor = this.hover ? 'grab' : 'default';
      }
    }
  }

  onUp(e) {
    if (!this.held || !this.press) return;
    this.press = false;
    const dt = performance.now() - this.downAt;
    if (dt < 280) { this.sticky = true; return; } // a click: keep carrying until the next click
    this.release();
  }

  onWheel(e) {
    if (!this.held) return;
    e.preventDefault(); e.stopPropagation();
    this.wheelAcc = (this.wheelAcc || 0) + e.deltaY;
    if (Math.abs(this.wheelAcc) > 40) {
      const step = (e.shiftKey ? 5 : 15) * Math.sign(this.wheelAcc);
      this.rotateWorld(UP, THREE.MathUtils.degToRad(step));
      this.wheelAcc = 0;
    }
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) { if (k === ' ') this.clearance = 0.035; return; }
    if (this.game.paused) return;
    const fine = e.shiftKey ? 1 / 6 : 1;
    if (this.held) {
      const camRight = new THREE.Vector3().setFromMatrixColumn(this.game.camera.matrixWorld, 0); camRight.y = 0; camRight.normalize();
      const camFwd = new THREE.Vector3().crossVectors(UP, camRight).normalize();
      if (k === 'q') this.rotateWorld(UP, THREE.MathUtils.degToRad(15 * fine));
      else if (k === 'e') this.rotateWorld(UP, THREE.MathUtils.degToRad(-15 * fine));
      else if (k === 'r') this.rotateWorld(camRight, Math.PI / 2 * fine);
      else if (k === 'f') this.rotateWorld(camFwd, Math.PI / 2 * fine);
      else if (k === 't') this.turnIntoWall();
      else if (k === 'c') this.standOnEdge();
      else if (k === ' ') { this.clearance = -0.004; e.preventDefault(); }
      else if (k === 'escape') this.release();
    }
  }

  rotateWorld(axis, ang) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    this.targetQ.premultiply(q).normalize();
    this.game.audio.scrape(0.15);
  }

  // length (local x) across the wall (world z), bed (local y) up, nearest of the four options
  turnIntoWall() {
    const cur = this.targetQ.clone();
    let best = null, bestD = Infinity;
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
      for (const flip of [0, Math.PI]) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(flip, yaw, 0, 'YXZ'));
        const d = q.angleTo(cur);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    this.targetQ.copy(best);
    this.game.audio.scrape(0.2);
  }

  // cope: length across the wall, thin axis along the wall, stood on edge
  standOnEdge() {
    const cur = this.targetQ.clone();
    let best = null, bestD = Infinity;
    for (const a of [0, Math.PI]) for (const b of [0, Math.PI]) {
      // local x -> world z, local y -> world x, local z -> world y
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), b));
      const d = q.angleTo(cur);
      if (d < bestD) { bestD = d; best = q; }
    }
    this.targetQ.copy(best);
    this.game.audio.scrape(0.2);
  }

  pick(stone) {
    this.held = stone;
    this.heldShape = stone.collider.shape;
    const b = stone.body;
    b.setGravityScale(0, true);
    b.wakeUp();
    const r = b.rotation();
    this.targetQ.set(r.x, r.y, r.z, r.w);
    const t = b.translation();
    this.smoothTarget.set(t.x, t.y + 0.05, t.z);
    this.target.copy(this.smoothTarget);
    this.liftT = 0;
    this.game.controls.enabled = false;
    this.el.style.cursor = 'grabbing';
    this.game.audio.scrape(0.35);
    this.game.ui.hoverStone(null);
    this.game.ui.setHolding(stone);
    this.ring.visible = true; this.drop.visible = true;
  }

  release() {
    const s = this.held;
    if (!s) return;
    const b = s.body;
    b.setGravityScale(1, true);
    const v = b.linvel();
    b.setLinvel({ x: v.x * 0.2, y: Math.min(0, v.y) * 0.2, z: v.z * 0.2 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.held = null;
    this.game.controls.enabled = true;
    this.el.style.cursor = 'default';
    this.game.stats.placed++;
    this.game.ui.setHolding(null);
    this.ring.visible = false; this.drop.visible = false;
    this.game.onStonePlaced(s);
  }

  // Called once per frame: where should the stone go?
  update(dt) {
    const s = this.held;
    if (!s) return;
    const hit = this.castPointer(s.body);
    if (hit) {
      const w = this.game.physics.world;
      const start = { x: hit.point.x, y: hit.point.y + 1.6, z: hit.point.z };
      const rot = { x: this.targetQ.x, y: this.targetQ.y, z: this.targetQ.z, w: this.targetQ.w };
      const sc = w.castShape(start, rot, { x: 0, y: -1, z: 0 }, this.heldShape, 0, 3.5, true, undefined, undefined, s.collider, s.body);
      let y = hit.point.y + 0.15;
      if (sc) y = start.y - sc.time_of_impact;
      this.target.set(hit.point.x, y + this.clearance, hit.point.z);
      // keep stones inside the work area
      this.target.x = THREE.MathUtils.clamp(this.target.x, -this.game.spec.L / 2 - 4, this.game.spec.L / 2 + 4);
      this.target.z = THREE.MathUtils.clamp(this.target.z, -4, 4);
      this.ring.position.set(hit.point.x, hit.point.y + 0.004, hit.point.z);
      this.surface = hit;
    }
    // lift feel: heavy stones come up a little slower
    const k = 1 - Math.exp(-dt * (14 / Math.sqrt(Math.max(1, s.mass / 8))));
    this.smoothTarget.lerp(this.target, k);
    const t = s.body.translation();
    this.drop.position.set(t.x, this.ring.position.y, t.z);
    this.drop.scale.set(1, Math.max(0.001, t.y - this.ring.position.y), 1);
    this.ring.position.x = t.x; this.ring.position.z = t.z;
  }

  // Called every physics sub-step.
  steer(h) {
    const s = this.held;
    if (!s) return;
    const b = s.body;
    const t = b.translation();
    const dx = this.smoothTarget.x - t.x, dy = this.smoothTarget.y - t.y, dz = this.smoothTarget.z - t.z;
    const vmax = THREE.MathUtils.clamp(3.2 / Math.sqrt(s.mass / 5), 0.7, 4);
    let vx = dx * 12, vy = dy * 12, vz = dz * 12;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; vz *= vmax / sp; }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    const r = b.rotation();
    const cq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const err = this.targetQ.clone().multiply(cq.invert());
    if (err.w < 0) { err.x *= -1; err.y *= -1; err.z *= -1; err.w *= -1; }
    const ang = 2 * Math.acos(Math.min(1, err.w));
    const sn = Math.sqrt(1 - err.w * err.w);
    let wx = 0, wy = 0, wz = 0;
    if (sn > 1e-4) {
      const w = Math.min(ang * 10, 5);
      wx = (err.x / sn) * w; wy = (err.y / sn) * w; wz = (err.z / sn) * w;
    }
    b.setAngvel({ x: wx, y: wy, z: wz }, true);
  }
}
