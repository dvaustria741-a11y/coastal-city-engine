// Terrain height, ground queries, and collision for coastal-city-engine.
// Uses a heightfield approach inspired by vice-coast: SDF from map boundary
// drives a smooth ocean→beach→land transition; hills added in outskirts only.
function ss(a: number, b: number, t: number) {
  const n = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return n * n * (3 - 2 * n);
}
function lp(a: number, b: number, t: number) { return a + (b - a) * t; }

export const WATER_LEVEL = .2;
export const WAVE_HEIGHT = .3;
export const TERRAIN_STEP = 2;
export const ROAD_XS = [-240, -160, -80, 0, 80];
export const ROAD_ZS = [-240, -160, -80, 0, 80, 160];
export interface Footprint { x: number; z: number; w: number; d: number }
export interface Surface extends Footprint {
  kind: 'road' | 'promenade' | 'dock' | 'bridge' | 'plaza';
  y: number;
  depth: number;
  axis?: 'x' | 'z';
}
export const ROADS: Surface[] = [
  ...ROAD_XS.map(x => ({ x, z: -40, w: 20, d: 424, y: 2.68, depth: .18, axis: 'z' as const, kind: 'road' as const })),
  ...ROAD_ZS.map(z => ({ x: -78, z, w: 344, d: 20, y: 2.68, depth: .18, axis: 'x' as const, kind: 'road' as const })),
];
export const BRIDGE: Surface = { x: 186, z: -80, w: 236, d: 17, y: 3.48, depth: .65, kind: 'bridge', axis: 'x' };
export const DOCKS: Surface[] = [
  { x: 135, z: 108, w: 66, d: 5.8, y: 2.5, depth: .55, kind: 'dock' },
  { x: 150.5, z: 114.5, w: 5, d: 41, y: 2.5, depth: .55, kind: 'dock' },
  ...[96, 132].map(z => ({ x: 160, z, w: 19, d: 2.5, y: 2.5, depth: .55, kind: 'dock' as const })),
  { x: 169, z: 132, w: 12, d: 4, y: 2.5, depth: .55, kind: 'dock' },
];
export const PROMENADE: Surface = { x: 97.5, z: 40, w: 15, d: 270, y: 2.56, depth: .06, kind: 'promenade' };
export const PLAZA: Surface = { x: 52, z: 112, w: 30, d: 30, y: 2.56, depth: .06, kind: 'plaza' };
export const SURFACES: Surface[] = [...ROADS, PROMENADE, PLAZA, ...DOCKS, BRIDGE];
export const WHEEL_SITE = { x: 52, z: 40, w: 34, d: 8 };
export const HARBOR_SITE = { x: 100, z: 126, w: 12, d: 18 };
export const PLAYER_SPAWN = { x: 94, z: 92 };
export const BOAT_BERTH = { x: 157.5, z: 120, yaw: -Math.PI / 2 };

export function contains(b: Footprint, x: number, z: number, inset = 0) {
  return Math.abs(x - b.x) <= b.w / 2 - inset && Math.abs(z - b.z) <= b.d / 2 - inset;
}
export function overlaps(a: Footprint, b: Footprint, clearance = 0) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + clearance && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + clearance;
}
function distanceTo(b: Footprint, x: number, z: number) {
  return Math.hypot(Math.max(0, Math.abs(x - b.x) - b.w / 2), Math.max(0, Math.abs(z - b.z) - b.d / 2));
}

// Coastline: X position of the shore at given Z. Geometry and navigation use
// the SDF below, not this nominal guide curve as a second shoreline cutoff.
export const coast = (z: number) => 116 + Math.sin(z * .015) * 8;
// Island ellipse test (district identity, not a land/water classification).
export const island = (x: number, z: number, margin = 0) =>
  ((x - 282) / (64 - margin)) ** 2 + ((z + 80) / (77 - margin)) ** 2 < 1;
export const onBridge = (x: number, z: number) => contains(BRIDGE, x, z);
export const onDock = (x: number, z: number) => DOCKS.some(d => contains(d, x, z));

// Signed distance from the map boundary. Positive = inside (land), negative = ocean.
export function edgeSDF(x: number, z: number): number {
  const cx = coast(z);
  const wave = Math.sin(x * .037 + Math.sin(z * .021)) * 7
    + Math.cos(z * .043 + x * .012) * 5 + Math.sin(z * .11 + x * .083) * 2;
  const mainland = Math.min((cx - x) + wave * ss(-15, 40, cx - x), z + 275, 232 - z, x + 298);
  const islandEdge = (1 - Math.hypot((x - 282) / 64, (z + 80) / 77)) * 65
    + Math.sin(x * .13 + z * .09) * 2;
  return Math.max(mainland, islandEdge);
}
function terrainVertex(x: number, z: number): number {
  const e = edgeSDF(x, z);
  let h = lp(-3.5, 2.5, ss(-35, 18, e));
  if (e > 0 && e < 14) h += Math.max(0, Math.sin(x * .048 + z * .031)) * .6 * ss(0, 14, e) * ss(14, 2, e);
  if (e > 22 && x < -125) {
    const hillMask = ss(-125, -260, x) * ss(22, 60, e);
    h += (2.3 + Math.sin(x * .026) * Math.cos(z * .031) * 1.4 + Math.sin(x * .065 + z * .048) * .7) * hillMask;
  }
  // Engineered road beds and waterfront grading modify the authoritative
  // field itself. The falloff leaves hills between finite road corridors.
  let grading = 0;
  for (const r of ROADS) grading = Math.max(grading, 1 - ss(2, 14, distanceTo(r, x, z)));
  for (const pad of [PROMENADE, PLAZA, WHEEL_SITE, HARBOR_SITE]) grading = Math.max(grading, 1 - ss(2, 9, distanceTo(pad, x, z)));
  if (island(x, z) && Math.abs(z + 80) < 18 && x > 262 && x < 309) grading = Math.max(grading, 1 - ss(9, 18, Math.abs(z + 80)));
  return lp(h, 2.5, grading);
}

// Continuous terrain height — the single source of truth for the terrain mesh
// and all runtime ground queries. Interpolate the same global triangles used
// by the tiles, so small objects and navigation match the rendered surface.
export function terrainHeight(x: number, z: number): number {
  const x0 = Math.floor(x / TERRAIN_STEP) * TERRAIN_STEP, z0 = Math.floor(z / TERRAIN_STEP) * TERRAIN_STEP;
  const u = (x - x0) / TERRAIN_STEP, v = (z - z0) / TERRAIN_STEP;
  const b = terrainVertex(x0 + TERRAIN_STEP, z0), c = terrainVertex(x0, z0 + TERRAIN_STEP);
  if (u + v <= 1) return terrainVertex(x0, z0) * (1 - u - v) + b * u + c * v;
  return terrainVertex(x0 + TERRAIN_STEP, z0 + TERRAIN_STEP) * (u + v - 1) + b * (1 - v) + c * (1 - u);
}
export function surfaceHeight(s: Surface, x: number, _z: number): number {
  if (s.kind !== 'bridge') return s.y;
  return x < 94 ? lp(2.68, s.y, ss(68, 94, x)) : lp(s.y, 2.5, ss(278, 304, x));
}
export function isWater(x: number, z: number) { return terrainHeight(x, z) < WATER_LEVEL; }
export function isLand(x: number, z: number) { return terrainHeight(x, z) >= WATER_LEVEL + WAVE_HEIGHT + .05; }
export function isBeach(x: number, z: number) { return isLand(x, z) && edgeSDF(x, z) < 18; }

// Navigation ground height. Returns <0 for impassable water.
export function groundHeight(x: number, z: number): number {
  let h = terrainHeight(x, z);
  for (const s of SURFACES) if (contains(s, x, z)) h = Math.max(h, surfaceHeight(s, x, z));
  return h < WATER_LEVEL + WAVE_HEIGHT + .05 ? -2 : h;
}
export function navigableWater(x: number, z: number) {
  if (Math.abs(x) >= 650 || Math.abs(z) >= 600 || terrainHeight(x, z) > WATER_LEVEL - .65) return false;
  // These are physical low decks, not an exclusion rectangle around the bay.
  return !SURFACES.some(s => contains(s, x, z) && surfaceHeight(s, x, z) - s.depth < WATER_LEVEL + 3.5);
}
export function protectedArea(bounds: Footprint, clearance = 0) {
  return SURFACES.some(s => overlaps(bounds, s, clearance));
}
export function sampleFootprint(b: Footprint, visit: (x: number, z: number) => boolean, step = TERRAIN_STEP): boolean {
  const xmin=b.x-b.w/2, xmax=b.x+b.w/2, zmin=b.z-b.d/2, zmax=b.z+b.d/2;
  const xs=[xmin,xmax], zs=[zmin,zmax];
  for(let x=Math.ceil(xmin/step)*step;x<xmax;x+=step)xs.push(x);
  for(let z=Math.ceil(zmin/step)*step;z<zmax;z+=step)zs.push(z);
  for(const x of xs)for(const z of zs)if(!visit(x,z))return false;
  // A clipped triangle can attain its highest point where its diagonal
  // crosses a footprint edge, not just at regular grid sample positions.
  for(const x of [xmin,xmax])for(let z=Math.floor(zmin/step)*step;z<zmax;z+=step){
    const crossing=z+step-(x-Math.floor(x/step)*step);
    if(crossing>zmin&&crossing<zmax&&!visit(x,crossing))return false;
  }
  for(const z of [zmin,zmax])for(let x=Math.floor(xmin/step)*step;x<xmax;x+=step){
    const crossing=x+step-(z-Math.floor(z/step)*step);
    if(crossing>xmin&&crossing<xmax&&!visit(crossing,z))return false;
  }
  return visit(b.x, b.z);
}

class SpatialHash<T extends Footprint> {
  private cells = new Map<string, T[]>();
  private keys(b: Footprint) {
    const keys: string[] = [];
    for (let x = Math.floor((b.x - b.w / 2) / 40); x <= Math.floor((b.x + b.w / 2) / 40); x++)
      for (let z = Math.floor((b.z - b.d / 2) / 40); z <= Math.floor((b.z + b.d / 2) / 40); z++) keys.push(`${x}:${z}`);
    return keys;
  }
  add(b: T) { for (const key of this.keys(b)) { const cell = this.cells.get(key) || []; cell.push(b); this.cells.set(key, cell); } }
  nearby(b: Footprint) { const found = new Set<T>(); for (const key of this.keys(b)) for (const item of this.cells.get(key) || []) found.add(item); return [...found]; }
}
export type PlacementKind = 'building' | 'landmark' | 'palm' | 'bush' | 'prop';
export interface Reservation extends Footprint { kind: PlacementKind; y: number; minY: number }
const placementRules = {
  building: { slope: .12, relief: 1.25, clearance: 1 },
  landmark: { slope: .08, relief: .6, clearance: 1 },
  palm: { slope: .35, relief: .8, clearance: .8 },
  bush: { slope: .3, relief: .5, clearance: .5 },
  prop: { slope: .12, relief: .35, clearance: .5 },
};
export class SpatialReservations {
  private hash = new SpatialHash<Reservation>();
  readonly entries: Reservation[] = [];
  reserve(b: Footprint, kind: PlacementKind, y = terrainHeight(b.x, b.z), minY = y) {
    const entry = { ...b, kind, y, minY }; this.hash.add(entry); this.entries.push(entry); return entry;
  }
  validate(b: Footprint, kind: PlacementKind): Reservation | null {
    const rule = placementRules[kind];
    if (protectedArea(b, rule.clearance)) return null;
    const expanded = { ...b, w: b.w + rule.clearance * 2, d: b.d + rule.clearance * 2 };
    if (this.hash.nearby(expanded).some(other => overlaps(b, other, rule.clearance))) return null;
    let lo = Infinity, hi = -Infinity;
    if (!sampleFootprint(b, (x, z) => {
      const h = terrainHeight(x, z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      const slope = Math.hypot(terrainHeight(x + .5, z) - terrainHeight(x - .5, z), terrainHeight(x, z + .5) - terrainHeight(x, z - .5));
      return isLand(x, z) && slope <= rule.slope;
    }) || hi - lo > rule.relief) return null;
    const y = kind === 'building' || kind === 'landmark' ? hi : terrainHeight(b.x, b.z);
    return { ...b, kind, y, minY: lo };
  }
  place(b: Footprint, kind: PlacementKind) {
    const valid = this.validate(b, kind);
    return valid && this.reserve(b, kind, valid.y, valid.minY);
  }
}

export interface Collider extends Footprint { h: number; y?: number }
export class CollisionWorld {
  private hash = new SpatialHash<Collider>();
  add(c: Collider) { this.hash.add(c); }
  blocked(x: number, z: number, r = .45, y = 2.5, height = 1.8) {
    const b = { x, z, w: r * 2, d: r * 2 };
    return this.hash.nearby(b).some(c => y + height > (c.y ?? 2.5) + .02 && y < (c.y ?? 2.5) + c.h - .02 && overlaps(b, c));
  }
  walkable(x: number, z: number, r = .45) {
    const h = groundHeight(x, z);
    return h > 0 && !this.blocked(x, z, r, h) && sampleFootprint({ x, z, w: r * 2, d: r * 2 }, (px, pz) => {
      const edge = groundHeight(px, pz); return edge > 0 && Math.abs(edge - h) < .5;
    });
  }
  move(position: { x: number; z: number; y: number }, dx: number, dz: number, r = .45) {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .3));
    for (let i = 0; i < steps; i++) {
      const moveAxis = (x: number, z: number) => {
        const current = groundHeight(position.x, position.z), next = groundHeight(x, z);
        if (next - current > .45 || current - next > .7 || !this.walkable(x, z, r) || this.blocked(x, z, r, Math.max(position.y, next))) return;
        position.x = x; position.z = z;
      };
      moveAxis(position.x + dx / steps, position.z);
      moveAxis(position.x, position.z + dz / steps);
    }
  }
  boatFits(x: number, z: number, yaw: number) {
    for (let side = -1; side <= 1; side++) for (let along = -4; along <= 4; along++) {
      const px = x + Math.cos(yaw) * side * 1.6 + Math.sin(yaw) * along;
      const pz = z - Math.sin(yaw) * side * 1.6 + Math.cos(yaw) * along;
      if (!navigableWater(px, pz) || this.blocked(px, pz, .2, WATER_LEVEL - .6, 4.1)) return false;
    }
    return true;
  }
  segmentClear(ax: number, az: number, bx: number, bz: number, y: number, radius = .3) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / .3));
    for (let i = 0; i <= n; i++) if (this.blocked(lp(ax, bx, i / n), lp(az, bz, i / n), radius, y)) return false;
    return true;
  }
  findExit(x: number, z: number, yaw: number, kind: 'boat' | 'car') {
    for (let radius = 2.5; radius <= (kind === 'boat' ? 5.5 : 4); radius += .25) for (let i = 0; i < 32; i++) {
      const a = yaw + i / 32 * Math.PI * 2, px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      const y = groundHeight(px, pz);
      if (this.walkable(px, pz, .6) && (kind !== 'boat' || !onBridge(px, pz)) && this.segmentClear(x, z, px, pz, y + .1, .45)) return { x: px, z: pz, y };
    }
    return null;
  }
}
