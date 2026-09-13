// Terrain height, ground queries, and collision for coastal-city-engine.
// Uses a heightfield approach inspired by vice-coast: SDF from map boundary
// drives a smooth ocean→beach→land transition; hills added in outskirts only.

function ss(a: number, b: number, t: number) {
  const n = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return n * n * (3 - 2 * n);
}
function lp(a: number, b: number, t: number) { return a + (b - a) * t; }

// Coastline: X position of the shore at given Z
export const coast = (z: number) => 116 + Math.sin(z * .015) * 8;

// Island ellipse test
export const island = (x: number, z: number, margin = 0) =>
  ((x - 282) / (64 - margin)) ** 2 + ((z + 80) / (77 - margin)) ** 2 < 1;

export const onBridge = (x: number, z: number) =>
  x >= 70 && x <= 284 && Math.abs(z + 80) < 8;

export const onDock = (x: number, z: number) =>
  (x > 110 && x < 167 && Math.abs(z - 108) < 3) ||
  (x > 148 && x < 153 && z > 94 && z < 135);

// Signed distance from the map boundary. Positive = inside (land), negative = ocean.
function edgeSDF(x: number, z: number): number {
  const cx = coast(z);
  // Organic wave noise on the east coastline
  const wave = Math.sin(x * .037 + Math.sin(z * .021)) * 7
             + Math.cos(z * .043 + x * .012) * 5
             + Math.sin(z * .11 + x * .083) * 2;
  const eastEdge = (cx - x) + wave * ss(-15, 40, cx - x);

  // Map outer bounds
  const northEdge = z + 275;
  const southEdge = 232 - z;
  const westEdge  = x + 298;

  // Mainland SDF
  const mainland = Math.min(eastEdge, northEdge, southEdge, westEdge);

  // Island as a separate land mass
  const islandEdge = (1 - Math.hypot((x - 282) / 64, (z + 80) / 77)) * 65
                   + Math.sin(x * .13 + z * .09) * 2;

  return Math.max(mainland, islandEdge);
}

// Continuous terrain height — the single source of truth for the terrain mesh
// and all runtime ground queries.
export function terrainHeight(x: number, z: number): number {
  const e = edgeSDF(x, z);

  // Ocean (-3.5) → beach (0) → land (2.5) smooth ramp
  let h = lp(-3.5, 2.5, ss(-35, 18, e));

  // Gentle beach dunes just inland from shore
  if (e > 0 && e < 22) {
    h += Math.max(0, Math.sin(x * .048 + z * .031)) * 1.1 * ss(0, 18, e) * ss(22, 4, e);
  }

  // Residential hills — only far west of city, never near roads
  if (e > 22 && x < -125) {
    const hillMask = ss(-295, -125, x) * ss(22, 60, e);
    h += (2.3 + Math.sin(x * .026) * Math.cos(z * .031) * 2.8
              + Math.sin(x * .065 + z * .048) * 1.6
              + Math.cos(x * .11 + z * .09) * 0.9) * hillMask;
  }

  return h;
}

// Navigation ground height. Returns <0 for impassable water.
export function groundHeight(x: number, z: number): number {
  if (onBridge(x, z)) return 3.4;
  if (onDock(x, z)) return 2.5;
  const h = terrainHeight(x, z);
  return h < 0.12 ? -2 : Math.max(0.12, h);
}

export function navigableWater(x: number, z: number) {
  return groundHeight(x, z) < 0 && Math.abs(x) < 650 && Math.abs(z) < 600;
}

export interface Collider { x: number; z: number; w: number; d: number; h: number }

export class CollisionWorld {
  private cells = new Map<string, Collider[]>();
  add(c: Collider) {
    for (let gx = Math.floor((c.x - c.w / 2) / 40); gx <= Math.floor((c.x + c.w / 2) / 40); gx++)
      for (let gz = Math.floor((c.z - c.d / 2) / 40); gz <= Math.floor((c.z + c.d / 2) / 40); gz++) {
        const key = `${gx}:${gz}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key)!.push(c);
      }
  }
  blocked(x: number, z: number, r = .45, y = 2.5) {
    const nearby = this.cells.get(`${Math.floor(x / 40)}:${Math.floor(z / 40)}`) || [];
    return nearby.some(c => y < c.h + 2.5 && Math.abs(x - c.x) < c.w / 2 + r && Math.abs(z - c.z) < c.d / 2 + r);
  }
  move(position: { x: number; z: number; y: number }, dx: number, dz: number, r = .45) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .4));
    for (let i = 0; i < steps; i++) {
      const nx = position.x + dx / steps, nz = position.z + dz / steps;
      if (groundHeight(nx, position.z) > 0 && !this.blocked(nx, position.z, r, position.y)) position.x = nx;
      if (groundHeight(position.x, nz) > 0 && !this.blocked(position.x, nz, r, position.y)) position.z = nz;
    }
  }
}
