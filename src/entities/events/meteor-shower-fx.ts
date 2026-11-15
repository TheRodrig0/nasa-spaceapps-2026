import * as pc from 'playcanvas';
import type {
  EventStepResult,
  EventUpdateContext,
  Vec3XYZ,
  WorldEventHandler,
  WorldEventPhase,
  WorldEventType,
} from '../../types/index.ts';

/**
 * Total pooled meteor impact slots (11-13 meteors per shower).
 */
const POOL_SIZE = 13;
const DEBRIS_PER_IMPACT = 12;
const SPARKS_PER_METEOR = 6;
const CONTRAIL_PUFFS_PER_METEOR = 4;
const PLUME_PUFFS_PER_IMPACT = 5;

type SlotState = 'pending' | 'falling' | 'impacted' | 'done';

interface DebrisChunkState {
  readonly entity: pc.Entity;
  readonly pos: pc.Vec3;
  readonly vel: pc.Vec3;
  readonly rotVel: pc.Vec3;
  baseScale: number;
}

interface PlumePuffState {
  readonly entity: pc.Entity;
  readonly mat: pc.StandardMaterial;
  readonly pos: pc.Vec3;
  readonly vel: pc.Vec3;
  rotZ: number;
  rotSpeed: number;
  baseScale: number;
  maxScale: number;
  delay: number;
  life: number;
  maxLife: number;
}

interface ContrailPuffState {
  readonly entity: pc.Entity;
  readonly mat: pc.StandardMaterial;
  rotZ: number;
}

interface MeteorSlot {
  state: SlotState;
  targetX: number;
  targetY: number;
  targetZ: number;
  startX: number;
  startY: number;
  startZ: number;
  spawnDelay: number;
  fallDuration: number;
  fallElapsed: number;
  impactElapsed: number;
  damageDealt: boolean;
  isWarningCandidate: boolean;

  // Soft ground decal indicator (replaces the hard red ring!)
  readonly groundDecalEntity: pc.Entity;
  readonly groundDecalMat: pc.StandardMaterial;
  readonly groundDecalMesh: pc.Mesh;

  // Meteor Body Rig
  readonly meteorRootEntity: pc.Entity;
  readonly coreEntity: pc.Entity;
  readonly flightLightEntity: pc.Entity;
  readonly flightLight: pc.LightComponent;
  readonly sparks: readonly pc.Entity[];
  readonly contrailPuffs: readonly ContrailPuffState[];

  // Impact Detonation
  readonly flashLightEntity: pc.Entity;
  readonly flashLight: pc.LightComponent;
  readonly flashSphereEntity: pc.Entity;
  readonly flashMat: pc.StandardMaterial;

  readonly shockwaveEntity: pc.Entity;
  readonly shockwaveMat: pc.StandardMaterial;
  readonly shockwaveMesh: pc.Mesh;

  readonly scorchDiscEntity: pc.Entity;
  readonly scorchMat: pc.StandardMaterial;
  readonly scorchMesh: pc.Mesh;

  readonly plumePuffs: readonly PlumePuffState[];

  readonly debrisMat: pc.StandardMaterial;
  readonly debris: readonly DebrisChunkState[];
}

/**
 * Creates a PlayCanvas Texture sourced from an offscreen HTML canvas.
 * Fallback-safe if running in headless/mock test environments.
 */
function createProceduralCanvasTexture(
  device: pc.GraphicsDevice,
  name: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): pc.Texture {
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      draw(ctx, width, height);
    }
  }

  const texture = new pc.Texture(device, {
    name,
    width,
    height,
    format: pc.PIXELFORMAT_RGBA8,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    mipmaps: false,
  });

  if (canvas && device.supportsHtmlTextures) {
    texture.setSource(canvas);
  }
  return texture;
}

/**
 * Procedural Texture 1:
 * Soft ground impact shadow + faint warm ember glow (feathered falloff, zero hard rings).
 */
function createGroundIndicatorTexture(device: pc.GraphicsDevice): pc.Texture {
  return createProceduralCanvasTexture(
    device,
    'MeteorGroundIndicatorTex',
    256,
    256,
    (ctx, width, height) => {
      const cx = width * 0.5;
      const cy = height * 0.5;
      const maxR = width * 0.48;

      ctx.clearRect(0, 0, width, height);

      // Feathered dark atmospheric shadow / ambient occlusion
      const shadowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      shadowGrad.addColorStop(0.0, 'rgba(12, 8, 6, 0.90)');
      shadowGrad.addColorStop(0.30, 'rgba(16, 10, 8, 0.75)');
      shadowGrad.addColorStop(0.60, 'rgba(22, 14, 10, 0.45)');
      shadowGrad.addColorStop(0.85, 'rgba(25, 16, 12, 0.15)');
      shadowGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

      ctx.fillStyle = shadowGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.fill();

      // Soft warm ember core in the center (additive on canvas)
      ctx.globalCompositeOperation = 'lighter';
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.42);
      glowGrad.addColorStop(0.0, 'rgba(255, 140, 30, 0.95)');
      glowGrad.addColorStop(0.25, 'rgba(255, 80, 10, 0.70)');
      glowGrad.addColorStop(0.55, 'rgba(180, 40, 5, 0.35)');
      glowGrad.addColorStop(0.80, 'rgba(100, 20, 0, 0.10)');
      glowGrad.addColorStop(1.0, 'rgba(40, 10, 0, 0.0)');

      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 0.42, 0, Math.PI * 2);
      ctx.fill();

      // Incandescent pinpoint center
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.16);
      coreGrad.addColorStop(0.0, 'rgba(255, 235, 160, 0.95)');
      coreGrad.addColorStop(0.50, 'rgba(255, 160, 40, 0.55)');
      coreGrad.addColorStop(1.0, 'rgba(255, 90, 10, 0.0)');

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 0.16, 0, Math.PI * 2);
      ctx.fill();
    },
  );
}

/**
 * Procedural Texture 2:
 * Soft smoke/dust plume texture (multi-lobed radial noise gradient for billowing dust clouds).
 */
function createSmokePlumeTexture(device: pc.GraphicsDevice): pc.Texture {
  return createProceduralCanvasTexture(
    device,
    'MeteorSmokePlumeTex',
    256,
    256,
    (ctx, width, height) => {
      const cx = width * 0.5;
      const cy = height * 0.5;
      const maxR = width * 0.46;

      ctx.clearRect(0, 0, width, height);

      // Central base density
      const baseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.68);
      baseGrad.addColorStop(0.0, 'rgba(215, 200, 185, 0.88)');
      baseGrad.addColorStop(0.35, 'rgba(185, 170, 155, 0.70)');
      baseGrad.addColorStop(0.70, 'rgba(150, 135, 120, 0.35)');
      baseGrad.addColorStop(1.0, 'rgba(120, 110, 100, 0.0)');
      ctx.fillStyle = baseGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 0.68, 0, Math.PI * 2);
      ctx.fill();

      // Multi-lobed satellite radial puffs for cloud billows
      const lobes = [
        { angle: 0.18, dist: 0.38, r: 0.46, alpha: 0.78 },
        { angle: 0.98, dist: 0.42, r: 0.44, alpha: 0.72 },
        { angle: 1.76, dist: 0.36, r: 0.48, alpha: 0.80 },
        { angle: 2.54, dist: 0.43, r: 0.42, alpha: 0.70 },
        { angle: 3.38, dist: 0.39, r: 0.46, alpha: 0.74 },
        { angle: 4.22, dist: 0.43, r: 0.44, alpha: 0.76 },
        { angle: 4.98, dist: 0.37, r: 0.50, alpha: 0.82 },
        { angle: 5.78, dist: 0.41, r: 0.43, alpha: 0.71 },
      ];

      for (const lobe of lobes) {
        const lx = cx + Math.cos(lobe.angle) * (maxR * lobe.dist);
        const ly = cy + Math.sin(lobe.angle) * (maxR * lobe.dist);
        const lr = maxR * lobe.r;

        const lobeGrad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
        lobeGrad.addColorStop(0.0, `rgba(205, 190, 175, ${lobe.alpha * 0.72})`);
        lobeGrad.addColorStop(0.45, `rgba(170, 155, 140, ${lobe.alpha * 0.45})`);
        lobeGrad.addColorStop(0.80, `rgba(135, 120, 110, ${lobe.alpha * 0.18})`);
        lobeGrad.addColorStop(1.0, 'rgba(100, 90, 80, 0.0)');

        ctx.fillStyle = lobeGrad;
        ctx.beginPath();
        ctx.arc(lx, ly, lr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fine secondary micro-lobes for fluffy cloud texture
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2 + 0.22;
        const dist = maxR * (0.46 + 0.18 * Math.sin(i * 3.7));
        const lr = maxR * (0.28 + 0.10 * Math.cos(i * 4.9));
        const lx = cx + Math.cos(angle) * dist;
        const ly = cy + Math.sin(angle) * dist;

        const microGrad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
        microGrad.addColorStop(0.0, 'rgba(195, 180, 165, 0.48)');
        microGrad.addColorStop(0.6, 'rgba(150, 135, 125, 0.22)');
        microGrad.addColorStop(1.0, 'rgba(110, 100, 90, 0.0)');

        ctx.fillStyle = microGrad;
        ctx.beginPath();
        ctx.arc(lx, ly, lr, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  );
}

/**
 * Procedural Texture 3:
 * Soft radial scorch mark (feathered dark-charred ash + faint cooling ember core).
 */
function createScorchMarkTexture(device: pc.GraphicsDevice): pc.Texture {
  return createProceduralCanvasTexture(
    device,
    'MeteorScorchMarkTex',
    256,
    256,
    (ctx, width, height) => {
      const cx = width * 0.5;
      const cy = height * 0.5;
      const maxR = width * 0.48;

      ctx.clearRect(0, 0, width, height);

      // Base charred dark ash with soft feathered falloff
      const ashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      ashGrad.addColorStop(0.0, 'rgba(14, 10, 8, 0.96)');
      ashGrad.addColorStop(0.35, 'rgba(18, 12, 10, 0.90)');
      ashGrad.addColorStop(0.65, 'rgba(24, 16, 12, 0.70)');
      ashGrad.addColorStop(0.85, 'rgba(28, 18, 14, 0.35)');
      ashGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

      ctx.fillStyle = ashGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.fill();

      // Irregular radiating blast spokes / ash splatters
      ctx.fillStyle = 'rgba(16, 12, 10, 0.48)';
      for (let i = 0; i < 30; i++) {
        const angle = (i / 30) * Math.PI * 2 + Math.sin(i * 5.3) * 0.12;
        const length = maxR * (0.65 + 0.32 * Math.abs(Math.sin(i * 3.7 + 1.1)));
        const spread = 0.08 + 0.04 * Math.cos(i * 2.1);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, length, angle - spread, angle + spread);
        ctx.closePath();
        ctx.fill();
      }

      // Burnt charcoal crust
      const crustGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.55);
      crustGrad.addColorStop(0.0, 'rgba(22, 12, 8, 0.95)');
      crustGrad.addColorStop(0.5, 'rgba(40, 18, 10, 0.85)');
      crustGrad.addColorStop(0.8, 'rgba(25, 12, 8, 0.50)');
      crustGrad.addColorStop(1.0, 'rgba(15, 8, 5, 0.0)');
      ctx.fillStyle = crustGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 0.55, 0, Math.PI * 2);
      ctx.fill();

      // Radiant molten ember core in center
      ctx.globalCompositeOperation = 'lighter';
      const emberGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.32);
      emberGrad.addColorStop(0.0, 'rgba(255, 140, 30, 0.98)');
      emberGrad.addColorStop(0.35, 'rgba(230, 70, 10, 0.80)');
      emberGrad.addColorStop(0.70, 'rgba(160, 35, 5, 0.40)');
      emberGrad.addColorStop(1.0, 'rgba(80, 15, 0, 0.0)');

      ctx.fillStyle = emberGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 0.32, 0, Math.PI * 2);
      ctx.fill();

      // Hot center pinpoint
      const hotCore = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.12);
      hotCore.addColorStop(0.0, 'rgba(255, 235, 170, 0.95)');
      hotCore.addColorStop(0.5, 'rgba(255, 160, 40, 0.60)');
      hotCore.addColorStop(1.0, 'rgba(255, 100, 10, 0.0)');
      ctx.fillStyle = hotCore;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 0.12, 0, Math.PI * 2);
      ctx.fill();
    },
  );
}

/**
 * Procedural Texture 4:
 * Soft shockwave pressure haze ring.
 */
function createShockwaveTexture(device: pc.GraphicsDevice): pc.Texture {
  return createProceduralCanvasTexture(
    device,
    'MeteorShockwaveTex',
    128,
    128,
    (ctx, width, height) => {
      const cx = width * 0.5;
      const cy = height * 0.5;
      const maxR = width * 0.48;

      ctx.clearRect(0, 0, width, height);

      const grad = ctx.createRadialGradient(cx, cy, maxR * 0.55, cx, cy, maxR);
      grad.addColorStop(0.0, 'rgba(255, 180, 80, 0.0)');
      grad.addColorStop(0.35, 'rgba(255, 200, 120, 0.85)');
      grad.addColorStop(0.65, 'rgba(255, 140, 40, 0.95)');
      grad.addColorStop(1.0, 'rgba(200, 60, 10, 0.0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.fill();
    },
  );
}

/**
 * Precomputed concentric ring template for terrain-conforming decals.
 * 6 concentric rings x 16 sectors provides 97 vertices for smooth terrain curvature.
 */
const CONFORM_RINGS = 6;
const CONFORM_SECTORS = 16;
const CONFORM_VERT_COUNT = 1 + CONFORM_RINGS * CONFORM_SECTORS; // 97 vertices

const CONFORM_UNIT_XZ = new Float32Array(CONFORM_VERT_COUNT * 2);
const CONFORM_UVS = new Float32Array(CONFORM_VERT_COUNT * 2);
const CONFORM_INDICES = new Uint16Array(
  CONFORM_SECTORS * 3 + (CONFORM_RINGS - 1) * CONFORM_SECTORS * 6,
);

(function initConformTemplate() {
  // Center vertex
  CONFORM_UNIT_XZ[0] = 0;
  CONFORM_UNIT_XZ[1] = 0;
  CONFORM_UVS[0] = 0.5;
  CONFORM_UVS[1] = 0.5;

  let vIdx = 1;
  for (let r = 1; r <= CONFORM_RINGS; r++) {
    const frac = r / CONFORM_RINGS;
    for (let s = 0; s < CONFORM_SECTORS; s++) {
      const theta = (s / CONFORM_SECTORS) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const ux = cosT * frac;
      const uz = sinT * frac;

      CONFORM_UNIT_XZ[vIdx * 2] = ux;
      CONFORM_UNIT_XZ[vIdx * 2 + 1] = uz;
      CONFORM_UVS[vIdx * 2] = 0.5 + 0.5 * ux;
      CONFORM_UVS[vIdx * 2 + 1] = 0.5 + 0.5 * uz;
      vIdx++;
    }
  }

  // Indices: ring 1 (center fan)
  let iIdx = 0;
  for (let s = 0; s < CONFORM_SECTORS; s++) {
    const nextS = (s + 1) % CONFORM_SECTORS;
    CONFORM_INDICES[iIdx++] = 0;
    CONFORM_INDICES[iIdx++] = 1 + s;
    CONFORM_INDICES[iIdx++] = 1 + nextS;
  }

  // Indices: outer rings (quad strips)
  for (let r = 1; r < CONFORM_RINGS; r++) {
    const rBase = 1 + (r - 1) * CONFORM_SECTORS;
    const rNextBase = 1 + r * CONFORM_SECTORS;
    for (let s = 0; s < CONFORM_SECTORS; s++) {
      const nextS = (s + 1) % CONFORM_SECTORS;
      const a = rBase + s;
      const b = rBase + nextS;
      const c = rNextBase + s;
      const d = rNextBase + nextS;
      CONFORM_INDICES[iIdx++] = a;
      CONFORM_INDICES[iIdx++] = c;
      CONFORM_INDICES[iIdx++] = b;
      CONFORM_INDICES[iIdx++] = b;
      CONFORM_INDICES[iIdx++] = c;
      CONFORM_INDICES[iIdx++] = d;
    }
  }
})();

interface ConformedMesh extends pc.Mesh {
  _dynamicPositions?: Float32Array;
}

/**
 * Creates a subdivided circular mesh on the XZ plane designed for dynamic terrain conforming.
 */
function createTerrainConformingMesh(device: pc.GraphicsDevice): pc.Mesh {
  const mesh = new pc.Mesh(device) as ConformedMesh;
  const positions = new Float32Array(CONFORM_VERT_COUNT * 3);
  const normals = new Float32Array(CONFORM_VERT_COUNT * 3);
  const uvs = new Float32Array(CONFORM_VERT_COUNT * 2);

  for (let i = 0; i < CONFORM_VERT_COUNT; i++) {
    positions[i * 3] = CONFORM_UNIT_XZ[i * 2];
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = CONFORM_UNIT_XZ[i * 2 + 1];

    normals[i * 3] = 0;
    normals[i * 3 + 1] = 1;
    normals[i * 3 + 2] = 0;

    uvs[i * 2] = CONFORM_UVS[i * 2];
    uvs[i * 2 + 1] = CONFORM_UVS[i * 2 + 1];
  }

  mesh._dynamicPositions = positions;
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  mesh.setUvs(0, uvs);
  mesh.setIndices(CONFORM_INDICES);
  mesh.update(pc.PRIMITIVE_TRIANGLES, true);
  return mesh;
}

/**
 * Conforms a subdivided decal mesh to the 3D terrain height profile.
 * - Computes each vertex's world (wx, wz) = (centerX + localX * worldRadius, centerZ + localZ * worldRadius).
 * - Sets vertex y = sampleHeight(wx, wz) - baseGroundY + yOffset (relative to entity at (centerX, baseGroundY, centerZ)).
 * - Leaves entity scale at (1, 1, 1) since mesh vertices embody worldRadius.
 * - Flushes updated vertex positions and recalculates bounding box AABB.
 */
function conformGroundMeshToTerrain(
  mesh: pc.Mesh,
  centerX: number,
  centerZ: number,
  worldRadius: number,
  yOffset: number,
  sampleHeight: (x: number, z: number) => number,
  baseGroundY?: number,
): void {
  const dynamicMesh = mesh as ConformedMesh;
  const positions = dynamicMesh._dynamicPositions ?? new Float32Array(CONFORM_VERT_COUNT * 3);
  dynamicMesh._dynamicPositions = positions;

  const groundY = baseGroundY !== undefined ? baseGroundY : sampleHeight(centerX, centerZ);

  for (let i = 0; i < CONFORM_VERT_COUNT; i++) {
    const unitX = CONFORM_UNIT_XZ[i * 2];
    const unitZ = CONFORM_UNIT_XZ[i * 2 + 1];

    const localX = unitX * worldRadius;
    const localZ = unitZ * worldRadius;
    const wx = centerX + localX;
    const wz = centerZ + localZ;
    const wy = sampleHeight(wx, wz);

    positions[i * 3] = localX;
    positions[i * 3 + 1] = wy - groundY + yOffset;
    positions[i * 3 + 2] = localZ;
  }

  mesh.setPositions(positions, 3);
  mesh.update(pc.PRIMITIVE_TRIANGLES, true);
  if (mesh.vertexBuffer && typeof mesh.vertexBuffer.unlock === 'function') {
    mesh.vertexBuffer.unlock();
  }
}

/**
 * Generates a camera-facing quad billboard mesh on the XY plane with UVs.
 */
function createQuadMesh(device: pc.GraphicsDevice, size = 1.0): pc.Mesh {
  const h = size * 0.5;
  const positions = new Float32Array([
    -h, -h, 0,
     h, -h, 0,
     h,  h, 0,
    -h,  h, 0,
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2,
    0, 2, 3,
  ]);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * Generates an incandescent, jagged craggy rock mesh for the meteor core.
 */
function createCraggyRockMesh(
  device: pc.GraphicsDevice,
  radius = 1.0,
  latBands = 10,
  lonBands = 14,
): pc.Mesh {
  const totalVerts = (latBands + 1) * (lonBands + 1);
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 4);
  const indices = new Uint16Array(latBands * lonBands * 6);

  let vIdx = 0;
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const nx = sinTheta * cosPhi;
      const ny = cosTheta;
      const nz = sinTheta * sinPhi;

      const noise =
        Math.sin(nx * 4.8 + lon * 0.6) * 0.22 +
        Math.cos(ny * 5.4 + lat * 0.7) * 0.18 +
        Math.sin(nz * 4.2) * 0.14;
      const r = radius * (1.0 + noise);

      const pPtr = vIdx * 3;
      positions[pPtr] = nx * r;
      positions[pPtr + 1] = ny * r;
      positions[pPtr + 2] = nz * r;

      normals[pPtr] = nx;
      normals[pPtr + 1] = ny;
      normals[pPtr + 2] = nz;

      const cPtr = vIdx * 4;
      const heat = Math.max(0, -noise * 2.2);
      colors[cPtr] = 0.25 + 0.75 * heat;
      colors[cPtr + 1] = 0.1 + 0.45 * heat;
      colors[cPtr + 2] = 0.04;
      colors[cPtr + 3] = 1.0;

      vIdx++;
    }
  }

  let iPtr = 0;
  const cols = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * cols + lon;
      const b = (lat + 1) * cols + lon;
      const c = a + 1;
      const d = b + 1;

      indices[iPtr++] = a;
      indices[iPtr++] = b;
      indices[iPtr++] = c;
      indices[iPtr++] = c;
      indices[iPtr++] = b;
      indices[iPtr++] = d;
    }
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  mesh.setColors(colors, 4);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * Generates an 8-faced jagged rock octahedron mesh for ejected debris chunks.
 */
function createDebrisMesh(device: pc.GraphicsDevice): pc.Mesh {
  const positions = new Float32Array([
    0.0, 0.8, 0.0, // 0 top
    0.6, 0.1, 0.4, // 1 front-right
    -0.5, 0.0, 0.5, // 2 front-left
    -0.6, -0.1, -0.4, // 3 back-left
    0.5, 0.0, -0.5, // 4 back-right
    0.0, -0.7, 0.0, // 5 bottom
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4,
  ]);
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;
    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    for (const idx of [i0, i1, i2]) {
      normals[idx] += nx;
      normals[idx + 1] += ny;
      normals[idx + 2] += nz;
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

function createDecalMaterial(
  texture: pc.Texture,
  blendType: number,
  emissiveIntensity = 0.0,
): pc.StandardMaterial {
  const mat = new pc.StandardMaterial();
  mat.diffuseMap = texture;
  mat.opacityMap = texture;
  mat.opacityMapChannel = 'a';
  mat.diffuse = new pc.Color(1, 1, 1);
  if (emissiveIntensity > 0) {
    mat.emissiveMap = texture;
    mat.emissive = new pc.Color(1, 1, 1);
    mat.emissiveIntensity = emissiveIntensity;
  }
  mat.useLighting = false;
  mat.blendType = blendType;
  mat.depthWrite = false;
  mat.cull = pc.CULLFACE_NONE;
  mat.opacity = 1.0;
  mat.update();
  return mat;
}

function createGlowMaterial(
  rgb: readonly [number, number, number],
  emissiveIntensity: number,
  blendType: number,
  opacity = 1.0,
): pc.StandardMaterial {
  const mat = new pc.StandardMaterial();
  const color = new pc.Color(rgb[0], rgb[1], rgb[2]).linear();
  mat.diffuse = color;
  mat.emissive = color;
  mat.emissiveIntensity = emissiveIntensity;
  mat.useLighting = false;
  mat.blendType = blendType;
  mat.depthWrite = blendType === pc.BLEND_NONE;
  mat.cull = pc.CULLFACE_NONE;
  mat.opacity = opacity;
  mat.update();
  return mat;
}

/**
 * MeteorShowerFx: High-craft, performant 3D VFX event handler for meteor showers.
 *
 * Implements WorldEventHandler lifecycle:
 * - Warning phase: Soft ground atmospheric shadows with faint pulsing ember cores at first impact sites (no red wheel!).
 * - Active phase: Staggered descending meteors with molten craggy rock core, fiery plasma coma halo,
 *   tapered additive ion tail & plasma sheath, trailing turbulent ember sparks & smoke contrail puffs,
 *   tightening ground impact shadow decal, transient flash light + expanding fireball sphere,
 *   soft feathered shockwave ring expanding to 55 units, rising billowing vertical dust plume (5 puffs),
 *   12 ballistic glowing debris chunks bouncing on terrain, and 6s fading scorched blast decal.
 * - Zero leaks: Rigorous cleanup and mesh/material/texture disposal.
 */
export class MeteorShowerFx implements WorldEventHandler {
  public readonly type: WorldEventType = 'meteor_shower';
  public readonly label = 'Chuva de Meteoros';
  public readonly warningDurationSec = 4;
  public readonly activeDurationSec = 14;

  public readonly app: pc.AppBase;
  public readonly entity: pc.Entity;

  // Shared procedural meshes
  private readonly quadMesh: pc.Mesh;
  private readonly rockMesh: pc.Mesh;
  private readonly debrisMesh: pc.Mesh;

  // Procedural canvas textures
  private readonly groundIndicatorTex: pc.Texture;
  private readonly smokePlumeTex: pc.Texture;
  private readonly scorchMarkTex: pc.Texture;
  private readonly shockwaveTex: pc.Texture;

  // Shared flight materials
  private readonly sharedMeteorCoreMat: pc.StandardMaterial;
  private readonly sharedInnerCoreMat: pc.StandardMaterial;
  private readonly sharedComaMat: pc.StandardMaterial;
  private readonly sharedOuterTrailMat: pc.StandardMaterial;
  private readonly sharedInnerTrailMat: pc.StandardMaterial;
  private readonly sharedSparkMat: pc.StandardMaterial;

  // Pooled slots
  private readonly slots: MeteorSlot[] = [];
  private activeCount = 12;
  private targetsInitialized = false;

  // Shake accumulator
  private shakeEnergy = 0;

  constructor(app?: pc.AppBase) {
    const activeApp = app ?? (pc.AppBase.getApplication() as pc.AppBase | undefined);
    if (!activeApp) {
      throw new Error('MeteorShowerFx requires an active PlayCanvas AppBase instance');
    }
    this.app = activeApp;
    const device = activeApp.graphicsDevice;

    this.entity = new pc.Entity('MeteorShowerRoot', activeApp);
    if (activeApp.root && !this.entity.parent) {
      activeApp.root.addChild(this.entity);
    }

    // 1. Procedural meshes
    this.quadMesh = createQuadMesh(device, 1.0);
    this.rockMesh = createCraggyRockMesh(device, 3.8, 10, 14);
    this.debrisMesh = createDebrisMesh(device);

    // 2. Procedural canvas textures
    this.groundIndicatorTex = createGroundIndicatorTexture(device);
    this.smokePlumeTex = createSmokePlumeTexture(device);
    this.scorchMarkTex = createScorchMarkTexture(device);
    this.shockwaveTex = createShockwaveTexture(device);

    // 3. Shared flight materials
    this.sharedMeteorCoreMat = new pc.StandardMaterial();
    this.sharedMeteorCoreMat.diffuse = new pc.Color(0.28, 0.18, 0.12).linear();
    this.sharedMeteorCoreMat.diffuseVertexColor = true;
    this.sharedMeteorCoreMat.emissive = new pc.Color(1.0, 0.46, 0.10).linear();
    this.sharedMeteorCoreMat.emissiveVertexColor = true;
    this.sharedMeteorCoreMat.emissiveIntensity = 4.8;
    this.sharedMeteorCoreMat.shininess = 14;
    this.sharedMeteorCoreMat.update();

    this.sharedInnerCoreMat = createGlowMaterial([1.0, 0.96, 0.82], 14.0, pc.BLEND_ADDITIVE, 1.0);
    this.sharedComaMat = createGlowMaterial([1.0, 0.72, 0.28], 11.0, pc.BLEND_ADDITIVE, 0.95);
    this.sharedOuterTrailMat = createGlowMaterial([1.0, 0.36, 0.05], 6.5, pc.BLEND_ADDITIVE, 0.85);
    this.sharedInnerTrailMat = createGlowMaterial([1.0, 0.90, 0.45], 9.5, pc.BLEND_ADDITIVE, 0.95);
    this.sharedSparkMat = createGlowMaterial([1.0, 0.72, 0.22], 7.5, pc.BLEND_ADDITIVE, 0.9);

    // 4. Initialize pooled slots
    for (let i = 0; i < POOL_SIZE; i++) {
      // Soft Ground Impact Shadow + Ember Decal (replaces hard red ring!)
      const groundDecalMesh = createTerrainConformingMesh(device);
      const groundDecalMat = createDecalMaterial(this.groundIndicatorTex, pc.BLEND_NORMAL, 2.0);
      const groundDecalEntity = new pc.Entity(`GroundDecal_${i}`, activeApp);
      groundDecalEntity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(groundDecalMesh, groundDecalMat)],
        castShadows: false,
        receiveShadows: false,
      });
      groundDecalEntity.enabled = false;
      this.entity.addChild(groundDecalEntity);

      // Meteor Body Rig
      const meteorRootEntity = new pc.Entity(`MeteorRig_${i}`, activeApp);

      const coreEntity = new pc.Entity('MeteorCore', activeApp);
      coreEntity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(this.rockMesh, this.sharedMeteorCoreMat)],
        castShadows: false,
        receiveShadows: false,
      });
      meteorRootEntity.addChild(coreEntity);

      const innerCoreEntity = new pc.Entity('InnerCore', activeApp);
      innerCoreEntity.addComponent('render', {
        type: 'sphere',
        material: this.sharedInnerCoreMat,
        castShadows: false,
        receiveShadows: false,
      });
      innerCoreEntity.setLocalScale(2.6, 2.6, 2.6);
      meteorRootEntity.addChild(innerCoreEntity);

      const comaEntity = new pc.Entity('PlasmaComa', activeApp);
      comaEntity.addComponent('render', {
        type: 'sphere',
        material: this.sharedComaMat,
        castShadows: false,
        receiveShadows: false,
      });
      comaEntity.setLocalScale(5.4, 5.4, 5.4);
      meteorRootEntity.addChild(comaEntity);

      const outerTrail = new pc.Entity('OuterTrail', activeApp);
      outerTrail.addComponent('render', {
        type: 'cone',
        material: this.sharedOuterTrailMat,
        castShadows: false,
        receiveShadows: false,
      });
      outerTrail.setLocalEulerAngles(90, 0, 0);
      outerTrail.setLocalPosition(0, 0, 24.0);
      outerTrail.setLocalScale(5.8, 48.0, 5.8);
      meteorRootEntity.addChild(outerTrail);

      const innerTrail = new pc.Entity('InnerTrail', activeApp);
      innerTrail.addComponent('render', {
        type: 'cone',
        material: this.sharedInnerTrailMat,
        castShadows: false,
        receiveShadows: false,
      });
      innerTrail.setLocalEulerAngles(90, 0, 0);
      innerTrail.setLocalPosition(0, 0, 14.0);
      innerTrail.setLocalScale(3.0, 28.0, 3.0);
      meteorRootEntity.addChild(innerTrail);

      // Flight light
      const flightLightEntity = new pc.Entity('FlightLight', activeApp);
      flightLightEntity.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1.0, 0.65, 0.28).linear(),
        intensity: 14,
        range: 95,
        castShadows: false,
      });
      flightLightEntity.enabled = false;
      meteorRootEntity.addChild(flightLightEntity);

      // Trailing sparks
      const sparksList: pc.Entity[] = [];
      for (let s = 0; s < SPARKS_PER_METEOR; s++) {
        const spk = new pc.Entity(`Spark_${i}_${s}`, activeApp);
        spk.addComponent('render', {
          type: 'sphere',
          material: this.sharedSparkMat,
          castShadows: false,
          receiveShadows: false,
        });
        spk.setLocalScale(1.4, 1.4, 1.4);
        this.entity.addChild(spk);
        sparksList.push(spk);
      }

      // Trailing contrail smoke puffs
      const contrailPuffs: ContrailPuffState[] = [];
      for (let p = 0; p < CONTRAIL_PUFFS_PER_METEOR; p++) {
        const pMat = createDecalMaterial(this.smokePlumeTex, pc.BLEND_NORMAL, 0.4);
        const pEnt = new pc.Entity(`ContrailPuff_${i}_${p}`, activeApp);
        pEnt.addComponent('render', {
          meshInstances: [new pc.MeshInstance(this.quadMesh, pMat)],
          castShadows: false,
          receiveShadows: false,
        });
        pEnt.enabled = false;
        this.entity.addChild(pEnt);
        contrailPuffs.push({
          entity: pEnt,
          mat: pMat,
          rotZ: Math.random() * Math.PI * 2,
        });
      }

      meteorRootEntity.enabled = false;
      this.entity.addChild(meteorRootEntity);

      // Transient Impact Flash Light & Fireball Sphere
      const flashLightEntity = new pc.Entity(`ImpactFlashLight_${i}`, activeApp);
      flashLightEntity.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1.0, 0.94, 0.78).linear(),
        intensity: 0,
        range: 145,
        castShadows: false,
      });
      flashLightEntity.enabled = false;
      this.entity.addChild(flashLightEntity);

      const flashMat = createGlowMaterial([1.0, 0.96, 0.82], 14.0, pc.BLEND_ADDITIVE, 1.0);
      const flashSphereEntity = new pc.Entity(`FlashSphere_${i}`, activeApp);
      flashSphereEntity.addComponent('render', {
        type: 'sphere',
        material: flashMat,
        castShadows: false,
        receiveShadows: false,
      });
      flashSphereEntity.enabled = false;
      this.entity.addChild(flashSphereEntity);

      // Expanding Shockwave (soft feathered ring expanding to 55 units)
      const shockwaveMesh = createTerrainConformingMesh(device);
      const shockwaveMat = createDecalMaterial(this.shockwaveTex, pc.BLEND_ADDITIVE, 10.0);
      const shockwaveEntity = new pc.Entity(`Shockwave_${i}`, activeApp);
      shockwaveEntity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(shockwaveMesh, shockwaveMat)],
        castShadows: false,
        receiveShadows: false,
      });
      shockwaveEntity.enabled = false;
      this.entity.addChild(shockwaveEntity);

      // Ground Scorch Decal Disc (charred ash + glowing cooling ember core)
      const scorchMesh = createTerrainConformingMesh(device);
      const scorchMat = createDecalMaterial(this.scorchMarkTex, pc.BLEND_NORMAL, 3.6);
      const scorchDiscEntity = new pc.Entity(`ScorchDisc_${i}`, activeApp);
      scorchDiscEntity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(scorchMesh, scorchMat)],
        castShadows: false,
        receiveShadows: false,
      });
      scorchDiscEntity.enabled = false;
      this.entity.addChild(scorchDiscEntity);

      // Rising Vertical Dust/Smoke Plume Puffs
      const plumePuffs: PlumePuffState[] = [];
      for (let p = 0; p < PLUME_PUFFS_PER_IMPACT; p++) {
        const puffMat = createDecalMaterial(this.smokePlumeTex, pc.BLEND_NORMAL, 0.4);
        const puffEnt = new pc.Entity(`PlumePuff_${i}_${p}`, activeApp);
        puffEnt.addComponent('render', {
          meshInstances: [new pc.MeshInstance(this.quadMesh, puffMat)],
          castShadows: false,
          receiveShadows: false,
        });
        puffEnt.enabled = false;
        this.entity.addChild(puffEnt);

        plumePuffs.push({
          entity: puffEnt,
          mat: puffMat,
          pos: new pc.Vec3(),
          vel: new pc.Vec3(),
          rotZ: 0,
          rotSpeed: 0,
          baseScale: 4.0,
          maxScale: 20.0,
          delay: 0,
          life: 0,
          maxLife: 3.5,
        });
      }

      // Ejected Debris Chunks (12 ballistic fragments)
      const debrisMat = new pc.StandardMaterial();
      debrisMat.diffuse = new pc.Color(0.14, 0.09, 0.06).linear();
      debrisMat.emissive = new pc.Color(1.0, 0.44, 0.09).linear();
      debrisMat.emissiveIntensity = 4.8;
      debrisMat.shininess = 12;
      debrisMat.blendType = pc.BLEND_NORMAL;
      debrisMat.depthWrite = true;
      debrisMat.cull = pc.CULLFACE_BACK;
      debrisMat.opacity = 1.0;
      debrisMat.update();

      const debrisChunks: DebrisChunkState[] = [];
      for (let d = 0; d < DEBRIS_PER_IMPACT; d++) {
        const debEnt = new pc.Entity(`Debris_${i}_${d}`, activeApp);
        debEnt.addComponent('render', {
          meshInstances: [new pc.MeshInstance(this.debrisMesh, debrisMat)],
          castShadows: false,
          receiveShadows: false,
        });
        debEnt.enabled = false;
        this.entity.addChild(debEnt);

        debrisChunks.push({
          entity: debEnt,
          pos: new pc.Vec3(),
          vel: new pc.Vec3(),
          rotVel: new pc.Vec3(),
          baseScale: 1.5,
        });
      }

      this.slots.push({
        state: 'pending',
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        startX: 0,
        startY: 0,
        startZ: 0,
        spawnDelay: 0,
        fallDuration: 1.6,
        fallElapsed: 0,
        impactElapsed: 0,
        damageDealt: false,
        isWarningCandidate: i < 3,
        groundDecalEntity,
        groundDecalMat,
        groundDecalMesh,
        meteorRootEntity,
        coreEntity,
        flightLightEntity,
        flightLight: flightLightEntity.light!,
        sparks: sparksList,
        contrailPuffs,
        flashLightEntity,
        flashLight: flashLightEntity.light!,
        flashSphereEntity,
        flashMat,
        shockwaveEntity,
        shockwaveMat,
        shockwaveMesh,
        scorchDiscEntity,
        scorchMat,
        scorchMesh,
        plumePuffs,
        debrisMat,
        debris: debrisChunks,
      });
    }
  }

  public startWarning(ctx: EventUpdateContext): void {
    this.stop();
    this.selectTargets(ctx);
    this.targetsInitialized = true;

    // Activate soft atmospheric shadow decals with gentle warm ember glow at candidate impact sites
    for (let i = 0; i < Math.min(3, this.activeCount); i++) {
      const slot = this.slots[i];
      slot.groundDecalEntity.setPosition(slot.targetX, slot.targetY, slot.targetZ);
      slot.groundDecalEntity.setLocalScale(1.0, 1.0, 1.0);
      conformGroundMeshToTerrain(
        slot.groundDecalMesh,
        slot.targetX,
        slot.targetZ,
        22.0,
        0.08,
        ctx.sampleHeight,
        slot.targetY,
      );
      slot.groundDecalMat.opacity = 0.45;
      slot.groundDecalMat.emissiveIntensity = 1.4;
      slot.groundDecalEntity.enabled = true;
    }
  }

  public startActive(ctx: EventUpdateContext): void {
    // If warning phase was skipped, ensure targets are initialized
    if (!this.targetsInitialized) {
      this.stop();
      this.selectTargets(ctx);
      this.targetsInitialized = true;
    }
  }

  public update(
    dt: number,
    phase: Exclude<WorldEventPhase, 'cooldown'>,
    phaseElapsed: number,
    ctx: EventUpdateContext,
  ): Omit<EventStepResult, 'activeEvent'> {
    let damageThisFrame = 0;

    // Camera lookup for billboard orientation
    const cameraEntity =
      (this.app.root.findComponent('camera') as pc.CameraComponent | null)?.entity ??
      this.app.root.findByName('Camera') ??
      null;
    const camPos = cameraEntity ? cameraEntity.getPosition() : null;

    if (phase === 'warning') {
      // Gentle atmospheric pulsing of ground indicator shadows (no red wheel!)
      const pulse = 0.40 + 0.20 * Math.sin(phaseElapsed * 4.6);
      for (let i = 0; i < Math.min(3, this.activeCount); i++) {
        const slot = this.slots[i];
        if (slot.groundDecalEntity.enabled) {
          slot.groundDecalEntity.setLocalScale(1.0, 1.0, 1.0);
          slot.groundDecalMat.opacity = pulse;
          slot.groundDecalMat.emissiveIntensity = 1.2 + pulse * 2.0;
        }
      }

      // Subtle seismic tremor anticipation near warning completion
      const preRumble = (phaseElapsed / this.warningDurationSec) * 0.22;
      this.shakeEnergy = Math.max(this.shakeEnergy, preRumble);
      this.shakeEnergy *= Math.exp(-dt * 4.0);

      return {
        damageThisFrame: 0,
        productionMultiplier: 1.0,
        shakeOffset: this.getShakeOffset(phaseElapsed),
      };
    }

    // Active phase: Staggered falling meteors
    for (let i = 0; i < this.activeCount; i++) {
      const slot = this.slots[i];

      if (slot.state === 'pending') {
        // Soft ground decal appears ~2.2s before spawn for player telegraph
        if (slot.spawnDelay - phaseElapsed <= 2.2 && !slot.groundDecalEntity.enabled) {
          slot.groundDecalEntity.setPosition(slot.targetX, slot.targetY, slot.targetZ);
          slot.groundDecalEntity.setLocalScale(1.0, 1.0, 1.0);
          conformGroundMeshToTerrain(
            slot.groundDecalMesh,
            slot.targetX,
            slot.targetZ,
            22.0,
            0.08,
            ctx.sampleHeight,
            slot.targetY,
          );
          slot.groundDecalEntity.enabled = true;
        }

        if (slot.groundDecalEntity.enabled) {
          const pulse = 0.42 + 0.22 * Math.sin(phaseElapsed * 5.5 + i);
          slot.groundDecalMat.opacity = pulse;
          slot.groundDecalMat.emissiveIntensity = 1.4 + pulse * 2.2;
        }

        if (phaseElapsed >= slot.spawnDelay) {
          slot.state = 'falling';
          slot.fallElapsed = phaseElapsed - slot.spawnDelay;
          slot.meteorRootEntity.setPosition(slot.startX, slot.startY, slot.startZ);
          slot.meteorRootEntity.enabled = true;
          slot.flightLightEntity.enabled = true;
          if (!slot.groundDecalEntity.enabled) {
            slot.groundDecalEntity.setPosition(slot.targetX, slot.targetY, slot.targetZ);
            slot.groundDecalEntity.setLocalScale(1.0, 1.0, 1.0);
            conformGroundMeshToTerrain(
              slot.groundDecalMesh,
              slot.targetX,
              slot.targetZ,
              22.0,
              0.08,
              ctx.sampleHeight,
              slot.targetY,
            );
            slot.groundDecalEntity.enabled = true;
          }
        }
      }

      if (slot.state === 'falling') {
        slot.fallElapsed += dt;
        const progress = Math.min(1.0, slot.fallElapsed / slot.fallDuration);
        const accel = Math.pow(progress, 1.25);

        const curX = slot.startX + (slot.targetX - slot.startX) * accel;
        const curY = slot.startY + (slot.targetY - slot.startY) * accel;
        const curZ = slot.startZ + (slot.targetZ - slot.startZ) * accel;

        slot.meteorRootEntity.setPosition(curX, curY, curZ);
        slot.meteorRootEntity.lookAt(slot.targetX, slot.targetY, slot.targetZ);

        // Craggy basalt rock core tumbles inside plasma coma
        slot.coreEntity.rotateLocal(115 * dt, 75 * dt, 95 * dt);

        // Ground decal softly tightens and intensifies as meteor plunges closer
        const decalRadius = Math.max(5.5, 22.0 * (1.0 - progress * 0.75));
        conformGroundMeshToTerrain(
          slot.groundDecalMesh,
          slot.targetX,
          slot.targetZ,
          decalRadius,
          0.08,
          ctx.sampleHeight,
          slot.targetY,
        );
        slot.groundDecalEntity.setLocalScale(1.0, 1.0, 1.0);
        const fastPulse = 0.65 + 0.35 * Math.sin(phaseElapsed * (8.0 + progress * 24.0));
        slot.groundDecalMat.opacity = Math.min(1.0, 0.50 + progress * 0.45);
        slot.groundDecalMat.emissiveIntensity = 2.0 + progress * 5.5 + fastPulse * 1.5;

        // Trajectory direction unit vector
        const fwdX = slot.targetX - slot.startX;
        const fwdY = slot.targetY - slot.startY;
        const fwdZ = slot.targetZ - slot.startZ;
        const fwdLen = Math.hypot(fwdX, fwdY, fwdZ) || 1;
        const nx = fwdX / fwdLen;
        const ny = fwdY / fwdLen;
        const nz = fwdZ / fwdLen;

        // Trailing sparks with turbulent swirl
        for (let s = 0; s < slot.sparks.length; s++) {
          const spark = slot.sparks[s];
          const lag = (s + 1) * 6.2;
          const wigX = Math.sin(phaseElapsed * 26.0 + s * 1.8) * 2.0;
          const wigY = Math.cos(phaseElapsed * 30.0 + s * 2.2) * 2.0;
          const wigZ = Math.sin(phaseElapsed * 22.0 + s * 3.4) * 2.0;
          spark.setPosition(curX - nx * lag + wigX, curY - ny * lag + wigY, curZ - nz * lag + wigZ);
          const sScale = (1.6 - (s / slot.sparks.length) * 0.9) * (0.8 + 0.4 * Math.sin(phaseElapsed * 35.0 + s));
          spark.setLocalScale(sScale, sScale, sScale);
          spark.enabled = true;
        }

        // Trailing contrail smoke puffs drifting behind the falling meteor
        for (let p = 0; p < slot.contrailPuffs.length; p++) {
          const puff = slot.contrailPuffs[p];
          const lag = (p + 1) * 15.0;
          const driftX = Math.sin(phaseElapsed * 6.5 + p * 2.2) * 2.5;
          const driftY = Math.cos(phaseElapsed * 5.5 + p * 2.8) * 2.5;
          const driftZ = Math.sin(phaseElapsed * 7.5 + p * 1.8) * 2.5;
          puff.entity.setPosition(curX - nx * lag + driftX, curY - ny * lag + driftY, curZ - nz * lag + driftZ);

          if (camPos) {
            puff.entity.lookAt(camPos);
          }
          puff.rotZ += (15 + p * 10) * dt;
          puff.entity.rotateLocal(0, 0, puff.rotZ);

          const pScale = 4.5 + p * 3.2;
          puff.entity.setLocalScale(pScale, pScale, pScale);
          puff.mat.opacity = 0.70 * Math.max(0, 1.0 - p / slot.contrailPuffs.length);
          puff.entity.enabled = true;
        }

        if (progress >= 1.0) {
          // IMPACT DETONATION
          slot.state = 'impacted';
          slot.fallElapsed = slot.fallDuration;
          slot.impactElapsed = 0;

          slot.meteorRootEntity.enabled = false;
          slot.groundDecalEntity.enabled = false;
          for (let s = 0; s < slot.sparks.length; s++) {
            slot.sparks[s].enabled = false;
          }
          for (let p = 0; p < slot.contrailPuffs.length; p++) {
            slot.contrailPuffs[p].entity.enabled = false;
          }

          // 1. Transient Flash Light & Fireball Sphere
          slot.flashLightEntity.setPosition(slot.targetX, slot.targetY + 3.5, slot.targetZ);
          slot.flashLight.intensity = 45.0;
          slot.flashLightEntity.enabled = true;

          slot.flashSphereEntity.setPosition(slot.targetX, slot.targetY + 2.5, slot.targetZ);
          slot.flashSphereEntity.setLocalScale(4.5, 4.5, 4.5);
          slot.flashMat.opacity = 1.0;
          slot.flashSphereEntity.enabled = true;

          // 2. Feathered Expanding Shockwave (to 55 units)
          slot.shockwaveEntity.setPosition(slot.targetX, slot.targetY, slot.targetZ);
          slot.shockwaveEntity.setLocalScale(1.0, 1.0, 1.0);
          conformGroundMeshToTerrain(
            slot.shockwaveMesh,
            slot.targetX,
            slot.targetZ,
            3.0,
            0.14,
            ctx.sampleHeight,
            slot.targetY,
          );
          slot.shockwaveMat.opacity = 0.95;
          slot.shockwaveMat.emissiveIntensity = 10.0;
          slot.shockwaveEntity.enabled = true;

          // 3. Ground Scorch Decal (charred ash + glowing ember core - conformed ONCE at impact!)
          slot.scorchDiscEntity.setPosition(slot.targetX, slot.targetY, slot.targetZ);
          slot.scorchDiscEntity.setLocalScale(1.0, 1.0, 1.0);
          conformGroundMeshToTerrain(
            slot.scorchMesh,
            slot.targetX,
            slot.targetZ,
            16.0,
            0.06,
            ctx.sampleHeight,
            slot.targetY,
          );
          slot.scorchMat.opacity = 0.96;
          slot.scorchMat.emissiveIntensity = 3.6;
          slot.scorchDiscEntity.enabled = true;

          // 4. Rising Vertical Dust/Smoke Plume (5 billboard puffs)
          const plumeConfigs = [
            { dY: 0.5, delay: 0.00, vX: 0.0, vY: 19.0, vZ: 0.0, bS: 4.0, mS: 18.0, mL: 3.4 },
            { dY: 1.0, delay: 0.07, vX: 3.2, vY: 16.5, vZ: 1.8, bS: 4.8, mS: 21.0, mL: 3.6 },
            { dY: 1.4, delay: 0.14, vX: -2.8, vY: 14.0, vZ: -2.2, bS: 5.4, mS: 24.0, mL: 3.8 },
            { dY: 1.8, delay: 0.21, vX: 2.2, vY: 11.5, vZ: -2.6, bS: 6.0, mS: 26.0, mL: 4.0 },
            { dY: 2.2, delay: 0.28, vX: -1.8, vY: 9.0, vZ: 2.4, bS: 6.8, mS: 28.0, mL: 4.2 },
          ];

          for (let p = 0; p < slot.plumePuffs.length; p++) {
            const puff = slot.plumePuffs[p];
            const cfg = plumeConfigs[p];
            puff.pos.set(slot.targetX, slot.targetY + cfg.dY, slot.targetZ);
            puff.vel.set(cfg.vX, cfg.vY, cfg.vZ);
            puff.rotZ = Math.random() * Math.PI * 2;
            puff.rotSpeed = (Math.random() - 0.5) * 45.0;
            puff.baseScale = cfg.bS;
            puff.maxScale = cfg.mS;
            puff.delay = cfg.delay;
            puff.life = 0;
            puff.maxLife = cfg.mL;
            puff.mat.opacity = 0.0;
            puff.entity.enabled = false;
          }

          // 5. Ballistic Molten Debris Chunks (12 fragments)
          slot.debrisMat.opacity = 1.0;
          slot.debrisMat.emissiveIntensity = 4.8;
          for (let d = 0; d < slot.debris.length; d++) {
            const deb = slot.debris[d];
            deb.pos.set(slot.targetX, slot.targetY + 0.8, slot.targetZ);
            deb.entity.setPosition(deb.pos);
            deb.entity.enabled = true;

            const angle = (d / slot.debris.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
            const hSpeed = 14.0 + Math.random() * 24.0;
            const vSpeed = 16.0 + Math.random() * 26.0;
            deb.vel.set(Math.cos(angle) * hSpeed, vSpeed, Math.sin(angle) * hSpeed);
            deb.rotVel.set(
              (Math.random() - 0.5) * 360,
              (Math.random() - 0.5) * 360,
              (Math.random() - 0.5) * 360,
            );
            deb.baseScale = 1.2 + Math.random() * 0.8;
            deb.entity.setLocalScale(deb.baseScale, deb.baseScale, deb.baseScale);
          }

          // 6. Camera Tremor Impulse
          this.shakeEnergy = Math.min(6.5, this.shakeEnergy + 2.8);

          // 7. Collision / Damage check: strictly once per meteor within 42 units radius
          if (!slot.damageDealt) {
            slot.damageDealt = true;
            for (const b of ctx.buildings) {
              const bx = b.worldCenter?.x ?? (b.gridX + b.cols * 0.5) * 14;
              const bz = b.worldCenter?.z ?? (b.gridZ + b.rows * 0.5) * 14;
              const dx = bx - slot.targetX;
              const dz = bz - slot.targetZ;
              if (dx * dx + dz * dz <= 42 * 42) {
                damageThisFrame += 12;
              }
            }
          }
        }
      }

      if (slot.state === 'impacted') {
        slot.impactElapsed += dt;

        // Flash light decay (~0.35s)
        const flashT = slot.impactElapsed / 0.35;
        if (flashT < 1.0) {
          const fade = (1.0 - flashT) * (1.0 - flashT);
          slot.flashLight.intensity = 45.0 * fade;
        } else if (slot.flashLightEntity.enabled) {
          slot.flashLightEntity.enabled = false;
        }

        // Flash fireball sphere expansion (~0.38s)
        const sphereT = slot.impactElapsed / 0.38;
        if (sphereT < 1.0) {
          const s = 4.5 + sphereT * 18.0;
          slot.flashSphereEntity.setLocalScale(s, s, s);
          slot.flashMat.opacity = 1.0 - sphereT * sphereT;
        } else if (slot.flashSphereEntity.enabled) {
          slot.flashSphereEntity.enabled = false;
        }

        // Feathered Shockwave Expansion (to 55 units over 0.75s)
        const waveT = slot.impactElapsed / 0.75;
        if (waveT < 1.0) {
          const radius = 3.0 + Math.pow(waveT, 0.65) * 52.0;
          conformGroundMeshToTerrain(
            slot.shockwaveMesh,
            slot.targetX,
            slot.targetZ,
            radius,
            0.14,
            ctx.sampleHeight,
            slot.targetY,
          );
          slot.shockwaveEntity.setLocalScale(1.0, 1.0, 1.0);
          slot.shockwaveMat.opacity = (1.0 - waveT) * 0.95;
          slot.shockwaveMat.emissiveIntensity = 10.0 * (1.0 - waveT);
        } else if (slot.shockwaveEntity.enabled) {
          slot.shockwaveEntity.enabled = false;
        }

        // Rising Vertical Dust/Smoke Plume Puffs
        for (let p = 0; p < slot.plumePuffs.length; p++) {
          const puff = slot.plumePuffs[p];
          if (slot.impactElapsed >= puff.delay) {
            puff.life = slot.impactElapsed - puff.delay;
            if (puff.life < puff.maxLife) {
              puff.entity.enabled = true;
              const t = puff.life / puff.maxLife;

              // Drag slows vertical ascent and lateral spread
              const drag = Math.exp(-dt * 1.1);
              puff.vel.x *= drag;
              puff.vel.y *= drag;
              puff.vel.z *= drag;
              puff.pos.x += puff.vel.x * dt;
              puff.pos.y += puff.vel.y * dt;
              puff.pos.z += puff.vel.z * dt;
              puff.entity.setPosition(puff.pos);

              if (camPos) {
                puff.entity.lookAt(camPos);
              }
              puff.rotZ += puff.rotSpeed * dt;
              puff.entity.rotateLocal(0, 0, puff.rotZ);

              const curScale = puff.baseScale + (puff.maxScale - puff.baseScale) * Math.pow(t, 0.65);
              puff.entity.setLocalScale(curScale, curScale, curScale);

              // Alpha fade: dense at start, smooth feather over life
              const alpha = t < 0.2 ? (t / 0.2) : Math.pow(1.0 - (t - 0.2) / 0.8, 1.4);
              puff.mat.opacity = 0.85 * alpha;
            } else if (puff.entity.enabled) {
              puff.entity.enabled = false;
            }
          }
        }

        // Ballistic Debris Physics & Bounce (~1.8s)
        const debT = slot.impactElapsed / 1.8;
        if (debT < 1.0) {
          const debFade = 1.0 - debT;
          slot.debrisMat.opacity = debFade;
          slot.debrisMat.emissiveIntensity = 4.8 * debFade;
          for (let d = 0; d < slot.debris.length; d++) {
            const deb = slot.debris[d];
            deb.pos.x += deb.vel.x * dt;
            deb.pos.y += deb.vel.y * dt;
            deb.pos.z += deb.vel.z * dt;
            deb.vel.y -= 52.0 * dt; // gravity

            const groundY = ctx.sampleHeight(deb.pos.x, deb.pos.z);
            if (deb.pos.y < groundY + 0.25) {
              deb.pos.y = groundY + 0.25;
              deb.vel.y = -deb.vel.y * 0.25; // bounce!
              deb.vel.x *= 0.60;
              deb.vel.z *= 0.60;
            }

            deb.entity.setPosition(deb.pos);
            deb.entity.rotate(deb.rotVel.x * dt, deb.rotVel.y * dt, deb.rotVel.z * dt);
            const s = deb.baseScale * (0.35 + 0.65 * debFade);
            deb.entity.setLocalScale(s, s, s);
          }
        } else {
          for (let d = 0; d < slot.debris.length; d++) {
            if (slot.debris[d].entity.enabled) {
              slot.debris[d].entity.enabled = false;
            }
          }
        }

        // Scorch Mark Disc Fade (~6.0s)
        const scorchT = slot.impactElapsed / 6.0;
        if (scorchT < 1.0) {
          slot.scorchMat.opacity = 0.96 * (1.0 - scorchT);
          // Hot ember center cools down in ~2.0s
          slot.scorchMat.emissiveIntensity = Math.max(0, 3.6 * (1.0 - scorchT * 3.0));
        } else if (slot.scorchDiscEntity.enabled) {
          slot.scorchDiscEntity.enabled = false;
          slot.state = 'done';
        }
      }
    }

    // Seismic shake exponential decay
    this.shakeEnergy *= Math.exp(-dt * 4.8);

    return {
      damageThisFrame,
      productionMultiplier: 1.0,
      shakeOffset: this.getShakeOffset(phaseElapsed),
    };
  }

  public stop(): void {
    this.targetsInitialized = false;
    for (const slot of this.slots) {
      slot.state = 'pending';
      slot.fallElapsed = 0;
      slot.impactElapsed = 0;
      slot.damageDealt = false;
      slot.groundDecalEntity.enabled = false;
      slot.groundDecalEntity.setLocalScale(1.0, 1.0, 1.0);
      slot.meteorRootEntity.enabled = false;
      slot.flightLightEntity.enabled = false;
      slot.flashLightEntity.enabled = false;
      if (slot.flashLight) {
        slot.flashLight.intensity = 0;
      }
      slot.flashSphereEntity.enabled = false;
      slot.shockwaveEntity.enabled = false;
      slot.shockwaveEntity.setLocalScale(1.0, 1.0, 1.0);
      slot.scorchDiscEntity.enabled = false;
      slot.scorchDiscEntity.setLocalScale(1.0, 1.0, 1.0);
      for (let s = 0; s < slot.sparks.length; s++) {
        slot.sparks[s].enabled = false;
      }
      for (let p = 0; p < slot.contrailPuffs.length; p++) {
        slot.contrailPuffs[p].entity.enabled = false;
      }
      for (let p = 0; p < slot.plumePuffs.length; p++) {
        slot.plumePuffs[p].entity.enabled = false;
      }
      for (let d = 0; d < slot.debris.length; d++) {
        slot.debris[d].entity.enabled = false;
      }
    }
    this.shakeEnergy = 0;
  }

  public destroy(): void {
    this.stop();

    // Dispose procedural textures
    this.groundIndicatorTex.destroy();
    this.smokePlumeTex.destroy();
    this.scorchMarkTex.destroy();
    this.shockwaveTex.destroy();

    // Dispose shared materials
    this.sharedMeteorCoreMat.destroy();
    this.sharedInnerCoreMat.destroy();
    this.sharedComaMat.destroy();
    this.sharedOuterTrailMat.destroy();
    this.sharedInnerTrailMat.destroy();
    this.sharedSparkMat.destroy();

    // Dispose slot materials and per-slot conformed meshes
    for (const slot of this.slots) {
      slot.groundDecalMat.destroy();
      slot.groundDecalMesh.destroy();
      slot.flashMat.destroy();
      slot.shockwaveMat.destroy();
      slot.shockwaveMesh.destroy();
      slot.scorchMat.destroy();
      slot.scorchMesh.destroy();
      slot.debrisMat.destroy();
      for (let p = 0; p < slot.contrailPuffs.length; p++) {
        slot.contrailPuffs[p].mat.destroy();
      }
      for (let p = 0; p < slot.plumePuffs.length; p++) {
        slot.plumePuffs[p].mat.destroy();
      }
    }

    // Dispose procedural meshes
    this.quadMesh.destroy();
    this.rockMesh.destroy();
    this.debrisMesh.destroy();

    // Destroy entity graph
    this.entity.destroy();
  }

  private selectTargets(ctx: EventUpdateContext): void {
    let originX = ctx.focusTarget.x;
    let originZ = ctx.focusTarget.z;

    if (ctx.buildings.length > 0) {
      let sumX = 0;
      let sumZ = 0;
      for (const b of ctx.buildings) {
        sumX += b.worldCenter?.x ?? (b.gridX + b.cols * 0.5) * 14;
        sumZ += b.worldCenter?.z ?? (b.gridZ + b.rows * 0.5) * 14;
      }
      const avgX = sumX / ctx.buildings.length;
      const avgZ = sumZ / ctx.buildings.length;
      originX = avgX * 0.75 + ctx.focusTarget.x * 0.25;
      originZ = avgZ * 0.75 + ctx.focusTarget.z * 0.25;
    }

    const maxBound = Math.max(80, ctx.worldHalf - 100);
    this.activeCount = 11 + Math.floor(Math.random() * 3); // 11-13 meteors

    const minSpawn = 0.25;
    const maxSpawn = this.activeDurationSec - 2.8;

    for (let i = 0; i < this.activeCount; i++) {
      const slot = this.slots[i];
      const targetBuilding =
        ctx.buildings.length > 0 && Math.random() < 0.35
          ? ctx.buildings[Math.floor(Math.random() * ctx.buildings.length)]
          : null;

      let tx: number;
      let tz: number;

      if (targetBuilding) {
        const bx =
          targetBuilding.worldCenter?.x ??
          (targetBuilding.gridX + targetBuilding.cols * 0.5) * 14;
        const bz =
          targetBuilding.worldCenter?.z ??
          (targetBuilding.gridZ + targetBuilding.rows * 0.5) * 14;
        const angle = Math.random() * Math.PI * 2;
        const dist = 4.0 + Math.random() * 24.0;
        tx = bx + Math.cos(angle) * dist;
        tz = bz + Math.sin(angle) * dist;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const dist = 50.0 + Math.sqrt(Math.random()) * 390.0;
        tx = originX + Math.cos(angle) * dist;
        tz = originZ + Math.sin(angle) * dist;
      }

      slot.targetX = Math.max(-maxBound, Math.min(maxBound, tx));
      slot.targetZ = Math.max(-maxBound, Math.min(maxBound, tz));
      slot.targetY = ctx.sampleHeight(slot.targetX, slot.targetZ);

      // Diagonal descent trajectory from sky
      const diagDx = -(170.0 + Math.random() * 80.0);
      const diagDy = 290.0 + Math.random() * 80.0;
      const diagDz = -(130.0 + Math.random() * 70.0);
      slot.startX = slot.targetX + diagDx;
      slot.startY = slot.targetY + diagDy;
      slot.startZ = slot.targetZ + diagDz;

      slot.fallDuration = 1.4 + Math.random() * 0.4;
      slot.spawnDelay =
        minSpawn +
        (i / (this.activeCount - 1)) * (maxSpawn - minSpawn) +
        (Math.random() - 0.5) * 0.3;
      slot.fallElapsed = 0;
      slot.impactElapsed = 0;
      slot.state = 'pending';
      slot.damageDealt = false;
      slot.isWarningCandidate = i < 3;
    }
  }

  private getShakeOffset(t: number): Vec3XYZ {
    if (this.shakeEnergy < 0.005) {
      return { x: 0, y: 0, z: 0 };
    }
    return {
      x:
        (Math.sin(t * 54.0) * 0.65 + Math.cos(t * 88.0 + 1.2) * 0.35) *
        this.shakeEnergy,
      y:
        (Math.cos(t * 48.0) * 0.80 + Math.sin(t * 72.0 + 0.8) * 0.40) *
        this.shakeEnergy,
      z:
        (Math.sin(t * 36.0) * 0.50 + Math.cos(t * 64.0 + 2.1) * 0.30) *
        this.shakeEnergy,
    };
  }
}

export const MeteorShowerFX = MeteorShowerFx;
