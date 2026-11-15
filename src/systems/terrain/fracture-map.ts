import * as pc from 'playcanvas';

const TEXTURE_SIZE = 512;
const MACRO_CELLS = 10;
const MICRO_CELLS = 24;

function hashPeriodic2D(ix: number, iy: number, period: number, seed: number): number {
  const wx = ((ix % period) + period) % period;
  const wy = ((iy % period) + period) % period;
  const h = Math.sin(wx * 127.1 + wy * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function createPeriodicNoiseGrid(period: number, seed: number): Float32Array {
  const grid = new Float32Array(period * period);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      grid[y * period + x] = hashPeriodic2D(x, y, period, seed);
    }
  }
  return grid;
}

function samplePeriodicNoise(u: number, v: number, period: number, grid: Float32Array): number {
  const gx = u * period;
  const gy = v * period;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;

  const v00 = grid[iy0 * period + ix0];
  const v10 = grid[iy0 * period + ix1];
  const v01 = grid[iy1 * period + ix0];
  const v11 = grid[iy1 * period + ix1];

  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}

function createVoronoiSites(cells: number, seed: number): Float32Array {
  const sites = new Float32Array(cells * cells * 2);
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const idx = (cy * cells + cx) * 2;
      const rx = hashPeriodic2D(cx, cy, cells, seed);
      const ry = hashPeriodic2D(cx, cy, cells, seed + 19.37);
      sites[idx] = cx + 0.16 + 0.68 * rx;
      sites[idx + 1] = cy + 0.16 + 0.68 * ry;
    }
  }
  return sites;
}

function samplePeriodicVoronoiEdge(
  gx: number,
  gy: number,
  cells: number,
  sites: Float32Array,
): number {
  const wrappedX = ((gx % cells) + cells) % cells;
  const wrappedY = ((gy % cells) + cells) % cells;
  const cellX = Math.floor(wrappedX);
  const cellY = Math.floor(wrappedY);

  let d1Sq = 1e9;
  let d2Sq = 1e9;

  for (let oy = -1; oy <= 1; oy++) {
    const rawNy = cellY + oy;
    const ny = ((rawNy % cells) + cells) % cells;
    const shiftY = rawNy - ny;

    for (let ox = -1; ox <= 1; ox++) {
      const rawNx = cellX + ox;
      const nx = ((rawNx % cells) + cells) % cells;
      const shiftX = rawNx - nx;

      const idx = (ny * cells + nx) * 2;
      const dx = sites[idx] + shiftX - wrappedX;
      const dy = sites[idx + 1] + shiftY - wrappedY;
      const dSq = dx * dx + dy * dy;

      if (dSq < d1Sq) {
        d2Sq = d1Sq;
        d1Sq = dSq;
      } else if (dSq < d2Sq) {
        d2Sq = dSq;
      }
    }
  }

  return Math.sqrt(d2Sq) - Math.sqrt(d1Sq);
}

/**
 * Generates a 512x512 seamless periodic RGBA8 fracture map texture once at startup:
 * - R: Macro Voronoi fault edges (10x10 toroidal cells, 255 on crack spine with crisp dropoff)
 * - G: Fine secondary microfissures (24x24 toroidal cells) + branched ridged grooves
 * - B: Periodic volcanic basalt / ash grain noise
 * - A: Smooth periodic noise for low-cost GPU UV domain warping
 */
export function createFractureMapTexture(device: pc.GraphicsDevice, seed = 4092): pc.Texture {
  const size = TEXTURE_SIZE;
  const rgbaBytes = new Uint8Array(size * size * 4);

  const macroSites = createVoronoiSites(MACRO_CELLS, seed + 11);
  const microSites = createVoronoiSites(MICRO_CELLS, seed + 53);

  const warpGrid4 = createPeriodicNoiseGrid(4, seed + 101);
  const warpGrid8 = createPeriodicNoiseGrid(8, seed + 131);
  const warpGrid16 = createPeriodicNoiseGrid(16, seed + 167);
  const warpGrid32 = createPeriodicNoiseGrid(32, seed + 199);

  const basaltGrid16 = createPeriodicNoiseGrid(16, seed + 241);
  const basaltGrid32 = createPeriodicNoiseGrid(32, seed + 283);
  const basaltGrid64 = createPeriodicNoiseGrid(64, seed + 331);
  const basaltGrid128 = createPeriodicNoiseGrid(128, seed + 389);

  const branchGrid24 = createPeriodicNoiseGrid(24, seed + 433);
  const branchGrid48 = createPeriodicNoiseGrid(48, seed + 487);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Smooth periodic domain warp noise (Channel A)
      const w4 = samplePeriodicNoise(u, v, 4, warpGrid4);
      const w8 = samplePeriodicNoise(u, v, 8, warpGrid8);
      const w16 = samplePeriodicNoise(u, v, 16, warpGrid16);
      const smoothWarp = w4 * 0.56 + w8 * 0.3 + w16 * 0.14;

      const jx = (samplePeriodicNoise(u, v, 16, warpGrid16) - 0.5) * 0.34
        + (samplePeriodicNoise(u, v, 32, warpGrid32) - 0.5) * 0.14;
      const jy = (samplePeriodicNoise((u + 0.37) % 1, (v + 0.61) % 1, 16, warpGrid16) - 0.5) * 0.34
        + (samplePeriodicNoise((u + 0.53) % 1, (v + 0.19) % 1, 32, warpGrid32) - 0.5) * 0.14;

      // Channel R: Macro Voronoi periodic fault lines (10x10)
      const macroEdge = samplePeriodicVoronoiEdge(
        u * MACRO_CELLS + jx,
        v * MACRO_CELLS + jy,
        MACRO_CELLS,
        macroSites,
      );
      const macroNorm = Math.max(0, 1 - macroEdge / 0.36);
      const macroCrack = Math.pow(macroNorm, 1.55);

      // Channel G: Micro Voronoi fissures (24x24) + branched periodic grooves
      const microEdge = samplePeriodicVoronoiEdge(
        u * MICRO_CELLS + jx * 0.75,
        v * MICRO_CELLS + jy * 0.75,
        MICRO_CELLS,
        microSites,
      );
      const microNorm = Math.max(0, 1 - microEdge / 0.34);
      const microCrack = Math.pow(microNorm, 1.75);

      const ridgeA = 1 - Math.abs(samplePeriodicNoise(u + jx * 0.04, v + jy * 0.04, 24, branchGrid24) * 2 - 1);
      const ridgeB = 1 - Math.abs(samplePeriodicNoise((u + 0.21) % 1, (v + 0.43) % 1, 48, branchGrid48) * 2 - 1);
      const branchedGroove = Math.pow(Math.max(0, ridgeA * 0.55 + ridgeB * 0.45), 5.0) * 0.85;
      const microCombined = Math.min(1, Math.max(microCrack, branchedGroove));

      // Channel B: Volcanic basalt / ash grain noise
      const b16 = samplePeriodicNoise(u, v, 16, basaltGrid16);
      const b32 = samplePeriodicNoise(u, v, 32, basaltGrid32);
      const b64 = samplePeriodicNoise(u, v, 64, basaltGrid64);
      const b128 = samplePeriodicNoise(u, v, 128, basaltGrid128);
      const basalt = b16 * 0.34 + b32 * 0.3 + b64 * 0.22 + b128 * 0.14;

      const offset = (y * size + x) * 4;
      rgbaBytes[offset] = Math.round(Math.min(1, Math.max(0, macroCrack)) * 255);
      rgbaBytes[offset + 1] = Math.round(Math.min(1, Math.max(0, microCombined)) * 255);
      rgbaBytes[offset + 2] = Math.round(Math.min(1, Math.max(0, basalt)) * 255);
      rgbaBytes[offset + 3] = Math.round(Math.min(1, Math.max(0, smoothWarp)) * 255);
    }
  }

  return new pc.Texture(device, {
    name: 'VolcanicFractureMap',
    width: size,
    height: size,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    anisotropy: 4,
    levels: [rgbaBytes],
  });
}
