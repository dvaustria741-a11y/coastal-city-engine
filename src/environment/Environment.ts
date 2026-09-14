import * as T from 'three/webgpu';
import { positionLocal, positionWorld, sin, vec3, uniform, mix, color } from 'three/tsl';
import { materials } from '../assets/models';
import { WATER_LEVEL } from '../world/queries';
import { presets, seeded, solarAltitude, type Settings } from '../core/settings';
export class Environment {
  skyRoot=new T.Group();sunLight=new T.DirectionalLight('#fff1cb',3);ambient=new T.HemisphereLight('#b5dce8','#707961',2);
  sun=new T.Mesh(new T.SphereGeometry(22,20,12),new T.MeshBasicMaterial({color:'#fff2c6',fog:false,depthWrite:false}));
  moon=new T.Mesh(new T.SphereGeometry(15,16,12),new T.MeshBasicMaterial({color:'#eaf6ff',fog:false,depthWrite:false}));
  sky:T.Mesh; water:T.Mesh;clouds:T.InstancedMesh;rain:T.LineSegments; wetness=0;elapsed=0;
  private tick=0;private waterTime=uniform(0);private wet=uniform(0);private weatherMix=0;private cloudMaterial=new T.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.74,fog:false,depthWrite:false});
  private starMaterial=new T.PointsMaterial({color:'#d4eeff',size:2.1,sizeAttenuation:false,fog:false,transparent:true,opacity:0,depthWrite:false});
  private colors:Float32Array;private skyGeometry=new T.SphereGeometry(1750,32,20);private rainPositions=new Float32Array(1600*6);private reflection:T.CanvasTexture;
  constructor(private scene:T.Scene) {
    this.colors=new Float32Array(this.skyGeometry.attributes.position.count*3);this.skyGeometry.setAttribute('color',new T.BufferAttribute(this.colors,3));
    this.sky=new T.Mesh(this.skyGeometry,new T.MeshBasicMaterial({vertexColors:true,side:T.BackSide,fog:false,depthWrite:false}));this.sky.renderOrder=-100;
    this.sun.renderOrder=-98;this.moon.renderOrder=-98;this.skyRoot.add(this.sky,this.sun,this.moon);this.skyRoot.traverse(o=>o.frustumCulled=false);scene.add(this.skyRoot,this.sunLight,this.sunLight.target,this.ambient);
    this.sunLight.shadow.camera.left=-85;this.sunLight.shadow.camera.right=85;this.sunLight.shadow.camera.top=85;this.sunLight.shadow.camera.bottom=-85;this.sunLight.shadow.camera.near=1;this.sunLight.shadow.camera.far=420;this.sunLight.shadow.bias=-.0003;this.sunLight.shadow.normalBias=.25;
    const wm=new T.MeshStandardNodeMaterial({roughness:.24,metalness:.48,color:'#37aaa8'});
    const wave=sin(positionLocal.x.mul(.09).add(this.waterTime.mul(.8))).mul(.18).add(sin(positionLocal.y.mul(.14).sub(this.waterTime)).mul(.12));
    wm.positionNode=positionLocal.add(vec3(0,0,wave));
    wm.colorNode=mix(color('#197e8a'),color('#66c9bd'),sin(positionWorld.x.mul(.09).add(positionWorld.z.mul(.13)).add(this.waterTime)).mul(.16).add(.42));
    this.water=new T.Mesh(new T.PlaneGeometry(6000,6000,96,96),wm);this.water.rotation.x=-Math.PI/2;this.water.position.y=WATER_LEVEL;this.water.receiveShadow=true;scene.add(this.water);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const ctx=canvas.getContext('2d')!;const gr=ctx.createLinearGradient(0,0,0,128);gr.addColorStop(0,'#4192c1');gr.addColorStop(.45,'#d7e8df');gr.addColorStop(.52,'#b7c6b0');gr.addColorStop(1,'#526956');ctx.fillStyle=gr;ctx.fillRect(0,0,256,128);ctx.fillStyle='#fff1c8';ctx.fillRect(177,31,14,23);this.reflection=new T.CanvasTexture(canvas);this.reflection.mapping=T.EquirectangularReflectionMapping;scene.environment=this.reflection;scene.environmentIntensity=.65;
    const random=seeded(99),dummy=new T.Object3D();this.clouds=new T.InstancedMesh(new T.SphereGeometry(1,12,8),this.cloudMaterial,96);
    for(let i=0;i<96;i++){const a=Math.floor(i/4)*2.4;dummy.position.set(Math.sin(a)*950+(i%4)*35,200+random()*75,Math.cos(a)*950);dummy.scale.set(75+random()*40,12+random()*16,35);dummy.rotation.z=random()*.15;dummy.updateMatrix();this.clouds.setMatrixAt(i,dummy.matrix);}this.clouds.frustumCulled=false;this.clouds.renderOrder=-97;this.skyRoot.add(this.clouds);
    const stars=new Float32Array(750*3);for(let i=0;i<750;i++){const a=random()*Math.PI*2,h=random();stars[i*3]=Math.cos(a)*Math.sqrt(1-h*h)*1550;stars[i*3+1]=h*1550;stars[i*3+2]=Math.sin(a)*Math.sqrt(1-h*h)*1550;}
    const sg=new T.BufferGeometry();sg.setAttribute('position',new T.BufferAttribute(stars,3));const points=new T.Points(sg,this.starMaterial);points.frustumCulled=false;points.renderOrder=-99;this.skyRoot.add(points);
    for(let i=0;i<this.rainPositions.length;i+=6){this.rainPositions[i]=(random()-.5)*55;this.rainPositions[i+1]=random()*35;this.rainPositions[i+2]=(random()-.5)*55;}
    const rg=new T.BufferGeometry();rg.setAttribute('position',new T.BufferAttribute(this.rainPositions,3).setUsage(T.DynamicDrawUsage));this.rain=new T.LineSegments(rg,new T.LineBasicMaterial({color:'#b8d3e1',transparent:true,opacity:.4,depthWrite:false}));this.rain.frustumCulled=false;scene.add(this.rain);scene.fog=new T.FogExp2('#bedcd9',.00105);
  }
  apply(settings:Settings) {
    const p=presets[settings.quality];this.sunLight.castShadow=p.shadow>0;
    if(this.sunLight.shadow.mapSize.x!==p.shadow&&p.shadow){this.sunLight.shadow.map?.dispose();this.sunLight.shadow.map=null;this.sunLight.shadow.mapSize.set(p.shadow,p.shadow);}
    this.clouds.count=p.clouds*4;this.rain.geometry.setDrawRange(0,p.rain*2);
    this.water.geometry.dispose();this.water.geometry=new T.PlaneGeometry(6000,6000,p.water,p.water);
  }
  update(dt:number,camera:T.Camera,settings:Settings,target:T.Vector3) {
    this.elapsed+=dt;this.waterTime.value=this.elapsed;
    if(settings.cycle)settings.time=(settings.time+dt*.018)%24;
    this.skyRoot.position.copy(camera.position);
    const angle=(settings.time-6)/24*Math.PI*2,alt=solarAltitude(settings.time),day=T.MathUtils.smoothstep(alt,-.17,.25);
    const direction=new T.Vector3(-Math.cos(angle)*.85,alt,Math.cos(angle)*.53).normalize();
    this.sun.position.copy(direction).multiplyScalar(1400);this.moon.position.copy(direction).multiplyScalar(-1400);this.sun.visible=alt>-.06;this.moon.visible=alt<.06;
    const weatherTarget=settings.weather==='Rain'?1:settings.weather==='Cloudy'?.55:0;this.weatherMix=T.MathUtils.damp(this.weatherMix,weatherTarget,1,dt);this.wetness=T.MathUtils.damp(this.wetness,settings.weather==='Rain'?1:0,settings.weather==='Rain'?.15:.025,dt);this.wet.value=this.wetness;
    this.sunLight.position.copy(target).addScaledVector(alt>0?direction:direction.clone().negate(),180);this.sunLight.target.position.copy(target);this.sunLight.intensity=(alt>0?3.1*day:.65)*(1-this.weatherMix*.55);this.sunLight.color.set(alt>0?(alt<.3?'#ffbc7c':'#fff1d2'):'#adc7ff');this.ambient.intensity=.42+day*1.7-this.weatherMix*.4;
    materials.light.emissiveIntensity=(1-day)*2.5+.05;materials.road.roughness=.94-this.wetness*.77;materials.road.metalness=.04+this.wetness*.4;this.scene.environmentIntensity=.15+day*.6;
    this.starMaterial.opacity=(1-day)*(1-this.weatherMix*.8);this.cloudMaterial.opacity=.6+this.weatherMix*.25;this.cloudMaterial.color.setRGB(.95-this.weatherMix*.5,.97-this.weatherMix*.48,1-this.weatherMix*.42).multiplyScalar(.18+day*.82);
    this.clouds.rotation.y=this.elapsed*.001;
    const horizon=new T.Color('#b6dcd8').lerp(new T.Color('#f3bd91'),(1-T.MathUtils.smoothstep(Math.abs(alt),0,.38))*.85).lerp(new T.Color('#718b98'),this.weatherMix*.8).lerp(new T.Color('#172638'),1-day);
    const top=new T.Color('#519dbe').lerp(new T.Color('#637f93'),this.weatherMix).lerp(new T.Color('#06111f'),1-day);
    const fog=this.scene.fog as T.FogExp2;fog.color.copy(horizon);fog.density=.00085+this.weatherMix*.0016;
    this.tick+=dt;if(this.tick>.25){this.tick=0;const c=new T.Color();for(let i=0;i<this.skyGeometry.attributes.position.count;i++){const height=this.skyGeometry.attributes.position.getY(i)/1750; c.copy(horizon).lerp(top,Math.max(0,Math.min(1,height*1.5)));c.toArray(this.colors,i*3);}this.skyGeometry.attributes.color.needsUpdate=true;}
    this.rain.visible=this.weatherMix>.2&&settings.weather==='Rain';
    if(this.rain.visible){this.rain.position.copy(target);for(let i=0;i<this.rainPositions.length;i+=6){this.rainPositions[i+1]-=dt*24;if(this.rainPositions[i+1]<0)this.rainPositions[i+1]=35;this.rainPositions[i+3]=this.rainPositions[i]+.22;this.rainPositions[i+4]=this.rainPositions[i+1]-1;this.rainPositions[i+5]=this.rainPositions[i+2];}this.rain.geometry.attributes.position.needsUpdate=true;}
  }
}
