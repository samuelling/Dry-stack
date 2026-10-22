// Rapier physics wrapper.
import RAPIER from '../vendor/rapier/rapier.es.js';

export { RAPIER };

export class Physics {
  static async init() { await RAPIER.init(); }

  constructor({ gravity = -9.81, damping = 0.02, angDamping = 0.05 } = {}) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = 1 / 120;
    this.world.numSolverIterations = 8;
    this.events = new RAPIER.EventQueue(true);
    this.damping = damping;
    this.angDamping = angDamping;
    this.acc = 0;
    this.bodies = new Map(); // collider handle -> stone
    this.groundHandles = new Set();
    this.onImpact = null;
  }

  setUnderwater(on) {
    // buoyancy for stone (≈2.6 g/cc) in water: effective g × (1 - 1/2.6); plus drag.
    this.world.gravity = { x: 0, y: on ? -9.81 * 0.62 : -9.81, z: 0 };
    this.damping = on ? 1.2 : 0.02;
    this.angDamping = on ? 1.6 : 0.05;
    for (const s of this.bodies.values()) {
      s.body.setLinearDamping(this.damping);
      s.body.setAngularDamping(this.angDamping);
    }
  }

  addHeightfield(heights, nx, nz, sizeX, sizeZ, cx = 0, cz = 0) {
    const desc = RAPIER.ColliderDesc.heightfield(nz, nx, heights, { x: sizeX, y: 1, z: sizeZ })
      .setTranslation(cx, 0, cz).setFriction(0.9).setRestitution(0.02);
    const c = this.world.createCollider(desc);
    this.groundHandles.add(c.handle);
    return c;
  }

  addBox(hx, hy, hz, x, y, z, friction = 0.8, rot = null) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction).setRestitution(0.02);
    if (rot) desc.setRotation(rot);
    const c = this.world.createCollider(desc);
    this.groundHandles.add(c.handle);
    return c;
  }

  addStone(stone, x, y, z, quat, friction) {
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation(quat)
      .setLinearDamping(this.damping)
      .setAngularDamping(this.angDamping)
      .setCanSleep(true);
    const body = this.world.createRigidBody(bd);
    let cd = RAPIER.ColliderDesc.convexHull(stone.hullPoints);
    cd.setDensity(2600).setFriction(friction).setRestitution(0.03);
    const collider = this.world.createCollider(cd, body);
    if (stone.cls === 'hearting') body.enableCcd(true);
    stone.body = body; stone.collider = collider; stone.friction = friction;
    stone.mass = body.mass();
    this.bodies.set(collider.handle, stone);
    return body;
  }

  // new hull after dressing: swap the collider, keep the body (and its pose)
  replaceCollider(stone) {
    const cd = RAPIER.ColliderDesc.convexHull(stone.hullPoints);
    if (!cd) return false;
    const old = stone.collider;
    this.bodies.delete(old.handle);
    this.world.removeCollider(old, false);
    cd.setDensity(2600).setFriction(stone.friction).setRestitution(0.03);
    stone.collider = this.world.createCollider(cd, stone.body);
    this.bodies.set(stone.collider.handle, stone);
    stone.mass = stone.collider.mass(); // body mass updates on the next step
    stone.body.wakeUp();
    return true;
  }

  setGhost(stone, on) {
    stone.collider.setCollisionGroups(on ? 0x00000000 : 0xffffffff);
  }

  // contact points (world) between a stone and everything it touches
  contactPoints(stone) {
    const pts = [];
    this.world.contactPairsWith(stone.collider, (other) => {
      this.world.contactPair(stone.collider, other, (m) => {
        const n = m.numSolverContacts();
        for (let i = 0; i < n; i++) { const p = m.solverContactPoint(i); pts.push({ x: p.x, y: p.y, z: p.z, ground: this.groundHandles.has(other.handle) }); }
      });
    });
    return pts;
  }

  removeStone(stone) {
    this.bodies.delete(stone.collider.handle);
    this.world.removeRigidBody(stone.body);
  }

  step(dt, preStep, postStep) {
    this.acc += Math.min(dt, 1 / 20);
    const h = this.world.timestep;
    let n = 0;
    while (this.acc >= h && n < 6) {
      if (preStep) preStep(h);
      this.world.step(this.events);
      if (postStep) postStep(h);
      this.acc -= h; n++;
    }
    if (n >= 6) this.acc = 0;
    return n;
  }

  // Which colliders is this stone touching? Returns {ground, stones[]}
  touching(stone) {
    const out = { ground: false, stones: [] };
    this.world.contactPairsWith(stone.collider, (other) => {
      if (this.groundHandles.has(other.handle)) out.ground = true;
      else { const s = this.bodies.get(other.handle); if (s) out.stones.push(s); }
    });
    return out;
  }
}
