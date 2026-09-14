import * as T from 'three/webgpu';
import { Batch, building, palm, materials, type Building } from '../assets/models';
import { seeded } from '../core/settings';
import {
  island, terrainHeight, groundHeight, edgeSDF, CollisionWorld, SpatialReservations,
  TERRAIN_STEP, ROADS, DOCKS, BRIDGE, PROMENADE, PLAZA, WHEEL_SITE, HARBOR_SITE,
  surfaceHeight, contains, type Surface, type Footprint, type Reservation,
} from './queries';

interface Detail extends Reservation { form: 'bush' | 'lamp' }
export interface Chunk {
  id: number; x: number; z: number; buildings: Building[]; decorations: Detail[];
  group: T.Group; detail: number; resident: boolean; lastChange: number;
}

// ─── terrain tile builder (vice-coast approach) ───────────────────────────────
const TERRAIN_MAT = new T.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0 });
export function buildTerrainTile(x0: number, z0: number, x1: number, z1: number): T.Mesh | null {
  const nx = Math.round((x1 - x0) / TERRAIN_STEP) + 1, nz = Math.round((z1 - z0) / TERRAIN_STEP) + 1;
  const positions: number[] = [], colors: number[] = [], normals: number[] = [];
  let hasLand = false;
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = x0 + ix * TERRAIN_STEP, z = z0 + iz * TERRAIN_STEP, h = terrainHeight(x, z);
    if (h > -.6) hasLand = true;
    positions.push(x, h, z);
    const n = new T.Vector3(terrainHeight(x - 1, z) - terrainHeight(x + 1, z), 2, terrainHeight(x, z - 1) - terrainHeight(x, z + 1)).normalize();
    normals.push(n.x, n.y, n.z);
    // Biome colours use the same coastline, including the island shore.
    const sand = T.MathUtils.clamp((18 - edgeSDF(x, z)) / 18, 0, 1);
    const rock = T.MathUtils.clamp((h - 4) / 4, 0, 1);
    const c = new T.Color('#6e9555').lerp(new T.Color('#dbc98a'), sand).lerp(new T.Color('#857265'), rock);
    colors.push(c.r, c.g, c.b);
  }
  if (!hasLand) return null;
  const indices: number[] = [];
  for (let iz = 0; iz < nz - 1; iz++) for (let ix = 0; ix < nx - 1; ix++) {
    const a = iz * nx + ix, b = a + 1, c = a + nx, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  const mesh = new T.Mesh(geo, TERRAIN_MAT); mesh.receiveShadow = true;
  return mesh;
}

// A deck is a structure, never a second heightfield. Geometry and navigation
// consume the same bounds and height profile, including approach ramps.
function deck(b: Batch, s: Surface, mat: keyof typeof materials) {
  if (s.kind !== 'bridge') {
    b.add('box', mat, s.x, s.y - s.depth / 2, s.z, s.w, s.depth, s.d);
    return;
  }
  const count = Math.ceil(s.w / 2), width = s.w / count;
  for (let i = 0; i < count; i++) {
    const left = s.x - s.w / 2 + i * width, right = left + width;
    const a = surfaceHeight(s, left, s.z), c = surfaceHeight(s, right, s.z);
    b.add('box', mat, (left + right) / 2, (a + c) / 2 - s.depth / 2, s.z,
      Math.hypot(width, c - a), s.depth, s.d, 0, Math.atan2(c - a, width));
  }
}

// ─── World class ─────────────────────────────────────────────────────────────
export class World {
  root = new T.Group();
  chunks: Chunk[] = [];
  collision = new CollisionWorld();
  spatial = new SpatialReservations();
  wheel = new T.Group();
  constructor(public scene: T.Scene) { scene.add(this.root); }

  // ── MAIN BUILD ─────────────────────────────────────────────────────────────
  async create(progress: (p: number, label: string) => void) {
    // Reserve intentional structures before any procedural occupancy. These
    // global reservations survive chunk eviction and LOD reconstruction.
    this.spatial.reserve(WHEEL_SITE, 'landmark');
    this.spatial.reserve(HARBOR_SITE, 'landmark');
    this.createTerrain();
    this.createRoads();
    this.createWaterfront();
    this.createMarina();
    this.createBridge();
    this.createIsland();
    this.createWheel();
    this.createStreetDetail();

    const random = seeded(771);
    // Compact city blocks follow the existing 80 m road grid instead of a
    // competing 55 m grid that rejected most buildings and overlapped others.
    for (let iz = 0; iz < 5; iz++) for (let ix = 0; ix < 4; ix++) {
      const cx = -200 + ix * 80, cz = -200 + iz * 80;
      const chunk: Chunk = { id: this.chunks.length, x: cx, z: cz, buildings: [], decorations: [], group: new T.Group(), detail: 2, resident: true, lastChange: 0 };
      // Signature skyline is assigned to valid parcels, not road centerlines.
      if (iz === 1 && ix < 3) {
        this.placeBuilding(chunk.buildings, { x: cx, z: cz, w: 32, d: 30, h: [105, 130, 115][ix], style: 2 });
      } else {
        for (const [dx, dz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) {
          const central = Math.max(0, 1 - Math.hypot(cx + 95, cz + 90) / 210);
          const p = { x: cx + dx, z: cz + dz, w: 16 + random() * 4, d: 14 + random() * 4, h: 12 + random() * 14 + central * random() * 65, style: Math.floor(random() * 5) };
          this.placeBuilding(chunk.buildings, p);
        }
      }
      this.chunks.push(chunk);
      progress(.2 + this.chunks.length / 20 * .6, 'Building the city');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    // Finalize all footprints before small detail, independent of load order.
    for (const chunk of this.chunks) {
      for (const [dx, dz] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) {
        const site = this.spatial.place({ x: chunk.x + dx, z: chunk.z + dz, w: 3, d: 3 }, 'bush');
        if (site) { chunk.decorations.push({ ...site, form: 'bush' }); this.collision.add({ ...site, h: 1.2 }); }
      }
      for (const dx of [-26, 26]) {
        const site = this.spatial.place({ x: chunk.x + dx, z: chunk.z, w: 1, d: 1 }, 'prop');
        if (site) { chunk.decorations.push({ ...site, form: 'lamp' }); this.collision.add({ ...site, w: .25, d: .25, h: 7 }); }
      }
      chunk.group = this.buildChunk(chunk, 2); this.root.add(chunk.group);
    }
    this.createPalms(random);
    this.root.name = 'Coastal district';
  }

  private placeBuilding(target: Building[], p: Omit<Building, 'y' | 'minY'>) {
    const footprint = { x: p.x, z: p.z, w: Math.max(p.w + 6, p.w * 1.14), d: Math.max(p.d + 8, p.d * 1.14) };
    const site = this.spatial.place(footprint, 'building');
    if (!site) return false;
    target.push({ ...p, y: site.y, minY: site.minY });
    this.collision.add({ ...footprint, y: site.minY, h: p.h + 16 + site.y - site.minY });
    return true;
  }

  // ── TERRAIN ───────────────────────────────────────────────────────────────
  // Continuous heightfield tiled in 240×240 chunks.
  createTerrain() {
    for (let x = -306; x < 420; x += 240) for (let z = -282; z < 250; z += 240) {
      const mesh = buildTerrainTile(x, z, x + 240, z + 240);
      if (mesh) this.root.add(mesh);
    }
  }

  // ── CHUNK BUILDER (used by ChunkManager for LOD) ─────────────────────────
  buildChunk(chunk: Chunk, detail: number): T.Group {
    const b = new Batch();
    chunk.buildings.forEach(p => building(b, p, detail));
    if (detail < 2) for (const p of chunk.decorations) {
      if (p.form === 'bush') {
        b.add('box', 'dark', p.x, p.y + .1, p.z, 3, .2, 3);
        b.add('box', 'grass', p.x, p.y + .24, p.z, 2.8, .1, 2.8);
        b.add('sphere', 'leaf', p.x, p.y + .8, p.z, 1.2, .65, 1.2, (p.x + p.z) * .1);
      } else {
        b.add('cylinder', 'dark', p.x, p.y + 3.5, p.z, .075, 7, .075);
        b.add('sphere', 'light', p.x, p.y + 7, p.z, .3, .14, .3);
      }
    }
    return b.finish();
  }

  // ── ROADS ─────────────────────────────────────────────────────────────────
  createRoads() {
    const b = new Batch();
    // Asphalt has priority at intersections; inset sidewalks are split there.
    for (const r of ROADS) {
      const vertical = r.axis === 'z';
      deck(b, { ...r, w: vertical ? 13 : r.w, d: vertical ? r.d : 13 }, 'road');
      const length = vertical ? r.d : r.w;
      for (let t = -length / 2; t < length / 2; t += 2) {
        const x = r.x + (vertical ? 0 : t + 1), z = r.z + (vertical ? t + 1 : 0);
        if (!ROADS.some(other => other.axis !== r.axis && contains(other, x, z))) {
          for (const side of [-1, 1]) deck(b, { ...r, x: x + (vertical ? side * 8.25 : 0), z: z + (vertical ? 0 : side * 8.25), w: vertical ? 3.5 : 2, d: vertical ? 2 : 3.5 }, 'concrete');
          if (Math.floor(t + length / 2) % 12 < 4) b.add('box', 'line', x, r.y + .007, z, vertical ? .15 : 2, .01, vertical ? 2 : .15);
        }
      }
    }
    for(const vertical of ROADS.filter(r=>r.axis==='z'))for(const horizontal of ROADS.filter(r=>r.axis==='x'))
      for(const dx of [-8.25,8.25])for(const dz of [-8.25,8.25])
        deck(b,{...vertical,x:vertical.x+dx,z:horizontal.z+dz,w:3.5,d:3.5},'concrete');
    this.root.add(b.finish());
  }

  // ── WATERFRONT PROMENADE ──────────────────────────────────────────────────
  createWaterfront() {
    const b = new Batch(); deck(b, PROMENADE, 'concrete');
    // Leave actual gaps in rails at the dock and beach access routes.
    for (let z = -92; z < 172; z += 4) {
      if (Math.abs(z + 80) < 12 || Math.abs(z - 108) < 8 || Math.abs(z-HARBOR_SITE.z)<HARBOR_SITE.d/2+2 || [-60, 0, 52, 160].some(gap => Math.abs(z - gap) < 5)) continue;
      b.add('cylinder', 'white', 104.5, PROMENADE.y + .55, z, .06, 1.1, .06);
      b.add('box', 'white', 104.5, PROMENADE.y + 1.1, z, .07, .07, 4);
      this.collision.add({ x: 104.5, z, w: .15, d: 4, y: PROMENADE.y, h: 1.2 });
    }
    // Street furniture is kept on the outer edge; the central walking lane
    // at x=94 remains continuous from the city to the marina entrance.
    for (const z of [-48, 16, 64, 148]) {
      const y = groundHeight(101, z);
      b.add('box', 'wood', 101, y + .5, z, 1.2, .3, 3);
      b.add('box', 'dark', 101.5, y + .8, z, .15, .8, 3);
      this.spatial.reserve({ x: 101, z, w: 2, d: 4 }, 'prop', y);
      this.collision.add({ x: 101, z, w: 1.5, d: 3, y, h: 1.2 });
    }
    this.root.add(b.finish());
  }

  // ── MARINA ────────────────────────────────────────────────────────────────
  createMarina() {
    const b = new Batch();
    for (const s of DOCKS) deck(b, s, 'wood');
    // Dock pilings & cleats have only their physical dimensions, never a
    // marina-sized collider. Deck tops are handled by groundHeight.
    for (const s of DOCKS) for (const side of [-1, 1]) {
      const x = s.x + side * (s.w / 2 - .5), z = s.z;
      b.add('cylinder', 'dark', x, .3, z, .22, 4.2, .22);
      this.collision.add({ x, z, w: .44, d: .44, y: -1.8, h: 4.2 });
    }
    // Marina building / harbour master, outside the x=94 through-route and
    // the z=108 dock entrance. Foundation uses the graded waterfront pad.
    const { x, z } = HARBOR_SITE, y = terrainHeight(x, z);
    b.add('box', 'ivory', x, y + .5, z, 10, 1, 16);
    b.add('box', 'glass', x, y + 3.1, z, 8, 4.5, 12);
    b.add('box', 'ivory', x, y + 5.7, z, 12, .4, 17);
    b.add('box', 'coral', x, y + 6, z, 8, .25, 12);
    this.collision.add({ x, z, w: 10, d: 16, y, h: 6.2 });
    this.root.add(b.finish());
  }

  // ── BRIDGE ────────────────────────────────────────────────────────────────
  createBridge() {
    const b = new Batch(); deck(b, BRIDGE, 'concrete');
    deck(b, { ...BRIDGE, d: 12, depth: .04, y: BRIDGE.y + .01 }, 'road');
    // Two pairs of cable-stay towers (slimmer, more proportional)
    for (const tx of [141, 218]) {
      for (const tz of [-88, -72]) {
        b.add('box', 'ivory', tx, 27, tz, 2, 55, 2);
        b.add('cylinder', 'concrete', tx, -.5, tz, 2.2, 8, 2.2);
        this.collision.add({ x: tx, z: tz, w: 4.4, d: 4.4, y: -4.5, h: 59 });
      }
      b.add('box', 'ivory', tx, 42, -80, 2, 2.2, 16);
      // Stay cables — fanned from tower top down to the deck surface. The
      // deck-side anchor tracks BRIDGE's actual (now raised) surface height
      // instead of a stale hardcoded constant, so cables stay attached to
      // the deck rather than floating above it after the bridge was raised.
      for (const side of [-1, 1]) for (let j = 1; j < 7; j++) for (const tz of [-88, -72]) {
        const ax = tx + side * j * 5.5;
        b.beam('white', new T.Vector3(tx, 49 - j * .6, tz), new T.Vector3(ax, surfaceHeight(BRIDGE, ax, tz) + .3, tz), .04);
      }
    }
    // Railings along both edges
    for (const tz of [-88, -72]) for (let x = 70; x < 302; x += 4) {
      const y = surfaceHeight(BRIDGE, x, tz);
      b.add('box', 'white', x, y + 1.2, tz, 4, .1, .1);
      b.add('box', 'concrete', x, y + .6, tz, .1, 1.2, .1);
      this.collision.add({ x, z: tz, w: 4, d: .15, y, h: 1.3 });
    }
    this.root.add(b.finish());
  }

  // ── ISLAND ────────────────────────────────────────────────────────────────
  createIsland() {
    const b = new Batch(), resort: Building[] = [];
    // Terrain base comes exclusively from the tiled heightfield; the former
    // cylinder layers and full-island concrete disk contradicted its shore.
    for (const [x, z, w, d, h] of [[275, -117, 24, 18, 14], [275, -42, 24, 18, 14], [309, -107, 14, 12, 9], [309, -52, 14, 12, 9]])
      this.placeBuilding(resort, { x, z, w, d, h, style: 1 });
    resort.forEach(p => building(b, p, 0));
    this.root.add(b.finish());
  }

  // ── FERRIS WHEEL ─────────────────────────────────────────────────────────
  createWheel() {
    const b = new Batch(), { x, z } = WHEEL_SITE, y = terrainHeight(x, z), hub = y + 18.5;
    b.add('box', 'concrete', x, y + .15, z, 32, .3, 6);
    // Support A-frame
    for (const dx of [-13, 13]) {
      b.beam('ivory', new T.Vector3(x + dx, y, z), new T.Vector3(x, hub, z), .55);
    }
    // Hub
    b.add('cylinder', 'concrete', x, hub, z, .55, .8, .55);
    // Spokes + gondolas
    this.wheel.add(new T.Mesh(new T.TorusGeometry(14, .25, 5, 48), materials.ivory));
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, gx = Math.cos(a) * 14, gy = Math.sin(a) * 14;
      b.beam('concrete', new T.Vector3(x, hub, z), new T.Vector3(x + gx, hub + gy, z), .09);
      const gondola = new T.Mesh(new T.SphereGeometry(1.15, 8, 6), materials[i % 2 ? 'coral' : 'teal']);
      gondola.position.set(gx, gy, 0); this.wheel.add(gondola);
    }
    this.wheel.position.set(x, hub, z); this.root.add(b.finish(), this.wheel);
    this.collision.add({ ...WHEEL_SITE, y, h: 34 });
  }

  // ── STREET DETAIL ─────────────────────────────────────────────────────────
  // Fills the city with micro-scale elements at street level.
  createStreetDetail() {
    const b = new Batch(); deck(b, PLAZA, 'concrete');
    // Plaza fountain is in a reserved pocket, not in the z=0 traffic lanes.
    const { x, z, y } = PLAZA;
    b.add('cylinder', 'concrete', x, y + .2, z, 4, .4, 4);
    b.add('cylinder', 'teal', x, y + .45, z, 3.4, .1, 3.4);
    b.add('sphere', 'teal', x, y + 1.2, z, .8, .9, .8);
    this.spatial.reserve({ x, z, w: 9, d: 9 }, 'landmark', y);
    this.collision.add({ x, z, w: 8, d: 8, y, h: 1.8 });
    this.root.add(b.finish());
  }

  // ── VEGETATION ────────────────────────────────────────────────────────────
  // Intentionally placed: waterfront row, marina, island, park, plaza.
  // No random road-side palms.
  createPalms(random: () => number) {
    const b = new Batch();
    const plant = (x: number, z: number, height: number) => {
      // Reserve the leaning trunk and crown as well as the root footprint.
      const bounds: Footprint = { x: x + .8, z, w: 10, d: 9 };
      const site = this.spatial.place(bounds, 'palm');
      if (!site) return;
      const y = terrainHeight(x, z);
      palm(b, x, z, height, 0, y);
      this.collision.add({ x, z, w: .75, d: .75, y, h: height });
    };
    for (let z = -218; z < 216; z += 15) {
      for (const x of [64, 111]) plant(x + random() * 2, z, 7 + random() * 3);
    }
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2, r = 27 + random() * 18;
      plant(282 + Math.cos(a) * r, -80 + Math.sin(a) * r * 1.05, 7 + random() * 3);
    }
    for (let i = 0; i < 140; i++) plant(-275 + random() * 330, -240 + random() * 435, 6 + random() * 4);
    this.root.add(b.finish());
  }
}
