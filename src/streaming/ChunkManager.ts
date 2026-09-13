import { Vector3 } from 'three/webgpu';
import { disposeBatch } from '../assets/models';
import { adaptCulling, chooseLOD, presets, residencyRadius, type Settings } from '../core/settings';
import type { World } from '../world/World';

export class ChunkManager {
  auto: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  resident = 0; detailed = 0; active = 0; pending = 0;
  private timer = 0; private adaptation = 0; private average = 20;
  constructor(private world: World) {}
  update(dt: number, position: Vector3, settings: Settings, frameMs: number, overview: boolean) {
    this.timer += dt;
    this.adaptation += dt;
    this.average += (Math.min(200, frameMs) - this.average) * (1 - Math.exp(-dt / 3));
    if (this.adaptation > 8) {
      this.adaptation = 0;
      this.auto = adaptCulling(this.auto, this.average);
    }
    if (this.timer < .16) return;
    this.timer = 0;
    const radius = residencyRadius(settings.culling, settings.distance, this.auto);
    const effective = settings.culling === 'AUTO' ? this.auto : settings.culling;
    const factor = presets[settings.quality].detail * (effective === 'HIGH' ? .8 : 1);
    let budget = 1;
    this.resident = this.detailed = this.active = this.pending = 0;
    const chunks = [...this.world.chunks].sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z));
    for (const c of chunks) {
      const distance = Math.hypot(c.x - position.x, c.z - position.z);
      const protectedNear = distance < 115;
      const keep = protectedNear || distance < radius + (c.resident ? 45 : 0);
      if (!keep) {
        if (c.group) disposeBatch(c.group);
        c.group = null;
        c.resident = false;
        c.detail = -1;
        continue;
      }
      const wanted = chooseLOD(overview ? distance * .65 : distance, factor, c.detail);
      if (wanted !== c.detail) {
        if (budget > 0) {
          const next = this.world.buildChunk(c, wanted);
          if (c.group) disposeBatch(c.group);
          c.group = next;
          this.world.root.add(next);
          c.detail = wanted;
          c.resident = true;
          budget--;
        } else this.pending++;
      }
      if (c.group) {
        c.group.visible = protectedNear || distance < settings.distance + 60;
        this.resident++;
        if (c.group.visible) this.active++;
        if (c.detail < 2) this.detailed++;
      }
    }
  }
}
