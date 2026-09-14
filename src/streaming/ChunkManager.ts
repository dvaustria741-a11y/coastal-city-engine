import { Vector3 } from 'three/webgpu';
import { disposeBatch } from '../assets/models';
import { chooseLOD, presets, residencyRadius, type Settings } from '../core/settings';
import type { World } from '../world/World';
// Half the 80m city block grid spacing (see World.ts chunk layout) — used to
// measure LOD/residency distance to a chunk's nearest edge rather than its center.
const HALF_CHUNK=40;
export class ChunkManager {
  auto: 'LOW'|'MEDIUM'|'HIGH'='MEDIUM'; resident=0; detailed=0; private timer=0; private adaptation=0; private average=20;
  constructor(private world:World) {}
  update(dt:number, position:Vector3, settings:Settings, frameMs:number, overview:boolean) {
    this.timer+=dt;this.adaptation+=dt;this.average=this.average*.98+frameMs*.02;
    if(this.adaptation>8) {this.adaptation=0;if(this.average>36)this.auto='HIGH';else if(this.average<18)this.auto='LOW';else this.auto='MEDIUM';}
    if(this.timer<.16)return;this.timer=0;
    const radius=residencyRadius(settings.culling,settings.distance,this.auto);
    const factor=presets[settings.quality].detail * settings.distance/400;
    let budget=1;this.resident=0;this.detailed=0;
    // Distance is measured to the nearest point on the chunk's own footprint,
    // not its center. Buildings sit up to ~40m from chunk center, so a
    // center-only distance under-estimated proximity for edge buildings and
    // could leave a building the player is standing next to on a coarser LOD
    // than its actual distance warranted (visible as glass/detail popping
    // out too early when the player gets close).
    const edgeDistance=(cx:number,cz:number)=>{const dx=Math.max(0,Math.abs(cx-position.x)-HALF_CHUNK),dz=Math.max(0,Math.abs(cz-position.z)-HALF_CHUNK);return Math.hypot(dx,dz);};
    const chunks=[...this.world.chunks].sort((a,b)=>edgeDistance(a.x,a.z)-edgeDistance(b.x,b.z));
    for(const c of chunks) {
      const distance=edgeDistance(c.x,c.z);
      const keep=distance<radius+(c.resident?40:0)||distance<100;
      const wanted=keep?chooseLOD(overview?distance*.65:distance,factor,c.detail):2;
      if(!keep&&c.resident&&budget>0){disposeBatch(c.group);c.resident=false;budget--;}
      else if(keep&&(!c.resident||wanted!==c.detail)&&budget>0) { const next=this.world.buildChunk(c,wanted); this.world.root.add(next);disposeBatch(c.group);c.group=next;c.detail=wanted;c.resident=true;budget--; }
      c.group.visible=c.resident&&distance<settings.distance+56;
      if(c.resident)this.resident++;if(c.resident&&c.detail<2)this.detailed++;
    }
  }
}
