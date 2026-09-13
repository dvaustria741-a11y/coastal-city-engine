import * as T from 'three/webgpu';
import { presets, type Settings } from '../core/settings';

export class RendererManager {
  renderer!: T.WebGPURenderer;
  backend = 'Initializing'; width = 0; height = 0;
  private container!: HTMLElement;
  async init(container: HTMLElement, force = new URLSearchParams(location.search).get('renderer') === 'webgl') {
    this.container = container;
    let renderer = new T.WebGPURenderer({ antialias: true, forceWebGL: force, alpha: false });
    try { await renderer.init(); }
    catch (error) {
      try { renderer.dispose(); } catch { /* A failed backend may not have allocated its disposal hooks. */ }
      if (force) throw error;
      renderer = new T.WebGPURenderer({ antialias: true, forceWebGL: true, alpha: false });
      await renderer.init();
    }
    this.renderer = renderer;
    this.backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.domElement.id = 'world-canvas';
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D Coastal City world');
    container.replaceChildren(renderer.domElement);
  }
  async prepare(scene: T.Scene, camera: T.Camera, settings: Settings) {
    this.apply(settings);
    try {
      await this.renderer.compileAsync(scene, camera);
      this.renderer.render(scene, camera);
    } catch (error) {
      if (this.backend === 'WebGL2') throw error;
      this.renderer.dispose();
      await this.init(this.container, true);
      this.apply(settings);
      await this.renderer.compileAsync(scene, camera);
      this.renderer.render(scene, camera);
    }
  }
  apply(settings: Settings) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, presets[settings.quality].dpr) * settings.resolution);
    this.renderer.shadowMap.enabled = settings.shadows && presets[settings.quality].shadow > 0;
    this.resize();
  }
  resize() { this.width = innerWidth; this.height = innerHeight; this.renderer.setSize(this.width, this.height); }
}
