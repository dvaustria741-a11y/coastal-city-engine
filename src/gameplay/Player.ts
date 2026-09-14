import * as T from 'three/webgpu';
import { makeHuman, animateHuman } from '../assets/models';
import { groundHeight, swimmable, WATER_LEVEL, PLAYER_SPAWN, type CollisionWorld } from '../world/queries';
import type { Input } from '../input/Input';
// How far below the water surface the player's origin (feet) sits while
// swimming, based on the existing human model's proportions (torso ~1.14,
// head ~1.67 above the origin) — puts the head and shoulders above the
// surface, like a person swimming, rather than fully submerged or floating.
const SWIM_DEPTH = 1.3;
export class Player {
  model=makeHuman('ivory');position=new T.Vector3(PLAYER_SPAWN.x,groundHeight(PLAYER_SPAWN.x,PLAYER_SPAWN.z),PLAYER_SPAWN.z);velocityY=0;speed=0;swimming=false;private elapsed=0;
  constructor(scene:T.Scene,private collision:CollisionWorld){this.model.position.copy(this.position);scene.add(this.model);}
  update(dt:number,input:Input,yaw:number){
    this.elapsed+=dt;const x=input.horizontal,z=input.vertical;const length=Math.max(1,Math.hypot(x,z));const speed=input.sprint?(this.swimming?7.2:10):(this.swimming?3.6:5.2);this.speed=Math.hypot(x,z)*speed;
    const dx=(x*Math.cos(yaw)-z*Math.sin(yaw))/length*speed*dt,dz=(-x*Math.sin(yaw)-z*Math.cos(yaw))/length*speed*dt;
    const clear=(px:number,pz:number)=>!this.collision.blocked(px,pz,.4,WATER_LEVEL-SWIM_DEPTH,2.2);
    if(this.swimming){
      // Swimming uses a swimmer-scale water classification (swimmable)
      // instead of the land walkable() rules, so the water itself never
      // behaves like a solid wall and open water stays reachable out to the
      // actual land/water boundary. Movement is allowed into a spot that's
      // either still swimmable OR has become dry shore (groundHeight>=0):
      // gating strictly on swimmable() would stop the player right at the
      // waterline and never let them advance the last bit onto the beach
      // where the exit check below actually fires.
      const nx=this.position.x+dx,nz=this.position.z+dz;
      if((swimmable(nx,this.position.z)||groundHeight(nx,this.position.z)>=0)&&clear(nx,this.position.z))this.position.x=nx;
      if((swimmable(this.position.x,nz)||groundHeight(this.position.x,nz)>=0)&&clear(this.position.x,nz))this.position.z=nz;
      this.velocityY=0;
      const ground=groundHeight(this.position.x,this.position.z);
      // Exiting requires the destination to be genuinely walkable() (whole
      // footprint clear), not just groundHeight>=0 at the single point —
      // there's a narrow marginal strip right at the shoreline where the
      // center point already reads as land height but collision.walkable()
      // still rejects it (a neighboring sample is still underwater).
      // Exiting there would hand the player to land movement at a spot it
      // can't itself validate, leaving them stuck. Swim movement above
      // still crosses that strip fine (it only needs groundHeight>=0), so
      // the player keeps moving until they reach solid, walkable ground.
      if(this.collision.walkable(this.position.x,this.position.z)){this.swimming=false;this.position.y=ground;}
      else this.position.y=T.MathUtils.damp(this.position.y,WATER_LEVEL-SWIM_DEPTH,6,dt);
    } else {
      const beforeX=this.position.x,beforeZ=this.position.z;
      this.collision.move(this.position,dx,dz);
      const ground=groundHeight(this.position.x,this.position.z);
      const moved=Math.hypot(this.position.x-beforeX,this.position.z-beforeZ);
      // Land movement stops the player right at the shoreline. walkable()
      // requires the player's whole footprint (not just its center) to be
      // on land, so it can halt a little short of where the water actually
      // starts — a single-step probe right at that halted spot can land in
      // the same short margin and miss the water entirely. Scan a short
      // distance further along the movement direction for the nearest
      // swimmable point and step to it directly, the way a person's next
      // stride would actually reach the water rather than stopping an inch
      // short of it.
      let entered=false;
      const dirLen=Math.hypot(dx,dz);
      if(ground>=0&&moved<Math.hypot(dx,dz)*.4&&dirLen>1e-4){
        const ux=dx/dirLen,uz=dz/dirLen;
        for(let t=.5;t<=3;t+=.5){
          const px=beforeX+ux*t,pz=beforeZ+uz*t;
          if(swimmable(px,pz)&&clear(px,pz)){this.swimming=true;this.position.x=px;this.position.z=pz;this.velocityY=0;entered=true;break;}
        }
      }
      if(!entered){
        if(input.consume('Space')&&this.position.y<=ground+.05)this.velocityY=7.2;
        this.velocityY-=20*dt;this.position.y+=this.velocityY*dt;if(this.position.y<ground){this.position.y=ground;this.velocityY=0;}
      }
    }
    if(this.speed>.1){const target=Math.atan2(-dx,-dz);this.model.rotation.y+=Math.atan2(Math.sin(target-this.model.rotation.y),Math.cos(target-this.model.rotation.y))*Math.min(1,dt*12);}
    this.model.position.copy(this.position);animateHuman(this.model,this.elapsed,this.speed/(this.swimming?7:5));
  }
  respawn(){this.swimming=false;this.velocityY=0;this.position.set(PLAYER_SPAWN.x,groundHeight(PLAYER_SPAWN.x,PLAYER_SPAWN.z),PLAYER_SPAWN.z);this.model.position.copy(this.position);}
}
export class FollowCamera {
  yaw=.3;pitch=.28;distance=9;private ray=new T.Ray();
  constructor(public camera:T.PerspectiveCamera,private collision:CollisionWorld){}
  update(dt:number,input:Input,target:T.Vector3,sensitivity:number,driving:boolean){
    this.yaw-=input.lookX*.004*sensitivity;this.pitch=T.MathUtils.clamp(this.pitch+input.lookY*.003*sensitivity,-.05,1.05);this.distance=T.MathUtils.clamp(this.distance+input.zoom,5,24);input.lookX=0;input.lookY=0;input.zoom=0;
    const focus=target.clone().add(new T.Vector3(0,driving?2.1:1.65,0)),d=this.distance+(driving?5:0);const dir=new T.Vector3(Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch));
    let length=d;for(let t=.7;t<d;t+=.45){const p=focus.clone().addScaledVector(dir,t);if(this.collision.blocked(p.x,p.z,.3,p.y)){length=Math.max(.6,t-.5);break;}}
    const desired=focus.clone().addScaledVector(dir,length);desired.y=Math.max(desired.y,groundHeight(desired.x,desired.z)+.8,.8);this.camera.position.lerp(desired,1-Math.exp(-dt*8));this.camera.lookAt(focus);
  }
}
