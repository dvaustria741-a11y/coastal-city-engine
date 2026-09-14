import * as T from 'three/webgpu';
import { makeHuman, animateHuman } from '../assets/models';
import { groundHeight, PLAYER_SPAWN, type CollisionWorld } from '../world/queries';
import type { Input } from '../input/Input';
export class Player {
  model=makeHuman('ivory');position=new T.Vector3(PLAYER_SPAWN.x,groundHeight(PLAYER_SPAWN.x,PLAYER_SPAWN.z),PLAYER_SPAWN.z);velocityY=0;speed=0;private elapsed=0;
  constructor(scene:T.Scene,private collision:CollisionWorld){this.model.position.copy(this.position);scene.add(this.model);}
  update(dt:number,input:Input,yaw:number){
    this.elapsed+=dt;const x=input.horizontal,z=input.vertical;const length=Math.max(1,Math.hypot(x,z));const speed=input.sprint?10:5.2;this.speed=Math.hypot(x,z)*speed;
    const dx=(x*Math.cos(yaw)-z*Math.sin(yaw))/length*speed*dt,dz=(-x*Math.sin(yaw)-z*Math.cos(yaw))/length*speed*dt;
    this.collision.move(this.position,dx,dz);
    const ground=groundHeight(this.position.x,this.position.z);if(input.consume('Space')&&this.position.y<=ground+.05)this.velocityY=7.2;
    this.velocityY-=20*dt;this.position.y+=this.velocityY*dt;if(this.position.y<ground){this.position.y=ground;this.velocityY=0;}
    if(this.speed>.1){const target=Math.atan2(-dx,-dz);this.model.rotation.y+=Math.atan2(Math.sin(target-this.model.rotation.y),Math.cos(target-this.model.rotation.y))*Math.min(1,dt*12);}
    this.model.position.copy(this.position);animateHuman(this.model,this.elapsed,this.speed/5);
  }
  respawn(){this.position.set(PLAYER_SPAWN.x,groundHeight(PLAYER_SPAWN.x,PLAYER_SPAWN.z),PLAYER_SPAWN.z);this.velocityY=0;this.model.position.copy(this.position);}
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
