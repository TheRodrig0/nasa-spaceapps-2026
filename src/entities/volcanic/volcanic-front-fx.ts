import * as pc from 'playcanvas';
import { DEFAULT_CRATER_RADIUS, WORLD_HALF } from '../../systems/terrain/index.ts';
import type {
  GameState,
  ImpactHeightSampler,
  Vec2XZ,
  VolcanicShakeOffset,
} from '../../types/index.ts';

export const METEOR_FALL_DURATION = 2.6;
export const IMPACT_FLASH_DURATION = 0.5;
export const CRATER_RADIUS = DEFAULT_CRATER_RADIUS;
export const SHOCKWAVE_MAX_RADIUS = 3200;
export const MAX_SPREAD_RADIUS = WORLD_HALF * 1.5;

const METEOR_START_OFFSET: readonly [number, number, number] = [-2200, 1480, -2500];
const METEORITE_COUNT = 14;
const GRID_HALF_CELLS = 5;
const CELL_SIZE = 155.0;
const VISIBLE_RADIUS = GRID_HALF_CELLS * CELL_SIZE; // 775m around camera
const SPARKS_PER_CELL = 24;

type MeteoriteRig = {
  readonly root: pc.Entity;
  readonly flashEntity: pc.Entity;
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly timeLag: number;
  readonly speedScale: number;
  readonly baseScale: number;
};

function createCompanionDescriptors(): ReadonlyArray<{
  dx: number;
  dz: number;
  timeLag: number;
  speedScale: number;
  scale: number;
}> {
  const list: Array<{
    dx: number;
    dz: number;
    timeLag: number;
    speedScale: number;
    scale: number;
  }> = [];
  for (let i = 0; i < METEORITE_COUNT; i++) {
    const h1 = ((Math.sin(i * 17.3 + 4.1) * 43758.5453) % 1 + 1) % 1;
    const h2 = ((Math.sin(i * 31.7 + 9.4) * 43758.5453) % 1 + 1) % 1;
    const h3 = ((Math.sin(i * 53.9 + 2.7) * 43758.5453) % 1 + 1) % 1;
    const dx = (h1 - 0.5) * 1250;
    const dz = (h2 - 0.5) * 1150;
    list.push({
      dx: Math.abs(dx) < 95 ? (dx < 0 ? -120 : 120) : dx,
      dz: Math.abs(dz) < 95 ? (dz < 0 ? -120 : 120) : dz,
      timeLag: -0.12 + h3 * 0.42,
      speedScale: 0.98 + h2 * 0.28,
      scale: 9.0 + h1 * 10.0,
    });
  }
  return list;
}

const SHARED_TOROIDAL_VS_HEADER = `
  attribute vec3 aCorner;
  attribute vec4 aCellOffset;

  uniform mat4 matrix_viewProjection;
  uniform sampler2D uHeightMap;
  uniform sampler2D uFractureMap;
  uniform vec3 uCameraPos;
  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform vec2 uImpactCenter;
  uniform float uSpreadRadius;
  uniform float uCraterRadius;
  uniform float uTime;
  uniform float uWorldHalf;
  uniform float uHeightMapStride;

  varying vec2 vUv;
  varying float vFade;
  varying float vIntensity;
  varying float vAge;
  varying float vPuffRand;

  float vsHash21(vec2 p, float seedOffset) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031 + seedOffset * 0.1731);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float vsDecodeHeight(vec4 c) {
    float q = floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5);
    return (q / 65535.0) * 900.0 - 250.0;
  }

  float vsSampleGroundHeight(vec2 worldXZ) {
    vec2 uvNorm = clamp((worldXZ + uWorldHalf) / (2.0 * uWorldHalf), 0.0, 1.0);
    float maxIdx = max(1.0, uHeightMapStride - 1.0);
    vec2 gridCoord = uvNorm * maxIdx;
    vec2 i0 = floor(gridCoord);
    vec2 f = gridCoord - i0;
    vec2 i1 = min(i0 + 1.0, vec2(maxIdx));
    float invStride = 1.0 / max(2.0, uHeightMapStride);

    float h00 = vsDecodeHeight(textureLod(uHeightMap, (vec2(i0.x, i0.y) + 0.5) * invStride, 0.0));
    float h10 = vsDecodeHeight(textureLod(uHeightMap, (vec2(i1.x, i0.y) + 0.5) * invStride, 0.0));
    float h01 = vsDecodeHeight(textureLod(uHeightMap, (vec2(i0.x, i1.y) + 0.5) * invStride, 0.0));
    float h11 = vsDecodeHeight(textureLod(uHeightMap, (vec2(i1.x, i1.y) + 0.5) * invStride, 0.0));
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }

  float vsCalcImpactEffDist(vec2 worldXZ, float groundY, out float rawDist) {
    vec2 delta = worldXZ - uImpactCenter;
    rawDist = length(delta);
    vec2 dir = delta / max(rawDist, 1.0);
    float lobe = (dir.x * dir.x - dir.y * dir.y) * 14.0
               + (dir.x * dir.y) * 20.0
               + sin(dir.x * 5.0 - dir.y * 4.0) * 9.0
               + cos(dir.x * 9.0 + dir.y * 7.0) * 5.0;
    float relief = clamp(-groundY * 0.45, -24.0, 28.0);
    float blend = smoothstep(4.0, 32.0, rawDist);
    return max(0.0, rawDist - (lobe + relief) * blend);
  }

  bool vsEvaluateSparseCell(
    out vec3 basePos,
    out vec4 hashes,
    out float craterBoost,
    out float fireGrowth,
    out float distFade
  ) {
    if (uSpreadRadius <= 1.0) return false;

    vec2 camCell = floor(uCameraPos.xz / ${CELL_SIZE.toFixed(1)});
    vec2 worldCell = camCell + aCellOffset.xy;

    hashes.x = vsHash21(worldCell, 1.13);
    hashes.y = vsHash21(worldCell, 2.71);
    hashes.z = vsHash21(worldCell, 4.37);
    hashes.w = vsHash21(worldCell, 7.91);

    vec2 worldXZ = (worldCell + vec2(0.16 + 0.68 * hashes.x, 0.16 + 0.68 * hashes.y)) * ${CELL_SIZE.toFixed(1)};
    float terrainLimit = uWorldHalf - 80.0;
    if (abs(worldXZ.x) > terrainLimit || abs(worldXZ.y) > terrainLimit) return false;

    float camDist = length(worldXZ - uCameraPos.xz);
    if (camDist > ${VISIBLE_RADIUS.toFixed(1)}) return false;

    float groundY = vsSampleGroundHeight(worldXZ);
    float rawDist = 0.0;
    float effDist = vsCalcImpactEffDist(worldXZ, groundY, rawDist);
    float pen = uSpreadRadius - effDist;
    if (pen <= 2.0) return false;

    float safeCrater = max(uCraterRadius, 1.0);
    vec4 fracSample = textureLod(uFractureMap, worldXZ * 0.0032, 0.0);
    bool isCraterCore = rawDist < safeCrater * 0.85;
    if (isCraterCore) {
      // Pin crater core vent cleanly inside the excavated bowl so main pillar stays centered
      worldXZ = mix(worldXZ, uImpactCenter + (vec2(hashes.x, hashes.y) - 0.5) * safeCrater * 0.65, 0.72);
      groundY = vsSampleGroundHeight(worldXZ) - 18.0;
    } else if (fracSample.r <= 0.56 || hashes.w >= 0.28) {
      // Sparse distribution: ejecta vents only erupt at select major tectonic fault intersections
      return false;
    }

    craterBoost = isCraterCore ? 1.0 : (1.0 - smoothstep(safeCrater * 0.5, safeCrater * 2.2, rawDist)) * 0.5;
    float ignite = smoothstep(8.0, 48.0, pen);
    float craterIgnite = clamp(uSpreadRadius / (safeCrater * 0.35), 0.0, 1.0) * (isCraterCore ? 1.0 : craterBoost);
    fireGrowth = max(ignite, craterIgnite);
    if (fireGrowth <= 0.002) return false;

    distFade = smoothstep(${VISIBLE_RADIUS.toFixed(1)}, 500.0, camDist);
    basePos = vec3(worldXZ.x, groundY, worldXZ.y);
    return true;
  }
`;

const SPARK_VERTEX_GLSL = `
  ${SHARED_TOROIDAL_VS_HEADER}

  void main(void) {
    vec3 basePos = vec3(0.0);
    vec4 hashes = vec4(0.0);
    float craterBoost = 0.0;
    float fireGrowth = 0.0;
    float distFade = 0.0;

    if (!vsEvaluateSparseCell(basePos, hashes, craterBoost, fireGrowth, distFade)) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      vUv = vec2(0.0);
      vFade = 0.0;
      vIntensity = 0.0;
      vAge = 0.0;
      vPuffRand = 0.0;
      return;
    }

    float idx = aCorner.z;
    bool isBallisticEjecta = idx < 11.5;
    float speed = isBallisticEjecta ? (0.46 + 0.18 * hashes.y) : (0.30 + 0.16 * hashes.y);
    float cycle = fract(idx / ${SPARKS_PER_CELL.toFixed(1)} + uTime * speed + hashes.z);

    vec3 particleCenter;
    float particleSize;
    if (isBallisticEjecta) {
      float tSec = cycle * 2.6;
      float ang = hashes.x * 6.2831 + idx * 2.39996;
      float hSpeed = mix(38.0, 96.0, fract(hashes.y * 3.7 + idx * 0.17)) * (1.0 + 1.65 * craterBoost);
      float v0y = mix(72.0, 195.0, fract(hashes.z * 5.1 + idx * 0.29)) * (1.0 + 1.15 * craterBoost);
      float yArc = max(-6.0, v0y * tSec - 0.5 * 42.0 * tSec * tSec);
      particleCenter = vec3(
        basePos.x + cos(ang) * hSpeed * tSec,
        basePos.y + yArc,
        basePos.z + sin(ang) * hSpeed * tSec
      );
      particleSize = mix(5.5, 14.0, fract(hashes.x + idx * 0.31)) * (1.0 + 0.65 * craterBoost) * (1.0 - 0.42 * cycle);
    } else {
      float sparkAngle = idx * 2.39996 + uTime * 1.5;
      float maxH = mix(190.0, 390.0, hashes.z) * (1.0 + 0.55 * craterBoost);
      vec2 windDir = vec2(0.8805, 0.4741);
      float spread = mix(8.0, 48.0, cycle);
      particleCenter = vec3(
        basePos.x + cos(sparkAngle) * spread + windDir.x * (cycle * cycle * 85.0),
        basePos.y + cycle * maxH,
        basePos.z + sin(sparkAngle) * spread + windDir.y * (cycle * cycle * 85.0)
      );
      particleSize = mix(3.2, 7.2, fract(hashes.y + idx * 0.23)) * (1.0 - 0.32 * cycle);
    }

    vec2 billboardOffset = aCorner.xy * particleSize;
    vec3 posW = particleCenter + uCameraRight * billboardOffset.x + uCameraUp * billboardOffset.y;

    vUv = aCorner.xy + 0.5;
    vFade = distFade * fireGrowth;
    vIntensity = (isBallisticEjecta ? 1.85 : 1.35) * (1.0 + 0.75 * craterBoost);
    vAge = cycle;
    vPuffRand = isBallisticEjecta ? 0.0 : 1.0;
    gl_Position = matrix_viewProjection * vec4(posW, 1.0);
  }
`;

const SPARK_FRAGMENT_GLSL = `
  varying vec2 vUv;
  varying float vFade;
  varying float vIntensity;
  varying float vAge;
  varying float vPuffRand;

  void main(void) {
    if (vFade <= 0.005) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;

    float glow = exp(-(d * d) * 4.5);
    float lifeFade = smoothstep(0.0, 0.08, vAge) * smoothstep(1.0, 0.55, vAge);
    vec3 col = vPuffRand < 0.5
      ? mix(vec3(3.6, 0.75, 0.06), vec3(6.5, 4.2, 1.8), glow)
      : mix(vec3(2.8, 0.58, 0.05), vec3(4.8, 2.6, 0.75), glow);

    float strength = glow * lifeFade * vFade * vIntensity;
    if (strength < 0.015) discard;
    gl_FragColor = vec4(col * strength, 1.0);
  }
`;

const FIREBALL_DOME_VS = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;

  uniform mat4 matrix_viewProjection;
  uniform vec3 uFireballPos;
  uniform float uFireballRadius;
  uniform float uTime;

  varying vec3 vNormal;
  varying vec3 vLocalPos;

  void main(void) {
    float ripple = sin(aNormal.x * 11.0 + uTime * 10.5) * cos(aNormal.y * 9.5 - uTime * 8.8) * 0.12
                 + sin(aNormal.z * 16.0 - uTime * 13.5) * 0.06;
    float verticalStretch = aPosition.y > 0.0 ? (1.0 + aPosition.y * 1.65) : 0.25;
    vec3 localDisplaced = vec3(
      aPosition.x * (1.0 + ripple * 0.7),
      aPosition.y * verticalStretch * (1.0 + ripple),
      aPosition.z * (1.0 + ripple * 0.7)
    );
    vec3 posW = uFireballPos + localDisplaced * uFireballRadius;
    vNormal = normalize(aNormal);
    vLocalPos = aPosition;
    gl_Position = matrix_viewProjection * vec4(posW, 1.0);
  }
`;

const FIREBALL_DOME_FS = `
  uniform sampler2D uFractureMap;
  uniform float uTime;
  uniform float uDomeAge;
  uniform float uDomeFade;

  varying vec3 vNormal;
  varying vec3 vLocalPos;

  void main(void) {
    if (uDomeFade <= 0.01) discard;
    vec2 sphereUv = vNormal.xz * 0.55 + vec2(0.0, -uTime * 0.35 + vLocalPos.y * 0.40);
    float n1 = texture2D(uFractureMap, sphereUv).b;
    float n2 = texture2D(uFractureMap, sphereUv * 2.1 + vec2(uTime * 0.14, -uTime * 0.45)).a;
    float crack = texture2D(uFractureMap, sphereUv * 1.4).r;

    float heat = clamp(n1 * 0.60 + n2 * 0.35 + crack * 0.52 - uDomeAge * 0.38, 0.0, 1.5);
    float plasmaMask = smoothstep(0.20, 0.82, heat);
    vec3 darkCrust = vec3(0.045, 0.025, 0.020);
    vec3 fireCore = mix(vec3(3.4, 0.68, 0.05), vec3(6.5, 4.2, 1.8), smoothstep(0.38, 1.0, heat));
    vec3 col = mix(darkCrust, fireCore, plasmaMask);

    // Blinding white-gold thermal flash at touchdown (t = 0..0.4s)
    float thermalFlash = smoothstep(0.14, 0.01, uDomeAge);
    vec3 blindingFlash = vec3(8.8, 8.2, 6.8);
    col = mix(col, blindingFlash, thermalFlash * 0.94);

    // Towering incandescent volcanic ejecta crown at the apex (Greenland style)
    float crownEruption = smoothstep(0.35, 0.95, vLocalPos.y) * (0.65 + 0.35 * crack);
    col += vec3(4.8, 3.4, 1.4) * crownEruption * (1.0 - uDomeAge * 0.42);

    float rim = clamp(1.0 - abs(vNormal.y), 0.0, 1.0);
    col += vec3(2.6, 0.88, 0.20) * rim * (1.0 - uDomeAge * 0.55);
    float alpha = clamp(uDomeFade * (0.76 + 0.24 * plasmaMask), 0.0, 0.98);
    gl_FragColor = vec4(col, alpha);
  }
`;

const BLAST_WALL_VS = `
  attribute vec3 aPosition;
  uniform mat4 matrix_viewProjection;
  uniform vec3 uWallPos;
  uniform float uWallRadius;
  uniform float uWallHeight;

  varying vec2 vCylUv;

  void main(void) {
    vec3 posW = vec3(
      uWallPos.x + aPosition.x * uWallRadius,
      uWallPos.y + aPosition.y * uWallHeight,
      uWallPos.z + aPosition.z * uWallRadius
    );
    vCylUv = vec2(atan(aPosition.z, aPosition.x) * 0.15915 + 0.5, aPosition.y);
    gl_Position = matrix_viewProjection * vec4(posW, 1.0);
  }
`;

const BLAST_WALL_FS = `
  uniform sampler2D uFractureMap;
  uniform float uTime;
  uniform float uWallAlpha;

  varying vec2 vCylUv;

  void main(void) {
    if (uWallAlpha <= 0.008) discard;
    float gust = texture2D(uFractureMap, vec2(vCylUv.x * 4.0 + uTime * 0.08, vCylUv.y * 1.4 - uTime * 0.35)).b;
    float vertProfile = smoothstep(0.0, 0.14, vCylUv.y) * smoothstep(1.0, 0.22, vCylUv.y);
    vec3 wallCol = mix(vec3(3.8, 1.35, 0.32), vec3(6.8, 4.4, 1.8), gust);
    float strength = vertProfile * (0.68 + 0.95 * gust) * uWallAlpha;
    if (strength < 0.01) discard;
    gl_FragColor = vec4(wallCol * strength, 1.0);
  }
`;

function createSphereMesh(
  device: pc.GraphicsDevice,
  latBands: number,
  lonBands: number,
  radius: number,
  craggy: boolean,
): pc.Mesh {
  const cols = lonBands + 1;
  const rows = latBands + 1;
  const vertCount = rows * cols;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const colors = craggy ? new Float32Array(vertCount * 4) : null;
  const indices = new Uint16Array(latBands * lonBands * 6);

  for (let i = 0; i <= latBands; i++) {
    const theta = (i / latBands) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    for (let j = 0; j <= lonBands; j++) {
      const phi = ((j % lonBands) / lonBands) * Math.PI * 2;
      const nx = sinT * Math.cos(phi);
      const ny = cosT;
      const nz = sinT * Math.sin(phi);

      const idx = i * cols + j;
      let r = radius;
      if (craggy) {
        const ridge = 1 - Math.abs(Math.sin(nx * 4.8 + ny * 3.6 - nz * 4.2) * Math.cos(nz * 5.9 - nx * 4.1));
        const rough = Math.sin(nx * 10.3 + nz * 8.7) * Math.cos(ny * 11.4 - nx * 7.6);
        r = radius * (0.76 + 0.34 * ridge + 0.09 * rough);

        if (colors) {
          const cPtr = idx * 4;
          if (ridge < 0.35) {
            const hot = 1 - ridge / 0.35;
            colors[cPtr] = 1.0;
            colors[cPtr + 1] = 0.35 + 0.65 * hot;
            colors[cPtr + 2] = 0.08 + 0.3 * hot;
          } else {
            colors[cPtr] = 0.04;
            colors[cPtr + 1] = 0.025;
            colors[cPtr + 2] = 0.02;
          }
          colors[cPtr + 3] = 1.0;
        }
      }

      const pPtr = idx * 3;
      positions[pPtr] = nx * r;
      positions[pPtr + 1] = ny * r;
      positions[pPtr + 2] = nz * r;
      normals[pPtr] = nx;
      normals[pPtr + 1] = ny;
      normals[pPtr + 2] = nz;
    }
  }

  let iPtr = 0;
  for (let i = 0; i < latBands; i++) {
    for (let j = 0; j < lonBands; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
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

  if (craggy) {
    normals.fill(0);
    for (let k = 0; k < indices.length; k += 3) {
      const ia = indices[k] * 3;
      const ib = indices[k + 1] * 3;
      const ic = indices[k + 2] * 3;
      const ux = positions[ib] - positions[ia];
      const uy = positions[ib + 1] - positions[ia + 1];
      const uz = positions[ib + 2] - positions[ia + 2];
      const vx = positions[ic] - positions[ia];
      const vy = positions[ic + 1] - positions[ia + 1];
      const vz = positions[ic + 2] - positions[ia + 2];
      const fnx = uy * vz - uz * vy;
      const fny = uz * vx - ux * vz;
      const fnz = ux * vy - uy * vx;
      for (const v of [ia, ib, ic]) {
        normals[v] += fnx;
        normals[v + 1] += fny;
        normals[v + 2] += fnz;
      }
    }
    for (let v = 0; v < normals.length; v += 3) {
      const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
      normals[v] /= len;
      normals[v + 1] /= len;
      normals[v + 2] /= len;
    }
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  if (colors) mesh.setColors(colors, 4);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

function createShockwaveRingMesh(device: pc.GraphicsDevice, segments = 48): pc.Mesh {
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint16Array(segments * 6);
  const innerRadius = 0.70;
  const outerRadius = 1.0;

  let pPtr = 0;
  let nPtr = 0;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    positions[pPtr++] = cosT * innerRadius;
    positions[pPtr++] = 0;
    positions[pPtr++] = sinT * innerRadius;
    normals[nPtr++] = 0;
    normals[nPtr++] = 1;
    normals[nPtr++] = 0;

    positions[pPtr++] = cosT * outerRadius;
    positions[pPtr++] = 0;
    positions[pPtr++] = sinT * outerRadius;
    normals[nPtr++] = 0;
    normals[nPtr++] = 1;
    normals[nPtr++] = 0;
  }

  let idx = 0;
  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices[idx++] = base;
    indices[idx++] = base + 2;
    indices[idx++] = base + 1;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    indices[idx++] = base + 3;
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

function createShockwaveCylinderMesh(device: pc.GraphicsDevice, segments = 48): pc.Mesh {
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const indices = new Uint16Array(segments * 6);

  let pPtr = 0;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    positions[pPtr++] = cosT;
    positions[pPtr++] = 0;
    positions[pPtr++] = sinT;

    positions[pPtr++] = cosT;
    positions[pPtr++] = 1;
    positions[pPtr++] = sinT;
  }

  let idx = 0;
  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices[idx++] = base;
    indices[idx++] = base + 2;
    indices[idx++] = base + 1;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    indices[idx++] = base + 3;
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  mesh.aabb = new pc.BoundingBox(new pc.Vec3(0, 0, 0), new pc.Vec3(WORLD_HALF * 2, 1000, WORLD_HALF * 2));
  return mesh;
}

function createToroidalPuffMesh(device: pc.GraphicsDevice, quadsPerCell: number): pc.Mesh {
  const gridDim = GRID_HALF_CELLS * 2 + 1;
  const totalQuads = gridDim * gridDim * quadsPerCell;
  const totalVerts = totalQuads * 4;
  const totalIndices = totalQuads * 6;

  const corners = new Float32Array(totalVerts * 3);
  const cellOffsets = new Float32Array(totalVerts * 4);
  const indices = new Uint16Array(totalIndices);

  let vPtr = 0;
  let uvPtr = 0;
  let iPtr = 0;
  let baseVertex = 0;

  const cornerCoords: readonly (readonly [number, number])[] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];

  for (let oz = -GRID_HALF_CELLS; oz <= GRID_HALF_CELLS; oz++) {
    for (let ox = -GRID_HALF_CELLS; ox <= GRID_HALF_CELLS; ox++) {
      for (let q = 0; q < quadsPerCell; q++) {
        for (let k = 0; k < 4; k++) {
          const [cx, cy] = cornerCoords[k];
          corners[vPtr++] = cx;
          corners[vPtr++] = cy;
          corners[vPtr++] = q;

          cellOffsets[uvPtr++] = ox;
          cellOffsets[uvPtr++] = oz;
          cellOffsets[uvPtr++] = 0;
          cellOffsets[uvPtr++] = 0;
        }

        indices[iPtr++] = baseVertex;
        indices[iPtr++] = baseVertex + 1;
        indices[iPtr++] = baseVertex + 2;
        indices[iPtr++] = baseVertex;
        indices[iPtr++] = baseVertex + 2;
        indices[iPtr++] = baseVertex + 3;
        baseVertex += 4;
      }
    }
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(corners, 3);
  mesh.setUvs(0, cellOffsets, 4);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  mesh.aabb = new pc.BoundingBox(new pc.Vec3(0, 0, 0), new pc.Vec3(WORLD_HALF * 2, 1000, WORLD_HALF * 2));
  return mesh;
}

function createToroidalShaderMaterial(
  uniqueName: string,
  vertexGLSL: string,
  fragmentGLSL: string,
  blendType: number,
): pc.ShaderMaterial {
  const mat = new pc.ShaderMaterial({
    uniqueName,
    attributes: {
      aCorner: pc.SEMANTIC_POSITION,
      aCellOffset: pc.SEMANTIC_TEXCOORD0,
    },
    vertexGLSL,
    fragmentGLSL,
  });
  mat.blendType = blendType;
  mat.depthWrite = false;
  mat.cull = pc.CULLFACE_NONE;
  mat.setParameter('uCameraPos', [0, 0, 0]);
  mat.setParameter('uCameraRight', [1, 0, 0]);
  mat.setParameter('uCameraUp', [0, 1, 0]);
  mat.setParameter('uImpactCenter', [0, -240]);
  mat.setParameter('uSpreadRadius', 0);
  mat.setParameter('uCraterRadius', CRATER_RADIUS);
  mat.setParameter('uTime', 0);
  mat.setParameter('uWorldHalf', WORLD_HALF);
  mat.setParameter('uHeightMapStride', 241);
  mat.update();
  return mat;
}

function createGlowMaterial(
  srgb: [number, number, number],
  emissiveIntensity: number,
  blendType: number,
  opacity = 1,
): pc.StandardMaterial {
  const mat = new pc.StandardMaterial();
  const color = new pc.Color(srgb[0], srgb[1], srgb[2]).linear();
  mat.diffuse = color;
  mat.emissive = color;
  mat.emissiveIntensity = emissiveIntensity;
  mat.useLighting = false;
  mat.blendType = blendType;
  mat.depthWrite = blendType === pc.BLEND_NONE;
  mat.cull = pc.CULLFACE_NONE;
  if (opacity < 1) {
    mat.opacity = opacity;
  }
  mat.update();
  return mat;
}

/**
 * Orchestrates the colossal magma-veined asteroid + 14 companion meteorites crossing the distant sky,
 * the cataclysmic expanding 3D fireball dome, supersonic Mach blast wall, apocalyptic sky shift,
 * violent seismic camera tremor, and GPU-driven ballistic molten ejecta + fiery sparks.
 */
export class VolcanicFrontFx {
  private readonly app: pc.AppBase;
  public readonly entity: pc.Entity;

  private readonly meteorRoot: pc.Entity;
  private readonly asteroidBody: pc.Entity;
  private readonly companionMeteorites: MeteoriteRig[] = [];
  private readonly meteorLight: pc.Entity;
  private readonly flashLight: pc.Entity;
  private readonly craterLight: pc.Entity;
  private readonly fireballDomeEntity: pc.Entity;
  private readonly shockwaveEntity: pc.Entity;
  private readonly shockwaveWallEntity: pc.Entity;
  private readonly sparksEntity: pc.Entity;

  private readonly asteroidMesh: pc.Mesh;
  private readonly fireballSphereMesh: pc.Mesh;
  private readonly shockwaveMesh: pc.Mesh;
  private readonly shockwaveWallMesh: pc.Mesh;
  private readonly sparksMesh: pc.Mesh;

  private readonly asteroidMat: pc.StandardMaterial;
  private readonly bowShockMat: pc.StandardMaterial;
  private readonly comaMat: pc.StandardMaterial;
  private readonly primaryTailMat: pc.StandardMaterial;
  private readonly companionFlashMat: pc.StandardMaterial;
  private readonly fireballDomeMat: pc.ShaderMaterial;
  private readonly shockwaveMat: pc.StandardMaterial;
  private readonly shockwaveWallMat: pc.ShaderMaterial;
  private readonly sparksMaterial: pc.ShaderMaterial;

  private readonly camPosVec = new Float32Array(3);
  private readonly camRightVec = new Float32Array(3);
  private readonly camUpVec = new Float32Array(3);
  private readonly centerVec = new Float32Array(2);
  private readonly fireballPosVec = new Float32Array(3);
  private readonly wallPosVec = new Float32Array(3);

  private readonly baseAmbient = new pc.Color(0.45, 0.26, 0.2);
  private readonly hotAmbient = new pc.Color(0.92, 0.34, 0.12);
  private readonly workingAmbient = new pc.Color();
  private readonly baseSky = new pc.Color(0.18, 0.09, 0.07);
  private readonly apocSky = new pc.Color(0.42, 0.13, 0.05);
  private readonly flashSky = new pc.Color(1.0, 0.94, 0.82);
  private readonly workingSky = new pc.Color();
  private texturesBound = false;

  constructor(app: pc.AppBase) {
    this.app = app;
    const device = app.graphicsDevice;
    this.entity = new pc.Entity('VolcanicFrontFX', app);

    // 1. Colossal 96m craggy magma-veined asteroid + 1580m hypersonic sky contrail
    this.meteorRoot = new pc.Entity('ColossalAsteroid', app);
    this.asteroidMesh = createSphereMesh(device, 26, 36, 48, true);
    this.asteroidMat = new pc.StandardMaterial();
    this.asteroidMat.diffuse = new pc.Color(0.85, 0.78, 0.72);
    this.asteroidMat.diffuseVertexColor = true;
    this.asteroidMat.emissive = new pc.Color(1.0, 0.9, 0.75);
    this.asteroidMat.emissiveVertexColor = true;
    this.asteroidMat.emissiveIntensity = 4.8;
    this.asteroidMat.shininess = 12;
    this.asteroidMat.update();

    this.asteroidBody = new pc.Entity('AsteroidBody', app);
    this.asteroidBody.addComponent('render', {
      meshInstances: [new pc.MeshInstance(this.asteroidMesh, this.asteroidMat)],
      castShadows: false,
      receiveShadows: false,
    });
    this.meteorRoot.addChild(this.asteroidBody);

    this.bowShockMat = createGlowMaterial([1.0, 0.98, 0.88], 8.8, pc.BLEND_ADDITIVE, 0.88);
    const bowShock = new pc.Entity('AsteroidBowShock', app);
    bowShock.addComponent('render', { type: 'sphere', material: this.bowShockMat, castShadows: false });
    bowShock.setLocalPosition(0, 0, -34);
    bowShock.setLocalScale(155, 136, 98);
    this.meteorRoot.addChild(bowShock);

    this.comaMat = createGlowMaterial([1.0, 0.52, 0.08], 6.5, pc.BLEND_ADDITIVE, 0.75);
    const coma = new pc.Entity('AsteroidComa', app);
    coma.addComponent('render', { type: 'sphere', material: this.comaMat, castShadows: false });
    coma.setLocalScale(245, 245, 255);
    this.meteorRoot.addChild(coma);

    this.primaryTailMat = createGlowMaterial([1.0, 0.42, 0.06], 5.8, pc.BLEND_ADDITIVE, 0.72);
    const primaryTail = new pc.Entity('AsteroidPrimaryTail', app);
    primaryTail.addComponent('render', { type: 'cone', material: this.primaryTailMat, castShadows: false });
    primaryTail.setLocalEulerAngles(90, 0, 0);
    primaryTail.setLocalPosition(0, 0, 720);
    primaryTail.setLocalScale(175, 1580, 175);
    this.meteorRoot.addChild(primaryTail);

    this.entity.addChild(this.meteorRoot);

    // 2. Companion meteorite swarm (visual sky-crossing shower only; never triggers planetary destruction)
    this.companionFlashMat = createGlowMaterial([1.0, 0.82, 0.35], 6.5, pc.BLEND_ADDITIVE, 0.92);
    for (const desc of createCompanionDescriptors()) {
      const root = new pc.Entity('CompanionMeteorite', app);
      const body = new pc.Entity('CompanionCore', app);
      body.addComponent('render', { type: 'sphere', material: this.comaMat, castShadows: false });
      body.setLocalScale(desc.scale, desc.scale, desc.scale);
      root.addChild(body);

      const trail = new pc.Entity('CompanionTail', app);
      trail.addComponent('render', { type: 'cone', material: this.primaryTailMat, castShadows: false });
      trail.setLocalEulerAngles(90, 0, 0);
      const tailLen = 240 + desc.scale * 16;
      trail.setLocalPosition(0, 0, tailLen * 0.48);
      trail.setLocalScale(desc.scale * 1.8, tailLen, desc.scale * 1.8);
      root.addChild(trail);

      root.enabled = false;
      this.entity.addChild(root);

      const flashEntity = new pc.Entity('CompanionFlash', app);
      flashEntity.addComponent('render', {
        type: 'sphere',
        material: this.companionFlashMat,
        castShadows: false,
      });
      flashEntity.enabled = false;
      this.entity.addChild(flashEntity);

      this.companionMeteorites.push({
        root,
        flashEntity,
        offsetX: desc.dx,
        offsetZ: desc.dz,
        timeLag: desc.timeLag,
        speedScale: desc.speedScale,
        baseScale: desc.scale,
      });
    }

    // 3. Dynamic point lights
    this.meteorLight = new pc.Entity('MeteorStreakLight', app);
    this.meteorLight.addComponent('light', {
      type: 'omni',
      color: new pc.Color(1.0, 0.72, 0.34).linear(),
      intensity: 28,
      range: 1400,
      castShadows: false,
    });
    this.entity.addChild(this.meteorLight);

    this.flashLight = new pc.Entity('ImpactFlashLight', app);
    this.flashLight.addComponent('light', {
      type: 'omni',
      color: new pc.Color(1.0, 0.90, 0.68).linear(),
      intensity: 0,
      range: 2400,
      castShadows: false,
    });
    this.entity.addChild(this.flashLight);

    this.craterLight = new pc.Entity('CraterInfernoLight', app);
    this.craterLight.addComponent('light', {
      type: 'omni',
      color: new pc.Color(1.0, 0.42, 0.08).linear(),
      intensity: 0,
      range: 820,
      castShadows: false,
    });
    this.entity.addChild(this.craterLight);

    // 4. Expanding 3D Impact Fireball Dome (50m -> 520m diameter)
    this.fireballSphereMesh = createSphereMesh(device, 24, 32, 1, false);
    this.fireballDomeMat = new pc.ShaderMaterial({
      uniqueName: 'CataclysmFireballDome',
      attributes: {
        aPosition: pc.SEMANTIC_POSITION,
        aNormal: pc.SEMANTIC_NORMAL,
      },
      vertexGLSL: FIREBALL_DOME_VS,
      fragmentGLSL: FIREBALL_DOME_FS,
    });
    this.fireballDomeMat.blendType = pc.BLEND_NORMAL;
    this.fireballDomeMat.depthWrite = false;
    this.fireballDomeMat.cull = pc.CULLFACE_NONE;
    this.fireballDomeMat.setParameter('uFireballPos', [0, 0, 0]);
    this.fireballDomeMat.setParameter('uFireballRadius', 25);
    this.fireballDomeMat.setParameter('uTime', 0);
    this.fireballDomeMat.setParameter('uDomeAge', 0);
    this.fireballDomeMat.setParameter('uDomeFade', 0);
    this.fireballDomeMat.update();

    const domeMi = new pc.MeshInstance(this.fireballSphereMesh, this.fireballDomeMat);
    domeMi.cull = false;
    this.fireballDomeEntity = new pc.Entity('ImpactFireballDome', app);
    this.fireballDomeEntity.addComponent('render', {
      meshInstances: [domeMi],
      castShadows: false,
      receiveShadows: false,
    });
    this.fireballDomeEntity.enabled = false;
    this.entity.addChild(this.fireballDomeEntity);

    // 5. Dual Supersonic Shockwave: Ground Ring + 280m Mach Blast Wall
    this.shockwaveMesh = createShockwaveRingMesh(device, 48);
    this.shockwaveMat = createGlowMaterial([1.0, 0.84, 0.45], 7.5, pc.BLEND_ADDITIVE, 0.96);
    this.shockwaveEntity = new pc.Entity('ImpactShockwaveRing', app);
    const shockwaveMi = new pc.MeshInstance(this.shockwaveMesh, this.shockwaveMat);
    shockwaveMi.cull = false;
    this.shockwaveEntity.addComponent('render', {
      meshInstances: [shockwaveMi],
      castShadows: false,
      receiveShadows: false,
    });
    this.shockwaveEntity.enabled = false;
    this.entity.addChild(this.shockwaveEntity);

    this.shockwaveWallMesh = createShockwaveCylinderMesh(device, 48);
    this.shockwaveWallMat = new pc.ShaderMaterial({
      uniqueName: 'SupersonicBlastWall',
      attributes: { aPosition: pc.SEMANTIC_POSITION },
      vertexGLSL: BLAST_WALL_VS,
      fragmentGLSL: BLAST_WALL_FS,
    });
    this.shockwaveWallMat.blendType = pc.BLEND_ADDITIVE;
    this.shockwaveWallMat.depthWrite = false;
    this.shockwaveWallMat.cull = pc.CULLFACE_NONE;
    this.shockwaveWallMat.setParameter('uWallPos', [0, 0, 0]);
    this.shockwaveWallMat.setParameter('uWallRadius', 1);
    this.shockwaveWallMat.setParameter('uWallHeight', 280);
    this.shockwaveWallMat.setParameter('uTime', 0);
    this.shockwaveWallMat.setParameter('uWallAlpha', 0);
    this.shockwaveWallMat.update();

    const wallMi = new pc.MeshInstance(this.shockwaveWallMesh, this.shockwaveWallMat);
    wallMi.cull = false;
    this.shockwaveWallEntity = new pc.Entity('SupersonicBlastWall', app);
    this.shockwaveWallEntity.addComponent('render', {
      meshInstances: [wallMi],
      castShadows: false,
      receiveShadows: false,
    });
    this.shockwaveWallEntity.enabled = false;
    this.entity.addChild(this.shockwaveWallEntity);

    // 6. Ballistic molten ejecta boulders & fiery embers/sparks (1 draw call)
    this.sparksMesh = createToroidalPuffMesh(device, SPARKS_PER_CELL);
    this.sparksMaterial = createToroidalShaderMaterial(
      'ToroidalSparksAndEjecta',
      SPARK_VERTEX_GLSL,
      SPARK_FRAGMENT_GLSL,
      pc.BLEND_ADDITIVE,
    );
    const sparksMi = new pc.MeshInstance(this.sparksMesh, this.sparksMaterial);
    sparksMi.cull = false;
    sparksMi.drawBucket = 126;
    this.sparksEntity = new pc.Entity('ToroidalSparksAndEjecta', app);
    this.sparksEntity.addComponent('render', {
      meshInstances: [sparksMi],
      castShadows: false,
      receiveShadows: false,
    });
    this.entity.addChild(this.sparksEntity);
  }

  private bindTerrainTextures(terrain: ImpactHeightSampler): void {
    if (this.texturesBound) return;
    const heightMap = terrain.getHeightMapTexture();
    const fractureMap = terrain.getFractureTexture();
    if (heightMap instanceof pc.Texture && fractureMap instanceof pc.Texture) {
      this.sparksMaterial.setParameter('uHeightMap', heightMap);
      this.sparksMaterial.setParameter('uFractureMap', fractureMap);
      this.sparksMaterial.setParameter('uHeightMapStride', heightMap.width);
      this.fireballDomeMat.setParameter('uFractureMap', fractureMap);
      this.shockwaveWallMat.setParameter('uFractureMap', fractureMap);
      this.texturesBound = true;
    }
  }

  private updateCompanionMeteorites(
    state: GameState,
    terrain: ImpactHeightSampler,
  ): void {
    const cx = state.impactCenter.x;
    const cz = state.impactCenter.z;
    const postImpactSec =
      state.impactPhase === 'meteor_falling'
        ? -1
        : state.impactPhase === 'impact_flash'
          ? state.phaseElapsed
          : IMPACT_FLASH_DURATION + state.phaseElapsed;

    const mainProgress =
      state.impactPhase === 'meteor_falling'
        ? state.phaseElapsed / METEOR_FALL_DURATION
        : 1 + postImpactSec / METEOR_FALL_DURATION;

    for (const m of this.companionMeteorites) {
      const localP = (mainProgress - m.timeLag) * m.speedScale;
      if (localP <= 0 || localP >= 1.15) {
        m.root.enabled = false;
        m.flashEntity.enabled = false;
        continue;
      }

      const tx = cx + m.offsetX;
      const tz = cz + m.offsetZ;
      const ty = terrain.sampleHeightAt(tx, tz);

      if (localP < 1.0) {
        const inv = 1 - Math.pow(localP, 1.68);
        const mx = tx + METEOR_START_OFFSET[0] * inv;
        const my = ty + METEOR_START_OFFSET[1] * inv;
        const mz = tz + METEOR_START_OFFSET[2] * inv;
        if (my > ty) {
          m.root.enabled = true;
          m.root.setPosition(mx, my, mz);
          m.root.lookAt(tx, ty, tz);
          m.flashEntity.enabled = false;
        } else {
          m.root.enabled = false;
          m.flashEntity.enabled = false;
        }
      } else {
        m.root.enabled = false;
        const flashPhase = (localP - 1.0) / 0.15;
        m.flashEntity.enabled = true;
        m.flashEntity.setPosition(tx, ty + 8, tz);
        const s = m.baseScale * 5.2 * (1 - flashPhase);
        m.flashEntity.setLocalScale(s, s, s);
      }
    }
  }

  private updateAsteroidAndExplosion(
    state: GameState,
    impactY: number,
    camXZ: Vec2XZ,
    terrain: ImpactHeightSampler,
  ): { flashIntensity: number; shockProximity: number; preImpactRumble: number } {
    const cx = state.impactCenter.x;
    const cz = state.impactCenter.z;

    this.updateCompanionMeteorites(state, terrain);

    if (state.impactPhase === 'meteor_falling') {
      const progress = Math.min(1, Math.max(0, state.phaseElapsed / METEOR_FALL_DURATION));
      const eased = Math.pow(progress, 1.74);
      const inv = 1 - eased;
      const mx = cx + METEOR_START_OFFSET[0] * inv;
      const my = impactY + METEOR_START_OFFSET[1] * inv;
      const mz = cz + METEOR_START_OFFSET[2] * inv;

      this.meteorRoot.enabled = true;
      this.meteorRoot.setPosition(mx, my, mz);
      this.meteorRoot.lookAt(cx, impactY, cz);
      this.asteroidBody.setLocalEulerAngles(progress * 760, progress * 520, progress * 340);

      this.meteorLight.enabled = true;
      this.meteorLight.setPosition(mx, my, mz);
      if (this.meteorLight.light) {
        this.meteorLight.light.intensity = 28 + 52 * Math.pow(eased, 2.4);
        this.meteorLight.light.range = 950 + 750 * eased;
      }
      if (this.flashLight.light) this.flashLight.light.intensity = 0;
      if (this.craterLight.light) this.craterLight.light.intensity = 0;
      this.fireballDomeEntity.enabled = false;
      this.shockwaveEntity.enabled = false;
      this.shockwaveWallEntity.enabled = false;

      const remainingFallSec = Math.max(0, METEOR_FALL_DURATION - state.phaseElapsed);
      const preImpactRumble = remainingFallSec < 0.85 ? Math.pow(1 - remainingFallSec / 0.85, 2.0) : 0;
      const preImpactFlash = Math.max(0, eased - 0.78) * 4.5;
      return {
        flashIntensity: Math.min(1, preImpactFlash),
        shockProximity: 0,
        preImpactRumble,
      };
    }

    this.meteorRoot.enabled = false;
    this.meteorLight.enabled = false;

    const postImpactSec =
      state.impactPhase === 'impact_flash'
        ? state.phaseElapsed
        : IMPACT_FLASH_DURATION + state.phaseElapsed;
    const flashIntensity = Math.max(0, 1 - postImpactSec / 1.5);

    this.flashLight.setPosition(cx, impactY + 75, cz);
    if (this.flashLight.light) {
      this.flashLight.light.intensity = 85 * Math.pow(flashIntensity, 1.4);
    }

    const craterFlicker =
      0.86 +
      0.18 * Math.sin(state.elapsedTime * 6.2) +
      0.08 * Math.cos(state.elapsedTime * 12.1);
    const craterActive = Math.min(1, state.spreadRadius / CRATER_RADIUS);
    this.craterLight.setPosition(cx, impactY + 36, cz);
    if (this.craterLight.light) {
      this.craterLight.light.intensity = 24 * craterActive * craterFlicker;
    }

    // 3D Fireball Dome (expanding violently to > 750m diameter)
    if (postImpactSec < 3.4) {
      const domeRadius = 38 + 340 * (1 - Math.exp(-postImpactSec * 5.2));
      const domeAge = Math.min(1, postImpactSec / 3.4);
      const domeFade = Math.max(0, 1 - Math.max(0, postImpactSec - 1.3) / 2.1);
      this.fireballPosVec[0] = cx;
      this.fireballPosVec[1] = impactY - 6;
      this.fireballPosVec[2] = cz;
      this.fireballDomeMat.setParameter('uFireballPos', this.fireballPosVec);
      this.fireballDomeMat.setParameter('uFireballRadius', domeRadius);
      this.fireballDomeMat.setParameter('uTime', state.elapsedTime);
      this.fireballDomeMat.setParameter('uDomeAge', domeAge);
      this.fireballDomeMat.setParameter('uDomeFade', domeFade);
      this.fireballDomeEntity.enabled = domeFade > 0.01;
    } else {
      this.fireballDomeEntity.enabled = false;
    }

    // Dual Supersonic Shockwave (Ground ring + 280m Mach Blast Wall)
    let shockProximity = 0;
    if (state.shockwaveRadius > 0.5 && state.shockwaveRadius < SHOCKWAVE_MAX_RADIUS) {
      const normR = state.shockwaveRadius / SHOCKWAVE_MAX_RADIUS;
      const fadeIn = Math.min(1, state.shockwaveRadius / 25);
      const fadeOut = Math.max(0, 1 - normR);
      const alpha = fadeIn * fadeOut * 0.96;

      this.shockwaveEntity.enabled = alpha > 0.01;
      const lift = Math.min(32, 5 + state.shockwaveRadius * 0.03);
      this.shockwaveEntity.setPosition(cx, impactY + lift, cz);
      this.shockwaveEntity.setLocalScale(state.shockwaveRadius, 1, state.shockwaveRadius);
      this.shockwaveMat.opacity = alpha;
      this.shockwaveMat.update();

      this.wallPosVec[0] = cx;
      this.wallPosVec[1] = impactY - 14;
      this.wallPosVec[2] = cz;
      this.shockwaveWallMat.setParameter('uWallPos', this.wallPosVec);
      this.shockwaveWallMat.setParameter('uWallRadius', state.shockwaveRadius);
      this.shockwaveWallMat.setParameter('uWallHeight', 280 * (1 - normR * 0.38));
      this.shockwaveWallMat.setParameter('uTime', state.elapsedTime);
      this.shockwaveWallMat.setParameter('uWallAlpha', alpha * 0.92);
      this.shockwaveWallEntity.enabled = alpha > 0.01;

      const camDistToImpact = Math.hypot(camXZ.x - cx, camXZ.z - cz);
      const ringDelta = Math.abs(camDistToImpact - state.shockwaveRadius);
      shockProximity = Math.max(0, 1 - ringDelta / 120) * fadeOut;
    } else {
      this.shockwaveEntity.enabled = false;
      this.shockwaveWallEntity.enabled = false;
    }

    return { flashIntensity, shockProximity, preImpactRumble: 0 };
  }

  public update(
    _dt: number,
    state: GameState,
    terrain: ImpactHeightSampler,
    camera: pc.Entity,
  ): VolcanicShakeOffset {
    if (state.impactPhase === 'idle') {
      this.entity.enabled = false;
      if (camera.camera) {
        camera.camera.clearColor = this.baseSky;
      }
      this.app.scene.ambientLight.copy(this.baseAmbient.linear());
      return { x: 0, y: 0, z: 0 };
    }

    this.entity.enabled = true;
    this.bindTerrainTextures(terrain);

    const impactY = terrain.sampleHeightAt(state.impactCenter.x, state.impactCenter.z);
    const camXZ: Vec2XZ = { x: state.cameraPos.x, z: state.cameraPos.z };
    const { flashIntensity, shockProximity, preImpactRumble } = this.updateAsteroidAndExplosion(
      state,
      impactY,
      camXZ,
      terrain,
    );

    // Push Toroidal Sliding Grid uniforms (true 3D camera vectors + zero fixed cap)
    this.camPosVec[0] = state.cameraPos.x;
    this.camPosVec[1] = state.cameraPos.y;
    this.camPosVec[2] = state.cameraPos.z;
    const camRight = camera.right;
    const camUp = camera.up;
    this.camRightVec[0] = camRight.x;
    this.camRightVec[1] = camRight.y;
    this.camRightVec[2] = camRight.z;
    this.camUpVec[0] = camUp.x;
    this.camUpVec[1] = camUp.y;
    this.camUpVec[2] = camUp.z;
    this.centerVec[0] = state.impactCenter.x;
    this.centerVec[1] = state.impactCenter.z;

    this.sparksMaterial.setParameter('uCameraPos', this.camPosVec);
    this.sparksMaterial.setParameter('uCameraRight', this.camRightVec);
    this.sparksMaterial.setParameter('uCameraUp', this.camUpVec);
    this.sparksMaterial.setParameter('uImpactCenter', this.centerVec);
    this.sparksMaterial.setParameter('uSpreadRadius', state.spreadRadius);
    this.sparksMaterial.setParameter('uCraterRadius', CRATER_RADIUS);
    this.sparksMaterial.setParameter('uTime', state.elapsedTime);

    // Apocalyptic sky shift & ambient pulse
    const camDist = Math.hypot(camXZ.x - state.impactCenter.x, camXZ.z - state.impactCenter.z);
    const apocProgress = state.impactPhase === 'meteor_falling' ? 0 : Math.min(1, state.spreadRadius / 750);
    const inFractureZone =
      state.spreadRadius > 1 ? Math.max(0, Math.min(1, 1 - (camDist - state.spreadRadius) / 180)) : 0;
    const nearCrater = state.spreadRadius > 1 ? Math.max(0, Math.min(1, 1 - camDist / (CRATER_RADIUS * 2.8))) : 0;

    this.workingSky.lerp(this.baseSky, this.apocSky, apocProgress);
    if (flashIntensity > 0.005) {
      this.workingSky.lerp(this.workingSky, this.flashSky, Math.min(1, flashIntensity * 1.35));
    }
    if (camera.camera) {
      camera.camera.clearColor = this.workingSky;
    }

    const warmFactor = Math.min(
      1,
      flashIntensity * 1.25 + apocProgress * 0.5 + nearCrater * 0.65 + inFractureZone * 0.3,
    );
    this.workingAmbient.lerp(this.baseAmbient, this.hotAmbient, warmFactor);
    this.app.scene.ambientLight.copy(this.workingAmbient.linear());

    // Visceral multi-frequency camera shake
    const impactJolt = Math.pow(flashIntensity, 1.4) * 5.4;
    const blastPassage = Math.pow(shockProximity, 1.2) * 4.8;
    const preRumble = preImpactRumble * 1.35;
    const craterTremor = nearCrater * 0.42;
    const shakeAmp = Math.min(6.8, impactJolt + blastPassage + preRumble + craterTremor);

    const t = state.elapsedTime;
    return {
      x:
        (Math.sin(t * 42.0) * 0.55 +
          Math.sin(t * 73.0 + 1.2) * 0.32 +
          Math.cos(t * 19.0) * 0.45) *
        shakeAmp,
      y:
        (Math.cos(t * 36.0) * 0.62 +
          Math.sin(t * 64.0 + 2.1) * 0.35 +
          Math.sin(t * 14.0) * 0.42) *
        shakeAmp,
      z:
        (Math.sin(t * 28.0 + 0.8) * 0.48 +
          Math.cos(t * 55.0 + 1.7) * 0.28 +
          Math.cos(t * 11.0) * 0.35) *
        shakeAmp,
    };
  }

  public destroy(): void {
    this.sparksMaterial.destroy();
    this.shockwaveMat.destroy();
    this.shockwaveWallMat.destroy();
    this.fireballDomeMat.destroy();
    this.asteroidMat.destroy();
    this.bowShockMat.destroy();
    this.comaMat.destroy();
    this.primaryTailMat.destroy();
    this.companionFlashMat.destroy();
    this.sparksMesh.destroy();
    this.shockwaveMesh.destroy();
    this.shockwaveWallMesh.destroy();
    this.fireballSphereMesh.destroy();
    this.asteroidMesh.destroy();
    this.entity.destroy();
  }
}
