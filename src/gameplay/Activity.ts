import * as T from 'three/webgpu';
import { makeBoat, makeCar, makeHuman, animateHuman, Batch, type Mat } from '../assets/models';
import { groundHeight, navigableWater, type CollisionWorld } from '../world/queries';
import { presets, residencyRadius, type Settings } from '../core/settings';
import type { Input } from '../input/Input';
import type { Player } from './Player';
interface Entity { model:T.LOD; position:T.Vector3; yaw:number; speed:number; kind:'car'|'boat' }
function lodModel(kind:'car'|'boat',mat:Mat='coral') {const lod=new T.LOD();for(let i=0;i<3;i++)lod.addLevel(kind==='car'?makeCar(mat,i):makeBoat(i),[0,65,160][i]);return lod;}
export class Activity {
  car:Entity;boat:Entity;active:Entity|null=null;traffic:T.LOD[]=[];waterTraffic:T.LOD[]=[];pedestrians:T.LOD[]=[];aircraft:T.Group;
  private elapsed=0;private trafficProgress:number[]=[];private pedestrianProgress=Array.from({length:24},(_,i)=>i*18);private wakes:T.Mesh[]=[];speed=0;
  constructor(private scene:T.Scene,private collision:CollisionWorld) {
    this.car={model:lodModel('car'),position:new T.Vector3(80,2.65,103),yaw:0,speed:0,kind:'car'};
    this.boat={model:lodModel('boat'),position:new T.Vector3(143,.2,121),yaw:Math.PI/2,speed:0,kind:'boat'};
    for(const e of [this.car,this.boat]){e.model.position.copy(e.position);e.model.rotation.y=e.yaw;scene.add(e.model);}
    const colors:Mat[]=['white','blue','coral','red','teal'];
    for(let i=0;i<24;i++){const car=lodModel('car',colors[i%5]);this.traffic.push(car);this.trafficProgress.push(i/24*960);scene.add(car);}
    for(let i=0;i<6;i++){const boat=lodModel('boat');this.waterTraffic.push(boat);scene.add(boat);const wake=new T.Mesh(new T.PlaneGeometry(2,9),new T.MeshBasicMaterial({color:'#e6ffff',transparent:true,opacity:.23,depthWrite:false}));wake.rotation.x=-Math.PI/2;this.wakes.push(wake);scene.add(wake);}
    for(let i=0;i<24;i++){const p=new T.LOD();p.addLevel(makeHuman(colors[i%5]),0);p.addLevel(makeHuman(colors[i%5],1),55);this.pedestrians.push(p);scene.add(p);}
    const b=new Batch();b.add('sphere','ivory',0,0,0,.8,.7,4);b.add('box','ivory',0,0,0,10,.12,1.3,0,0,.025);b.add('box','coral',0,.7,3,.12,2,1);b.add('box','ivory',0,.1,3,3,.12,1);this.aircraft=b.finish();scene.add(this.aircraft);
  }
  get position(){return this.active?.position;}
  nearest(player:Player){return [this.car,this.boat].find(e=>e.position.distanceTo(player.position)<(e.kind==='boat'?6.5:5.5));}
  interact(player:Player):string {
    if(this.active){const e=this.active;let exit:T.Vector3|null=null;
      for(let r=3;r<=15&&!exit;r+=1.5)for(let i=0;i<16;i++){const a=i/16*Math.PI*2,x=e.position.x+Math.cos(a)*r,z=e.position.z+Math.sin(a)*r,h=groundHeight(x,z);if(h>0&&!this.collision.blocked(x,z,.6,h)){exit=new T.Vector3(x,h,z);break;}}
      if(!exit)return 'Move closer to a dock or beach to disembark.';
      player.position.copy(exit);player.model.position.copy(exit);player.model.visible=true;player.velocityY=0;e.speed=0;this.active=null;return 'Back on foot. Explore at your own pace.';
    }
    const e=this.nearest(player);if(!e)return 'Walk up to the coral car or the boat at the marina.';
    this.active=e;player.model.visible=false;return e.kind==='car'?'You are driving. W / S to accelerate and reverse.':'You are at the helm. W / S for throttle, A / D to steer.';
  }
  drive(dt:number,input:Input){
    const e=this.active;if(!e)return;
    const throttle=input.vertical,steer=input.horizontal,boat=e.kind==='boat',max=boat?17:28;
    e.speed+=throttle*(boat?6:13)*dt;e.speed*=Math.exp(-dt*(Math.abs(throttle)<.1?1.1:.15));e.speed=T.MathUtils.clamp(e.speed,-max*.35,max);if(input.keys.has('Space'))e.speed*=Math.exp(-dt*5);
    e.yaw-=steer*dt*(boat?1.1:1.5)*Math.min(1,Math.abs(e.speed)/3)*Math.sign(e.speed||1);
    const dx=-Math.sin(e.yaw)*e.speed*dt,dz=-Math.cos(e.yaw)*e.speed*dt;
    if(boat){const x=e.position.x+dx,z=e.position.z+dz;if(navigableWater(x,z,1.4)&&navigableWater(x-Math.sin(e.yaw)*2.7,z-Math.cos(e.yaw)*2.7)&&navigableWater(x+Math.sin(e.yaw)*2.7,z+Math.cos(e.yaw)*2.7)&&!this.waterTraffic.some(b=>b.visible&&Math.hypot(b.position.x-x,b.position.z-z)<4)){e.position.x=x;e.position.z=z;}else e.speed*=.2;e.position.y=.2+Math.sin(this.elapsed*.8+e.position.x*.09)*.18;}
    else {const before=e.position.clone();if(!this.traffic.some(car=>car.visible&&Math.hypot(car.position.x-e.position.x-dx,car.position.z-e.position.z-dz)<4))this.collision.move(e.position,dx,dz,2.1);if(before.distanceTo(e.position)<Math.hypot(dx,dz)*.4)e.speed*=.4;e.position.y=groundHeight(e.position.x,e.position.z)+.1;}
    e.model.position.copy(e.position);e.model.rotation.y=e.yaw;this.speed=Math.abs(e.speed)*3.6;
  }
  update(dt:number,settings:Settings,focus:T.Vector3,camera:T.Camera,auto:'LOW'|'MEDIUM'|'HIGH'='MEDIUM') {
    this.elapsed+=dt;const population=Math.round(presets[settings.quality].population*settings.traffic),people=Math.round(presets[settings.quality].population*settings.pedestrians);
    const range=Math.max(115,Math.min(settings.distance,residencyRadius(settings.culling,settings.distance,auto)));
    for(let i=0;i<this.traffic.length;i++){
      const car=this.traffic[i];car.visible=i<population;if(!car.visible)continue;
      const t=this.trafficProgress[i]%960;const isRed=Math.floor(this.elapsed/8)%2===0;
      const stop=isRed&&[78,158,238,398,552,632,712,872].some(line=>t>=line&&t<line+3);
      const headway=this.trafficProgress.some((p,j)=>j!==i&&j<population&&((p-this.trafficProgress[i]+960)%960)<7);
      const nearPlayer=car.position.distanceTo(focus)<5;
      if(!stop&&!headway&&!nearPlayer)this.trafficProgress[i]+=dt*9;
      const p=this.trafficProgress[i]%960;
      if(p<320){car.position.set(83,2.75,163-p);car.rotation.y=0;}else if(p<480){car.position.set(83-(p-320),2.75,-157);car.rotation.y=Math.PI/2;}else if(p<800){car.position.set(-77,2.75,-157+p-480);car.rotation.y=Math.PI;}else{car.position.set(-77+p-800,2.75,163);car.rotation.y=-Math.PI/2;}
      car.visible=car.position.distanceTo(focus)<range;car.update(camera);
    }
    for(let i=0;i<this.waterTraffic.length;i++){const b=this.waterTraffic[i];b.visible=i<Math.ceil(population/4);this.wakes[i].visible=b.visible;if(!b.visible)continue;const a=this.elapsed*.022+i*Math.PI/3,x=300+Math.cos(a)*125,z=185+Math.sin(a)*37;b.position.set(x,.2+Math.sin(this.elapsed+i)*.13,z);b.rotation.set(Math.sin(this.elapsed+i)*.016,Math.atan2(Math.sin(a)*125,-Math.cos(a)*37),Math.sin(this.elapsed*.8+i)*.025);b.visible=b.position.distanceTo(focus)<range;this.wakes[i].visible=b.visible;b.update(camera);this.wakes[i].position.set(x+Math.sin(b.rotation.y)*7,.24,z+Math.cos(b.rotation.y)*7);this.wakes[i].rotation.z=-b.rotation.y;}
    for(let i=0;i<this.pedestrians.length;i++){const p=this.pedestrians[i];p.visible=i<people;if(!p.visible)continue;const walking=(this.elapsed+i*3)%28<23;if(walking)this.pedestrianProgress[i]+=dt*1.1;const u=this.pedestrianProgress[i]%360,z=u<180?u-45:315-u;if(walking||dt===0)p.position.set(i%2?94:68,2.5,z);p.rotation.y=u<180?Math.PI:0;p.visible=p.position.distanceTo(focus)<range;p.update(camera);if(p.levels[0].object.visible)animateHuman(p.levels[0].object as T.Group,this.elapsed+i,walking?1:0);}
    const a=this.elapsed*.016;this.aircraft.position.set(Math.cos(a)*450,155,-100+Math.sin(a)*350);this.aircraft.rotation.y=-a-Math.PI/2;
    this.boat.model.rotation.z=Math.sin(this.elapsed)*.025;
    for(const e of [this.car,this.boat]){e.model.visible=e===this.active||e.position.distanceTo(focus)<range;e.model.update(camera);}
    if(this.active!==this.boat){this.boat.position.y=.2+Math.sin(this.elapsed*.8)*.12;this.boat.model.position.copy(this.boat.position);}
  }
}
