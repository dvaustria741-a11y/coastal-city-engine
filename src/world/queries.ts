export const coast = (z: number) => 116 + Math.sin(z * .015) * 8;
export const island = (x: number, z: number, margin = 0) => ((x - 282) / (64 - margin)) ** 2 + ((z + 80) / (77 - margin)) ** 2 < 1;
export const onMainland = (x: number, z: number) => x > -350 && x < coast(z) && z > -260 && z < 220;
export const onBridge = (x: number, z: number) => x >= 70 && x <= 296 && Math.abs(z + 80) < 7.4;
export const bridgeHeight = (x: number) => 2.7 + .8 * Math.max(0, Math.min(1, (x - 70) / 30, (296 - x) / 30));
export const onDock = (x: number, z: number) => (x > 110 && x < 167 && Math.abs(z - 108) < 3) || (x > 148 && x < 153 && z > 94 && z < 135) || (x > 148 && x < 164 && [96, 106, 116, 126].some(lane => Math.abs(z - lane) < 1.25));
export function terrainHeight(x: number, z: number) {
  const hill = Math.max(0, 1 - ((x + 302) / 49) ** 2);
  const elevation = 38 * hill ** 2 * (.55 + .45 * Math.cos((z + 25) * .009) ** 2);
  const shore = Math.max(0, Math.min(1, (coast(z) - x) / 9));
  return .4 + 2.1 * shore + elevation;
}
export function groundHeight(x: number, z: number) {
  if (onBridge(x, z)) return bridgeHeight(x);
  if (onDock(x, z)) return 2.5;
  if (onMainland(x, z)) return terrainHeight(x, z);
  if (island(x, z)) return 2.5;
  return -2;
}
export function navigableWater(x: number, z: number, radius = 0) {
  const clear = (px: number, pz: number) => !onMainland(px, pz) && !island(px, pz) && !onDock(px, pz) && Math.abs(px) < 650 && Math.abs(pz) < 600 && ![141, 218].some(tower => Math.abs(px - tower) < 2.8 && Math.abs(Math.abs(pz + 80) - 8) < 2.8);
  if (!clear(x, z)) return false;
  if (radius > 0) for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    if (!clear(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return false;
  }
  return true;
}
export interface Collider { x: number; z: number; w: number; d: number; h: number }
export class CollisionWorld {
  private cells = new Map<string, Collider[]>();
  add(c: Collider) {
    for (let x = Math.floor((c.x - c.w / 2) / 40); x <= Math.floor((c.x + c.w / 2) / 40); x++) for (let z = Math.floor((c.z - c.d / 2) / 40); z <= Math.floor((c.z + c.d / 2) / 40); z++) {
      const key = `${x}:${z}`;
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key)!.push(c);
    }
  }
  blocked(x: number, z: number, r = .45, y = 2.5) {
    for (let cx = Math.floor((x - r) / 40); cx <= Math.floor((x + r) / 40); cx++) for (let cz = Math.floor((z - r) / 40); cz <= Math.floor((z + r) / 40); cz++) {
      if (this.cells.get(`${cx}:${cz}`)?.some(c => y < c.h + 2.5 && Math.abs(x - c.x) < c.w / 2 + r && Math.abs(z - c.z) < c.d / 2 + r)) return true;
    }
    return false;
  }
  move(position: { x: number; z: number; y: number }, dx: number, dz: number, r = .45) {
    const supported = (x: number, z: number) => groundHeight(x, z) > 0 && groundHeight(x - r, z) > 0 && groundHeight(x + r, z) > 0 && groundHeight(x, z - r) > 0 && groundHeight(x, z + r) > 0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .4));
    for (let i = 0; i < steps; i++) {
      const x = position.x + dx / steps, z = position.z + dz / steps;
      if (supported(x, position.z) && !this.blocked(x, position.z, r, position.y)) position.x = x;
      if (supported(position.x, z) && !this.blocked(position.x, z, r, position.y)) position.z = z;
    }
  }
}
