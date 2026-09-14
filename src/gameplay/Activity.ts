import * as T from 'three/webgpu';
import { makeBoat, makeCar, makeHuman, animateHuman, Batch, type Mat } from '../assets/models';
import { groundHeight, WATER_LEVEL, BOAT_BERTH, onDock, onBridge, type CollisionWorld } from '../world/queries';
import { presets, type Settings } from '../core/settings';
import type { Input } from '../input/Input';
import type { Player } from './Player';
interface Entity { model:T.LOD; position:T.Vector3; yaw:number; speed:number; kind:'car'|'boat' }
function lodModel(kind:'car'|'boat',mat:Mat='coral') {const lod=new T.LOD();for(let i=0;i<3;i++)lod.addLevel(kind==='car'?makeCar(mat,i):makeBoat(i),[0,65,160][i]);return lod;}
export class Activity {
  car:Entity;boat:Entity;active:Entity|null=null;traffic:T.LOD[]=[];waterTraffic:T.LOD[]=[];pedestrians:T.Group[]=[];aircraft:T.Group;
  private elapsed=0;private trafficProgress:number[]=[];private wakes:T.Mesh[]=[];speed=0;
  constructor(private scene:T.Scene,private collision:CollisionWorld) {
    this.car={model:lodModel('car'),position:new T.Vector3(83,groundHeight(83,103),103),yaw:0,speed:0,kind:'car'};
    this.boat={model:lodModel('boat'),position:new T.Vector3(BOAT_BERTH.x,WATER_LEVEL,BOAT_BERTH.z),yaw:BOAT_BERTH.yaw,speed:0,kind:'boat'};
    for(const e of [this.car,this.boat]){e.model.position.copy(e.position);e.model.rotation.y=e.yaw;scene.add(e.model);}
    const colors:Mat[]=['white','blue','coral','red','teal'];
    for(let i=0;i<24;i++){const car=lodModel('car',colors[i%5]);this.traffic.push(car);this.trafficProgress.push(i/24*960);scene.add(car);}
    for(let i=0;i<6;i++){const boat=lodModel('boat');this.waterTraffic.push(boat);scene.add(boat);const wake=new T.Mesh(new T.PlaneGeometry(2,9),new T.MeshBasicMaterial({color:'#e6ffff',transparent:true,opacity:.23,depthWrite:false}));wake.rotation.x=-Math.PI/2;this.wakes.push(wake);scene.add(wake);}
    for(let i=0;i<24;i++){const p=makeHuman(colors[i%5]),x=i%2?94:-8.25,z=-50+i*8;p.position.set(x,groundHeight(x,z),z);p.userData.direction=i%2?1:-1;this.pedestrians.push(p);scene.add(p);}
    const b=new Batch();b.add('sphere','ivory',0,0,0,.8,.7,4);b.add('box','ivory',0,0,0,10,.12,1.3,0,0,.025);b.add('box','coral',0,.7,3,.12,2,1);b.add('box','ivory',0,.1,3,3,.12,1);this.aircraft=b.finish();scene.add(this.aircraft);
  }
  get position(){return this.active?.position;}
  nearest(player:Player){
    const p=player.position;
    return [this.car,this.boat].find(e=>Math.hypot(e.position.x-p.x,e.position.z-p.z)<=5.5
      && Math.abs(e.position.y-p.y)<3.5 && this.collision.walkable(p.x,p.z)
      && (e.kind!=='boat'||(!onBridge(p.x,p.z)&&(onDock(p.x,p.z)||groundHeight(p.x,p.z)>0)))
      && this.collision.segmentClear(p.x,p.z,e.position.x,e.position.z,p.y+.1));
  }
  interact(player:Player):string {
    if(this.active){const e=this.active;const safe=this.collision.findExit(e.position.x,e.position.z,e.yaw,e.kind);
      if(!safe)return 'Move closer to a dock or beach to disembark.';
      const exit=new T.Vector3(safe.x,safe.y,safe.z);
      player.position.copy(exit);player.model.position.copy(exit);player.model.visible=true;player.velocityY=0;e.speed=0;this.active=null;return 'Back on foot. Explore at your own pace.';
    }
    const e=this.nearest(player);if(!e)return 'Walk up to the coral car or the boat at the marina.';
    this.active=e;player.model.visible=false;return e.kind==='car'?'You are driving. W / S to accelerate and reverse.':'You are at the helm. W / S for throttle, A / D to steer.';
  }
  drive(dt:number,input:Input){
    const e=this.active;if(!e)return;
    const throttle=input.vertical,steer=input.horizontal,boat=e.kind==='boat',max=boat?17:28;
    e.speed+=throttle*(boat?6:13)*dt;e.speed*=Math.exp(-dt*(Math.abs(throttle)<.1?1.1:.15));e.speed=T.MathUtils.clamp(e.speed,-max*.35,max);if(input.keys.has('Space'))e.speed*=Math.exp(-dt*5);
    const turn=-steer*dt*(boat?1.1:1.5)*Math.min(1,Math.abs(e.speed)/3)*Math.sign(e.speed||1);
    const targetYaw=e.yaw+turn;
    if(!boat||this.collision.boatFits(e.position.x,e.position.z,targetYaw))e.yaw=targetYaw;
    const dx=-Math.sin(e.yaw)*e.speed*dt,dz=-Math.cos(e.yaw)*e.speed*dt;
    if(boat){
      const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.25));
      for(let i=0;i<steps;i++){
        const x=e.position.x+dx/steps,z=e.position.z+dz/steps;
        if(!this.collision.boatFits(x,z,e.yaw)||this.waterTraffic.some(b=>b.visible&&Math.hypot(b.position.x-x,b.position.z-z)<7)){e.speed*=.2;break;}
        e.position.x=x;e.position.z=z;
      }
      e.position.y=WATER_LEVEL+Math.sin(this.elapsed*.8+e.position.x*.09)*.18;
    }
    else {const before=e.position.clone();this.collision.move(e.position,dx,dz,1.25);if(before.distanceTo(e.position)<Math.hypot(dx,dz)*.4)e.speed*=.4;e.position.y=groundHeight(e.position.x,e.position.z)+.1;}
    e.model.position.copy(e.position);e.model.rotation.y=e.yaw;this.speed=Math.abs(e.speed)*3.6;
  }
  update(dt:number,settings:Settings,focus:T.Vector3,camera:T.Camera) {
    this.elapsed+=dt;const population=presets[settings.quality].population;
    for(let i=0;i<this.traffic.length;i++){
      const car=this.traffic[i];car.visible=i<population;if(!car.visible)continue;
      const t=this.trafficProgress[i]%960;const isRed=Math.floor(this.elapsed/8)%2===0;
      const stop=isRed&&(t>220&&t<230||t>700&&t<710);
      const headway=this.trafficProgress.some((p,j)=>j!==i&&j<population&&((p-this.trafficProgress[i]+960)%960)<7);
      const nearPlayer=car.position.distanceTo(focus)<5;
      if(!stop&&!headway&&!nearPlayer)this.trafficProgress[i]+=dt*9;
      const p=this.trafficProgress[i]%960;
      if(p<320){car.position.set(83,2.75,160-p);car.rotation.y=0;}else if(p<480){car.position.set(83-(p-320),2.75,-163);car.rotation.y=Math.PI/2;}else if(p<800){car.position.set(-83,2.75,-160+p-480);car.rotation.y=Math.PI;}else{car.position.set(-80+p-800,2.75,163);car.rotation.y=-Math.PI/2;}
      car.position.y=groundHeight(car.position.x,car.position.z);
      car.update(camera);
    }
    for(let i=0;i<this.waterTraffic.length;i++){const b=this.waterTraffic[i];b.visible=i<Math.max(2,Math.floor(population/4));this.wakes[i].visible=b.visible;if(!b.visible)continue;const a=this.elapsed*.022+i*Math.PI/3,x=300+Math.cos(a)*125,z=185+Math.sin(a)*37;b.position.set(x,.2+Math.sin(this.elapsed+i)*.13,z);b.rotation.set(Math.sin(this.elapsed+i)*.016,Math.atan2(Math.sin(a)*125,-Math.cos(a)*37),Math.sin(this.elapsed*.8+i)*.025);b.update(camera);this.wakes[i].position.set(x+Math.sin(b.rotation.y)*7,.24,z+Math.cos(b.rotation.y)*7);this.wakes[i].rotation.z=-b.rotation.y;}
    for(let i=0;i<this.pedestrians.length;i++){
      const p=this.pedestrians[i];p.visible=i<population;if(!p.visible)continue;
      const before=p.position.z;this.collision.move(p.position,0,p.userData.direction*dt*1.2,.35);
      if(p.position.z>150||p.position.z<-55||(dt>0&&Math.abs(p.position.z-before)<dt*.1))p.userData.direction*=-1;
      p.position.y=groundHeight(p.position.x,p.position.z);p.rotation.y=p.userData.direction>0?Math.PI:0;animateHuman(p,this.elapsed+i,1);
    }
    const a=this.elapsed*.016;this.aircraft.position.set(Math.cos(a)*450,155,-100+Math.sin(a)*350);this.aircraft.rotation.y=-a-Math.PI/2;
    this.boat.model.rotation.z=Math.sin(this.elapsed)*.025;
    for(const e of [this.car,this.boat])e.model.update(camera);
  }
}
