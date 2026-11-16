import * as pc from 'playcanvas';
import type {
  EventStepResult,
  EventUpdateContext,
  Vec3XYZ,
  WorldEventHandler,
  WorldEventPhase,
  WorldEventType,
} from '../../types/index.ts';

const TORNADO_WARNING_DURATION = 5;
const TORNADO_ACTIVE_DURATION = 16;
const TORNADO_DAMAGE_RATE = 8;
const TORNADO_DAMAGE_RADIUS = 42;
const TORNADO_DAMAGE_RADIUS_SQ = TORNADO_DAMAGE_RADIUS * TORNADO_DAMAGE_RADIUS;

const FUNNEL_HEIGHT = 180;
const FUNNEL_RINGS = 24;
const FUNNEL_RADIAL_SEGS = 32;
const FUNNEL_BASE_RADIUS = 6.0;
const FUNNEL_TOP_RADIUS = 52.0;

const SKIRT_PUFFS_PER_TORNADO = 12;
const DEBRIS_PER_TORNADO = 24;

const BASE_OUTER_ALPHA = 0.92;
const BASE_INNER_ALPHA = 0.95;
const BASE_SKIRT_OPACITY = 0.90;

const DEFAULT_CAM_POS: Vec3XYZ = { x: 0, y: 50, z: 200 };

const TORNADO_VERTEX_SHADER = /* glsl */ `
attribute vec3 vertex_position;
attribute vec3 vertex_normal;
attribute vec2 vertex_texCoord0;

uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
uniform vec3 uCameraPos;

uniform float uTime;
uniform float uGrowth;
uniform float uSwayIntensity;
uniform float uDescendOffset;
uniform float uPhaseOffset;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;

void main(void) {
    vUv = vertex_texCoord0;
    float v = vertex_texCoord0.y;
    float growth = clamp(uGrowth, 0.001, 1.0);

    vec3 localPos = vertex_position;
    localPos.x *= growth;
    localPos.z *= growth;
    localPos.y = localPos.y * growth + uDescendOffset;

    // Sinuous traveling S-curve horizontal sway along v
    float swayPhase = v * 4.5 - uTime * 3.2 + uPhaseOffset;
    float swayAmp = v * 12.0 * uSwayIntensity * growth;
    localPos.x += sin(swayPhase) * swayAmp;
    localPos.z += cos(swayPhase * 0.88 + 0.6) * (swayAmp * 0.85);

    vec4 worldPos = matrix_model * vec4(localPos, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(matrix_model) * vertex_normal);
    vViewDir = uCameraPos - vWorldPos;

    gl_Position = matrix_viewProjection * worldPos;
}
`;

const TORNADO_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;

uniform float uTime;
uniform float uAlphaMultiplier;
uniform float uSpinSpeed;
uniform float uSpinDirection;
uniform vec3 uColorBase;
uniform vec3 uColorCore;

void main(void) {
    float u = vUv.x;
    float v = vUv.y;

    float spin = uTime * uSpinSpeed * uSpinDirection;

    // Multi-octave helical wind streaks scrolling diagonally around the cone
    // Octave 1: Major spiral winds (3 helical wraps)
    float streak1 = sin((u * 3.0 + v * 1.8 - spin) * 6.2831853);
    streak1 = streak1 * 0.5 + 0.5;
    streak1 = pow(streak1, 1.8);

    // Octave 2: Counter/faster fine air streaks (6 helical wraps)
    float streak2 = sin((u * 6.0 + v * 3.2 - spin * 1.5 + 1.57) * 6.2831853);
    streak2 = streak2 * 0.5 + 0.5;
    streak2 = pow(streak2, 2.2);

    // Octave 3: High-frequency vertical shear & turbulence
    float turb = sin(v * 24.0 - spin * 2.4 + sin(u * 10.0 * 6.2831853) * 2.2);
    turb = turb * 0.5 + 0.5;

    // Combined swirling wind streak pattern (0..1)
    float windStreaks = streak1 * 0.52 + streak2 * 0.32 + turb * 0.22;
    windStreaks = clamp(windStreaks, 0.0, 1.0);

    // View & Normal vectors
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewDir);
    float ndotv = abs(dot(N, V));

    // Silhouette feathering: smoothly tapers to 0 only at extreme grazing angle (< 0.065)
    // to eliminate hard polygon edges while keeping 94% of the vortex solid, dense and prominent!
    float silhouetteFade = smoothstep(0.005, 0.065, ndotv);

    // Volumetric dust density: dense, highly visible presence with internal wind streak variation
    float volumeDensity = 0.70 + 0.30 * windStreaks;

    // Smooth vertical fades at ground touchdown and sky cloud deck
    float bottomFade = smoothstep(0.0, 0.035, v);
    float topFade = smoothstep(1.0, 0.92, v);
    float verticalFade = bottomFade * topFade;

    // Total alpha: dense, highly visible swirling air & dust
    float alpha = volumeDensity * silhouetteFade * verticalFade * uAlphaMultiplier;
    alpha = clamp(alpha, 0.0, 0.96);

    // Vibrant high-contrast Martian dust colors: deep ochre body with illuminated golden streaks
    vec3 col = mix(uColorBase, uColorCore, pow(windStreaks, 1.25));
    // Glowing wind swirl boost
    col += uColorCore * pow(windStreaks, 2.6) * 0.45;

    gl_FragColor = vec4(col, alpha);
}
`;

interface SkirtPuff {
  readonly entity: pc.Entity;
  readonly baseRadius: number;
  readonly baseScale: number;
  readonly baseAngle: number;
  readonly rotSpeed: number;
  readonly rollSpeed: number;
  readonly altitude: number;
  rollAngle: number;
}

interface DebrisParticle {
  readonly entity: pc.Entity;
  height: number;
  climbSpeed: number;
  orbitAngle: number;
  orbitSpeed: number;
  orbitRadiusFactor: number;
  rotSpeedX: number;
  rotSpeedY: number;
  rotSpeedZ: number;
  baseScale: number;
}

interface TornadoInstance {
  readonly root: pc.Entity;
  readonly outerFunnelEntity: pc.Entity;
  readonly outerMeshInstance: pc.MeshInstance;
  readonly innerFunnelEntity: pc.Entity;
  readonly innerMeshInstance: pc.MeshInstance;
  readonly skirtPuffs: SkirtPuff[];
  readonly debris: DebrisParticle[];
  readonly light: pc.Entity;
  readonly spinDirection: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  wanderPhase1: number;
  wanderPhase2: number;
}

/**
 * Generates an offscreen procedural soft dust cloud texture using multi-octave
 * FBM harmonic turbulence and radial Gaussian/cosine cloud puff clusters with feathered alpha falloff.
 */
function createSoftDustTexture(device: pc.GraphicsDevice, size = 256): pc.Texture {
  const texture = new pc.Texture(device, {
    width: size,
    height: size,
    format: pc.PIXELFORMAT_RGBA8,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    mipmaps: true,
  });

  const pixels = new Uint8ClampedArray(size * size * 4);
  const half = size * 0.5;

  const lobes = [
    { x: 0.0, y: 0.0, r: 0.88, w: 1.0 },
    { x: -0.22, y: -0.2, r: 0.62, w: 0.85 },
    { x: 0.26, y: -0.16, r: 0.6, w: 0.8 },
    { x: -0.18, y: 0.26, r: 0.58, w: 0.78 },
    { x: 0.24, y: 0.22, r: 0.54, w: 0.74 },
    { x: -0.32, y: 0.02, r: 0.48, w: 0.65 },
    { x: 0.3, y: -0.04, r: 0.52, w: 0.68 },
    { x: 0.04, y: -0.32, r: 0.46, w: 0.62 },
  ];

  for (let py = 0; py < size; py++) {
    const ny = (py - half) / half;
    for (let px = 0; px < size; px++) {
      const nx = (px - half) / half;
      const d = Math.hypot(nx, ny);
      if (d >= 1.0) continue;

      const radialFalloff = 0.5 * (1 + Math.cos(d * Math.PI));

      let lobeSum = 0;
      for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const ld = Math.hypot(nx - l.x, ny - l.y) / l.r;
        if (ld < 1.0) {
          const lw = 0.5 * (1 + Math.cos(ld * Math.PI));
          lobeSum += l.w * Math.pow(lw, 1.4);
        }
      }

      let fbm = 0;
      let amp = 0.5;
      let freq = 3.6;
      for (let o = 0; o < 4; o++) {
        const s =
          Math.sin(nx * freq + Math.cos(ny * freq * 0.9 + 1.2)) *
          Math.cos(ny * freq - Math.sin(nx * freq * 0.8 + 2.0));
        fbm += (s * 0.5 + 0.5) * amp;
        freq *= 2.15;
        amp *= 0.48;
      }

      const combined = lobeSum * (0.62 + 0.48 * fbm) * radialFalloff;
      const density = Math.min(1.0, Math.max(0, combined * 0.96));

      const r = Math.round(225 * (0.82 + 0.28 * density) + 24 * (1 - density));
      const g = Math.round(118 * (0.78 + 0.32 * density) + 16 * (1 - density));
      const b = Math.round(62 * (0.74 + 0.36 * density) + 12 * (1 - density));
      const a = Math.round(Math.pow(density, 1.1) * 248);

      const idx = (py * size + px) * 4;
      pixels[idx] = Math.min(255, r);
      pixels[idx + 1] = Math.min(255, g);
      pixels[idx + 2] = Math.min(255, b);
      pixels[idx + 3] = Math.min(255, a);
    }
  }

  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.createImageData(size, size);
      imgData.data.set(pixels);
      ctx.putImageData(imgData, 0, 0);
      texture.setSource(canvas);
      return texture;
    }
  }

  const texPixels = texture.lock() as Uint8Array | Uint8ClampedArray;
  texPixels.set(pixels);
  texture.unlock();
  return texture;
}

/**
 * Creates a procedural hollow open-ended trumpet cone mesh for the tornado funnel.
 * Uses 24 vertical rings by 32 radial segments with smooth concave trumpet flaring:
 * narrow base (r ~ 6), slender waist, flared upper funnel (r ~ 52), height ~ 180.
 * Normals and UVs are computed analytically for seamless shading and texture wrapping.
 */
function createTrumpetConeMesh(
  device: pc.GraphicsDevice,
  rings = FUNNEL_RINGS,
  radialSegments = FUNNEL_RADIAL_SEGS,
  height = FUNNEL_HEIGHT,
  baseR = FUNNEL_BASE_RADIUS,
  topR = FUNNEL_TOP_RADIUS,
): pc.Mesh {
  const numVertices = (rings + 1) * (radialSegments + 1);
  const numTriangles = rings * radialSegments * 2;
  const positions = new Float32Array(numVertices * 3);
  const normals = new Float32Array(numVertices * 3);
  const uvs = new Float32Array(numVertices * 2);
  const indices = new Uint16Array(numTriangles * 3);

  let vIdx = 0;
  let uvIdx = 0;

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const y = v * height;

    // Smooth concave / trumpet profile: slender lower column, flaring rapidly at top
    const radius = baseR + 3.0 * Math.pow(v, 1.5) + (topR - baseR - 3.0) * Math.pow(v, 3.0);
    const dr_dv = 4.5 * Math.pow(v, 0.5) + 3.0 * (topR - baseR - 3.0) * Math.pow(v, 2.0);
    const dr_dy = dr_dv / height;
    const normalHyp = Math.hypot(1.0, dr_dy);
    const ny = -dr_dy / normalHyp;
    const nRadial = 1.0 / normalHyp;

    for (let s = 0; s <= radialSegments; s++) {
      const u = s / radialSegments;
      const angle = u * Math.PI * 2.0;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      positions[vIdx * 3 + 0] = cosA * radius;
      positions[vIdx * 3 + 1] = y;
      positions[vIdx * 3 + 2] = sinA * radius;

      normals[vIdx * 3 + 0] = cosA * nRadial;
      normals[vIdx * 3 + 1] = ny;
      normals[vIdx * 3 + 2] = sinA * nRadial;

      uvs[uvIdx * 2 + 0] = u;
      uvs[uvIdx * 2 + 1] = v;

      vIdx++;
      uvIdx++;
    }
  }

  let iIdx = 0;
  for (let r = 0; r < rings; r++) {
    const row0 = r * (radialSegments + 1);
    const row1 = (r + 1) * (radialSegments + 1);
    for (let s = 0; s < radialSegments; s++) {
      const p0 = row0 + s;
      const p1 = row0 + s + 1;
      const p2 = row1 + s;
      const p3 = row1 + s + 1;

      // Triangle 1
      indices[iIdx++] = p0;
      indices[iIdx++] = p2;
      indices[iIdx++] = p1;

      // Triangle 2
      indices[iIdx++] = p1;
      indices[iIdx++] = p2;
      indices[iIdx++] = p3;
    }
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * Creates a standard quad mesh centered at (0, 0, 0) in XY plane facing +Z.
 */
function createQuadMesh(device: pc.GraphicsDevice): pc.Mesh {
  const positions = new Float32Array([
    -0.5, -0.5, 0,
     0.5, -0.5, 0,
     0.5,  0.5, 0,
    -0.5,  0.5, 0,
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
 * Creates a 3D box mesh for regolith debris chunks.
 */
function createBoxMesh(
  device: pc.GraphicsDevice,
  hx: number,
  hy: number,
  hz: number,
): pc.Mesh {
  // prettier-ignore
  const positions = new Float32Array([
    // Front
    -hx, -hy,  hz,   hx, -hy,  hz,   hx,  hy,  hz,  -hx,  hy,  hz,
    // Back
     hx, -hy, -hz,  -hx, -hy, -hz,  -hx,  hy, -hz,   hx,  hy, -hz,
    // Top
    -hx,  hy,  hz,   hx,  hy,  hz,   hx,  hy, -hz,  -hx,  hy, -hz,
    // Bottom
    -hx, -hy, -hz,   hx, -hy, -hz,   hx, -hy,  hz,  -hx, -hy,  hz,
    // Right
     hx, -hy,  hz,   hx, -hy, -hz,   hx,  hy, -hz,   hx,  hy,  hz,
    // Left
    -hx, -hy, -hz,  -hx, -hy,  hz,  -hx,  hy,  hz,  -hx,  hy, -hz,
  ]);

  // prettier-ignore
  const normals = new Float32Array([
     0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1,
     0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1,
     0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
     0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
     1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0,
    -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0,
  ]);

  // prettier-ignore
  const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
    20, 21, 22,  20, 22, 23,
  ]);

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions, 3);
  mesh.setNormals(normals, 3);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * 3D Mars dust tornado world event handler.
 * Generates sleek, twisting, translucent cones of wind/air and Martian dust using
 * custom GLSL shaders on continuous curved procedural cone meshes.
 * Features dual-layer funnel visuals (outer dust veil + inner high-speed core),
 * soft swirling ground dust skirts, orbiting regolith debris chunks, dynamic ambient lights,
 * camera rumble/shake, and structural colony damage.
 */
export class TornadoFx implements WorldEventHandler {
  public readonly type: WorldEventType = 'tornado';
  public readonly label = 'Tornado';
  public readonly warningDurationSec = TORNADO_WARNING_DURATION;
  public readonly activeDurationSec = TORNADO_ACTIVE_DURATION;

  private readonly app: pc.AppBase;
  private readonly rootEntity: pc.Entity;

  private readonly createdTextures: pc.Texture[] = [];
  private readonly createdMeshes: pc.Mesh[] = [];
  private readonly createdMaterials: pc.Material[] = [];

  private readonly outerFunnelMat: pc.ShaderMaterial;
  private readonly innerCoreMat: pc.ShaderMaterial;
  private readonly skirtMat: pc.StandardMaterial;
  private readonly debrisMat: pc.StandardMaterial;

  private readonly tornadoes: TornadoInstance[] = [];
  private readonly hitBuildingUids = new Set<string>();

  private isRunning = false;
  private spawnPointsInitialized = false;
  private cachedCamera: pc.Entity | null = null;
  private totalTime = 0;

  constructor(app: pc.AppBase) {
    this.app = app;
    this.rootEntity = new pc.Entity('TornadoFxRoot', app);
    this.app.root.addChild(this.rootEntity);
    this.rootEntity.enabled = false;

    const device = app.graphicsDevice;

    // 1. Procedural Soft Dust Cloud Texture for skirts
    const dustTexture = createSoftDustTexture(device, 256);
    this.createdTextures.push(dustTexture);

    // 2. Custom Shader Materials for outer funnel and inner faster core
    this.outerFunnelMat = new pc.ShaderMaterial({
      uniqueName: 'TornadoOuterFunnelShader',
      vertexGLSL: TORNADO_VERTEX_SHADER,
      fragmentGLSL: TORNADO_FRAGMENT_SHADER,
      attributes: {
        vertex_position: pc.SEMANTIC_POSITION,
        vertex_normal: pc.SEMANTIC_NORMAL,
        vertex_texCoord0: pc.SEMANTIC_TEXCOORD0,
      },
    });
    this.outerFunnelMat.blendType = pc.BLEND_NORMAL;
    this.outerFunnelMat.depthWrite = false;
    this.outerFunnelMat.cull = pc.CULLFACE_NONE;
    this.outerFunnelMat.setParameter('uSpinSpeed', 2.6);
    this.outerFunnelMat.setParameter('uPhaseOffset', 0.0);
    this.outerFunnelMat.setParameter('uSwayIntensity', 1.0);
    this.outerFunnelMat.setParameter('uColorBase', [0.82, 0.40, 0.18]);
    this.outerFunnelMat.setParameter('uColorCore', [1.05, 0.72, 0.32]);
    this.outerFunnelMat.setParameter('uAlphaMultiplier', BASE_OUTER_ALPHA);
    this.outerFunnelMat.setParameter('uGrowth', 0.0);
    this.outerFunnelMat.setParameter('uDescendOffset', 0.0);
    this.outerFunnelMat.setParameter('uTime', 0.0);
    this.outerFunnelMat.setParameter('uCameraPos', [DEFAULT_CAM_POS.x, DEFAULT_CAM_POS.y, DEFAULT_CAM_POS.z]);
    this.outerFunnelMat.update();
    this.createdMaterials.push(this.outerFunnelMat);

    this.innerCoreMat = new pc.ShaderMaterial({
      uniqueName: 'TornadoInnerCoreShader',
      vertexGLSL: TORNADO_VERTEX_SHADER,
      fragmentGLSL: TORNADO_FRAGMENT_SHADER,
      attributes: {
        vertex_position: pc.SEMANTIC_POSITION,
        vertex_normal: pc.SEMANTIC_NORMAL,
        vertex_texCoord0: pc.SEMANTIC_TEXCOORD0,
      },
    });
    this.innerCoreMat.blendType = pc.BLEND_NORMAL;
    this.innerCoreMat.depthWrite = false;
    this.innerCoreMat.cull = pc.CULLFACE_NONE;
    this.innerCoreMat.setParameter('uSpinSpeed', 4.5);
    this.innerCoreMat.setParameter('uPhaseOffset', 0.42);
    this.innerCoreMat.setParameter('uSwayIntensity', 0.85);
    this.innerCoreMat.setParameter('uColorBase', [1.02, 0.62, 0.24]);
    this.innerCoreMat.setParameter('uColorCore', [1.25, 0.88, 0.48]);
    this.innerCoreMat.setParameter('uAlphaMultiplier', BASE_INNER_ALPHA);
    this.innerCoreMat.setParameter('uGrowth', 0.0);
    this.innerCoreMat.setParameter('uDescendOffset', 0.0);
    this.innerCoreMat.setParameter('uTime', 0.0);
    this.innerCoreMat.setParameter('uCameraPos', [DEFAULT_CAM_POS.x, DEFAULT_CAM_POS.y, DEFAULT_CAM_POS.z]);
    this.innerCoreMat.update();
    this.createdMaterials.push(this.innerCoreMat);

    // 3. Ground Skirt and Debris Materials
    this.skirtMat = new pc.StandardMaterial();
    this.skirtMat.diffuse = new pc.Color(0.85, 0.44, 0.20).linear();
    this.skirtMat.emissive = new pc.Color(0.65, 0.30, 0.12).linear();
    this.skirtMat.emissiveIntensity = 1.4;
    this.skirtMat.diffuseMap = dustTexture;
    this.skirtMat.opacityMap = dustTexture;
    this.skirtMat.opacityMapChannel = 'a';
    this.skirtMat.blendType = pc.BLEND_NORMAL;
    this.skirtMat.depthWrite = false;
    this.skirtMat.cull = pc.CULLFACE_NONE;
    this.skirtMat.useLighting = false;
    this.skirtMat.opacity = BASE_SKIRT_OPACITY;
    this.skirtMat.update();
    this.createdMaterials.push(this.skirtMat);

    this.debrisMat = new pc.StandardMaterial();
    this.debrisMat.diffuse = new pc.Color(0.24, 0.14, 0.10).linear();
    this.debrisMat.emissive = new pc.Color(0.12, 0.06, 0.04).linear();
    this.debrisMat.emissiveIntensity = 0.6;
    this.debrisMat.shininess = 24;
    this.debrisMat.depthWrite = true;
    this.debrisMat.cull = pc.CULLFACE_BACK;
    this.debrisMat.update();
    this.createdMaterials.push(this.debrisMat);

    // 4. Shared Procedural Meshes
    const coneMesh = createTrumpetConeMesh(device, FUNNEL_RINGS, FUNNEL_RADIAL_SEGS, FUNNEL_HEIGHT);
    this.createdMeshes.push(coneMesh);

    const quadMesh = createQuadMesh(device);
    this.createdMeshes.push(quadMesh);

    const debrisMesh = createBoxMesh(device, 1.4, 1.1, 1.2);
    this.createdMeshes.push(debrisMesh);

    // 5. Build Tornado Instances (2 instances)
    for (let i = 0; i < 2; i++) {
      const root = new pc.Entity(`MarsTornado_${i}`, app);
      const spinDirection = i === 0 ? 1 : -1;

      // 5a. Outer Funnel Mesh Entity
      const outerFunnelEntity = new pc.Entity(`OuterFunnel_${i}`, app);
      const outerMeshInstance = new pc.MeshInstance(coneMesh, this.outerFunnelMat);
      outerMeshInstance.setParameter('uSpinDirection', spinDirection);
      outerMeshInstance.setParameter('uGrowth', 0.0);
      outerMeshInstance.setParameter('uDescendOffset', 0.0);
      outerMeshInstance.setParameter('uAlphaMultiplier', 0.0);
      outerFunnelEntity.addComponent('render', {
        meshInstances: [outerMeshInstance],
        castShadows: false,
        receiveShadows: false,
      });
      root.addChild(outerFunnelEntity);

      // 5b. Inner Faster Core Funnel Entity (narrower scale ~0.58, brighter swirling air)
      const innerFunnelEntity = new pc.Entity(`InnerCore_${i}`, app);
      const innerMeshInstance = new pc.MeshInstance(coneMesh, this.innerCoreMat);
      innerMeshInstance.setParameter('uSpinDirection', spinDirection);
      innerMeshInstance.setParameter('uGrowth', 0.0);
      innerMeshInstance.setParameter('uDescendOffset', 0.0);
      innerMeshInstance.setParameter('uAlphaMultiplier', 0.0);
      innerFunnelEntity.addComponent('render', {
        meshInstances: [innerMeshInstance],
        castShadows: false,
        receiveShadows: false,
      });
      innerFunnelEntity.setLocalScale(0.58, 0.99, 0.58);
      root.addChild(innerFunnelEntity);

      // 5c. Soft Swirling Ground Dust Skirt Puffs (12 per tornado)
      const skirtPuffs: SkirtPuff[] = [];
      for (let s = 0; s < SKIRT_PUFFS_PER_TORNADO; s++) {
        const skirtEnt = new pc.Entity(`SkirtPuff_${i}_${s}`, app);
        skirtEnt.addComponent('render', {
          meshInstances: [new pc.MeshInstance(quadMesh, this.skirtMat)],
          castShadows: false,
          receiveShadows: false,
        });
        root.addChild(skirtEnt);

        const baseRadius = 22 + (s % 3) * 11;
        const baseScale = 34 + (s % 4) * 10;
        const altitude = 1.0 + (s % 3) * 0.6;
        const rotSpeed = 310 + (s % 4) * 22;
        const rollSpeed = (s % 2 === 0 ? 1 : -1) * (42 + s * 7);
        const baseAngle = (s / SKIRT_PUFFS_PER_TORNADO) * Math.PI * 2;

        skirtPuffs.push({
          entity: skirtEnt,
          baseRadius,
          baseScale,
          baseAngle,
          rotSpeed,
          rollSpeed,
          altitude,
          rollAngle: Math.random() * 360,
        });
      }

      // 5d. Orbiting Regolith Debris Particles (24 per tornado)
      const debris: DebrisParticle[] = [];
      for (let d = 0; d < DEBRIS_PER_TORNADO; d++) {
        const dEnt = new pc.Entity(`Debris_${i}_${d}`, app);
        dEnt.addComponent('render', {
          meshInstances: [new pc.MeshInstance(debrisMesh, this.debrisMat)],
          castShadows: false,
          receiveShadows: false,
        });
        root.addChild(dEnt);

        debris.push({
          entity: dEnt,
          height: (d / DEBRIS_PER_TORNADO) * FUNNEL_HEIGHT,
          climbSpeed: 42 + Math.random() * 28,
          orbitAngle: Math.random() * Math.PI * 2,
          orbitSpeed: 3.6 + Math.random() * 2.8,
          orbitRadiusFactor: 0.72 + Math.random() * 0.44,
          rotSpeedX: 180 + Math.random() * 220,
          rotSpeedY: 150 + Math.random() * 200,
          rotSpeedZ: 120 + Math.random() * 180,
          baseScale: 1.2 + Math.random() * 1.8,
        });
      }

      // 5e. Dynamic Warm Ambient Point Light
      const light = new pc.Entity(`TornadoLight_${i}`, app);
      light.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1.0, 0.65, 0.30).linear(),
        intensity: 5.0,
        range: 190,
        castShadows: false,
      });
      light.setLocalPosition(0, 32, 0);
      root.addChild(light);

      root.enabled = false;
      this.rootEntity.addChild(root);

      this.tornadoes.push({
        root,
        outerFunnelEntity,
        outerMeshInstance,
        innerFunnelEntity,
        innerMeshInstance,
        skirtPuffs,
        debris,
        light,
        spinDirection,
        x: 0,
        z: 0,
        y: 0,
        vx: 0,
        vz: 0,
        wanderPhase1: Math.random() * Math.PI * 2,
        wanderPhase2: Math.random() * Math.PI * 2,
      });
    }
  }

  public startWarning(ctx: EventUpdateContext): void {
    this.isRunning = true;
    this.rootEntity.enabled = true;
    this.hitBuildingUids.clear();
    this.initSpawnPoints(ctx);

    for (const t of this.tornadoes) {
      t.root.enabled = true;
      t.y = ctx.sampleHeight(t.x, t.z);
      t.root.setPosition(t.x, t.y, t.z);
    }
  }

  public startActive(ctx: EventUpdateContext): void {
    this.isRunning = true;
    this.rootEntity.enabled = true;

    if (!this.spawnPointsInitialized) {
      this.initSpawnPoints(ctx);
    }

    for (let i = 0; i < this.tornadoes.length; i++) {
      const t = this.tornadoes[i];
      t.root.enabled = true;
      t.y = ctx.sampleHeight(t.x, t.z);
      t.root.setPosition(t.x, t.y, t.z);

      // Drift across the region around the camera focus target with natural angular variation
      const toCenterX = ctx.focusTarget.x - t.x;
      const toCenterZ = ctx.focusTarget.z - t.z;
      const len = Math.hypot(toCenterX, toCenterZ) || 1;
      const baseSpeed = 38 + i * 6;
      const angleOffset = (Math.random() - 0.5) * 0.5;
      const cosA = Math.cos(angleOffset);
      const sinA = Math.sin(angleOffset);
      const ndx = toCenterX / len;
      const ndz = toCenterZ / len;
      t.vx = (ndx * cosA - ndz * sinA) * baseSpeed;
      t.vz = (ndx * sinA + ndz * cosA) * baseSpeed;
    }
  }

  public update(
    dt: number,
    phase: Exclude<WorldEventPhase, 'cooldown'>,
    phaseElapsed: number,
    ctx: EventUpdateContext,
  ): Omit<EventStepResult, 'activeEvent'> {
    if (!this.isRunning) {
      return {
        damageThisFrame: 0,
        productionMultiplier: 1.0,
        shakeOffset: { x: 0, y: 0, z: 0 },
      };
    }

    const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0.016;
    this.totalTime += safeDt;

    const camera = this.findMainCamera();
    const camPos = camera?.getPosition() ?? DEFAULT_CAM_POS;
    const camPosArr = [camPos.x, camPos.y, camPos.z];
    const camRot = camera?.getRotation() ?? null;

    // Update shared shader uniforms
    this.outerFunnelMat.setParameter('uCameraPos', camPosArr);
    this.innerCoreMat.setParameter('uCameraPos', camPosArr);
    this.outerFunnelMat.setParameter('uTime', this.totalTime);
    this.innerCoreMat.setParameter('uTime', this.totalTime);

    // ==========================================
    // 1. WARNING PHASE (5s)
    // Natural emergence: mini-whirlwind at ground + descending sky funnel
    // ==========================================
    if (phase === 'warning') {
      const warnProgress = Math.min(1.0, Math.max(0, phaseElapsed / this.warningDurationSec));

      let funnelGrowth: number;
      let funnelDescendOffset: number;
      let outerAlphaMult: number;
      let innerAlphaMult: number;
      let skirtRadiusFactor: number;
      let skirtScaleFactor: number;
      let skirtOpacityFactor: number;
      let debrisActive: boolean;
      let lightIntensity: number;

      if (warnProgress <= 0.5) {
        // 0% -> 50%: Ground mini-whirlwind + Descending Sky Funnel
        const tHalf = warnProgress / 0.5;

        // Funnel descends from sky towards ground (prominent and visible!)
        funnelGrowth = 0.35 + 0.35 * tHalf; // 0.35 -> 0.70
        funnelDescendOffset = FUNNEL_HEIGHT * (1.0 - funnelGrowth); // anchored at sky, tip descending: 117 -> 54
        outerAlphaMult = (0.55 + 0.30 * tHalf) * BASE_OUTER_ALPHA;
        innerAlphaMult = (0.50 + 0.30 * tHalf) * BASE_INNER_ALPHA;

        // Ground mini-whirlwind hugging terrain
        skirtRadiusFactor = 0.28 + 0.25 * tHalf;
        skirtScaleFactor = 0.28 + 0.25 * tHalf;
        skirtOpacityFactor = 0.60 + 0.25 * tHalf;
        debrisActive = false;
        lightIntensity = 0.8 + 1.2 * tHalf;
      } else {
        // 50% -> 100%: Descending funnel touches down to ground and strengthens
        const tConnect = (warnProgress - 0.5) / 0.5;
        const s = tConnect * tConnect * (3 - 2 * tConnect);

        funnelGrowth = 0.70 + 0.30 * s; // 0.70 -> 1.0 (touchdown!)
        funnelDescendOffset = FUNNEL_HEIGHT * (1.0 - funnelGrowth); // 54 -> 0.0
        outerAlphaMult = (0.85 + 0.15 * s) * BASE_OUTER_ALPHA;
        innerAlphaMult = (0.80 + 0.20 * s) * BASE_INNER_ALPHA;

        skirtRadiusFactor = 0.53 + 0.47 * s;
        skirtScaleFactor = 0.53 + 0.47 * s;
        skirtOpacityFactor = 0.85 + 0.15 * s;
        debrisActive = true;
        lightIntensity = 2.0 + 3.0 * s;
      }

      this.skirtMat.opacity = skirtOpacityFactor * BASE_SKIRT_OPACITY;
      this.skirtMat.update();

      for (let i = 0; i < this.tornadoes.length; i++) {
        const t = this.tornadoes[i];
        t.y = ctx.sampleHeight(t.x, t.z);
        t.root.setPosition(t.x, t.y, t.z);

        // Update shader cone parameters
        t.outerMeshInstance.setParameter('uGrowth', funnelGrowth);
        t.outerMeshInstance.setParameter('uDescendOffset', funnelDescendOffset);
        t.outerMeshInstance.setParameter('uAlphaMultiplier', outerAlphaMult);

        t.innerMeshInstance.setParameter('uGrowth', funnelGrowth);
        t.innerMeshInstance.setParameter('uDescendOffset', funnelDescendOffset);
        t.innerMeshInstance.setParameter('uAlphaMultiplier', innerAlphaMult);

        // Update ground skirt puffs
        for (const sp of t.skirtPuffs) {
          sp.rollAngle += sp.rollSpeed * safeDt;
          const theta =
            sp.baseAngle +
            ((sp.rotSpeed * t.spinDirection * Math.PI) / 180) * phaseElapsed;
          const r = sp.baseRadius * skirtRadiusFactor;
          const px = Math.cos(theta) * r;
          const py = sp.altitude;
          const pz = Math.sin(theta) * r;
          const s = sp.baseScale * skirtScaleFactor;

          sp.entity.setLocalPosition(px, py, pz);
          sp.entity.setLocalScale(s, s, 1.0);
          this.orientBillboard(sp.entity, camRot, sp.rollAngle);
        }

        // Update debris particles
        if (debrisActive) {
          const tConnect = Math.max(0, (warnProgress - 0.5) / 0.5);
          for (const d of t.debris) {
            d.entity.enabled = true;
            d.height += safeDt * d.climbSpeed * 0.45;
            if (d.height >= 48 * tConnect) {
              d.height = 1.0 + Math.random() * 5.0;
              d.orbitAngle = Math.random() * Math.PI * 2;
            }
            const r = (8 + (d.height / 48) * 16) * d.orbitRadiusFactor;
            d.orbitAngle += safeDt * d.orbitSpeed * 0.85 * t.spinDirection;
            const px = Math.cos(d.orbitAngle) * r;
            const pz = Math.sin(d.orbitAngle) * r;
            d.entity.setLocalPosition(px, d.height, pz);
            d.entity.rotateLocal(safeDt * d.rotSpeedX, safeDt * d.rotSpeedY, safeDt * d.rotSpeedZ);
            const dScale = d.baseScale * (0.35 + 0.45 * tConnect);
            d.entity.setLocalScale(dScale, dScale, dScale);
          }
        } else {
          for (const d of t.debris) {
            d.entity.enabled = false;
          }
        }

        // Dynamic light
        if (t.light.light) {
          t.light.light.intensity = lightIntensity;
        }
      }

      // Subtle atmospheric rumble as the funnel connects to ground
      let shakeOffset: Vec3XYZ = { x: 0, y: 0, z: 0 };
      if (warnProgress > 0.65) {
        const rumbleNorm = (warnProgress - 0.65) / 0.35;
        const rumbleAmp = rumbleNorm * rumbleNorm * 0.45;
        const tTime = phaseElapsed;
        shakeOffset = {
          x: Math.sin(tTime * 19.0) * rumbleAmp,
          y: Math.cos(tTime * 23.0) * rumbleAmp * 0.45,
          z: Math.sin(tTime * 17.0 + 1.0) * rumbleAmp,
        };
      }

      return {
        damageThisFrame: 0,
        productionMultiplier: 1.0,
        shakeOffset,
      };
    }

    // ==========================================
    // 2. ACTIVE PHASE (16s)
    // Full power, high visibility, wandering drift, damage, smooth dissipation in final 2.5s
    // ==========================================
    let scaleMult = 1.0;
    let opacityMult = 1.0;

    if (phaseElapsed < 1.5) {
      // Smooth ramp-in: 0.88 -> 1.0
      const rampIn = phaseElapsed / 1.5;
      const s = rampIn * rampIn * (3 - 2 * rampIn);
      scaleMult = 0.88 + 0.12 * s;
      opacityMult = 0.90 + 0.10 * s;
    } else if (phaseElapsed > 13.5) {
      // Smooth dissipation in final 2.5s: 1.0 -> 0.0 (NO pop-out!)
      const remainingSec = Math.max(0, this.activeDurationSec - phaseElapsed);
      const dissipateNorm = remainingSec / 2.5;
      const s = dissipateNorm * dissipateNorm * (3 - 2 * dissipateNorm);
      scaleMult = s;
      opacityMult = s;
    }

    this.skirtMat.opacity = opacityMult * BASE_SKIRT_OPACITY;
    this.skirtMat.update();

    const maxBound = Math.max(100, ctx.worldHalf * 0.84);

    for (let i = 0; i < this.tornadoes.length; i++) {
      const t = this.tornadoes[i];

      // Smooth wandering curved drift
      const w1 = Math.sin(phaseElapsed * 0.72 + t.wanderPhase1) * 24;
      const w2 = Math.cos(phaseElapsed * 0.88 + t.wanderPhase2) * 24;
      t.x += (t.vx + w1) * safeDt;
      t.z += (t.vz + w2) * safeDt;

      // Soft boundary reflections
      if (Math.abs(t.x) > maxBound) {
        t.vx = -t.vx * 0.85;
        t.x = Math.sign(t.x) * maxBound;
      }
      if (Math.abs(t.z) > maxBound) {
        t.vz = -t.vz * 0.85;
        t.z = Math.sign(t.z) * maxBound;
      }

      // Ground hugging
      t.y = ctx.sampleHeight(t.x, t.z);
      t.root.setPosition(t.x, t.y, t.z);

      // Shader-driven tornado funnel updates (dense, prominent presence)
      t.outerMeshInstance.setParameter('uGrowth', scaleMult);
      t.outerMeshInstance.setParameter('uDescendOffset', 0.0);
      t.outerMeshInstance.setParameter('uAlphaMultiplier', opacityMult * BASE_OUTER_ALPHA);

      t.innerMeshInstance.setParameter('uGrowth', scaleMult);
      t.innerMeshInstance.setParameter('uDescendOffset', 0.0);
      t.innerMeshInstance.setParameter('uAlphaMultiplier', opacityMult * BASE_INNER_ALPHA);

      // Soft swirling ground skirt
      for (let s = 0; s < t.skirtPuffs.length; s++) {
        const sp = t.skirtPuffs[s];
        sp.rollAngle += sp.rollSpeed * safeDt;

        const theta =
          sp.baseAngle +
          ((sp.rotSpeed * t.spinDirection * Math.PI) / 180) * phaseElapsed;
        const r =
          sp.baseRadius *
          scaleMult *
          (1.0 + 0.1 * Math.sin(phaseElapsed * 4.6 + s));
        const px = Math.cos(theta) * r;
        const py = sp.altitude;
        const pz = Math.sin(theta) * r;
        const currentScale = sp.baseScale * scaleMult;

        sp.entity.setLocalPosition(px, py, pz);
        sp.entity.setLocalScale(currentScale, currentScale, 1.0);
        this.orientBillboard(sp.entity, camRot, sp.rollAngle);
      }

      // Orbiting regolith debris particles spiraling upward
      for (const d of t.debris) {
        d.entity.enabled = scaleMult > 0.02;
        d.height += safeDt * d.climbSpeed * scaleMult;
        if (d.height >= FUNNEL_HEIGHT) {
          d.height = 1.0 + Math.random() * 8.0;
          d.orbitAngle = Math.random() * Math.PI * 2;
        }

        const ny = d.height / FUNNEL_HEIGHT;
        const r = (8 + Math.pow(ny, 1.35) * 48) * d.orbitRadiusFactor * scaleMult;
        d.orbitAngle += safeDt * d.orbitSpeed * t.spinDirection;

        const px = Math.cos(d.orbitAngle) * r;
        const pz = Math.sin(d.orbitAngle) * r;
        d.entity.setLocalPosition(px, d.height, pz);
        d.entity.rotateLocal(safeDt * d.rotSpeedX, safeDt * d.rotSpeedY, safeDt * d.rotSpeedZ);
        const dScale = d.baseScale * scaleMult;
        d.entity.setLocalScale(dScale, dScale, dScale);
      }

      // Dynamic ambient point light with storm flicker
      if (t.light.light) {
        t.light.light.intensity =
          (5.0 + Math.sin(phaseElapsed * 15.0 + i) * 1.5) * scaleMult;
      }
    }

    // ==========================================
    // 3. GAMEPLAY & LOCAL STRUCTURAL DAMAGE
    // Damage active only when tornado is mature/active
    // ==========================================
    let continuousDamage = 0;
    let hasBuildingOverlap = false;
    const isMature = scaleMult >= 0.7;

    let buildingsHitThisFrame = 0;

    if (isMature) {
      if (ctx.buildings.length > 0) {
        for (const t of this.tornadoes) {
          for (const b of ctx.buildings) {
            const bx = b.worldCenter?.x ?? (b.gridX + b.cols * 0.5) * 14;
            const bz = b.worldCenter?.z ?? (b.gridZ + b.rows * 0.5) * 14;
            const dx = bx - t.x;
            const dz = bz - t.z;
            if (dx * dx + dz * dz <= TORNADO_DAMAGE_RADIUS_SQ) {
              continuousDamage += TORNADO_DAMAGE_RATE * safeDt;
              hasBuildingOverlap = true;
              if (!this.hitBuildingUids.has(b.uid)) {
                this.hitBuildingUids.add(b.uid);
                buildingsHitThisFrame += 1;
              }
            }
          }
        }
      } else {
        for (const t of this.tornadoes) {
          const dx = ctx.focusTarget.x - t.x;
          const dz = ctx.focusTarget.z - t.z;
          if (dx * dx + dz * dz <= 75 * 75) {
            continuousDamage += TORNADO_DAMAGE_RATE * safeDt;
            hasBuildingOverlap = true;
          }
        }
      }
    }

    const damageThisFrame = continuousDamage;
    const productionMultiplier = hasBuildingOverlap ? 0.65 : 0.85;

    // ==========================================
    // 4. DYNAMIC CAMERA SHAKE
    // ==========================================
    let minFocusDist = Infinity;
    for (const t of this.tornadoes) {
      const dx = ctx.focusTarget.x - t.x;
      const dz = ctx.focusTarget.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < minFocusDist) minFocusDist = d;
    }

    let shakeOffset: Vec3XYZ = { x: 0, y: 0, z: 0 };
    const shakeMaxRadius = 420;
    if (minFocusDist < shakeMaxRadius) {
      const prox = 1 - minFocusDist / shakeMaxRadius;
      const amp = prox * prox * 3.4 * scaleMult;
      const tTime = phaseElapsed;
      shakeOffset = {
        x:
          (Math.sin(tTime * 31.0) * 0.55 +
            Math.sin(tTime * 53.0 + 1.2) * 0.35 +
            Math.cos(tTime * 19.0) * 0.4) *
          amp,
        y:
          (Math.cos(tTime * 37.0) * 0.6 +
            Math.sin(tTime * 67.0 + 2.1) * 0.3 +
            Math.sin(tTime * 13.0) * 0.35) *
          amp,
        z:
          (Math.sin(tTime * 29.0 + 0.8) * 0.5 +
            Math.cos(tTime * 47.0 + 1.7) * 0.35) *
          amp,
      };
    }

    return {
      damageThisFrame,
      productionMultiplier,
      shakeOffset,
      buildingsHitThisFrame,
    };
  }

  public stop(): void {
    this.isRunning = false;
    this.spawnPointsInitialized = false;
    this.hitBuildingUids.clear();
    this.rootEntity.enabled = false;
    for (const t of this.tornadoes) {
      t.root.enabled = false;
      t.outerMeshInstance.setParameter('uGrowth', 0.0);
      t.outerMeshInstance.setParameter('uAlphaMultiplier', 0.0);
      t.innerMeshInstance.setParameter('uGrowth', 0.0);
      t.innerMeshInstance.setParameter('uAlphaMultiplier', 0.0);
    }
    this.skirtMat.opacity = BASE_SKIRT_OPACITY;
    this.skirtMat.update();
  }

  public destroy(): void {
    this.stop();

    this.rootEntity.destroy();

    for (const tex of this.createdTextures) {
      tex.destroy();
    }
    this.createdTextures.length = 0;

    for (const mesh of this.createdMeshes) {
      mesh.destroy();
    }
    this.createdMeshes.length = 0;

    for (const mat of this.createdMaterials) {
      (mat as unknown as { meshInstances?: Set<unknown> }).meshInstances?.clear();
      mat.destroy();
    }
    this.createdMaterials.length = 0;
  }

  private orientBillboard(entity: pc.Entity, camRot: pc.Quat | null, rollAngle: number): void {
    if (camRot) {
      entity.setRotation(camRot);
      entity.rotateLocal(0, 0, rollAngle);
    } else {
      entity.setEulerAngles(-42, 45, rollAngle);
    }
  }

  private findMainCamera(): pc.Entity | null {
    if (this.cachedCamera?.camera) {
      return this.cachedCamera;
    }
    const mainCam = this.app.root.findByName('MainCamera') as pc.Entity | null;
    if (mainCam?.camera) {
      this.cachedCamera = mainCam;
      return mainCam;
    }
    let found: pc.Entity | null = null;
    this.app.root.forEach((node) => {
      if (!found && (node as pc.Entity).camera) {
        found = node as pc.Entity;
      }
    });
    this.cachedCamera = found;
    return found;
  }

  private initSpawnPoints(ctx: EventUpdateContext): void {
    const centerX = ctx.focusTarget.x;
    const centerZ = ctx.focusTarget.z;

    const baseAngle = Math.random() * Math.PI * 2;
    const angles = [baseAngle, baseAngle + Math.PI * 0.85 + Math.random() * 0.3];
    const distances = [
      135 + Math.random() * 45,
      145 + Math.random() * 45,
    ];

    const maxBound = Math.max(100, ctx.worldHalf * 0.82);

    for (let i = 0; i < this.tornadoes.length; i++) {
      const t = this.tornadoes[i];
      const ang = angles[i];
      const dist = distances[i];

      let sx = centerX + Math.cos(ang) * dist;
      let sz = centerZ + Math.sin(ang) * dist;

      sx = Math.max(-maxBound, Math.min(maxBound, sx));
      sz = Math.max(-maxBound, Math.min(maxBound, sz));
      const sy = ctx.sampleHeight(sx, sz);

      t.x = sx;
      t.z = sz;
      t.y = sy;
      t.root.setPosition(sx, sy, sz);
    }

    this.spawnPointsInitialized = true;
  }
}
