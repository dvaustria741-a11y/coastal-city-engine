import * as T from 'three/webgpu';
import { Batch, building, palm, materials, type Building } from '../assets/models';
import { seeded } from '../core/settings';
import { coast, CollisionWorld } from './queries';
export interface Chunk { id: number; x: number; z: number; buildings: Building[]; group: T.Group; detail: number; resident: boolean; lastChange: number }
export class World {
  root = new T.Group(); chunks: Chunk[] = []; collision = new CollisionWorld(); wheel = new T.Group();
  constructor(public scene: T.Scene) { scene.add(this.root); }
  async create(progress: (p:number,label:string)=>void) {
    this.createTerrain(); this.createRoads(); this.createMarina(); this.createBridge(); this.createIsland(); this.createWheel();
    const random=seeded(771);
    for(let iz=0;iz<5;iz++) for(let ix=0;ix<4;ix++) {
      const x=-200+ix*80,z=-200+iz*80, buildings: Building[]=[];
      for(const dx of [-18,18])for(const dz of [-18,18]) {
        const central=Math.max(0,1-Math.hypot(x+55,z+105)/245);
        const h=15+random()*27+central*random()*100;
        const p={x:x+dx,z:z+dz,w:19+random()*6,d:19+random()*5,h,style:Math.floor(random()*5)};
        buildings.push(p); this.collision.add({...p,w:p.w+3,d:p.d+3});
      }
      const chunk:Chunk={id:this.chunks.length,x,z,buildings,group:new T.Group(),detail:2,resident:false,lastChange:0};
      chunk.group=this.buildChunk(chunk,2); this.root.add(chunk.group); this.chunks.push(chunk);
      progress(.2+this.chunks.length/20*.6,'Building the waterfront');
      await new Promise(r=>setTimeout(r,0));
    }
    this.root.name='Coastal district';
  }
  buildChunk(chunk:Chunk,detail:number) {
    const b=new Batch();
    chunk.buildings.forEach(p=>building(b,p,detail));
    for(const side of [-1,1]) for(let j=0;j<(detail===0?5:3);j++) palm(b,chunk.x+side*32,chunk.z-27+j*(detail===0?13:27),8+(j%2)*2,detail);
    b.add('box','grass',chunk.x,2.7,chunk.z,7,.3,63);
    if(detail<2) {
      for(const side of [-1,1])for(const off of [-25,25]) {
        b.add('cylinder','dark',chunk.x+side*33,5.8,chunk.z+off,.07,6.6,.07);
        b.add('box','dark',chunk.x+side*33+side*.5,9,chunk.z+off,1.3,.12,.12);
        b.add('sphere','light',chunk.x+side*33+side,8.9,chunk.z+off,.23,.12,.23);
        b.add('box','wood',chunk.x+side*30,3.1,chunk.z+off+4,1.2,.15,2.7);
        b.add('box','dark',chunk.x+side*30,2.9,chunk.z+off+4,.15,.65,2.4);
      }
    }
    return b.finish();
  }
  createTerrain() {
    const land=new T.Shape(); land.moveTo(-284,-260); land.lineTo(116,-260);
    for(let z=-260;z<=220;z+=10)land.lineTo(coast(z),z);
    land.lineTo(-284,220); land.closePath();
    const geometry=new T.ExtrudeGeometry(land,{depth:5,bevelEnabled:true,bevelThickness:2,bevelSize:4,bevelSegments:2,steps:1});geometry.rotateX(Math.PI/2);
    const mesh=new T.Mesh(geometry,materials.sand);mesh.position.y=2.45;mesh.receiveShadow=true;this.root.add(mesh);
    const b=new Batch(); b.add('box','grass',-87,1, -20,388,2.95,475);
    for(let z=-240;z<210;z+=12) { const x=coast(z); b.add('box','ivory',x-5,2.5,z,9,.22,12.2); if(z%24===0)palm(b,x-9,z,9,0); }
    for(let z=-230;z<200;z+=16) { b.add('sphere','grass',-275,3,z,14,7+(z%3)*2,11); b.add('sphere','concrete',-280,3,z+7,8,5,8); }
    this.root.add(b.finish());
  }
  createRoads() {
    const b=new Batch();
    for(const x of [-240,-160,-80,0,80]) { b.add('box','concrete',x,2.48,-40,19,.16,423); b.add('box','road',x,2.6,-40,13,.12,423); for(let z=-248;z<170;z+=11)b.add('box','line',x,2.67,z,.16,.025,4); }
    for(const z of [-240,-160,-80,0,80,160]) { b.add('box','concrete',-78,2.48,z,341,.16,19);b.add('box','road',-78,2.62,z,341,.12,13);for(let x=-243;x<86;x+=11)b.add('box','line',x,2.7,z,4,.025,.16); }
    for(const x of [-240,-160,-80,0,80]) for(const z of [-160,-80,0,80,160]) for(let i=-2;i<=2;i++) { b.add('box','line',x+i*1.7,2.7,z+9,1,.03,3); b.add('box','line',x+9,2.7,z+i*1.7,3,.03,1); }
    for(const z of [-160,0,160]) { b.add('cylinder','dark',90,5.1,z+10,.1,5,.1); b.add('box','dark',90,7.2,z+10,.65,1.6,.4); b.add('sphere','coral',90,7.7,z+10.25,.16,.16,.08); }
    this.root.add(b.finish());
  }
  createMarina() {
    const b=new Batch();
    b.add('box','wood',138.5,2.23,108,57,.5,5.8); b.add('box','wood',150.5,2.23,114.5,5,.5,41);
    for(let x=118;x<165;x+=6) { b.add('cylinder','dark',x,.5,106,.25,4,.25); b.add('box','ivory',x,2.7,105.3,.2,1,.2); }
    for(let z=96;z<136;z+=10) { b.add('box','wood',156,2.23,z,15,.5,2.5); b.add('cylinder','dark',161,.5,z,.2,4,.2); }
    b.add('box','ivory',100,3,116,10,1,16); b.add('box','glass',100,5.8,116,8,4.5,12); b.add('box','ivory',100,8.2,116,12,.4,17);
    this.collision.add({x:100,z:116,w:10,d:16,h:7});
    for(let z=155;z<209;z+=11) { b.add('cylinder','wood',114,3.8,z,.06,3,.06);b.add('cone',z%2?'coral':'ivory',114,5.5,z,2,.7,2);b.add('box','white',116,2.8,z+2,1,.12,2.6,0,0,.2); }
    this.root.add(b.finish());
  }
  createBridge() {
    const b=new Batch(); b.add('box','concrete',179,2.9,-80,218,1,17); b.add('box','road',179,3.44,-80,218,.08,12);
    for(let x=80;x<285;x+=12)b.add('box','line',x,3.5,-80,5,.02,.16);
    for(const x of [141,218]) {
      for(const z of [-88,-72]) { b.add('box','ivory',x,25,z,2.3,53,2.3);b.add('cylinder','concrete',x,-.5,z,2.5,10,2.5); }
      b.add('box','ivory',x,40,-80,2,2,16);
      for(const side of [-1,1])for(let j=1;j<7;j++)for(const z of [-87,-73]) b.beam('ivory',new T.Vector3(x,49-j*.65,z),new T.Vector3(x+side*j*5.9,3.7,z),.055);
    }
    for(const z of [-88,-72]) { b.add('box','white',179,4.8,z,218,.1,.1); for(let x=76;x<286;x+=5)b.add('box','concrete',x,4.1,z,.1,1.5,.1); }
    this.root.add(b.finish());
  }
  createIsland() {
    const b=new Batch(); b.add('cylinder','sand',282,-.8,-80,68,6.5,81); b.add('cylinder','grass',282,1,-80,55,3,63);
    b.add('box','concrete',263,2.55,-80,66,.15,19); b.add('box','road',263,2.65,-80,66,.1,12);
    for(let i=0;i<8;i++) {const a=i/8*Math.PI*2; palm(b,282+Math.cos(a)*48,-80+Math.sin(a)*57,9+i%3,0); }
    for(const z of [-117,-42]) { building(b,{x:280,z,w:24,d:18,h:12,style:1},0);this.collision.add({x:280,z,w:27,d:21,h:13}); }
    b.add('box','glass',310,2.8,-80,12,.4,25);
    this.root.add(b.finish());
  }
  createWheel() {
    const b=new Batch();
    for(const x of [87,103])b.beam('ivory',new T.Vector3(x,2.5,28),new T.Vector3(95,20,28),.5);
    const ring=new T.Mesh(new T.TorusGeometry(14,.22,5,48),materials.ivory); this.wheel.add(ring);
    for(let i=0;i<12;i++) {const a=i/12*Math.PI*2, x=Math.cos(a)*14,y=Math.sin(a)*14; b.beam('concrete',new T.Vector3(95,20,28),new T.Vector3(95+x,20+y,28),.08); const gondola=new T.Mesh(new T.SphereGeometry(1.1,8,6),materials[i%2?'coral':'teal']);gondola.position.set(x,y,0);this.wheel.add(gondola);}
    this.wheel.position.set(95,20,28);this.root.add(b.finish(),this.wheel);
  }
}
