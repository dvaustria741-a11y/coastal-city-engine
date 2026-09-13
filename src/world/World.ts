import * as T from 'three/webgpu';
import { Batch, building, palm, materials, type Building } from '../assets/models';
import { seeded } from '../core/settings';
import { coast, island, terrainHeight, groundHeight, CollisionWorld } from './queries';

export interface Chunk {
  id: number; x: number; z: number; buildings: Building[];
  group: T.Group; detail: number; resident: boolean; lastChange: number;
}

// ─── local helpers ────────────────────────────────────────────────────────────
const ss  = (a: number, b: number, t: number) => { const n = Math.max(0, Math.min(1,(t-a)/(b-a))); return n*n*(3-2*n); };
const lp  = (a: number, b: number, t: number) => a + (b-a)*t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Road intersection X-positions and Z-positions used for palm/planter avoidance
const ROAD_XS = [-240, -160, -80, 0, 80];
const ROAD_ZS = [-240, -160, -80, 0, 80, 160];
function nearRoad(x: number, z: number, gap = 14): boolean {
  return ROAD_XS.some(rx => Math.abs(x - rx) < gap) ||
         ROAD_ZS.some(rz => Math.abs(z - rz) < gap);
}

// ─── terrain tile builder (vice-coast approach) ───────────────────────────────
const TERRAIN_MAT = new T.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0 });

function buildTerrainTile(
  x0: number, z0: number, x1: number, z1: number, step: number
): T.Mesh | null {
  const nx = Math.floor((x1 - x0) / step) + 1;
  const nz = Math.floor((z1 - z0) / step) + 1;
  const positions: number[] = [], colors: number[] = [];
  let hasLand = false;

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * step;
      const z = z0 + iz * step;
      const h = terrainHeight(x, z);
      if (h > -0.6) hasLand = true;
      positions.push(x, Math.max(h, -1.0), z);

      // ── Biome vertex colours ──────────────────────────────────────────────
      const cx = coast(z);
      const inland = cx - x;                        // >0 = inland from east coast
      const isIsland = island(x, z);

      // Sand weight: strong near coastline, beach dunes, island shores
      const sandCoast  = ss(30, 0, inland);
      const sandIsland = isIsland
        ? clamp((1 - Math.hypot((x-282)/50, (z+80)/63)) * 2.2, 0, 1)
        : 0;
      const sand = clamp(Math.max(sandCoast, sandIsland), 0, 1);

      // Rock weight: steep hills in residential zone
      const rocky = (x < -130 && h > 3.8)
        ? clamp((h - 3.8) / 2.5, 0, 1) * ss(-295, -130, x)
        : 0;

      // Grass base colour: #6e9555  sand: #dbc98a  rock: #857265
      const r = lp(lp(0.43, 0.86, sand), 0.52, rocky);
      const g = lp(lp(0.58, 0.79, sand), 0.45, rocky);
      const b = lp(lp(0.33, 0.54, sand), 0.40, rocky);
      colors.push(r, g, b);
    }
  }

  if (!hasLand) return null;

  const indices: number[] = [];
  for (let iz = 0; iz < nz - 1; iz++)
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz*nx+ix, b=a+1, c=a+nx, d=c+1;
      indices.push(a, c, b,  b, c, d);
    }

  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color',    new T.Float32BufferAttribute(colors,    3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new T.Mesh(geo, TERRAIN_MAT);
  mesh.receiveShadow = true;
  return mesh;
}

// ─── World class ─────────────────────────────────────────────────────────────
export class World {
  root      = new T.Group();
  chunks: Chunk[] = [];
  collision = new CollisionWorld();
  wheel     = new T.Group();

  constructor(public scene: T.Scene) { scene.add(this.root); }

  // ── MAIN BUILD ─────────────────────────────────────────────────────────────
  async create(progress: (p: number, label: string) => void) {
    // Terrain first so everything plants correctly
    this.createTerrain();
    this.createRoads();
    this.createWaterfront();
    this.createMarina();
    this.createBridge();
    this.createIsland();
    this.createWheel();
    this.createStreetDetail();

    const random = seeded(771);

    // ── COMPACT CITY GRID ─────────────────────────────────────────────────
    // 4 columns × 5 rows, step 55 — downtown centred around (-82, -83).
    // 8 buildings per cluster (4 corners + 4 edge midpoints) for urban density.
    const COLS = 4, ROWS = 5, STEP = 55;
    const X0 = -165, Z0 = -168;

    for (let iz = 0; iz < ROWS; iz++) {
      for (let ix = 0; ix < COLS; ix++) {
        const cx = X0 + ix * STEP;   // e.g. -165, -110, -55, 0
        const cz = Z0 + iz * STEP;   // e.g. -168, -113, -58, -3, 52

        // Tallest towers near centre of grid
        const central = Math.max(0, 1 - Math.hypot(cx + 83, cz + 83) / 185);
        // Downtown core (top-left quadrant of grid) gets extra height
        const downtown = ix < 2 && iz < 3 ? 1 : 0;

        const buildings: Building[] = [];

        // 4 corner positions + 4 edge-midpoint positions
        const offsets: [number, number][] = [
          [-19, -17], [ 19, -17], [-19,  17], [ 19,  17],   // corners
          [  0, -22], [  0,  22], [-23,   0], [ 23,   0],   // midpoints
        ];

        for (const [dx, dz] of offsets) {
          const baseH = 12 + random() * 14;
          const downtownBonus = downtown * random() * 80;
          const centralBonus  = central  * random() * 55;
          const h = baseH + downtownBonus + centralBonus;
          const w = 18 + random() * 12;
          const d = 17 + random() * 11;
          const p: Building = { x: cx+dx, z: cz+dz, w, d, h, style: Math.floor(random()*5) };
          buildings.push(p);
          this.collision.add({ ...p, w: p.w + 3, d: p.d + 3 });
        }

        const chunk: Chunk = {
          id: this.chunks.length, x: cx, z: cz, buildings,
          group: new T.Group(), detail: 2, resident: false, lastChange: 0,
        };
        chunk.group = this.buildChunk(chunk, 2);
        this.root.add(chunk.group);
        this.chunks.push(chunk);
        progress(0.2 + this.chunks.length / 20 * 0.6, 'Building the city');
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ── ADDITIONAL DOWNTOWN TOWERS (signature skyline) ───────────────────
    // 3 landmark super-towers at the city core
    const landmarks: [number, number, number, number][] = [
      [-83, -113, 35, 130],   // tallest spire
      [-138, -83,  28, 105],  // twin
      [-28,  -83,  30, 115],  // bookend
    ];
    {
      const rLand = seeded(998);
      const lbatch = new Batch();
      for (const [lx, lz, lw, lh] of landmarks) {
        building(lbatch, { x: lx, z: lz, w: lw, d: lw-2, h: lh, style: 2 }, 0);
        this.collision.add({ x: lx, z: lz, w: lw+4, d: lw+2, h: lh + 8 });
        // Rooftop antenna
        lbatch.beam('dark',
          new T.Vector3(lx, lh + 2.5 + 2, lz),
          new T.Vector3(lx, lh + 22 + 2, lz), .08);
        void rLand;
      }
      this.root.add(lbatch.finish());
    }

    // Vegetation last so it sits on final terrain
    this.createPalms(random);
    this.root.name = 'Coastal district';
  }

  // ── TERRAIN ───────────────────────────────────────────────────────────────
  // Continuous heightfield tiled in 240×240 chunks with 6-unit step.
  // Vice-coast approach: SDF-driven height + vertex-colour biomes.
  createTerrain() {
    const STEP = 6, TILE = 240;
    // Cover full playable world including island (x≈282) and bridge approach
    for (let tx = -306; tx < 420; tx += TILE) {
      for (let tz = -282; tz < 250; tz += TILE) {
        const mesh = buildTerrainTile(tx, tz, tx + TILE, tz + TILE, STEP);
        if (mesh) this.root.add(mesh);
      }
    }
  }

  // ── CHUNK BUILDER (used by ChunkManager for LOD) ─────────────────────────
  buildChunk(chunk: Chunk, detail: number): T.Group {
    const b = new Batch();
    chunk.buildings.forEach(p => building(b, p, detail));

    if (detail < 2) {
      // Sidewalk slab under each cluster
      b.add('box', 'concrete', chunk.x, 2.503, chunk.z, 48, 0.04, 46);

      // Corner planters with small shrubs
      for (const [dx, dz] of [[-14, -14],[14,-14],[-14,14],[14,14]]) {
        b.add('box', 'dark',    chunk.x+dx, 2.51,  chunk.z+dz, 3.5, 0.10, 3.5);
        b.add('box', 'grass',   chunk.x+dx, 2.63,  chunk.z+dz, 3.2, 0.18, 3.2);
        b.add('sphere','leaf',  chunk.x+dx, 3.1,   chunk.z+dz, 1.8, 1.4,  1.8,  Math.random()*6.28);
      }

      // Streetlights on all 4 sides of block
      for (const [ox, oz] of [[-24,0],[24,0],[0,-24],[0,24]]) {
        b.add('cylinder','dark', chunk.x+ox, 6.0, chunk.z+oz, .075, 7.8, .075);
        // Arm
        b.add('box','dark',
          chunk.x+ox + (ox!==0?Math.sign(ox)*1.2:1.4),
          9.5,
          chunk.z+oz + (oz!==0?Math.sign(oz)*1.2:0),
          Math.abs(ox)>0 ? .08 : 2.8, .09, Math.abs(oz)>0 ? 2.8 : .08);
        b.add('sphere','light', chunk.x+ox+(ox!==0?Math.sign(ox)*1:1), 9.42, chunk.z+oz+(oz!==0?Math.sign(oz)*1:0), .3,.14,.3);
      }
    }
    return b.finish();
  }

  // ── ROADS ─────────────────────────────────────────────────────────────────
  createRoads() {
    const b = new Batch();

    // Vertical roads
    for (const x of ROAD_XS) {
      b.add('box','concrete', x, 2.48, -40, 19, .16, 423);
      b.add('box','road',     x, 2.60, -40, 13, .12, 423);
      // Lane dividers
      for (let z = -248; z < 170; z += 11)
        b.add('box','line', x, 2.67, z, .16, .025, 4);
      // Kerb strips
      for (const side of [-1,1]) {
        b.add('box','concrete', x + side*9.8, 2.51, -40, .4, .22, 423);
      }
    }

    // Horizontal roads
    for (const z of ROAD_ZS) {
      b.add('box','concrete',-78, 2.48, z, 341, .16, 19);
      b.add('box','road',    -78, 2.60, z, 341, .12, 13);
      for (let x = -243; x < 86; x += 11)
        b.add('box','line', x, 2.70, z, 4, .025, .16);
      for (const side of [-1,1])
        b.add('box','concrete',-78, 2.51, z + side*9.8, 341, .22, .4);
    }

    // Crosswalk stripes at major intersections
    for (const rx of ROAD_XS) for (const rz of ROAD_ZS) {
      for (let i = -2; i <= 2; i++) {
        b.add('box','line', rx + i*1.7, 2.72, rz + 9.5, 1.1, .03,  3);
        b.add('box','line', rx + 9.5,   2.72, rz + i*1.7, 3, .03, 1.1);
      }
    }

    // Traffic signal poles at intersections
    for (const rx of ROAD_XS) for (const rz of ROAD_ZS) {
      b.add('cylinder','dark', rx+8, 4,    rz+8, .10, 6,   .10);
      b.add('box',     'dark', rx+8, 7.1,  rz+8, .72, 1.6, .42);
      b.add('sphere',  'coral',rx+8, 7.7,  rz+8.25, .16,.16,.08);
    }

    this.root.add(b.finish());
  }

  // ── WATERFRONT PROMENADE ──────────────────────────────────────────────────
  createWaterfront() {
    const b = new Batch();

    // Main promenade walkway (x=88..102, z=-90..170)
    b.add('box','concrete', 95, 2.515, 40, 20, .06, 270);

    // Steps down to water (3 tiers)
    b.add('box','concrete', 106, 2.30, 40, 10, .25, 270);
    b.add('box','concrete', 112, 1.90, 40, 10, .25, 270);
    b.add('box','concrete', 117, 1.48, 40, 10, .25, 270);

    // Railing posts every 4 m
    for (let z = -88; z <= 168; z += 4) {
      b.add('cylinder','white',101.5, 3.6, z, .065, 2.2, .065);
    }
    // Top rail
    b.add('box','white', 101.5, 4.65, 40, .07, .10, 260);
    // Mid rail
    b.add('box','white', 101.5, 3.85, 40, .07, .07, 260);

    // Benches every 28 m (alternating sides)
    for (let z = -72; z <= 150; z += 28) {
      const side = (Math.floor((z+72)/28) % 2) ? 1 : -1;
      b.add('box','wood',  93 + side*3, 2.76, z, 4,  .35, 1.3);
      b.add('box','dark',  91 + side*3, 2.87, z, 4,  .62, .22);
      b.add('box','dark',  96 + side*3, 2.87, z, 4,  .62, .22);
    }

    // Promenade lamp-posts every 22 m
    for (let z = -70; z <= 155; z += 22) {
      b.add('cylinder','dark', 98.5, 5.5, z, .07, 6.2, .07);
      b.add('box',     'dark', 100.5, 8.5, z, 3.5, .09, .09);
      b.add('sphere',  'light',102,   8.42, z, .28,.13,.28);
    }

    // Waterfront low wall (seating ledge)
    b.add('box','ivory', 104, 2.70, 40, .45, .55, 272);

    // Cafe/kiosk structures along promenade
    for (const kz of [-50, 0, 60, 110]) {
      b.add('box','wood',   87, 2.7,  kz, 7, .5,   5);
      b.add('box','coral',  87, 4.0,  kz, 7.6, .22, 5.6);
      b.add('box','glass',  87, 3.15, kz, 6.5, .9,  4.5);
      this.collision.add({ x:87, z:kz, w:7, d:5, h:5 });
    }

    this.root.add(b.finish());
  }

  // ── MARINA ────────────────────────────────────────────────────────────────
  createMarina() {
    const b = new Batch();

    // Main dock platforms
    b.add('box','wood', 138.5, 2.23, 108, 57, .55, 5.8);
    b.add('box','wood', 150.5, 2.23, 114.5, 5, .55, 41);

    // Dock pilings & cleats
    for (let x = 118; x < 165; x += 6) {
      b.add('cylinder','dark', x, .5,  106, .28, 4.2, .28);
      b.add('box',     'ivory', x, 2.7, 105.3, .22, 1.2, .22);
    }
    for (let z = 96; z < 136; z += 10) {
      b.add('box','wood', 156, 2.23, z, 16, .55, 2.5);
      b.add('cylinder','dark', 162, .5, z, .22, 4.2, .22);
    }

    // Marina building / harbour master
    b.add('box','ivory', 100, 3,   116, 10, 1,   16);
    b.add('box','glass', 100, 5.8, 116, 8,  4.5, 12);
    b.add('box','ivory', 100, 8.2, 116, 12, .4,  17);
    b.add('box','coral', 100, 8.5, 116,  8, .25, 12);
    this.collision.add({ x:100, z:116, w:10, d:16, h:9 });

    // Jetty flags/markers
    for (let z = 155; z < 209; z += 11) {
      b.add('cylinder','wood',  114, 3.8, z, .07, 3.2, .07);
      b.add('cone', z%2 ? 'coral':'ivory', 114, 5.5, z, 2, .7, 2);
      b.add('box',  'white', 116, 2.8, z+2, 1, .12, 2.6, 0, 0, .2);
    }

    // Fuel dock / pier extension
    b.add('box','wood', 170, 2.23, 110, 6, .5, 40);
    for (let z = 92; z < 132; z += 8) {
      b.add('cylinder','dark', 174, .5, z, .22, 4, .22);
    }

    this.root.add(b.finish());
  }

  // ── BRIDGE ────────────────────────────────────────────────────────────────
  createBridge() {
    const b = new Batch();

    // Road deck
    b.add('box','concrete', 179, 2.9,  -80, 218, 1,   17);
    b.add('box','road',     179, 3.44, -80, 218, .09, 12);
    for (let x = 80; x < 285; x += 12)
      b.add('box','line', x, 3.50, -80, 5, .02, .16);

    // Two pairs of cable-stay towers (slimmer, more proportional)
    for (const tx of [141, 218]) {
      for (const tz of [-88, -72]) {
        b.add('box','ivory', tx, 27, tz, 2.0, 55, 2.0);
        b.add('cylinder','concrete', tx, -.5, tz, 2.2, 8, 2.2);
      }
      // Cross beam at top
      b.add('box','ivory', tx, 42, -80, 2, 2.2, 16);

      // Stay cables — fanned from tower top
      for (const side of [-1, 1])
        for (let j = 1; j < 7; j++)
          for (const tz of [-88, -72])
            b.beam('white',
              new T.Vector3(tx, 49 - j*.6, tz),
              new T.Vector3(tx + side * j * 5.5, 3.8, tz), .04);
    }

    // Railings along both edges
    for (const tz of [-88, -72]) {
      b.add('box','white', 179, 4.85, tz, 218, .10, .10);
      for (let x = 76; x < 286; x += 5)
        b.add('box','concrete', x, 4.1, tz, .10, 1.5, .10);
    }

    // Bridge approach ramps (east side)
    b.add('box','concrete', 292, 2.2, -80, 24, .9, 17);
    b.add('box','road',     292, 2.7, -80, 24, .1, 12);

    this.root.add(b.finish());
  }

  // ── ISLAND ────────────────────────────────────────────────────────────────
  createIsland() {
    const b = new Batch();

    // Terrain base — real shape instead of cylinder slab
    b.add('cylinder','sand',  282, -.9, -80, 70, 7.0, 83);
    b.add('cylinder','grass', 282, 1.1, -80, 56, 3.2, 64);

    // Road on island
    b.add('box','concrete', 263, 2.55, -80, 68, .15, 19);
    b.add('box','road',     263, 2.65, -80, 68, .10, 12);

    // Resort buildings
    const rng = seeded(555);
    for (const [bx, bz, bw, bd, bh] of [
      [275, -117, 28, 22, 14], [275, -42, 28, 22, 14],
      [296, -80,  18, 14,  9], [258, -80,  18, 14,  9],
    ] as [number,number,number,number,number][]) {
      building(b, { x:bx, z:bz, w:bw, d:bd, h:bh, style:1 }, 0);
      this.collision.add({ x:bx, z:bz, w:bw+3, d:bd+3, h:bh+2 });
      void rng;
    }

    // Pool / feature
    b.add('box','teal',  282, 2.28, -80, 14, .25, 10);
    b.add('box','glass', 310, 2.8,  -80, 12, .4,  25);
    b.add('box','ivory', 282, 2.5,  -80, 24, .1,  .5);   // pool edge

    // Perimeter walkway
    b.add('cylinder','concrete', 282, 2.502, -80, 65, .04, 78);

    this.root.add(b.finish());
  }

  // ── FERRIS WHEEL ─────────────────────────────────────────────────────────
  createWheel() {
    const b = new Batch();

    // Support A-frame
    for (const x of [82, 108])
      b.beam('ivory', new T.Vector3(x, 2.5, 28), new T.Vector3(95, 22, 28), .55);

    // Hub
    b.add('cylinder','concrete', 95, 21, 28, .55, .8, .55);

    // Spokes + gondolas
    const ring = new T.Mesh(new T.TorusGeometry(14, .25, 5, 48), materials.ivory);
    this.wheel.add(ring);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const gx = Math.cos(a) * 14, gy = Math.sin(a) * 14;
      b.beam('concrete', new T.Vector3(95, 21, 28), new T.Vector3(95+gx, 21+gy, 28), .09);
      const gondola = new T.Mesh(
        new T.SphereGeometry(1.15, 8, 6),
        materials[i % 2 ? 'coral' : 'teal']
      );
      gondola.position.set(gx, gy, 0);
      this.wheel.add(gondola);
    }

    this.wheel.position.set(95, 21, 28);
    this.root.add(b.finish(), this.wheel);
    this.collision.add({ x:95, z:28, w:32, d:4, h:36 });
  }

  // ── STREET DETAIL ─────────────────────────────────────────────────────────
  // Fills the city with micro-scale elements at street level.
  createStreetDetail() {
    const b = new Batch();

    // Median planters and low shrubs on main N-S roads
    for (const rx of ROAD_XS) {
      for (let z = -230; z < 165; z += 32) {
        if (ROAD_ZS.some(rz => Math.abs(z - rz) < 18)) continue;
        // Planter box
        b.add('box','dark',  rx, 2.53, z, 6, .14, 2.5);
        b.add('box','grass', rx, 2.66, z, 5.5, .18, 2.0);
        b.add('sphere','leafLight', rx, 3.15, z, 2.2, 1.6, 2.2, z*.1);
      }
    }

    // Median planters on E-W roads (z=0 and z=-80)
    for (const rz of [0, -80]) {
      for (let x = -225; x < 78; x += 32) {
        if (ROAD_XS.some(rx => Math.abs(x - rx) < 18)) continue;
        b.add('box','dark',  x, 2.53, rz, 2.5, .14, 6);
        b.add('box','grass', x, 2.66, rz, 2.0, .18, 5.5);
        b.add('sphere','leaf', x, 3.1, rz, 2.0, 1.5, 2.0, x*.07);
      }
    }

    // Public plaza near waterfront (x=55..82, z=-35..35)
    b.add('box','concrete', 68, 2.503, 0,  28, .04, 72);
    b.add('box','dark',     68, 2.52,  0, 26, .06, 70);
    // Plaza fountain
    b.add('cylinder','concrete', 68, 2.6, 0,  5.5, .4,  5.5);
    b.add('cylinder','teal',     68, 2.9, 0,  3.8, .6,  3.8);
    b.add('sphere',  'teal',     68, 3.5, 0,  1.2, .9,  1.2);
    // Fountain ring benches
    for (let fi = 0; fi < 6; fi++) {
      const fa = fi/6*Math.PI*2;
      b.add('box','wood', 68+Math.cos(fa)*7, 2.73, Math.sin(fa)*7, 3, .3, 1.1, fa);
    }

    // Bus stops / street furniture along waterfront road (x=82 road)
    for (const sz of [-40, 20, 80]) {
      b.add('box','glass', 79, 3.8, sz, .12, 3.5, 5);
      b.add('box','concrete', 81, 2.55, sz, 1.5, .1, 5);
      b.add('box','dark',  79.5, 2.65, sz, .4, 2.2, .4);
      b.add('box','dark',  79.5, 2.65, sz+4.5, .4, 2.2, .4);
    }

    // Ground-floor shopfront detail strips
    // (subtle coloured stripe at building base — makes street feel lived-in)
    const shopColors: (keyof typeof materials)[] = ['coral','teal','wood','concrete'];
    const rng = seeded(444);
    for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 5; iz++) {
      const cx = -165 + ix*55, cz = -168 + iz*55;
      const col = shopColors[Math.floor(rng()*4)];
      b.add('box', col, cx,    2.58, cz,   48, .08, .6);
      b.add('box', col, cx,    2.58, cz+46, 48, .08, .6);
      b.add('box', col, cx-23, 2.58, cz,   .6, .08, 46);
      b.add('box', col, cx+23, 2.58, cz,   .6, .08, 46);
    }

    this.root.add(b.finish());
  }

  // ── VEGETATION ────────────────────────────────────────────────────────────
  // Intentionally placed: waterfront row, marina, island, park, plaza.
  // No random road-side palms.
  createPalms(random: () => number) {
    const b = new Batch();

    // 1. Waterfront promenade (west side, single staggered row)
    for (let z = -82; z <= 165; z += 14 + random() * 7) {
      if (Math.abs(z + 80) < 18) continue;  // gap where bridge road crosses
      if (Math.abs(z - 108) < 16) continue; // gap at marina dock entry
      const px = 84 + random() * 4;
      palm(b, px, z, 7.5 + random() * 3, 0, 2.5);
    }

    // 2. Marina perimeter palms
    for (let z = 90; z <= 150; z += 16 + random() * 6) {
      palm(b, 168, z, 6.5 + random() * 2, 0, 2.5);
    }
    for (let x = 118; x <= 162; x += 18) {
      palm(b, x, 138, 6 + random() * 2, 0, 2.5);
    }

    // 3. Island ring of palms
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const r = 30 + random() * 22;
      palm(b, 282 + Math.cos(a)*r, -80 + Math.sin(a)*r*.86, 7 + i%4, 0, 2.5);
    }

    // 4. Waterfront park (plaza zone)
    for (let pi = 0; pi < 12; pi++) {
      const px = 48 + random() * 26;
      const pz = -28 + random() * 72;
      if (nearRoad(px, pz, 12)) continue;
      palm(b, px, pz, 6.5 + random() * 3.5, 0, 2.5);
    }

    // 5. Promenade cafe clusters (flanking kiosks)
    for (const kz of [-50, 0, 60, 110]) {
      for (const side of [-1, 1]) {
        palm(b, 84, kz + side * 8, 6.5 + random() * 2, 0, 2.5);
      }
    }

    // 6. Road median palms (along z=0 road, in median strips)
    for (let rx = -220; rx < 72; rx += 22) {
      if (nearRoad(rx, -4, 18) || nearRoad(rx, 4, 18)) continue;
      palm(b, rx, -3 + random() * 6, 6.5 + random() * 2, 0, 2.5);
    }

    // 7. Beach fringe (just west of the waterline, z varies)
    for (let bz = -75; bz <= 55; bz += 20 + random() * 12) {
      const bx = coast(bz) - 8 - random() * 10;
      if (bx < 90) palm(b, bx, bz, 6 + random() * 3, 0, 2.5);
    }

    this.root.add(b.finish());
  }
}


