export type Quality = 'Low' | 'Medium' | 'High' | 'Ultra';
export type Culling = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH' | 'AUTO';
export type Weather = 'Clear' | 'Cloudy' | 'Rain';
export interface Settings { quality: Quality; culling: Culling; distance: number; time: number; cycle: boolean; weather: Weather; debug: boolean; sensitivity: number; fov: number; wireframe: boolean }
export const presets = {
  Low: { dpr: .75, shadow: 0, detail: .65, population: 6, rain: 250, clouds: 6, water: 32 },
  Medium: { dpr: 1, shadow: 512, detail: .85, population: 10, rain: 500, clouds: 10, water: 64 },
  High: { dpr: 1.5, shadow: 1024, detail: 1, population: 16, rain: 900, clouds: 16, water: 96 },
  Ultra: { dpr: 2, shadow: 2048, detail: 1.3, population: 24, rain: 1600, clouds: 24, water: 160 },
};
export function defaults(mobile = false): Settings { return { quality: mobile ? 'Low' : 'High', culling: 'AUTO', distance: 400, time: 15.7, cycle: true, weather: 'Clear', debug: false, sensitivity: 1, fov: 58, wireframe: false }; }
export function validateSettings(data: unknown, mobile = false): Settings {
  const result = defaults(mobile); if (!data || typeof data !== 'object') return result;
  const d = data as Record<string, unknown>;
  if (typeof d.quality === 'string' && d.quality in presets) result.quality = d.quality as Quality;
  if (['OFF', 'LOW', 'MEDIUM', 'HIGH', 'AUTO'].includes(String(d.culling))) result.culling = d.culling as Culling;
  if (['Clear', 'Cloudy', 'Rain'].includes(String(d.weather))) result.weather = d.weather as Weather;
  for (const [key, min, max] of [['distance', 140, 700], ['time', 0, 24], ['sensitivity', .3, 2], ['fov', 45, 85]] as const) {
    if (typeof d[key] === 'number' && Number.isFinite(d[key])) result[key] = Math.max(min, Math.min(max, d[key]));
  }
  for (const key of ['cycle', 'debug', 'wireframe'] as const) if (typeof d[key] === 'boolean') result[key] = d[key];
  return result;
}
export function loadSettings(mobile: boolean) { try { return validateSettings(JSON.parse(localStorage.getItem('coastal-city.settings.v1') || 'null'), mobile); } catch { return defaults(mobile); } }
export function saveSettings(settings: Settings) { try { localStorage.setItem('coastal-city.settings.v1', JSON.stringify(settings)); } catch { /* Private WebViews can deny storage; settings still work for the session. */ } }
export function residencyRadius(mode: Culling, distance: number, auto: 'LOW' | 'MEDIUM' | 'HIGH') { return mode === 'OFF' ? Infinity : distance * ({ LOW: 1.35, MEDIUM: 1, HIGH: .7 }[mode === 'AUTO' ? auto : mode]); }
export function chooseLOD(distance: number, detail: number, previous = 2) {
  const margin = 12;
  if (distance < 105 * detail + (previous === 0 ? margin : -margin)) return 0;
  if (distance < 235 * detail + (previous === 1 ? margin : -margin)) return 1;
  return 2;
}
export function solarAltitude(hour: number) { return Math.sin((hour - 6) / 24 * Math.PI * 2); }
export function phase(hour: number) { if (hour < 5) return 'Night'; if (hour < 6) return 'Pre-dawn'; if (hour < 7.5) return 'Sunrise'; if (hour < 16) return 'Daytime'; if (hour < 17.5) return 'Golden hour'; if (hour < 18.5) return 'Sunset'; if (hour < 20) return 'Dusk'; return 'Night'; }
export function clock(hour: number) { return `${Math.floor(hour % 24).toString().padStart(2, '0')}:${Math.floor((hour % 1) * 60).toString().padStart(2, '0')}`; }
export function seeded(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
