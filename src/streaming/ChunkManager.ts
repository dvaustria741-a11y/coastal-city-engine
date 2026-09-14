import { Vector3 } from 'three/webgpu';
import { disposeBatch } from '../assets/models';
import { chooseLOD, presets, residencyRadius, type Settings } from '../core/settings';
import type { World } from '../world/World';
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
    const chunks=[...this.world.chunks].sort((a,b)=>Math.hypot(a.x-position.x,a.z-position.z)-Math.hypot(b.x-position.x,b.z-position.z));
    for(const c of chunks) {
      const distance=Math.hypot(c.x-position.x,c.z-position.z);
      const keep=distance<radius+(c.resident?40:0)||distance<100;
      const wanted=keep?chooseLOD(overview?distance*.65:distance,factor,c.detail):2;
      if(!keep&&c.resident&&budget>0){disposeBatch(c.group);c.resident=false;budget--;}
      else if(keep&&(!c.resident||wanted!==c.detail)&&budget>0) { const next=this.world.buildChunk(c,wanted); this.world.root.add(next);disposeBatch(c.group);c.group=next;c.detail=wanted;c.resident=true;budget--; }
      c.group.visible=c.resident&&distance<settings.distance+56;
      if(c.resident)this.resident++;if(c.resident&&c.detail<2)this.detailed++;
    }
  }
}
