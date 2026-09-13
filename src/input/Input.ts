export class Input {
  keys=new Set<string>();enabled=false;moveX=0;moveY=0;lookX=0;lookY=0;zoom=0;touchSprint=false;
  private actions=new Set<string>();private drag:number|null=null;private lastX=0;private lastY=0;private releases:(()=>void)[]=[];
  constructor(canvas:HTMLCanvasElement) {
    window.addEventListener('keydown',e=>{if(!this.enabled||e.isComposing||e.keyCode===229||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(!e.repeat)this.actions.add(e.code);this.keys.add(e.code);});
    window.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>this.reset());
    canvas.addEventListener('pointerdown',e=>{if(!this.enabled||this.drag!==null)return;this.drag=e.pointerId;this.lastX=e.clientX;this.lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(this.drag===e.pointerId&&this.enabled){this.lookX+=e.clientX-this.lastX;this.lookY+=e.clientY-this.lastY;this.lastX=e.clientX;this.lastY=e.clientY;}});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if((e as PointerEvent).pointerId===this.drag)this.drag=null;});
    canvas.addEventListener('wheel',e=>{if(this.enabled){e.preventDefault();this.zoom+=e.deltaY*.01;}},{passive:false});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
  }
  bindTouch(root:HTMLElement) {
    const joystick=root.querySelector<HTMLElement>('#joystick')!,nub=root.querySelector<HTMLElement>('#joystick-nub')!;let id:number|null=null;
    const update=(e:PointerEvent)=>{const r=joystick.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,l=Math.max(1,Math.hypot(x,y)/35);this.moveX=x/l/35;this.moveY=-y/l/35;nub.style.transform=`translate(${x/l}px,${y/l}px)`;};
    joystick.addEventListener('pointerdown',e=>{if(!this.enabled)return;e.preventDefault();if(id!==null)return;id=e.pointerId;joystick.setPointerCapture(id);update(e);});joystick.addEventListener('pointermove',e=>{if(e.pointerId===id)update(e);});
    const release=()=>{id=null;this.moveX=0;this.moveY=0;nub.style.transform='';};this.releases.push(release);for(const event of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(event,release);
    root.querySelectorAll<HTMLElement>('[data-action]').forEach(el=>{el.addEventListener('pointerdown',e=>{if(!this.enabled)return;e.preventDefault();el.setPointerCapture(e.pointerId);const action=el.dataset.action!;this.actions.add(action);this.keys.add(action);});for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,()=>this.keys.delete(el.dataset.action!));});
  }
  get horizontal(){return Math.max(-1,Math.min(1,(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0)+this.moveX));}
  get vertical(){return Math.max(-1,Math.min(1,(this.keys.has('KeyW')?1:0)-(this.keys.has('KeyS')?1:0)+this.moveY));}
  get sprint(){return this.keys.has('ShiftLeft')||this.keys.has('ShiftRight');}
  consume(action:string){const has=this.actions.has(action);this.actions.delete(action);return has;}
  reset(){this.releases.forEach(release=>release());this.zoom=0;this.keys.clear();this.actions.clear();this.moveX=0;this.moveY=0;this.lookX=0;this.lookY=0;this.drag=null;document.querySelector<HTMLElement>('#joystick-nub')?.style.removeProperty('transform');}
}
