// Ground mesh with a non-uniform grid: fine near the work area, coarse at the horizon.
import * as THREE from 'three';

export function buildTerrainGeometry(heightFn, { radius = 800, n = 360, a = 5.0 } = {}) {
  const coords = new Float32Array(n + 1);
  const ea = Math.exp(a) - 1;
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * 2 - 1;
    coords[i] = Math.sign(u) * radius * (Math.exp(a * Math.abs(u)) - 1) / ea;
  }
  const verts = new Float32Array((n + 1) * (n + 1) * 3);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = coords[i], z = coords[j];
      verts[k++] = x; verts[k++] = heightFn(x, z); verts[k++] = z;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a0 = j * (n + 1) + i, b0 = a0 + 1, c0 = a0 + (n + 1), d0 = c0 + 1;
      idx[k++] = a0; idx[k++] = c0; idx[k++] = b0;
      idx[k++] = b0; idx[k++] = c0; idx[k++] = d0;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Heights for a Rapier heightfield centred at (cx, cz).
export function sampleHeightfield(heightFn, size, res, cx = 0, cz = 0) {
  const n = Math.round(size / res);
  const H = new Float32Array((n + 1) * (n + 1));
  for (let i = 0; i <= n; i++) {       // rows: z
    for (let j = 0; j <= n; j++) {     // cols: x
      const z = cz - size / 2 + size * i / n, x = cx - size / 2 + size * j / n;
      H[j * (n + 1) + i] = heightFn(x, z);
    }
  }
  return { H, n };
}
