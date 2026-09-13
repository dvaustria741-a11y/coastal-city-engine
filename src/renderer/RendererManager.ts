import * as T from 'three/webgpu';
import { presets, type Settings } from '../core/settings';
export class RendererManager {
  renderer!: T.WebGPURenderer; backend='Initializing'; width=0;height=0;
  async init(container:HTMLElement) {
    const force=new URLSearchParams(location.search).get('renderer')==='webgl';
    let renderer=new T.WebGPURenderer({antialias:true,forceWebGL:force,alpha:false});
    try {await renderer.init();} catch {renderer.dispose();renderer=new T.WebGPURenderer({antialias:true,forceWebGL:true,alpha:false});await renderer.init();}
    this.renderer=renderer; this.backend=(renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL2';
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;renderer.shadowMap.type=T.PCFShadowMap;renderer.domElement.id='world-canvas';renderer.domElement.setAttribute('aria-label','Interactive 3D Coastal City world');container.prepend(renderer.domElement);
  }
  apply(settings:Settings) {this.renderer.setPixelRatio(Math.min(devicePixelRatio,presets[settings.quality].dpr));this.renderer.shadowMap.enabled=presets[settings.quality].shadow>0;this.resize();}
  resize() {this.width=innerWidth;this.height=innerHeight;this.renderer.setSize(this.width,this.height);}
}
