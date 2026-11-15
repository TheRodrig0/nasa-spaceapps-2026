import type { Crater, RgbColorTuple } from '../../types/index.ts';
import { clamp, fbm, hash2D, lerp, noise2D, ridgedFbm, smoothstep } from './noise.ts';

export const WORLD_HALF = 2800;

export function createCratersForSeed(seed: number): Crater[] {
  const craters: Crater[] = [];
  const craterCount = 36;
  for (let i = 0; i < craterCount; i++) {
    const angle = i * 2.39996 + (seed % 100) * 0.1;
    const dist = (0.1 + 0.8 * hash2D(i, 11, seed, 30)) * WORLD_HALF;
    const cx = Math.cos(angle) * dist + noise2D(i * 1.7, seed * 0.05, seed, 10) * 190;
    const cz = Math.sin(angle) * dist + noise2D(seed * 0.05, i * 2.3, seed, 20) * 190;
    const r = 65 + hash2D(i, 29, seed, 50) * 165;
    const depth = r * 0.25;
    craters.push({ x: cx, z: cz, r, depth });
  }
  return craters;
}

export function samplePlanetHeight(
  x: number,
  z: number,
  seed: number,
  craters: Crater[],
): number {
  const warpX = x + fbm(x * 0.00085, z * 0.00085, seed, 4, 2.0, 0.5, 101) * 240.0;
  const warpZ = z + fbm(x * 0.00085, z * 0.00085, seed, 4, 2.0, 0.5, 202) * 240.0;

  const macroPlains = fbm(warpX * 0.0012, warpZ * 0.0012, seed, 5, 2.05, 0.5, 303) * 14.0;
  const microDetail = fbm(x * 0.028, z * 0.028, seed, 3, 2.2, 0.45, 808) * 1.5;
  const duneRipples =
    Math.sin(x * 0.055 + z * 0.038 + noise2D(x * 0.02, z * 0.02, seed, 99) * 2.2) * 0.85;
  let h = macroPlains + microDetail + duneRipples;

  const rawPlateau = fbm(warpX * 0.00058 + 4.2, warpZ * 0.00058 - 1.7, seed, 4, 2.1, 0.5, 404);
  const plateauMask = smoothstep(0.22, 0.5, rawPlateau);
  if (plateauMask > 0.001) {
    const mesaRawHeight = plateauMask * 115.0;
    const steppedMesa = Math.round(mesaRawHeight / 14.0) * 14.0;
    const fineTerrace = Math.round(mesaRawHeight / 3.5) * 3.5;
    h += lerp(mesaRawHeight, steppedMesa * 0.72 + fineTerrace * 0.28, 0.82);
  }

  const rawMacroMtn = fbm(warpX * 0.00048 - 8.5, warpZ * 0.00048 + 6.1, seed, 4, 2.0, 0.5, 505);
  const mountainMask = smoothstep(0.25, 0.56, rawMacroMtn);
  if (mountainMask > 0.001) {
    const ridges = ridgedFbm(warpX * 0.0022, warpZ * 0.0022, seed, 5, 606);
    const mtnElevation = Math.pow(mountainMask, 1.22) * (110.0 + ridges * 310.0);
    const mtnStepped = Math.floor(mtnElevation / 9.0) * 9.0;
    h += lerp(mtnElevation, mtnStepped, 0.24);
  }

  const canyonField = fbm(warpX * 0.00062, warpZ * 0.00062, seed, 4, 2.0, 0.48, 707);
  const distFromCanyonCenter = Math.abs(canyonField);
  const canyonThreshold = 0.068;

  if (distFromCanyonCenter < canyonThreshold) {
    const normCanyon = distFromCanyonCenter / canyonThreshold;
    const wallProfile = 1.0 - smoothstep(0.22, 1.0, normCanyon);
    const rawCarve = wallProfile * (88.0 + plateauMask * 46.0);
    const steppedCarve = Math.floor(rawCarve / 10.5) * 10.5;
    h -= lerp(rawCarve, steppedCarve, 0.72);
  }

  for (let i = 0; i < craters.length; i++) {
    const c = craters[i];
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r * 1.35) {
      const norm = d / c.r;
      if (norm < 0.82) {
        const bowl = Math.cos((norm / 0.82) * (Math.PI * 0.5));
        h -= Math.min(1.0, bowl * 1.25) * c.depth;
      } else {
        const rim = Math.sin(((norm - 0.82) / 0.53) * Math.PI);
        h += rim * (c.depth * 0.38);
      }
    }
  }

  return h;
}

export function getPlanetVertexColor(
  y: number,
  ny: number,
  seed: number,
  wx = 0,
  wz = 0,
): RgbColorTuple {
  const strataBand = Math.sin(y * 0.05 + noise2D(wx * 0.0025, wz * 0.0025, seed, 33) * 0.8);

  if (ny <= 0.65) {
    return strataBand > 0 ? [0.45, 0.2, 0.13] : [0.36, 0.15, 0.1];
  }
  if (y < -30.0) {
    return [0.28, 0.11, 0.07];
  }
  if (y < 25.0) {
    return strataBand > 0.2 ? [0.72, 0.34, 0.17] : [0.65, 0.28, 0.13];
  }
  if (y < 110.0) {
    return strataBand > 0 ? [0.55, 0.22, 0.11] : [0.48, 0.18, 0.09];
  }
  if (y < 255.0) {
    return [0.35, 0.14, 0.1];
  }
  if (ny > 0.72) {
    return [0.85, 0.76, 0.7];
  }
  return [0.35, 0.14, 0.1];
}

export function applyFacetColorJitter(
  rgb: RgbColorTuple,
  avgX: number,
  avgZ: number,
): RgbColorTuple {
  const facetJitter = 0.95 + 0.065 * Math.sin(avgX * 0.22 + avgZ * 0.19);
  return [
    clamp(rgb[0] * facetJitter, 0, 1),
    clamp(rgb[1] * facetJitter, 0, 1),
    clamp(rgb[2] * facetJitter, 0, 1),
  ];
}
