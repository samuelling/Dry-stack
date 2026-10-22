// The slow parts of the craft: dressing a stone with the hammer, pressing a
// set stone to feel whether it rocks, and reading where it bears.
import * as THREE from 'three';
import { dressStone, makeStoneMaterial, getStoneMaterial, cutFraction } from './stones.js';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

function hull2D(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// signed distance from point to convex polygon edges (positive inside)
function insideMargin(poly, x, z) {
  if (poly.length < 3) return -1;
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    const d = ((x - a[0]) * ez - (z - a[1]) * ex) / len; // >0 on the right
    m = Math.min(m, -d);
  }
  return m;
}

export class Craft {
  constructor(game) {
    this.game = game;
    this.tool = 'hand';
    this.depth = 0.015;
    this.tilt = 0;
    this.hover = null;
    this.cut = null;
    this.strike = null;
    this.press = null;
    this.labels = [];
    this.previewMat = makeStoneMaterial(game.cfg.stone);
    this.previewMat.userData.uniforms.uCutOn.value = 1;
    this.fitOn = game.cfg.mode === 'focus';

    // walling hammer
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x5a5d62, metalness: 0.85, roughness: 0.38 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.7 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.034, 0.12), steel);
    head.position.z = 0.06;
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.02, 0.012, 16).rotateX(Math.PI / 2), steel);
    face.position.z = 0.006;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.34, 10).rotateZ(Math.PI / 2), wood);
    handle.position.set(0.17, 0, 0.07);
    g.add(head, face, handle);
    g.traverse((o) => { o.castShadow = true; });
    g.visible = false;
    game.scene.add(g);
    this.hammer = g;

    // dust
    const n = 80;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.dustVel = new Float32Array(n * 3);
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd8cdb8, size: 0.006, transparent: true, opacity: 0, depthWrite: false }));
    this.dust.frustumCulled = false;
    game.scene.add(this.dust);
    this.dustT = 9;

    // chalk marks where a stone bears
    const cm = 64;
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cm * 3), 3));
    cg.setDrawRange(0, 0);
    this.chalk = new THREE.Points(cg, new THREE.PointsMaterial({ color: 0xfff6e0, size: 7, sizeAttenuation: false, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.chalk.renderOrder = 20;
    this.chalk.frustumCulled = false;
    game.scene.add(this.chalk);
    this.chalkT = 9;

    // fit dots: x-ray of where the held stone would bear (green) or nearly touch (amber)
    const fd = 200;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fd * 3), 3));
    fg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fd * 3), 3));
    fg.setDrawRange(0, 0);
    this.fitDots = new THREE.Points(fg, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }));
    this.fitDots.renderOrder = 21;
    this.fitDots.frustumCulled = false;
    game.scene.add(this.fitDots);
  }

  // ------------------------------------------------------------ fit light
  fitMap(stone) {
    const geo = stone.geometry;
    if (stone._fitGeo === geo) return stone._fit;
    const pos = geo.attributes.position, hp = stone.hullPoints;
    const nh = Math.min(hp.length / 3, 162);
    const dirs = [];
    for (let i = 0; i < nh; i++) dirs.push(new THREE.Vector3(hp[i * 3], hp[i * 3 + 1], hp[i * 3 + 2]).normalize());
    const idx = new Uint16Array(pos.count * 3), w = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      let b = [[-2, 0], [-2, 0], [-2, 0]];
      for (let j = 0; j < nh; j++) {
        const d = v.dot(dirs[j]);
        if (d > b[2][0]) { b[2] = [d, j]; b.sort((a, c) => c[0] - a[0]); }
      }
      let ws = 0;
      for (let k = 0; k < 3; k++) { const ww = Math.pow(Math.max(1e-4, b[k][0] + 1), 24); idx[i * 3 + k] = b[k][1]; w[i * 3 + k] = ww; ws += ww; }
      for (let k = 0; k < 3; k++) w[i * 3 + k] /= ws;
    }
    if (!geo.attributes.aFit) geo.setAttribute('aFit', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
    stone._fitGeo = geo;
    stone._fit = { idx, w, nh, vals: new Float32Array(nh) };
    return stone._fit;
  }

  updateFit(dt) {
    const it = this.game.interaction, s = it.held;
    if (!this.fitOn || !s || it.examining || !it.landing) return;
    this._fitT = (this._fitT || 0) + dt;
    if (this._fitT < 0.12) return;
    this._fitT = 0;
    const map = this.fitMap(s);
    const hp = s.hullPoints, q = it.targetQ, P = it.landing;
    const W = this.game.physics.world;
    const p = new THREE.Vector3();
    const dpos = this.fitDots.geometry.attributes.position, dcol = this.fitDots.geometry.attributes.color;
    let nd = 0;
    const lc = s.body.localCom();
    const com = new THREE.Vector3(lc.x, lc.y, lc.z).applyQuaternion(q).add(P);
    const bearing = [];
    const npts = hp.length / 3;
    for (let i = 0; i < npts; i++) {
      p.set(hp[i * 3], hp[i * 3 + 1], hp[i * 3 + 2]).applyQuaternion(q).add(P);
      const pr = W.projectPoint(p, true, undefined, undefined, s.collider, s.body);
      let d = 1;
      if (pr) d = pr.isInside ? 0 : Math.hypot(pr.point.x - p.x, pr.point.y - p.y, pr.point.z - p.z);
      if (i < map.nh) map.vals[i] = d < 0.004 ? 1 : d < 0.02 ? -(1 - (d - 0.004) / 0.016) : 0;
      if (d < 0.02 && nd < dpos.count) {
        dpos.setXYZ(nd, p.x, p.y, p.z);
        if (d < 0.004) dcol.setXYZ(nd, 0.45, 1.0, 0.55); else { const a = 1 - (d - 0.004) / 0.016; dcol.setXYZ(nd, 1.0 * a + 0.3, 0.6 * a + 0.2, 0.2); }
        nd++;
        if (d < 0.004 && p.y < com.y) bearing.push([p.x, p.z]);
      }
    }
    dpos.needsUpdate = true; dcol.needsUpdate = true;
    this.fitDots.geometry.setDrawRange(0, nd);
    // would it sit? bearing points spread around the centre of mass
    const uniq = [];
    for (const b of bearing) if (!uniq.some((u) => Math.hypot(u[0] - b[0], u[1] - b[1]) < 0.02)) uniq.push(b);
    const margin = insideMargin(hull2D(uniq), com.x, com.z);
    this.game.ui.fitReadout(uniq.length, margin);
    const a = s.geometry.attributes.aFit;
    for (let v = 0; v < a.count; v++) {
      let f = 0;
      for (let k = 0; k < 3; k++) f += map.vals[map.idx[v * 3 + k]] * map.w[v * 3 + k];
      a.array[v] = f;
    }
    a.needsUpdate = true;
  }

  clearFit(s) {
    this.fitDots.geometry.setDrawRange(0, 0);
    this.game.ui.fitReadout(null);
    const a = s && s.geometry.attributes.aFit;
    if (a) { a.array.fill(0); a.needsUpdate = true; }
  }

  setTool(t) {
    this.tool = t;
    this.clearHover();
    this.hammer.visible = false;
    this.game.ui.setTool(t);
    this.game.renderer.domElement.style.cursor = t === 'hammer' ? 'crosshair' : 'default';
  }

  clearHover() {
    if (this.hover) this.hover.mesh.material = getStoneMaterial(this.game.cfg.stone);
    this.hover = null; this.cut = null;
  }

  // ------------------------------------------------------------ hammer
  aim() {
    const it = this.game.interaction;
    if (this.tool !== 'hammer' || it.held || this.strike) return;
    const hit = it.castPointer();
    const stone = hit && hit.collider ? this.game.physics.bodies.get(hit.collider.handle) : null;
    if (!stone || !stone.shape || Math.max(stone.size.x, stone.size.z) < 0.05) { this.clearHover(); this.hammer.visible = false; this.game.ui.hammerInfo(null); return; }
    if (stone !== this.hover) { this.clearHover(); this.hover = stone; stone.mesh.material = this.previewMat; }
    const b = stone.body, t = b.translation(), r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const qi = _q.clone().invert();
    const pL = hit.point.clone().sub(_v.set(t.x, t.y, t.z)).applyQuaternion(qi);
    const nL = hit.normal.clone().applyQuaternion(qi).normalize();
    const radial = pL.clone().normalize();
    const n = nL.clone().multiplyScalar(0.65).addScaledVector(radial, 0.35).normalize();
    if (this.tilt) {
      const view = new THREE.Vector3(); this.game.camera.getWorldDirection(view); view.applyQuaternion(qi);
      const axis = new THREE.Vector3().crossVectors(n, view);
      if (axis.lengthSq() > 1e-6) n.applyAxisAngle(axis.normalize(), this.tilt);
    }
    const h = n.dot(pL) - this.depth;
    this.previewMat.userData.uniforms.uCut.value.set(n.x, n.y, n.z, h);
    // how much would go?
    const frac = cutFraction(stone, n, h);
    this.cut = { stone, n, h, frac, point: hit.point.clone(), normal: hit.normal.clone() };
    this.game.ui.hammerInfo({ depth: this.depth, tilt: this.tilt, frac, pointer: it.pointerPx });
    // place the hammer against the stone, handle up and toward the viewer
    const nW = hit.normal.clone();
    const up = new THREE.Vector3(0, 1, 0);
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.game.camera.matrixWorld, 0);
    const want = up.clone().addScaledVector(camRight, 0.8);
    let x = want.clone().addScaledVector(nW, -want.dot(nW));
    if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(nW, x);
    const m = new THREE.Matrix4().makeBasis(x, y, nW);
    this.hammer.quaternion.setFromRotationMatrix(m);
    this.hammer.userData.base = hit.point.clone().addScaledVector(nW, 0.004);
    this.hammer.userData.n = nW;
    if (!this.strike) this.hammer.position.copy(this.hammer.userData.base).addScaledVector(nW, 0.05);
    this.hammer.visible = true;
  }

  strikeNow() {
    if (!this.cut || this.strike) return;
    if (this.cut.frac > 0.42) { this.game.ui.toast('Too big a bite — that blow would split it. Take less.', 2200); return; }
    this.strike = { t: 0, cut: this.cut, applied: false };
  }

  applyCut(cut) {
    const g = this.game;
    const st = cut.stone;
    const res = dressStone(st, cut.n, cut.h);
    if (res.refused) { g.ui.toast('That would split it in two.', 1800); return; }
    if (!res.removed) { g.audio.hammer(0.5, 1.2, false); return; }
    g.physics.replaceCollider(st);
    st.mesh.geometry = st.geometry;
    g.audio.hammer(0.8, 1, true);
    this.burst(cut.point, cut.normal, res.flake ? 1 : 0.6);
    if (res.flake) g.addFlake(res.flake, st, cut.normal);
    g.stats.dressed = (g.stats.dressed || 0) + 1;
    g.lastAnalysis = -10;
    this.clearHover();
  }

  burst(p, n, amt) {
    const pos = this.dust.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, p.x, p.y, p.z);
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.9).add(n).normalize();
      const sp = (0.2 + Math.random() * 0.9) * amt;
      this.dustVel.set([d.x * sp, d.y * sp + 0.15, d.z * sp], i * 3);
    }
    pos.needsUpdate = true;
    this.dustT = 0;
  }

  // ------------------------------------------------------------ press test
  pressTest(stone) {
    const g = this.game;
    if (!stone || this.press) return;
    const touch = g.physics.touching(stone);
    const group = [stone, ...touch.stones];
    const snap = group.map((s) => ({ s, t: { ...s.body.translation() }, r: { ...s.body.rotation() } }));
    const r0 = stone.body.rotation();
    this.press = { stone, snap, t: 0, q0: new THREE.Quaternion(r0.x, r0.y, r0.z, r0.w), maxA: 0, side: 1, lastW: 0, tocks: 0 };
  }

  updatePress(dt) {
    const p = this.press;
    if (!p) return;
    const g = this.game;
    const prev = p.t;
    p.t += dt;
    const b = p.stone.body;
    if (p.t < 0.75 && Math.floor(prev / 0.13) !== Math.floor(p.t / 0.13)) {
      const t = b.translation(), r = b.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const s = p.stone.size;
      // press alternately on the two ends of the stone's top, like a hand testing it
      const ax = new THREE.Vector3(s.x >= s.z ? 1 : 0, 0, s.x >= s.z ? 0 : 1).applyQuaternion(_q);
      ax.y = 0; ax.normalize();
      const reach = Math.max(s.x, s.z) * 0.42 * p.side;
      const pt = { x: t.x + ax.x * reach, y: t.y + p.stone.max.y * 0.9, z: t.z + ax.z * reach };
      const J = Math.min(1.5, p.stone.mass * 0.06);
      b.applyImpulseAtPoint({ x: 0, y: -J, z: 0 }, pt, true);
      p.side *= -1;
    }
    const r = b.rotation();
    const a = p.q0.angleTo(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    p.maxA = Math.max(p.maxA, a);
    const w = b.angvel();
    const wm = Math.hypot(w.x, w.y, w.z);
    if (wm > 0.25 && p.lastW <= 0.25 && p.tocks < 6) { g.audio.tock(Math.min(1, wm), Math.cbrt(p.stone.size.x * p.stone.size.y * p.stone.size.z)); p.tocks++; }
    p.lastW = wm;
    if (p.t > 1.0) {
      for (const { s, t, r: rr } of p.snap) {
        s.body.setTranslation(t, true); s.body.setRotation(rr, true);
        s.body.setLinvel({ x: 0, y: 0, z: 0 }, true); s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
      const deg = THREE.MathUtils.radToDeg(p.maxA);
      let msg;
      if (deg < 0.35) msg = 'Solid. It doesn’t give at all.';
      else if (deg < 1.5) msg = `Rocks a hair (${deg.toFixed(1)}°) — a pinning would settle it.`;
      else msg = `It rocks (${deg.toFixed(1)}°). Find it a better bed, dress it, or pin it.`;
      this.label(p.stone, msg, deg < 0.35 ? 'good' : deg < 1.5 ? 'warn' : 'bad');
      this.press = null;
      this.bearing(p.stone, true);
    }
  }

  // ------------------------------------------------------------ bearing
  bearing(stone, quiet = false) {
    const g = this.game;
    const pts = g.physics.contactPoints(stone);
    const pos = this.chalk.geometry.attributes.position;
    const n = Math.min(pts.length, pos.count);
    for (let i = 0; i < n; i++) pos.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    pos.needsUpdate = true;
    this.chalk.geometry.setDrawRange(0, n);
    this.chalkT = 0;
    if (quiet) return;
    if (!pts.length) return;
    // merge near-duplicate points
    const uniq = [];
    for (const p of pts) if (!uniq.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.015)) uniq.push(p);
    const com = stone.body.worldCom();
    const below = uniq.filter((p) => p.y < com.y);
    const poly = hull2D(below.map((p) => [p.x, p.z]));
    const margin = insideMargin(poly, com.x, com.z);
    let msg, cls;
    if (below.length >= 3 && margin > 0.02) { msg = `Bears on ${below.length} points, well under its weight.`; cls = 'good'; }
    else if (below.length >= 3 && margin > 0) { msg = `Bears on ${below.length} points, but near the edge — check it.`; cls = 'warn'; }
    else { msg = `Only ${below.length} bearing point${below.length === 1 ? '' : 's'} — it will rock.`; cls = 'bad'; }
    this.label(stone, msg, cls);
  }

  label(stone, text, cls) {
    const el = document.createElement('div');
    el.className = 'flabel ' + (cls || '');
    el.textContent = text;
    document.getElementById('hud').appendChild(el);
    this.labels.push({ el, stone, t: 0 });
    if (this.labels.length > 3) { const o = this.labels.shift(); o.el.remove(); }
  }

  update(dt) {
    const g = this.game;
    this.aim();
    this.updateFit(dt);
    // strike animation
    if (this.strike) {
      const s = this.strike;
      s.t += dt;
      const base = this.hammer.userData.base, n = this.hammer.userData.n;
      let off;
      if (s.t < 0.16) off = 0.05 + 0.1 * Math.sin((s.t / 0.16) * Math.PI / 2); // draw back
      else if (s.t < 0.22) off = 0.15 * (1 - (s.t - 0.16) / 0.06);            // the blow
      else off = Math.min(0.05, (s.t - 0.22) * 0.4);
      if (base) this.hammer.position.copy(base).addScaledVector(n, off);
      if (!s.applied && s.t >= 0.22) { s.applied = true; this.applyCut(s.cut); }
      if (s.t > 0.4) this.strike = null;
    }
    // dust
    if (this.dustT < 1.2) {
      this.dustT += dt;
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        this.dustVel[i * 3 + 1] -= 3.5 * dt;
        pos.setXYZ(i, pos.getX(i) + this.dustVel[i * 3] * dt, pos.getY(i) + this.dustVel[i * 3 + 1] * dt, pos.getZ(i) + this.dustVel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      this.dust.material.opacity = Math.max(0, 0.8 * (1 - this.dustT / 1.2));
    } else this.dust.material.opacity = 0;
    // chalk
    this.chalkT += dt;
    this.chalk.material.opacity = this.chalkT < 4 ? Math.min(1, (4 - this.chalkT)) * 0.9 : 0;
    this.updatePress(dt);
    // floating labels
    for (const l of this.labels) {
      l.t += dt;
      const t = l.stone.body.translation();
      _v.set(t.x, t.y + l.stone.max.y + 0.06, t.z).project(g.camera);
      const x = (_v.x + 1) / 2 * innerWidth, y = (1 - _v.y) / 2 * innerHeight;
      l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      l.el.style.opacity = l.t < 4 ? 1 : Math.max(0, 1 - (l.t - 4));
    }
    this.labels = this.labels.filter((l) => { if (l.t > 5) { l.el.remove(); return false; } return true; });
  }
}
