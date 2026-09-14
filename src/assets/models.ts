import * as T from 'three/webgpu';
export const materials = {
  ivory: new T.MeshStandardMaterial({ color: '#e8e6d6', roughness: .65 }),
  concrete: new T.MeshStandardMaterial({ color: '#aebec0', roughness: .85 }),
  glass: new T.MeshStandardMaterial({ color: '#497c8a', metalness: .7, roughness: .21 }),
  blue: new T.MeshStandardMaterial({ color: '#284f65', metalness: .55, roughness: .26 }),
  teal: new T.MeshStandardMaterial({ color: '#63a9ac', metalness: .4, roughness: .3 }),
  sand: new T.MeshStandardMaterial({ color: '#f0d9a5', roughness: 1 }),
  grass: new T.MeshStandardMaterial({ color: '#6e9555', roughness: 1 }),
  leaf: new T.MeshStandardMaterial({ color: '#357952', roughness: .9, side: T.DoubleSide }),
  leafLight: new T.MeshStandardMaterial({ color: '#83a761', roughness: .9, side: T.DoubleSide }),
  trunk: new T.MeshStandardMaterial({ color: '#8f7860', roughness: 1 }),
  road: new T.MeshStandardMaterial({ color: '#47535b', roughness: .94, metalness: .04 }),
  line: new T.MeshStandardMaterial({ color: '#e4e2c5', roughness: .7 }),
  dark: new T.MeshStandardMaterial({ color: '#25353c', roughness: .7 }),
  coral: new T.MeshStandardMaterial({ color: '#d98667', roughness: .55 }),
  wood: new T.MeshStandardMaterial({ color: '#b29166', roughness: .9 }),
  light: new T.MeshStandardMaterial({ color: '#ffe5a5', emissive: '#ffb95c', emissiveIntensity: 0 }),
  red: new T.MeshStandardMaterial({ color: '#dc5948', roughness: .3, metalness: .45 }),
  white: new T.MeshStandardMaterial({ color: '#f0f1e5', roughness: .28, metalness: .15 }),
};
export type Mat = keyof typeof materials;
const box = new T.BoxGeometry(1, 1, 1);
const cylinder = new T.CylinderGeometry(1, 1, 1, 12);
const sphere = new T.SphereGeometry(1, 10, 6);
const cone = new T.CylinderGeometry(.1, 1, 1, 10);
const frond = (() => {
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8, width = Math.sin(t * Math.PI) * .65; positions.push(t * 5, Math.sin(t * Math.PI) * 1.2 - t * 1.4, -width, t * 5, Math.sin(t * Math.PI) * 1.2 - t * 1.4, width); if (i < 8) { const n = i * 2; indices.push(n, n+1, n+2, n+1, n+3, n+2); } }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals(); return g;
})();
const geo = { box, cylinder, sphere, cone, frond };
type Geo = keyof typeof geo;
export class Batch {
  private items = new Map<string, T.Matrix4[]>();
  private dummy = new T.Object3D();
  add(shape: Geo, mat: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rz = 0, rx = 0) {
    this.dummy.position.set(x, y, z); this.dummy.scale.set(sx, sy, sz); this.dummy.rotation.set(rx, ry, rz); this.dummy.updateMatrix();
    const key = shape + ':' + mat; if (!this.items.has(key)) this.items.set(key, []); this.items.get(key)!.push(this.dummy.matrix.clone());
  }
  beam(mat: Mat, a: T.Vector3, b: T.Vector3, radius: number) {
    this.dummy.position.copy(a).add(b).multiplyScalar(.5); this.dummy.scale.set(radius, a.distanceTo(b), radius); this.dummy.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), b.clone().sub(a).normalize()); this.dummy.updateMatrix();
    const key = 'cylinder:' + mat; if (!this.items.has(key)) this.items.set(key, []); this.items.get(key)!.push(this.dummy.matrix.clone());
  }
  finish() {
    const group = new T.Group();
    for (const [key, matrices] of this.items) {
      const [g, m] = key.split(':') as [Geo, Mat]; const mesh = new T.InstancedMesh(geo[g], materials[m], matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = !['light', 'line', 'glass', 'leaf', 'leafLight'].includes(m); mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      // One InstancedMesh here holds every building's glass/etc for a whole
      // chunk, so its auto bounding sphere spans the entire chunk footprint.
      // Chunk-level distance/residency (ChunkManager) already gates whether
      // this group is loaded and visible at all, so a second, per-mesh
      // frustum test is redundant and was the cause of glass/windows
      // vanishing when the camera got close to (and past) the edge of that
      // shared bounding sphere while still looking at the building. Rely on
      // the chunk system for culling and skip per-mesh frustum culling here.
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return group;
  }
}
export function palm(b: Batch, x: number, z: number, height: number, detail: number, y = 2.5) {
  const segments = detail === 0 ? 5 : 2;
  for (let i = 0; i < segments; i++) { const t = i / segments, n = (i+1) / segments; b.beam('trunk', new T.Vector3(x+t*t*1.8,y+t*height,z), new T.Vector3(x+n*n*1.8,y+n*height,z), .19 + (1-t)*.17); }
  const count = detail === 0 ? 9 : detail === 1 ? 6 : 4;
  for (let j = 0; j < count; j++) b.add('frond', j % 3 ? 'leaf' : 'leafLight', x+1.8, y+height, z, .85, 1, 1, j / count * Math.PI * 2);
  if (detail === 0) b.add('sphere', 'trunk', x+1.8,y+height-.3,z,.4,.5,.4);
}
export interface Building { x: number; z: number; w: number; d: number; h: number; style: number; y: number; minY: number }
export function building(b: Batch, p: Building, detail: number) {
  const {x,z,w,d,h,style,y,minY} = p;
  const foundation = Math.max(.1, y - minY + .1);
  b.add('box', 'concrete', x, y - foundation / 2, z, w + 3, foundation, d + 3);
  const glass: Mat = style % 3 === 0 ? 'blue' : style % 3 === 1 ? 'glass' : 'teal';
  b.add('box','ivory',x,y+2,z,w+3,4,d+3);
  const round = style === 2;
  if (round) { b.add('cylinder',glass,x,y+h/2,z,w*.54,h,d*.54); b.add('cylinder','ivory',x,y+h+1,z,w*.56,2,d*.56); }
  else {
    b.add('box',glass,x,y+h*.42,z,w,h*.84,d);
    b.add('box',glass,x,y+h*.89,z,w*.76,h*.1,d*.76);
    b.add('box','ivory',x,y+h*.95,z,w*.8,1,d*.8);
    b.add('box',style % 2 ? 'ivory' : glass,x,y+h*.98,z,w*.48,h*.08,d*.48);
  }
  b.add('box','concrete',x,y+h+2,z,w*.25,3,d*.22);
  if (h > 65) b.add('cylinder','ivory',x,y+h+8,z,.15,13,.15);
  if (detail === 2) { for (let i = 1; i < 6; i++) b.add(round ? 'cylinder' : 'box','ivory',x,y+h*i/6,z,round?w*.55:w+.25,.4,round?d*.55:d+.25); return; }
  const floors = Math.floor(h / 3.5);
  for (let floor = 1; floor < floors * (round ? 1 : .82); floor++) {
    const fy = y+floor*3.5;
    b.add(round?'cylinder':'box','ivory',x,fy,z,round?w*.552:w+.6,.22,round?d*.552:d+.6);
    if (style === 1 && floor%2===0) {
      b.add('box','ivory',x,fy,z+d/2+1.2,w+1,.25,2.8);
      b.add('box','glass',x,fy+.7,z+d/2+2.5,w+1,1.15,.12);
    }
    if (detail === 0 && floor % 3 === 1 && !round) for (let k = -1; k <= 1; k++) { b.add('box','light',x+k*w*.27,fy+1.4,z+d/2+.025,w*.12,1.6,.06); }
  }
  if (!round) {
    const n = detail === 0 ? 6 : 3;
    for (let i = 0; i <= n; i++) { b.add('box','ivory',x-w/2+i*w/n,y+h*.42,z,.22,h*.84,d+.2); b.add('box','ivory',x,y+h*.42,z-d/2+i*d/n,w+.2,h*.84,.22); }
    b.add('box','dark',x,y+1.7,z+d/2+1.6,w*.45,2.8,.2);
    b.add('box','ivory',x,y+3.2,z+d/2+2,w*.6,.25,3);
  }
  if (detail === 0) { b.add('box','dark',x+2,y+h+3,z+1,2,1,3); b.add('box','glass',x-2,y+h+3,z-1,3,.2,2,.2); }
}
export function makeCar(color: Mat = 'coral', detail = 0) {
  const b = new Batch();
  b.add('box',color,0,.72,0,1.85,.55,4.1);
  b.add('box',color,0,.91,-1.3,1.8,.28,1.4,0,.035);
  b.add('box','glass',0,1.3,.2,1.62,.7,2.1);
  b.add('box',color,0,1.68,.3,1.7,.13,1.65);
  b.add('box',color,0,1.29,.38,.11,.73,2.2);
  for (const x of [-.96,.96]) for (const z of [-1.27,1.27]) { b.add('cylinder','dark',x,.47,z,.39,.25,.39,0,Math.PI/2); if(detail<2) b.add('cylinder','concrete',x*1.015,.47,z,.23,.27,.23,0,Math.PI/2); }
  if (detail < 2) { for (const x of [-.6,.6]) { b.add('box','light',x,.86,-2.06,.43,.18,.08); b.add('box','red',x,.86,2.06,.42,.17,.08); } b.add('box','dark',0,.63,-2.08,.7,.23,.08); }
  if (detail === 0) for (const x of [-1,1]) b.add('box',color,x,1.3,-.6,.28,.15,.3);
  return b.finish();
}
const hullGeometry = (() => { const s = new T.Shape(); s.moveTo(0,-3.5); s.bezierCurveTo(1,-3,1.35,-1.5,1.35,1); s.lineTo(1.1,3); s.lineTo(-1.1,3); s.lineTo(-1.35,1); s.bezierCurveTo(-1.35,-1.5,-1,-3,0,-3.5); const g = new T.ExtrudeGeometry(s,{ depth:.65, bevelEnabled:true, bevelThickness:.25, bevelSize:.18, bevelSegments:2, steps:1 }); g.rotateX(-Math.PI/2); return g; })();
export function makeBoat(detail = 0) {
  const g = new T.Group(), b = new Batch(); const hull = new T.Mesh(hullGeometry, materials.ivory); hull.castShadow = true; g.add(hull);
  b.add('box','wood',0,.7,0,2.2,.1,4.7);
  b.add('box','ivory',0,1,-.5,1.85,.8,2.8);
  b.add('box','glass',0,1.63,-.6,1.65,.65,1.8);
  b.add('box','white',0,2,-.6,1.9,.15,2.1);
  if(detail<2) { for (const x of [-1.15,1.15]) { b.add('box','white',x,1,0,.07,.07,5.4); for(const z of [-2,0,2]) b.add('box','white',x,.82,z,.06,.45,.06); } b.add('box','ivory',0,1,1.6,1.4,.55,.55); }
  if(detail===0) { b.add('cylinder','white',0,2.7,-.7,.035,1.5,.035); b.add('box','coral',.25,3.2,-.7,.5,.3,.03); }
  g.add(b.finish()); return g;
}
export function makeHuman(shirt: Mat = 'ivory') {
  const g = new T.Group(), b = new Batch();
  b.add('sphere','trunk',0,1.67,0,.19,.23,.19); b.add('box',shirt,0,1.14,0,.52,.65,.3); b.add('sphere','dark',0,1.85,.02,.21,.09,.22);
  const limbs: T.Group[] = [];
  for (let i=0;i<4;i++) { const limb = new T.Group(), lb = new Batch(); const arm = i<2; lb.add('box',arm?shirt:'dark',0,-.29,0,arm?.14:.2,arm?.61:.69,arm?.18:.22); if(!arm) lb.add('box','white',0,-.66,-.07,.21,.13,.36); limb.position.set((i%2?1:-1)*(arm?.35:.15),arm?1.43:.83,0); limb.add(lb.finish()); limbs.push(limb); g.add(limb); }
  g.add(b.finish()); g.userData.limbs=limbs; return g;
}
export function animateHuman(g: T.Group, time: number, speed: number) { const limbs = g.userData.limbs as T.Group[]; limbs.forEach((l,i) => l.rotation.x=Math.sin(time*9+(i%2)*Math.PI)*(i<2?-.55:.65)*Math.min(speed,1)); }
export function disposeBatch(group: T.Group) { group.traverse(o => { if(o instanceof T.InstancedMesh) o.dispose(); }); group.removeFromParent(); }
