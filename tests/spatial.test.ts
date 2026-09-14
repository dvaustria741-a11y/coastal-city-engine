import { beforeAll, describe, expect, it } from 'vitest';
import * as T from 'three/webgpu';
import { World, buildTerrainTile } from '../src/world/World';
import { Activity } from '../src/gameplay/Activity';
import { Player } from '../src/gameplay/Player';
import { ChunkManager } from '../src/streaming/ChunkManager';
import { defaults, residencyRadius, type Settings } from '../src/core/settings';
import { disposeBatch } from '../src/assets/models';
import type { Input } from '../src/input/Input';
import {
  terrainHeight, groundHeight, isLand, isWater, navigableWater, swimmable, onDock, CollisionWorld,
  SpatialReservations, sampleFootprint, overlaps, ROADS, DOCKS, BRIDGE, BRIDGE_RAMP, SURFACES, BOAT_BERTH,
  PLAYER_SPAWN, surfaceHeight, WATER_LEVEL,
} from '../src/world/queries';

const scene = new T.Scene(), world = new World(scene);
beforeAll(async () => { await world.create(() => {}); }, 30000);
const input = (horizontal = 0, vertical = 0) => ({ horizontal, vertical, sprint: false, keys: new Set(), consume: () => false }) as unknown as Input;
function walk(player: Player, x: number, z: number) {
  for (let i = 0; i < 2400; i++) {
    const dx = x - player.position.x, dz = z - player.position.z, length = Math.hypot(dx, dz);
    if (length < .12) return;
    player.update(1 / 60, input(dx / Math.max(.1, length), -dz / Math.max(.1, length)), 0);
  }
  throw new Error(`Walking route blocked at ${player.position.toArray()} toward ${x},${z}`);
}

describe('one terrain and physical surface model', () => {
  it('grades complete finite road footprints below their surfaces', () => {
    for (const r of ROADS) expect(sampleFootprint(r, (x, z) => terrainHeight(x, z) <= r.y && r.y - terrainHeight(x, z) < .25, 4)).toBe(true);
    expect(terrainHeight(-200, -190)).toBeGreaterThan(2.5);
    expect(terrainHeight(80, 350)).toBeLessThan(0);
  });
  it('never applies a nominal shoreline cutoff to visible dry land', () => {
    for (let z = -240; z < 220; z += 7) for (let x = 90; x < 155; x += 2) {
      if (isLand(x, z)) expect(groundHeight(x, z)).toBeGreaterThan(0);
      if (isWater(x, z)) expect(terrainHeight(x, z)).toBeLessThan(WATER_LEVEL);
    }
  });
  it('uses matching tile-edge positions and normals', () => {
    const a = buildTerrainTile(-86, -82, -66, -62)!, b = buildTerrainTile(-66, -82, -46, -62)!;
    for (let iz = 0; iz <= 10; iz++) {
      for (const attribute of ['position', 'normal']) for (let component = 0; component < 3; component++) {
        expect(a.geometry.getAttribute(attribute).array[(iz * 11 + 10) * 3 + component]).toBe(b.geometry.getAttribute(attribute).array[iz * 11 * 3 + component]);
      }
    }
    a.geometry.dispose(); b.geometry.dispose();
  });
  it('grounds objects on the rendered triangle interiors, not a different noise field', () => {
    const tile = buildTerrainTile(-220, -120, -210, -110)!;
    const ray = new T.Raycaster(new T.Vector3(-215.3, 100, -113.7), new T.Vector3(0, -1, 0));
    const hit = ray.intersectObject(tile)[0];
    expect(hit.point.y).toBeCloseTo(terrainHeight(-215.3, -113.7), 5);
    tile.geometry.dispose();
  });
  it('recognizes every dock and finger with exact physical bounds', () => {
    for (const d of DOCKS) {
      expect(onDock(d.x, d.z)).toBe(true);
      expect(groundHeight(d.x, d.z)).toBeCloseTo(d.y);
      expect(navigableWater(d.x, d.z)).toBe(false);
    }
    expect(navigableWater(185, 120)).toBe(true);
    expect(world.collision.boatFits(BOAT_BERTH.x, BOAT_BERTH.z, BOAT_BERTH.yaw)).toBe(true);
  });
  it('joins bridge ramps without a step at either abutment', () => {
    for (const x of [BRIDGE.x - BRIDGE.w / 2, BRIDGE.x + BRIDGE.w / 2]) expect(Math.abs(groundHeight(x - .1, -80) - groundHeight(x + .1, -80))).toBeLessThan(.05);
    expect(surfaceHeight(BRIDGE, 180, -80)).toBe(BRIDGE.y);
  });
});

describe('shared placement and collision boundaries', () => {
  it('finds colliders across a spatial-cell edge and respects their vertical interval', () => {
    const c = new CollisionWorld(); c.add({ x: 40.6, z: 20, w: .3, d: 3, y: 6, h: 2 });
    expect(c.blocked(39.9, 20, .8, 6)).toBe(true);
    expect(c.blocked(39.9, 20, .8, 2.5)).toBe(false);
    expect(c.blocked(39.9, 20, .8, 8)).toBe(false);
  });
  it('checks reservation overlap across a cell edge', () => {
    const s = new SpatialReservations(); s.reserve({ x: 40.5, z: 40, w: 1, d: 1 }, 'prop');
    expect(s.place({ x: 39, z: 40, w: 2, d: 2 }, 'bush')).toBeNull();
  });
  it('rejects water, protected paths, steep terrain, and overlapping objects', () => {
    const s = new SpatialReservations();
    expect(s.place({ x: 168, z: 120, w: 2, d: 2 }, 'palm')).toBeNull();
    expect(s.place({ x: 80, z: 120, w: 2, d: 2 }, 'bush')).toBeNull();
    expect(s.place({ x: 94, z: 120, w: 2, d: 2 }, 'prop')).toBeNull();
    expect(s.place({ x: -288, z: 40, w: 18, d: 18 }, 'building')).toBeNull();
    expect(s.place({ x: -40, z: -40, w: 10, d: 10 }, 'building')).not.toBeNull();
    expect(s.place({ x: -39, z: -39, w: 3, d: 3 }, 'palm')).toBeNull();
  });
  it('has dense validated blocks without overlapping generated buildings or vegetation', () => {
    const entries = world.spatial.entries;
    expect(world.chunks.flatMap(c => c.buildings).length).toBeGreaterThan(45);
    expect(entries.filter(e => e.kind === 'palm').length).toBeGreaterThan(12);
    for (const [i, a] of entries.entries()) {
      if (a.kind !== 'building' && a.kind !== 'palm' && a.kind !== 'bush') continue;
      expect(sampleFootprint(a, isLand)).toBe(true);
      expect(SURFACES.some(s => overlaps(s, a))).toBe(false);
      for (let j = i + 1; j < entries.length; j++) expect(overlaps(a, entries[j]), `occupancy ${i}/${j}`).toBe(false);
    }
  });
  it('uses foundations that meet the terrain without hiding a buried floor', () => {
    for (const p of world.chunks.flatMap(c => c.buildings)) {
      expect(p.y - p.minY).toBeLessThanOrEqual(1.25);
      expect(sampleFootprint({ ...p, w: p.w + 3, d: p.d + 3 }, (x, z) => terrainHeight(x, z) <= p.y + .001)).toBe(true);
    }
  });
  it('rebuilds deterministic chunk details without adding occupancy or colliders', () => {
    const c = world.chunks[5], count = world.spatial.entries.length;
    const first = world.buildChunk(c, 0), second = world.buildChunk(c, 0);
    const matrices = (group: T.Group) => group.children.map(o => [...(o as T.InstancedMesh).instanceMatrix.array]);
    expect(matrices(first)).toEqual(matrices(second));
    expect(world.spatial.entries.length).toBe(count);
    disposeBatch(first); disposeBatch(second);
  });
});

describe('existing player and boat gameplay', () => {
  it('preserves walkable entry points in all eight major districts', () => {
    for(const [name,x,z] of [
      ['downtown',-8.25,-120],['waterfront',94,92],['marina',150.5,108],['beach',110,180],
      ['bridge',180,-80],['residential',-240,-120],['entertainment',52,48],['island',302,-80],
    ] as const) expect(world.collision.walkable(x,z),name).toBe(true);
    expect(world.spatial.entries.filter(e=>e.kind==='building'&&e.x>220).length).toBeGreaterThanOrEqual(2);
  });
  it('walks city → promenade → dock, boards, sails out, returns, and exits safely', () => {
    const player = new Player(scene, world.collision), activity = new Activity(scene, world.collision);
    // Start on the city sidewalk and walk through the actual player movement.
    player.position.set(70, groundHeight(70, 92), 92);
    walk(player, PLAYER_SPAWN.x, PLAYER_SPAWN.z);
    walk(player, 94, 108); walk(player, 150.5, 108); walk(player, 150.5, 120); walk(player, 152.2, 120);
    expect(activity.nearest(player)?.kind).toBe('boat');
    expect(activity.interact(player)).toContain('helm');
    expect(player.model.visible).toBe(false);
    for (let i = 0; i < 600; i++) activity.drive(1 / 60, input(0, 1));
    expect(activity.boat.position.x).toBeGreaterThan(240);
    expect(activity.interact(player)).toContain('closer');
    expect(activity.active?.kind).toBe('boat');
    activity.boat.speed = 0;
    for (let i = 0; i < 6000 && activity.boat.position.x > BOAT_BERTH.x + .1; i++) activity.drive(1 / 60, input(0, -1));
    expect(activity.boat.position.x).toBeLessThan(BOAT_BERTH.x + .2);
    expect(activity.interact(player)).toContain('Back on foot');
    expect(activity.active).toBeNull();
    expect(player.model.visible).toBe(true);
    expect(world.collision.walkable(player.position.x, player.position.z, .6)).toBe(true);
    expect(onDock(player.position.x, player.position.z)).toBe(true);
  });
  it('keeps looping street traffic on the underpass instead of lifting it onto the bridge deck', () => {
    // These cars follow a fixed street-level patrol whose x≈83 lane happens
    // to run straight through the bridge's z-band via the x=80 underpass —
    // they should never end up on the elevated deck. p=240 in the loop's
    // first leg puts the car at (83, -80), squarely under it.
    const activity = new Activity(scene, world.collision);
    activity.trafficProgress[0] = 240;
    activity.update(1 / 60, { ...defaults(), quality: 'Ultra' }, new T.Vector3(0, 0, 500), new T.PerspectiveCamera());
    expect(activity.traffic[0].position.z).toBeCloseTo(-80, 1);
    expect(activity.traffic[0].position.y).toBeLessThan(4); // street level (~2.68), not partway up the ~7.2-high ramp at this x
  });
  it('will not drive a hull through a thin dock even with a large frame delta', () => {
    const activity = new Activity(scene, world.collision); activity.active = activity.boat; activity.boat.speed = -15;
    activity.drive(1, input(0, -1));
    expect(activity.boat.position.x).toBeGreaterThan(157);
    expect(world.collision.boatFits(activity.boat.position.x, activity.boat.position.z, activity.boat.yaw)).toBe(true);
  });
  it('rejects boarding through solid obstacles and exiting onto an overhead bridge', () => {
    const c = new CollisionWorld(); c.add({ x: 155, z: 120, w: .3, d: 7, y: 0, h: 8 });
    const activity = new Activity(scene, c), player = new Player(scene, c);
    player.position.set(152, 2.5, 120);
    expect(activity.nearest(player)).toBeUndefined();
    expect(c.findExit(180, -68, 0, 'boat')).toBeNull();
  });
  it('walks the bridge end-to-end using the same collision world', () => {
    const p = new Player(scene, world.collision); p.position.set(20, groundHeight(20, -80), -80);
    walk(p, 185, -80); walk(p, 347, -80);
    expect(p.position.y).toBeCloseTo(groundHeight(p.position.x, p.position.z), 2);
  });
  it('carries the x=80 street straight through as a real underpass beneath the bridge deck', () => {
    // The street under the bridge deck and the deck itself are two
    // physically-stacked surfaces at the same (x, z); groundHeight's
    // reference-height mode (queries.ts) resolves each query to whichever
    // one the caller is actually on, so a pedestrian on the street stays
    // on it instead of snapping onto the deck above. Confirm the street is
    // walkable at street level all the way through the bridge's z-band...
    for (const z of [-140, -110, -95, -80, -65, -50, -20]) {
      expect(world.collision.walkable(80, z), `z=${z}`).toBe(true);
      expect(groundHeight(80, z, 2.68), `z=${z}`).toBeLessThan(BRIDGE.y - 1);
    }
    expect(world.collision.walkable(80, -160), 'meets the z=-160 cross street').toBe(true);
    expect(world.collision.walkable(80, 0), 'meets the z=0 cross street').toBe(true);
    // ...and that an actual player can walk straight through it in one
    // continuous route, north to south, without detouring via a cross
    // street and without ever being lifted up onto the deck.
    const p = new Player(scene, world.collision); p.position.set(80, groundHeight(80, -140), -140);
    walk(p, 80, -20);
    expect(p.position.z).toBeCloseTo(-20, 0);
    expect(p.position.y).toBeLessThan(BRIDGE.y - 1);
  });
  it('gives the bridge real clearance above its own collinear approach road and the promenade, not a near-collision', () => {
    // The west approach road (z=-80, up to the bridge's own left edge) and
    // the waterfront promenade both run right alongside the raised deck —
    // this is where "0.8 units of clearance" read as the bridge sitting on
    // top of the road. Both should now clear the deck by a believable
    // amount, not graze it. x=0 stays outside the bridge's own (now longer)
    // footprint, so this measures clearance against genuinely separate
    // ground, not the bridge's own ramp.
    expect(BRIDGE.x - BRIDGE.w / 2).toBeGreaterThan(0);
    expect(BRIDGE.y - groundHeight(0, -80)).toBeGreaterThan(3);
    expect(BRIDGE.y - groundHeight(97.5, 40)).toBeGreaterThan(3);
  });
  it('has a long, gradual ramp instead of a short steep one', () => {
    // Consecutive-sample height deltas along the ramp should stay small and
    // smooth (no staircase steps), and the ramp should actually use its
    // full advertised length rather than mostly flattening out early.
    const left = BRIDGE.x - BRIDGE.w / 2, samples: number[] = [];
    for (let x = left; x <= left + BRIDGE_RAMP; x += 1) samples.push(surfaceHeight(BRIDGE, x, -80));
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i] - samples[i - 1]), `step at x=${left + i}`).toBeLessThan(.5);
    expect(samples[0]).toBeCloseTo(2.68, 1);
    expect(samples[samples.length - 1]).toBeCloseTo(BRIDGE.y, 1);
    const midway = surfaceHeight(BRIDGE, left + BRIDGE_RAMP / 2, -80);
    expect(midway).toBeGreaterThan(3); // genuinely rising partway through, not flat-then-a-cliff
    expect(midway).toBeLessThan(BRIDGE.y - .5);
  });
});

describe('player water entry and swimming', () => {
  it('walks from the beach into the water — no invisible shoreline wall — and swims freely', () => {
    const player = new Player(scene, world.collision);
    player.position.set(110, groundHeight(110, 180), 180);
    expect(player.swimming).toBe(false);
    walk(player, 200, 120); // (200,120) is confirmed open navigable water above
    expect(player.swimming).toBe(true);
    expect(swimmable(player.position.x, player.position.z)).toBe(true);
    expect(player.position.y).toBeLessThan(WATER_LEVEL);
    const reachedX = player.position.x;
    walk(player, 260, 90); // swim further out — not stuck right at the entry point
    expect(player.position.x).toBeGreaterThan(reachedX);
    expect(player.swimming).toBe(true);
  });
  it('exits the water back onto land and resumes normal walking', () => {
    const player = new Player(scene, world.collision);
    player.position.set(200, WATER_LEVEL - 1.3, 120); player.swimming = true;
    walk(player, 110, 180);
    expect(player.swimming).toBe(false);
    expect(world.collision.walkable(player.position.x, player.position.z, .6)).toBe(true);
  });
  it('does not disturb existing boat boarding near the same waterfront', () => {
    const player = new Player(scene, world.collision), activity = new Activity(scene, world.collision);
    player.position.set(150.5, groundHeight(150.5, 120), 120);
    walk(player, 152.2, 120);
    expect(activity.nearest(player)?.kind).toBe('boat');
  });
});

describe('streaming retains spatial truth', () => {
  it('keeps render distance separate from residency policy', () => {
    expect(residencyRadius('HIGH', 140, 'LOW')).toBe(residencyRadius('HIGH', 700, 'LOW'));
    const manager = new ChunkManager(world), settings: Settings = { ...defaults(), culling: 'HIGH', distance: 140 };
    const count = world.spatial.entries.length;
    for (let i = 0; i < 25; i++) manager.update(.2, new T.Vector3(500, 0, 400), settings, 16, false);
    expect(world.chunks.every(c => !c.resident)).toBe(true);
    expect(world.spatial.entries.length).toBe(count);
    const building = world.chunks.flatMap(c => c.buildings)[0];
    expect(world.collision.blocked(building.x, building.z, .5, building.y)).toBe(true);
    settings.culling = 'OFF';
    for (let i = 0; i < 25; i++) manager.update(.2, new T.Vector3(500, 0, 400), settings, 16, false);
    expect(world.chunks.every(c => c.resident)).toBe(true);
    expect(world.chunks.every(c => !c.group.visible)).toBe(true);
  });
});
