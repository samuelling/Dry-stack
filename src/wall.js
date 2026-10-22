// Wall specification, batter frames and string lines.
import * as THREE from 'three';

export class WallSpec {
  constructor({ length = 3, base = 0.72, top = 0.42, height = 1.0, heightFn }) {
    this.L = length; this.base = base; this.top = top; this.H = height;
    this.heightFn = heightFn; // ground height (without trench)
  }
  // half width of the wall at height y above the ground line
  halfWidth(y) {
    const f = THREE.MathUtils.clamp(y / this.H, 0, 1.2);
    return (this.base - (this.base - this.top) * f) / 2;
  }
  ground(x) { return this.heightFn(x, 0); }
  inFootprint(x, z, margin = 0.1) {
    return Math.abs(x) <= this.L / 2 + margin && Math.abs(z) <= this.base / 2 + margin;
  }
}

// trench depth helper used by every environment's height function
export function trenchOffset(spec, x, z, depth = 0.07) {
  const hw = spec.base / 2 + 0.05;
  const mz = 1 - THREE.MathUtils.smoothstep(Math.abs(z), hw - 0.06, hw + 0.05);
  const mx = 1 - THREE.MathUtils.smoothstep(Math.abs(x), spec.L / 2 + 0.05, spec.L / 2 + 0.25);
  return -depth * mz * mx;
}

function board(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export class Guides {
  constructor(scene, spec, { underwater = false } = {}) {
    this.spec = spec;
    this.group = new THREE.Group();
    scene.add(this.group);
    const wood = new THREE.MeshStandardMaterial({ color: underwater ? 0x6d6a52 : 0xb08a5a, roughness: 0.85 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x7a5c3b, roughness: 0.9 });
    this.frames = [];
    for (const sx of [-1, 1]) {
      const x = sx * (spec.L / 2 + 0.12);
      const g = spec.ground(x);
      const f = new THREE.Group();
      f.position.set(x, g, 0);
      const H = spec.H + 0.15;
      for (const sz of [-1, 1]) {
        // sloped leg following the batter
        const zb = sz * (spec.base / 2), zt = sz * (spec.top / 2);
        const len = Math.hypot(H, zb - zt);
        const leg = board(0.045, len, 0.022, wood);
        leg.position.set(0, H / 2, (zb + zt) / 2);
        leg.rotation.x = Math.atan2(zt - zb, H);
        f.add(leg);
        // stake
        const stake = board(0.04, 0.5, 0.04, woodDark);
        stake.position.set(-sx * 0.05, 0.1, zb + sz * 0.05);
        f.add(stake);
      }
      for (const yy of [0.03, H * 0.55, H]) {
        const w = spec.halfWidth(yy) * 2 + 0.08;
        const cross = board(0.03, 0.06, w, wood);
        cross.position.set(sx * 0.03, yy, 0);
        f.add(cross);
      }
      // diagonal brace
      const br = board(0.025, H * 0.8, 0.04, woodDark);
      br.position.set(sx * 0.18, H * 0.38, 0);
      br.rotation.z = sx * 0.35;
      f.add(br);
      this.group.add(f);
      this.frames.push(f);
    }
    // string lines
    const lineMat = new THREE.MeshBasicMaterial({ color: underwater ? 0xffe14a : 0xf2e14b });
    this.lines = [];
    for (const sz of [-1, 1]) {
      const geo = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4, 1, true);
      geo.rotateZ(Math.PI / 2);
      const m = new THREE.Mesh(geo, lineMat);
      this.group.add(m);
      this.lines.push({ mesh: m, side: sz });
    }
    this.setLineHeight(0.18);
  }

  setLineHeight(y) {
    y = THREE.MathUtils.clamp(y, 0.1, this.spec.H + 0.05);
    this.lineY = y;
    const xa = -(this.spec.L / 2 + 0.12), xb = this.spec.L / 2 + 0.12;
    const ga = this.spec.ground(xa), gb = this.spec.ground(xb);
    const hw = this.spec.halfWidth(y);
    for (const l of this.lines) {
      const a = new THREE.Vector3(xa, ga + y, l.side * hw), b = new THREE.Vector3(xb, gb + y, l.side * hw);
      l.mesh.position.copy(a).add(b).multiplyScalar(0.5);
      l.mesh.scale.set(a.distanceTo(b), 1, 1);
      l.mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }

  // The string's height at x (ground line + current line height)
  lineAt(x) { return this.spec.ground(x) + this.lineY; }

  setVisible(v) { this.group.visible = v; }
}
