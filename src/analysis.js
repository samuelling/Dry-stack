// Reads the wall as a waller would: footings, faces, joints, hearting, throughs, copes.
import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export function stoneBounds(stone) {
  const t = stone.body.translation(), r = stone.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const hp = stone.hullPoints;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < hp.length; i += 3) {
    _v.set(hp[i], hp[i + 1], hp[i + 2]).applyQuaternion(_q);
    const x = _v.x + t.x, y = _v.y + t.y, z = _v.z + t.z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ax = X.clone().applyQuaternion(_q), ay = Y.clone().applyQuaternion(_q);
  return { minX, maxX, minY, maxY, minZ, maxZ, cx: t.x, cy: t.y, cz: t.z, ax, ay };
}

function coverage(intervals, a, b) {
  const iv = intervals.map(([x0, x1]) => [Math.max(a, x0), Math.min(b, x1)]).filter(([x0, x1]) => x1 > x0).sort((p, q) => p[0] - q[0]);
  let tot = 0, cur = -Infinity, start = 0;
  for (const [x0, x1] of iv) {
    if (x0 > cur) { if (cur > -Infinity) tot += cur - start; start = x0; cur = x1; }
    else cur = Math.max(cur, x1);
  }
  if (cur > -Infinity) tot += cur - start;
  return tot / (b - a);
}

export function analyseWall(game) {
  const { spec, stones, physics, interaction } = game;
  const L = spec.L, H = spec.H;
  const held = interaction?.held;
  const res = {
    inWall: 0, footings: { n: 0, covA: 0, covB: 0 }, faceStones: 0, lengthIn: 0, traced: 0,
    proud: 0, shy: 0, running: 0, throughs: 0, copes: 0, copeCov: 0, height: 0, heights: [],
    hearting: 0, heartingFill: 0, faceAbove: 0, settled: true, stones: [], runningAt: [],
  };
  const faceA = [], faceB = [];
  const footA = [], footB = [];
  const copes = [];
  for (const s of stones) {
    if (s === held) continue;
    const b = stoneBounds(s);
    const g = spec.ground(b.cx);
    const inside = Math.abs(b.cx) < L / 2 + 0.15 && Math.abs(b.cz) < spec.base / 2 + 0.1 && b.minY < g + H + 0.45;
    if (!inside) continue;
    const lin = s.body.linvel();
    if (Math.hypot(lin.x, lin.y, lin.z) > 0.08) res.settled = false;
    res.inWall++;
    const yRel = b.minY - g;
    const yc = (b.minY + b.maxY) / 2 - g;
    const hw = spec.halfWidth(Math.max(0, yc));
    const info = { s, b, yRel, yc, hw };
    res.stones.push(info);
    if (s.cls === 'hearting' || s.cls === 'pinning' || s.cls === 'shard') { res.hearting++; continue; }
    // through stones span the wall
    const span = b.maxZ - b.minZ;
    if (span >= 2 * hw * 0.85 && yc > 0.25 * H && yc < 0.85 * H) { res.throughs++; info.through = true; }
    // copes: on top, standing on edge with the thin axis along the wall
    if (yRel > H - 0.16 && Math.abs(b.ay.x) > 0.6) { copes.push([b.minX, b.maxX]); res.copes++; info.cope = true; continue; }
    // faces
    const onA = b.maxZ > hw - 0.11, onB = b.minZ < -hw + 0.11;
    if (!(onA || onB)) continue;
    res.faceStones++;
    if (yRel < 0.04) {
      res.footings.n++;
      if (onA) footA.push([b.minX, b.maxX]);
      if (onB) footB.push([b.minX, b.maxX]);
    } else res.faceAbove++;
    // length into the wall
    const size = s.size; // local dims: x length, y height, z width
    const ratio = size.x / Math.max(0.01, size.z);
    const hx = Math.hypot(b.ax.x, b.ax.z) || 1;
    const into = Math.abs(b.ax.z) / hx;
    if (!info.through) {
      if (into > 0.65 || ratio < 1.3) res.lengthIn++;
      else if (into < 0.45 && ratio > 1.45) { res.traced++; info.traced = true; }
    }
    // face line
    if (onA) { const d = b.maxZ - hw; if (d > 0.045) { res.proud++; info.proud = true; } else if (d < -0.1) res.shy++; faceA.push(info); }
    if (onB) { const d = -b.minZ - hw; if (d > 0.045) { res.proud++; info.proud = true; } else if (d < -0.1) res.shy++; faceB.push(info); }
  }
  res.footings.covA = coverage(footA, -L / 2, L / 2);
  res.footings.covB = coverage(footB, -L / 2, L / 2);
  res.copeCov = coverage(copes, -L / 2, L / 2);

  // running joints: a stone that ends where the stone beneath it ends
  for (const face of [faceA, faceB]) {
    for (const A of face) for (const B of face) {
      if (A === B) continue;
      if (B.b.minY < A.b.maxY - 0.07 || B.b.minY > A.b.maxY + 0.07) continue;
      const ov = Math.min(A.b.maxX, B.b.maxX) - Math.max(A.b.minX, B.b.minX);
      if (ov <= 0.02) continue;
      for (const [ea, eb] of [[A.b.minX, B.b.minX], [A.b.maxX, B.b.maxX]]) {
        if (Math.abs(ea - eb) < 0.035 && Math.abs(ea) < L / 2 - 0.12) {
          res.running++; B.running = true;
          const z = face === faceA ? spec.halfWidth(A.yc) + 0.01 : -spec.halfWidth(A.yc) - 0.01;
          res.runningAt.push({ x: (ea + eb) / 2, y: A.b.maxY, z, h: (B.b.maxY - A.b.minY) });
        }
      }
    }
  }

  // height profile in bins
  const bins = Math.max(4, Math.round(L / 0.25));
  const hA = new Array(bins).fill(0), hB = new Array(bins).fill(0);
  for (const info of [...faceA, ...faceB]) {
    for (let i = 0; i < bins; i++) {
      const x0 = -L / 2 + (i / bins) * L, x1 = x0 + L / bins;
      if (info.b.maxX > x0 && info.b.minX < x1) {
        const top = info.b.maxY - spec.ground((x0 + x1) / 2);
        if (faceA.includes(info)) hA[i] = Math.max(hA[i], top); else hB[i] = Math.max(hB[i], top);
      }
    }
  }
  const prof = hA.map((a, i) => Math.min(a, hB[i]));
  res.heights = prof;
  res.height = prof.reduce((s, v) => s + v, 0) / bins;
  res.minHeight = Math.min(...prof);

  // hearting fill: point samples in the core, up to the lower face at each x
  if (res.height > 0.05) {
    let filled = 0, total = 0;
    const p = { x: 0, y: 0, z: 0 };
    const yTop = Math.min(res.height, H);
    for (let i = 0; i < bins; i++) {
      const x = -L / 2 + ((i + 0.5) / bins) * L;
      const top = Math.min(prof[i], H) - 0.03;
      const g = spec.ground(x);
      for (let y = 0.04; y < top; y += 0.06) {
        const hw = spec.halfWidth(y) - 0.13;
        if (hw <= 0.02) continue;
        for (let z = -hw; z <= hw + 1e-6; z += Math.max(0.05, hw / 2)) {
          p.x = x; p.y = g + y; p.z = z;
          total++;
          let hit = false;
          physics.world.intersectionsWithPoint(p, (c) => { if (!physics.groundHandles.has(c.handle)) { hit = true; return false; } return true; });
          if (hit) filled++;
        }
      }
    }
    res.heartingFill = total ? filled / total : 0;
    res.fillSamples = total;
    res.yTop = yTop;
  }
  return res;
}
