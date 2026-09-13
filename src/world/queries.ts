export const coast = (z: number) => 116 + Math.sin(z * .015) * 8;
export const island = (x: number, z: number, margin = 0) => ((x-282)/(64-margin))**2 + ((z+80)/(77-margin))**2 < 1;
export const onBridge = (x: number,z: number) => x >= 70 && x <= 284 && Math.abs(z+80)<8;
export const onDock = (x: number,z: number) => (x>110 && x<167 && Math.abs(z-108)<3) || (x>148 && x<153 && z>94 && z<135);
export function groundHeight(x: number,z: number) {
  if(onBridge(x,z)) return 3.4;
  if(onDock(x,z)) return 2.5;
  if(x>-283 && x<coast(z) && z>-260 && z<220) return 2.5;
  if(island(x,z)) return 2.5;
  return -2;
}
export function navigableWater(x: number,z: number) { return groundHeight(x,z)<0 && Math.abs(x)<650 && Math.abs(z)<600; }
export interface Collider { x: number; z: number; w: number; d: number; h: number }
export class CollisionWorld {
  private cells = new Map<string,Collider[]>();
  add(c: Collider) { for(let x=Math.floor((c.x-c.w/2)/40);x<=Math.floor((c.x+c.w/2)/40);x++) for(let z=Math.floor((c.z-c.d/2)/40);z<=Math.floor((c.z+c.d/2)/40);z++) { const key=`${x}:${z}`; if(!this.cells.has(key))this.cells.set(key,[]); this.cells.get(key)!.push(c); } }
  blocked(x: number,z: number,r=.45,y=2.5) { const nearby=this.cells.get(`${Math.floor(x/40)}:${Math.floor(z/40)}`)||[]; return nearby.some(c=>y<c.h+2.5&&Math.abs(x-c.x)<c.w/2+r&&Math.abs(z-c.z)<c.d/2+r); }
  move(position: {x:number;z:number;y:number},dx:number,dz:number,r=.45) {
    const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.4));
    for(let i=0;i<steps;i++){ const x=position.x+dx/steps,z=position.z+dz/steps;
      if(groundHeight(x,position.z)>0&&!this.blocked(x,position.z,r,position.y))position.x=x;
      if(groundHeight(position.x,z)>0&&!this.blocked(position.x,z,r,position.y))position.z=z;
    }
  }
}
