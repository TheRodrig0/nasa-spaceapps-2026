import * as pc from 'playcanvas';
import { applyFacetColorJitter, getPlanetVertexColor } from './geology.ts';

export function createTerrainChunkMesh({
  graphicsDevice,
  cx,
  cz,
  detailed,
  isHeadless,
  cellsPerChunk,
  cellsPerSide,
  seed,
  coords,
  heights,
}: {
  graphicsDevice: pc.GraphicsDevice;
  cx: number;
  cz: number;
  detailed: boolean;
  isHeadless: boolean;
  cellsPerChunk: number;
  cellsPerSide: number;
  seed: number;
  coords: Float64Array;
  heights: Float32Array;
}): pc.Mesh {
  const stride = cellsPerSide + 1;
  const step = detailed ? 1 : isHeadless ? 3 : 4;
  const startX = cx * cellsPerChunk;
  const startZ = cz * cellsPerChunk;
  const cells = cellsPerChunk / step;
  const edgeTriangles = detailed ? 0 : 2 * (4 * cells - 4) + 4 * cells * (step - 1);
  const numTris = cells * cells * 2 + edgeTriangles;
  const numVerts = numTris * 3;
  const positions = new Float32Array(numVerts * 3);
  const normals = new Float32Array(numVerts * 3);
  const colors = new Float32Array(numVerts * 4);

  let vPtr = 0;
  let cPtr = 0;

  const emitTri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cxPt: number,
    cy: number,
    czPt: number,
  ): void => {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cxPt - ax;
    const vy = cy - ay;
    const vz = czPt - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const avgY = (ay + by + cy) / 3;
    const avgX = (ax + bx + cxPt) / 3;
    const avgZ = (az + bz + czPt) / 3;
    const baseRgb = getPlanetVertexColor(avgY, ny, seed, avgX, avgZ);
    const [r, g, b] = applyFacetColorJitter(baseRgb, avgX, avgZ);

    const pts = [ax, ay, az, bx, by, bz, cxPt, cy, czPt];
    for (let k = 0; k < 9; k += 3) {
      positions[vPtr] = pts[k];
      positions[vPtr + 1] = pts[k + 1];
      positions[vPtr + 2] = pts[k + 2];
      normals[vPtr] = nx;
      normals[vPtr + 1] = ny;
      normals[vPtr + 2] = nz;
      vPtr += 3;
      colors[cPtr++] = r;
      colors[cPtr++] = g;
      colors[cPtr++] = b;
      colors[cPtr++] = 1.0;
    }
  };

  const emitGridTri = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cxIdx: number,
    czIdx: number,
  ): void => {
    emitTri(
      coords[ax],
      heights[az * stride + ax],
      coords[az],
      coords[bx],
      heights[bz * stride + bx],
      coords[bz],
      coords[cxIdx],
      heights[czIdx * stride + cxIdx],
      coords[czIdx],
    );
  };

  for (let iz = 0; iz < cellsPerChunk; iz += step) {
    const z = startZ + iz;
    const zEnd = z + step;

    for (let ix = 0; ix < cellsPerChunk; ix += step) {
      const x = startX + ix;
      const xEnd = x + step;
      const west = ix === 0;
      const east = ix + step === cellsPerChunk;
      const north = iz === 0;
      const south = iz + step === cellsPerChunk;

      if (!detailed && (west || east || north || south)) {
        const centerX = x + Math.floor(step / 2);
        const centerZ = z + Math.floor(step / 2);
        const fanEdge = (
          ax: number,
          az: number,
          bx: number,
          bz: number,
          split: boolean,
        ): void => {
          const segments = split ? step : 1;
          const dx = (bx - ax) / segments;
          const dz = (bz - az) / segments;
          for (let i = 0; i < segments; i++) {
            emitGridTri(
              centerX,
              centerZ,
              ax + i * dx,
              az + i * dz,
              ax + (i + 1) * dx,
              az + (i + 1) * dz,
            );
          }
        };
        fanEdge(x, z, x, zEnd, west);
        fanEdge(x, zEnd, xEnd, zEnd, south);
        fanEdge(xEnd, zEnd, xEnd, z, east);
        fanEdge(xEnd, z, x, z, north);
      } else if ((x / step + z / step) % 2 === 0) {
        emitGridTri(x, z, x, zEnd, xEnd, z);
        emitGridTri(xEnd, z, x, zEnd, xEnd, zEnd);
      } else {
        emitGridTri(x, z, x, zEnd, xEnd, zEnd);
        emitGridTri(x, z, xEnd, zEnd, xEnd, z);
      }
    }
  }

  const mesh = new pc.Mesh(graphicsDevice);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setColors(colors);
  mesh.update(pc.PRIMITIVE_TRIANGLES);

  return mesh;
}
