// Lifting, carrying, turning and setting stones. The held stone stays a
// dynamic body steered by velocity, so it still nudges and is nudged.
import * as THREE from 'three';
import { RAPIER } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);
const STRENGTH = 450; // newtons the builder can put into a stone with both hands

export class Interaction {
  constructor(game) {
    this.game = game;
    this.held = null;
    this.effort = 0; this.effortRaw = 0;
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
    this.nudge = new THREE.Vector3();
    this.examining = false;
    this.ghosted = false;
    this.lastPlaced = null;
    const el = game.renderer.domElement;
    this.el = el;
    window.addEventListener('pointerdown', (e) => this.onDown(e), true);
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false, capture: true });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => { this.setPointer(e); this.lookClosely(); });

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
      if (this.examining) { this.endExamine(); return; }
      this.release();
      return;
    }
    const craft = this.game.craft;
    if (craft && craft.tool === 'hammer') {
      if (craft.cut) { e.stopPropagation(); craft.strikeNow(); }
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
    if (this.held && this.examining) {
      const dx = e.movementX || 0, dy = e.movementY || 0;
      const camRight = new THREE.Vector3().setFromMatrixColumn(this.game.camera.matrixWorld, 0);
      const camUp = new THREE.Vector3().setFromMatrixColumn(this.game.camera.matrixWorld, 1);
      this.targetQ.premultiply(new THREE.Quaternion().setFromAxisAngle(camUp, dx * 0.012));
      this.targetQ.premultiply(new THREE.Quaternion().setFromAxisAngle(camRight, dy * 0.012)).normalize();
      return;
    }
    if (this.held && this.nudge.lengthSq() > 0) {
      if (!this._nudgeFrom) this._nudgeFrom = { x: e.clientX, y: e.clientY };
      else if (Math.hypot(e.clientX - this._nudgeFrom.x, e.clientY - this._nudgeFrom.y) > 6) { this.nudge.set(0, 0, 0); this._nudgeFrom = null; }
    }
    this.setPointer(e);
    if (!this.held && e.target === this.el && !this.game.controlsActive) {
      const now = performance.now();
      if (!this._lastHover || now - this._lastHover > 50) {
        this._lastHover = now;
        if (this.game.craft && this.game.craft.tool === 'hammer') { this.game.ui.hoverStone(null); return; }
        this.hover = this.stoneUnderPointer();
        this.game.ui.hoverStone(this.hover, this.pointerPx);
        this.el.style.cursor = this.hover ? 'grab' : 'default';
      }
    }
  }

  onUp(e) {
    if (e.button !== 0) return;
    if (!this.held || !this.press) return;
    this.press = false;
    const dt = performance.now() - this.downAt;
    if (dt < 280) { this.sticky = true; return; } // a click: keep carrying until the next click
    this.release();
  }

  onWheel(e) {
    // plain wheel / pinch always zooms (OrbitControls); Shift+wheel works the stone or hammer
    if (!e.shiftKey) return;
    const craft = this.game.craft;
    const d = e.deltaY || e.deltaX;
    if (this.held) {
      e.preventDefault(); e.stopPropagation();
      this.wheelAcc = (this.wheelAcc || 0) + d;
      if (Math.abs(this.wheelAcc) > 40) {
        this.rotateWorld(UP, THREE.MathUtils.degToRad(10 * Math.sign(this.wheelAcc)));
        this.wheelAcc = 0;
      }
    } else if (craft && craft.tool === 'hammer') {
      e.preventDefault(); e.stopPropagation();
      craft.depth = THREE.MathUtils.clamp(craft.depth * (d > 0 ? 0.9 : 1.1), 0.003, 0.06);
    }
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) { if (k === ' ') this.clearance = 0.035; return; }
    if (this.game.paused) return;
    const fine = e.shiftKey ? 1 / 6 : 1;
    const craft = this.game.craft;
    if (k === 'z') { this.lookClosely(); return; }
    if (!this.held && craft) {
      if (k === '1') { craft.setTool('hand'); return; }
      if (k === '2' || k === 'g') { craft.setTool(craft.tool === 'hammer' ? 'hand' : 'hammer'); return; }
      if (k === 'x') { craft.pressTest(this.stoneUnderPointer() || this.lastPlaced); return; }
      if (craft.tool === 'hammer') {
        if (k === 'q') craft.tilt = Math.max(-0.9, craft.tilt - 0.15);
        else if (k === 'e') craft.tilt = Math.min(0.9, craft.tilt + 0.15);
        else if (k === '[') craft.depth = Math.max(0.003, craft.depth * 0.8);
        else if (k === ']') craft.depth = Math.min(0.06, craft.depth * 1.25);
        return;
      }
    }
    if (this.held) {
      if (k.startsWith('arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 0.001 : 0.004;
        const camRight = new THREE.Vector3().setFromMatrixColumn(this.game.camera.matrixWorld, 0); camRight.y = 0; camRight.normalize();
        const camFwd = new THREE.Vector3().crossVectors(UP, camRight).normalize();
        if (k === 'arrowleft') this.nudge.addScaledVector(camRight, -step);
        if (k === 'arrowright') this.nudge.addScaledVector(camRight, step);
        if (k === 'arrowup') this.nudge.addScaledVector(camFwd, step);
        if (k === 'arrowdown') this.nudge.addScaledVector(camFwd, -step);
        this._nudgeFrom = null;
        return;
      }
      if (k === 'v') { if (this.examining) this.endExamine(); else this.startExamine(); return; }
    }
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
      else if (k === 'escape') { if (this.examining) this.endExamine(); else this.release(); }
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
    this.placing = false;
    this.effort = 0;
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
    this.nudge.set(0, 0, 0);
    this.game.controls.mouseButtons.LEFT = -1; // left is for the stone now; right-drag still orbits
    this.el.style.cursor = 'grabbing';
    this.game.audio.scrape(0.35);
    this.game.ui.hoverStone(null);
    this.game.ui.setHolding(stone);
    this.ring.visible = true; this.drop.visible = true;
  }

  // Setting a stone down is not dropping it: lower it slowly onto whatever is beneath, and only
  // let go once it is touching and still.
  release(force = false) {
    const s = this.held;
    if (!s || this.placing) return;
    if (force || this.examining || this.ghosted) { this.finishRelease(); return; }
    const t = s.body.translation();
    this.placing = true;
    this.placeT = 0;
    this.placeXZ = { x: t.x, z: t.z };
    this.placeY = t.y;
    this.ring.visible = true;
  }

  updatePlacing(dt) {
    const s = this.held;
    this.placeT += dt;
    const touch = this.game.physics.touching(s);
    const contact = touch.ground || touch.stones.length > 0;
    const v = s.body.linvel();
    const still = Math.hypot(v.x, v.y, v.z) < 0.08;
    // lower at a walking-the-stone-down pace; heavier stones go down a touch slower
    const speed = THREE.MathUtils.clamp(0.22 / Math.sqrt(Math.max(1, s.mass / 10)), 0.07, 0.22);
    this.placeY -= speed * dt;
    const floor = this.landing ? this.landing.y - 0.012 : -Infinity;   // lean slightly into the bed
    this.placeY = Math.max(this.placeY, floor);
    this.target.set(this.placeXZ.x, this.placeY, this.placeXZ.z);
    this.smoothTarget.copy(this.target);
    const t = s.body.translation();
    this.ring.position.x = t.x; this.ring.position.z = t.z;
    if ((contact && this.placeT > 0.1 && (still || this.placeT > 0.5)) || this.placeT > 2.2) this.finishRelease();
  }

  finishRelease() {
    const s = this.held;
    if (!s) return;
    this.placing = false;
    const b = s.body;
    b.setGravityScale(1, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (this.ghosted) { this.game.physics.setGhost(s, false); this.ghosted = false; }
    this.examining = false;
    this.held = null;
    this.lastPlaced = s;
    if (this.game.craft) this.game.craft.clearFit(s);
    this.game.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.el.style.cursor = 'default';
    this.game.stats.placed++;
    this.game.ui.setHolding(null);
    this.ring.visible = false; this.drop.visible = false;
    this.game.onStonePlaced(s);
  }

  // Called once per frame: where should the stone go?
  startExamine() {
    const s = this.held;
    if (!s) return;
    this.examining = true;
    this.game.physics.setGhost(s, true);
    this.ghosted = true;
    this.ring.visible = false; this.drop.visible = false;
    this.game.ui.toast('Turn it in your hands — move the mouse. V or click to put it back to the wall.', 2600);
  }

  endExamine() {
    this.examining = false;
    this.ring.visible = true; this.drop.visible = true;
    // collisions come back once it is clear of everything (see update)
  }

  lookClosely() {
    const hit = this.castPointer(this.held ? this.held.body : null);
    if (!hit) return;
    this.game.flyTo(hit.point, 0.75);
  }

  update(dt) {
    const s = this.held;
    if (!s) return;
    if (this.placing) { this.updatePlacing(dt); return; }
    if (this.examining) {
      const cam = this.game.camera;
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
      const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const d = THREE.MathUtils.clamp(Math.max(s.size.x, s.size.z) * 1.6, 0.25, 0.9);
      this.target.copy(cam.position).addScaledVector(fwd, d).addScaledVector(camUp, -0.03);
      const k = 1 - Math.exp(-dt * 8);
      this.smoothTarget.lerp(this.target, k);
      return;
    }
    if (this.ghosted) {
      const t = s.body.translation(), r = s.body.rotation();
      let clear = true;
      this.game.physics.world.intersectionsWithShape(t, r, this.heldShape, () => { clear = false; return false; }, undefined, undefined, s.collider, s.body);
      if (clear) { this.game.physics.setGhost(s, false); this.ghosted = false; }
    }
    const hit = this.castPointer(s.body);
    if (hit) {
      hit.point.add(this.nudge);
      const w = this.game.physics.world;
      const start = { x: hit.point.x, y: hit.point.y + 1.6, z: hit.point.z };
      const rot = { x: this.targetQ.x, y: this.targetQ.y, z: this.targetQ.z, w: this.targetQ.w };
      const sc = w.castShape(start, rot, { x: 0, y: -1, z: 0 }, this.heldShape, 0, 3.5, true, undefined, undefined, s.collider, s.body);
      let y = hit.point.y + 0.15;
      // An overlap at the very start of the cast (toi ~ 0) means the probe began inside something,
      // not that the ground is 1.6 m up. Keep the last sensible height instead of lifting the stone.
      if (sc && sc.time_of_impact > 0.02) y = start.y - sc.time_of_impact;
      else if (sc && this.landing) y = this.landing.y;
      // never ask the hands to rise more than a step above where the pointer meets the surface
      y = Math.min(y, hit.point.y + 0.9);
      this.landing = new THREE.Vector3(hit.point.x, y, hit.point.z);
      this.target.set(hit.point.x, y + this.clearance, hit.point.z);
      // keep stones inside the work area
      this.target.x = THREE.MathUtils.clamp(this.target.x, -this.game.spec.L / 2 - 4, this.game.spec.L / 2 + 4);
      this.target.z = THREE.MathUtils.clamp(this.target.z, -4, 4);
      this.ring.position.set(hit.point.x, hit.point.y + 0.004, hit.point.z);
      this.surface = hit;
    }
    this.effort += ((this.effortRaw || 0) - this.effort) * (1 - Math.exp(-dt * 6));
    this.game.ui.effort(this.effort, s.mass);
    // lift feel: heavy stones come up a little slower
    const k = 1 - Math.exp(-dt * (14 / Math.pow(Math.max(1, s.mass / 8), 0.6)));
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
    // The builder is only so strong. Speed falls with weight, and the force the hands can
    // deliver is capped, so heavy stones lag, take time to get going, and give way slowly
    // (or not at all) when they push against something heavier than the hands can shift.
    const m = s.mass;
    const vmax = this.placing ? 0.25 : THREE.MathUtils.clamp(4.2 * Math.pow(20 / m, 0.9), 0.3, 4.2);
    let vx = dx * 12, vy = dy * 12, vz = dz * 12;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; vz *= vmax / sp; }
    const cv0 = b.linvel();
    // contact push-out must not build up into a launch: keep inherited speed near what we asked for
    const cs = Math.hypot(cv0.x, cv0.y, cv0.z), lim = vmax * 1.25 + 0.2;
    const cvk = cs > lim ? lim / cs : 1;
    const cv = { x: cv0.x * cvk, y: cv0.y * cvk, z: cv0.z * cvk };
    let ax = vx - cv.x, ay = vy - cv.y, az = vz - cv.z;
    const need = Math.hypot(ax, ay, az) / h * m;           // newtons wanted this step
    const cap = STRENGTH * (this.examining ? 2 : 1);
    if (need > cap) { const f = cap / need; ax *= f; ay *= f; az *= f; }
    this.effortRaw = Math.min(1, need / cap);
    b.setLinvel({ x: cv.x + ax, y: cv.y + ay, z: cv.z + az }, true);
    const r = b.rotation();
    const cq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const err = this.targetQ.clone().multiply(cq.invert());
    if (err.w < 0) { err.x *= -1; err.y *= -1; err.z *= -1; err.w *= -1; }
    const ang = 2 * Math.acos(Math.min(1, err.w));
    const sn = Math.sqrt(1 - err.w * err.w);
    let wx = 0, wy = 0, wz = 0;
    if (sn > 1e-4) {
      const w = Math.min(ang * 10, THREE.MathUtils.clamp(5 * Math.pow(20 / m, 0.5), 1.2, 5));
      wx = (err.x / sn) * w; wy = (err.y / sn) * w; wz = (err.z / sn) * w;
    }
    b.setAngvel({ x: wx, y: wy, z: wz }, true);
  }
}
