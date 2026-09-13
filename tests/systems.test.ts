import {describe,it,expect} from 'vitest';
import {defaults,validateSettings,chooseLOD,residencyRadius,solarAltitude,phase,seeded} from '../src/core/settings';
import {groundHeight,navigableWater,CollisionWorld,onBridge,island} from '../src/world/queries';
describe('graphics policies',()=>{
  it('validates persisted settings and rejects corrupt values',()=>{const s=validateSettings({quality:'Imaginary',distance:NaN,time:100,culling:'OFF'});expect(s.quality).toBe('High');expect(s.distance).toBe(400);expect(s.time).toBe(24);expect(s.culling).toBe('OFF');expect(validateSettings(null,true).quality).toBe('Low');});
  it('OFF never distance-unloads the finite world',()=>{expect(residencyRadius('OFF',140,'HIGH')).toBe(Infinity);expect(residencyRadius('LOW',400,'MEDIUM')).toBeGreaterThan(residencyRadius('HIGH',400,'MEDIUM'));});
  it('simplifies distant models with hysteresis',()=>{expect(chooseLOD(30,1)).toBe(0);expect(chooseLOD(170,1)).toBe(1);expect(chooseLOD(600,1)).toBe(2);expect(chooseLOD(110,1,0)).toBe(0);expect(chooseLOD(110,1,1)).toBe(1);});
  it('has distinct working resolution and population presets',()=>{expect(defaults(true).quality).toBe('Low');});
});
describe('24 hour astronomical cycle',()=>{
  it('places sun and moon on opposite day/night hemispheres',()=>{expect(solarAltitude(12)).toBeCloseTo(1);expect(solarAltitude(0)).toBeCloseTo(-1);expect(solarAltitude(6)).toBeCloseTo(0);expect(solarAltitude(18)).toBeCloseTo(0);});
  it('includes all seven phases',()=>{expect([5.5,6.5,12,17,18,19,23].map(phase)).toEqual(['Pre-dawn','Sunrise','Daytime','Golden hour','Sunset','Dusk','Night']);});
});
describe('collision independent of render residency',()=>{
  it('supports mainland, marina, bridge and island',()=>{expect(groundHeight(101,92)).toBe(2.5);expect(groundHeight(150,110)).toBe(2.5);expect(onBridge(180,-80)).toBe(true);expect(groundHeight(180,-80)).toBe(3.4);expect(island(282,-80)).toBe(true);expect(navigableWater(200,120)).toBe(true);expect(navigableWater(80,100)).toBe(false);});
  it('does not tunnel through buildings at driving speed',()=>{const c=new CollisionWorld();c.add({x:50,z:50,w:10,d:10,h:20});const p={x:40,y:2.5,z:50};c.move(p,30,0,1);expect(p.x).toBeLessThan(45);});
  it('keeps a player off deep water',()=>{const c=new CollisionWorld(),p={x:110,y:2.5,z:200};c.move(p,100,0);expect(p.x).toBeLessThan(120);});
  it('generates repeatable neighborhoods',()=>{const a=seeded(771),b=seeded(771);for(let i=0;i<20;i++)expect(a()).toBe(b());});
});
