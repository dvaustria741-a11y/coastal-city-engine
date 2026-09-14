import * as T from 'three/webgpu';
import { RendererManager } from '../renderer/RendererManager';
import { World } from '../world/World';
import { ChunkManager } from '../streaming/ChunkManager';
import { Environment } from '../environment/Environment';
import { Player, FollowCamera } from '../gameplay/Player';
import { Activity } from '../gameplay/Activity';
import { Input } from '../input/Input';
import { UI } from '../ui/UI';
import { loadSettings, saveSettings, type Settings } from './settings';
import { materials } from '../assets/models';
import { coast, island } from '../world/queries';
export class Game {
  settings=loadSettings(matchMedia('(pointer:coarse)').matches||innerWidth<700);state:'menu'|'playing'|'paused'='menu';
  scene=new T.Scene();camera=new T.PerspectiveCamera(58,innerWidth/innerHeight,.15,4500);renderer=new RendererManager();world=new World(this.scene);ui:UI;
  environment!:Environment;chunks!:ChunkManager;player!:Player;follow!:FollowCamera;activity!:Activity;input!:Input;
  visited=[false,false,false];private last=0;private accumulator=0;private elapsed=0;private frameMs=16;private report=0;private view=0;private hidden=false;
  constructor(){
    this.ui=new UI(this.settings,{play:()=>this.play(),pause:()=>this.pause(),home:()=>this.home(),settings:p=>this.apply(p),view:v=>this.view=v,respawn:()=>this.respawn(),reset:()=>this.visited.fill(false)});
    this.ui.root.addEventListener('panel-opened',()=>{if(this.state==='playing')this.state='paused';this.input?.reset();if(this.input)this.input.enabled=false;});
    this.ui.root.addEventListener('panel-closed',()=>{if(this.state==='paused'){this.state='playing';this.input.enabled=true;}});
    window.addEventListener('resize',()=>{if(!this.renderer.renderer)return;this.renderer.resize();this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();});
    window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!this.ui.dialog.open&&this.state==='playing'){e.preventDefault();this.pause();}});
    document.addEventListener('visibilitychange',()=>{this.hidden=document.hidden;if(this.hidden&&this.state==='playing')this.pause();this.input?.reset();this.last=performance.now();});
  }
  async boot(){
    try{
      this.ui.progress(.05,'Opening your window to the coast');await this.renderer.init(document.querySelector('#scene')!);this.renderer.apply(this.settings);
      this.environment=new Environment(this.scene);this.environment.apply(this.settings);await this.world.create((p,label)=>this.ui.progress(p,label));
      this.chunks=new ChunkManager(this.world);this.player=new Player(this.scene,this.world.collision);this.follow=new FollowCamera(this.camera,this.world.collision);this.activity=new Activity(this.scene,this.world.collision);this.input=new Input(this.renderer.renderer.domElement);this.input.bindTouch(this.ui.root);
      this.camera.position.set(390,224,335);this.camera.lookAt(-15,35,-40);this.environment.update(.3,this.camera,this.settings,new T.Vector3(0,0,0));this.activity.update(0,this.settings,this.player.position,this.camera);this.player.model.visible=false;
      this.ui.progress(.87,'Finding the light');await this.renderer.renderer.compileAsync(this.scene,this.camera);this.renderer.renderer.render(this.scene,this.camera);
      this.ui.progress(1,'The coast is yours');this.ui.ready();this.last=performance.now();this.renderer.renderer.setAnimationLoop(time=>this.frame(time));
      (window as Window & {coastal?:unknown}).coastal={snapshot:()=>this.snapshot(),...(import.meta.env.DEV&&new URLSearchParams(location.search).has('audit')?{game:this}:{})};
    }catch(error){console.error('Coastal City initialization:',error);this.ui.failure(error instanceof Error?error.message:'WebGPU or WebGL2 is required. Update your browser or Android System WebView.');}
  }
  play(){if(!this.input)return;this.state='playing';this.ui.playing(true);this.input.enabled=true;this.player.model.visible=!this.activity.active;this.follow.camera.position.copy(this.player.position).add(new T.Vector3(5,5,9));this.ui.notify('Welcome to the coast. Walk toward the marina, or take the coral car for a spin.');}
  pause(){this.input?.reset();this.ui.open('graphics');}
  home(){this.state='menu';this.input.enabled=false;this.input.reset();this.ui.playing(false);this.player.model.visible=false;}
  respawn(){this.activity.active=null;this.activity.car.speed=0;this.activity.boat.speed=0;this.player.respawn();this.player.model.visible=this.state!=='menu';this.follow.yaw=.3;this.ui.notify('Back at the waterfront.');}
  apply(patch:Partial<Settings>){const quality=patch.quality!==undefined;Object.assign(this.settings,patch);saveSettings(this.settings);if(!this.environment)return;if(quality){this.renderer.apply(this.settings);this.environment.apply(this.settings);}this.camera.fov=this.settings.fov;this.camera.updateProjectionMatrix();for(const mat of Object.values(materials))mat.wireframe=this.settings.wireframe;}
  private frame(time:number){
    if(this.hidden){this.last=time;return;}const raw=(time-this.last)/1000;this.last=time;const dt=Math.min(.08,Math.max(0,raw));this.frameMs=this.frameMs*.95+raw*1000*.05;this.elapsed+=dt;
    const playing=this.state==='playing';this.input.enabled=playing&&!this.ui.dialog.open;
    const focus=this.activity.position||this.player.position;
    if(playing){
      if(this.input.consume('KeyE'))this.ui.notify(this.activity.interact(this.player));
      this.accumulator=Math.min(this.accumulator+dt,.1);while(this.accumulator>=1/60){if(this.activity.active)this.activity.drive(1/60,this.input);else this.player.update(1/60,this.input,this.follow.yaw);this.accumulator-=1/60;}
      this.follow.update(dt,this.input,this.activity.position||this.player.position,this.settings.sensitivity,!!this.activity.active);
      const p=this.activity.position||this.player.position;
      const checks=[Math.hypot(p.x-100,p.z-35)<24,Math.hypot(p.x-148,p.z-108)<23,island(p.x,p.z)];
      checks.forEach((v,i)=>{if(v&&!this.visited[i]){this.visited[i]=true;this.ui.notify(['The waterfront. A good place to slow down.','Marina discovered. Your boat is waiting.','Welcome to Paloma Island.'][i]);}});
    } else if(this.state==='menu') {
      const poses=[{p:[390,224,335],t:[-15,35,-40]},{p:[185,135,188],t:[-55,49,-96]},{p:[415,120,105],t:[203,8,-69]}];const pose=poses[this.view];const desired=new T.Vector3(...pose.p as [number,number,number]);desired.x+=Math.sin(this.elapsed*.022)*12;this.camera.position.lerp(desired,1-Math.exp(-dt*.55));this.camera.lookAt(new T.Vector3(...pose.t as [number,number,number]));
    }
    const simulated=this.state==='paused'?0:dt;
    this.environment.update(simulated,this.camera,this.settings,focus);this.activity.update(simulated,this.settings,focus,this.camera);this.world.wheel.rotation.z+=simulated*.04;
    const streamFocus=this.state==='menu'?new T.Vector3(-30,0,-35):focus;
    this.chunks.update(dt,streamFocus,this.settings,this.frameMs,this.state==='menu');
    this.renderer.renderer.render(this.scene,this.camera);
    this.report+=dt;if(this.report>.3){this.report=0;this.updateHUD(focus);}
  }
  private updateHUD(focus:T.Vector3){
    this.ui.time();const mode=this.activity.active?.kind;
    document.querySelector('#mode-pill')!.textContent=mode?`${mode==='car'?'DRIVING':'ON THE WATER'} · ${Math.round(this.activity.speed)} KM/H`:this.player.swimming?'SWIMMING':'ON FOOT';
    document.querySelector('#district-name')!.textContent=island(focus.x,focus.z)?'Paloma Island':focus.x>120?'Azure Bay':focus.z<0?'Downtown':'Marina waterfront';
    const nearby=this.activity.active||this.activity.nearest(this.player),hint=document.querySelector<HTMLElement>('#interaction')!;hint.hidden=!nearby||this.state!=='playing';if(nearby)hint.querySelector('span')!.textContent=this.activity.active?'Exit '+nearby.kind:'Enter '+nearby.kind;
    this.visited.forEach((v,i)=>document.getElementById(`cp-${i}`)!.classList.toggle('visited',v));if(this.visited.every(Boolean))document.querySelector('#objective')!.textContent='The coast is yours. Keep exploring.';
    const info=this.renderer.renderer.info,perf=document.querySelector<HTMLElement>('#performance')!;perf.hidden=!this.settings.debug;
    const r=info.render as unknown as {drawCalls:number;triangles:number};perf.textContent=`${this.renderer.backend} · ${this.settings.quality}\n${Math.round(1000/Math.max(1,this.frameMs))} FPS / ${this.frameMs.toFixed(1)} ms\n${r.drawCalls} draws · ${Math.round(r.triangles/1000)}k triangles\n${this.chunks.resident}/20 resident · ${this.chunks.detailed} detailed\nCulling ${this.settings.culling} (${this.chunks.auto})\n${info.memory.geometries} geometries · ${info.memory.textures} textures\n${this.renderer.renderer.domElement.width} × ${this.renderer.renderer.domElement.height}\nSun ${this.environment.sun.visible?'above':'below'} horizon · Moon ${this.environment.moon.visible?'above':'below'}`;
    if(this.state!=='menu')this.drawMap(focus);
  }
  private drawMap(focus:T.Vector3){
    const canvas=document.querySelector<HTMLCanvasElement>('#minimap')!,ctx=canvas.getContext('2d')!,scale=.49,ox=140-focus.x*scale,oz=140-focus.z*scale;
    ctx.fillStyle='#2d737e';ctx.fillRect(0,0,280,280);ctx.save();ctx.translate(ox,oz);ctx.scale(scale,scale);ctx.fillStyle='#abbca5';ctx.beginPath();ctx.moveTo(-284,-260);for(let z=-260;z<=220;z+=10)ctx.lineTo(coast(z),z);ctx.lineTo(-284,220);ctx.closePath();ctx.fill();ctx.beginPath();ctx.ellipse(282,-80,64,77,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#e2dec1';ctx.lineWidth=8;
    for(const x of [-240,-160,-80,0,80]){ctx.beginPath();ctx.moveTo(x,-250);ctx.lineTo(x,170);ctx.stroke();}for(const z of [-240,-160,-80,0,80,160]){ctx.beginPath();ctx.moveTo(-250,z);ctx.lineTo(z===-80?282:88,z);ctx.stroke();}
    ctx.strokeStyle='#c19f74';ctx.beginPath();ctx.moveTo(115,108);ctx.lineTo(166,108);ctx.stroke();
    ctx.fillStyle='#254e55';this.world.chunks.forEach(c=>c.buildings.forEach(b=>ctx.fillRect(b.x-b.w/2,b.z-b.d/2,b.w,b.d)));
    for(const {position:{x,z}} of [this.activity.car,this.activity.boat]){ctx.fillStyle='#ffcc85';ctx.beginPath();ctx.arc(x,z,5,0,Math.PI*2);ctx.fill();}ctx.restore();ctx.save();ctx.translate(140,140);ctx.rotate(-this.follow.yaw);ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,6);ctx.lineTo(0,3);ctx.lineTo(-6,6);ctx.closePath();ctx.fill();ctx.restore();
  }
  snapshot(){return {state:this.state,backend:this.renderer.backend,position:(this.activity.position||this.player.position).toArray(),mode:this.activity.active?.kind||'foot',visited:[...this.visited],settings:{...this.settings},fps:Math.round(1000/this.frameMs),resident:this.chunks.resident,detailed:this.chunks.detailed,sunVisible:this.environment.sun.visible,moonVisible:this.environment.moon.visible,wetness:this.environment.wetness};}
}
