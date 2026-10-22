// Old, weathered walls running off across the landscape (static, instanced).
import * as THREE from 'three';
import { generateStone, getStoneMaterial } from './stones.js';
import { mulberry32, rand, makeNoise3 } from './noise.js';

const NZ = makeNoise3(404);

export function buildOldWalls({ paths, heightFn, typeKey, seed = 11, maxStones = 6000, height = 0.95, nearCollide = 0, physics = null, tumble = 0.3 }) {
  const rng = mulberry32(seed);
  const variants = [];
  for (let i = 0; i < 14; i++) {
    const s = generateStone(typeKey, i % 3 === 0 ? 'foundation' : 'builder', 9000 + seed * 31 + i);
    // lower-detail copy is fine for distant walls; reuse geometry as is
    variants.push(s);
  }
  const mat = getStoneMaterial(typeKey);
  const placements = variants.map(() => []);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qj = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const e = new THREE.Euler();
  let total = 0;
  const boxes = [];

  for (const path of paths) {
    // path: array of [x,z]
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const segLen = Math.hypot(dx, dz);
      const t = new THREE.Vector3(dx / segLen, 0, dz / segLen);
      const n = new THREE.Vector3(-t.z, 0, t.x);
      let s = 0;
      while (s < segLen && total < maxStones) {
        const x = a[0] + t.x * s, z = a[1] + t.z * s;
        const dist = Math.hypot(x, z);
        const scl = 1 + Math.max(0, dist - 6) / 45;
        const step = 0.3 * scl;
        const g = heightFn(x, z);
        const tumbleN = NZ(x * 0.08, 0, z * 0.08) * 0.5 + 0.5;
        const ruin = THREE.MathUtils.smoothstep(tumbleN, 1 - tumble, 1.0) * THREE.MathUtils.smoothstep(dist, 7, 22);
        const Hw = height * (0.85 + 0.25 * NZ(x * 0.3, 1, z * 0.3)) * (1 - ruin * 0.6);
        const base = 0.72, top = 0.42;
        let y = 0;
        const course = 0.17 * scl;
        while (y < Hw && total < maxStones) {
          const f = y / height;
          const w = base - (base - top) * f + ruin * 0.3;
          for (const side of [-1, 1]) {
            const vi = Math.floor(rng() * variants.length);
            const v = variants[vi];
            const off = side * (w / 2 - v.size.z * 0.35 * scl);
            const jitter = rand(rng, -0.08, 0.08) * scl;
            const yy = g + y + v.size.y * 0.45 * scl - 0.02 + ruin * rand(rng, -0.15, 0.0);
            p.set(x + n.x * off + t.x * jitter, yy, z + n.z * off + t.z * jitter);
            // local x = length (into wall: n), local y = up, local z = along wall
            basis.makeBasis(n, new THREE.Vector3(0, 1, 0), t.clone().negate());
            q.setFromRotationMatrix(basis);
            e.set(rand(rng, -0.12, 0.12) + ruin * rand(rng, -0.6, 0.6), rand(rng, -0.35, 0.35), rand(rng, -0.12, 0.12));
            qj.setFromEuler(e);
            q.multiply(qj);
            if (rng() < 0.5) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
            sc.setScalar(scl * rand(rng, 0.85, 1.15));
            m.compose(p, q, sc);
            placements[vi].push(m.clone());
            total++;
          }
          y += course * rand(rng, 0.85, 1.15);
        }
        // top stones
        if (ruin < 0.5) {
          const vi = Math.floor(rng() * variants.length);
          const v = variants[vi];
          p.set(x, g + Hw + v.size.y * 0.35 * scl, z);
          basis.makeBasis(n, new THREE.Vector3(0, 1, 0), t.clone().negate());
          q.setFromRotationMatrix(basis);
          e.set(rand(rng, -0.2, 0.2), rand(rng, -0.4, 0.4), rand(rng, -0.2, 0.2));
          q.multiply(qj.setFromEuler(e));
          sc.setScalar(scl * rand(rng, 0.9, 1.2));
          m.compose(p, q, sc);
          placements[vi].push(m.clone());
          total++;
        }
        if (physics && dist < nearCollide) {
          boxes.push({ x, z, g, Hw, t, w: base });
        }
        s += step * rand(rng, 0.8, 1.1);
      }
    }
  }

  const group = new THREE.Group();
  variants.forEach((v, i) => {
    const list = placements[i];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(v.geometry, mat, list.length);
    list.forEach((mm, j) => im.setMatrixAt(j, mm));
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });

  if (physics) {
    for (const b of boxes) {
      const ang = Math.atan2(b.t.z, b.t.x);
      const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
      physics.addBox(0.18, b.Hw / 2, b.w / 2 - 0.05, b.x, b.g + b.Hw / 2, b.z, 0.8, { x: qq.x, y: qq.y, z: qq.z, w: qq.w });
    }
  }
  group.userData.count = total;
  return group;
}
