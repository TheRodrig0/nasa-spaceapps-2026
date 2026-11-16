import * as pc from 'playcanvas';
import type {
  EventStepResult,
  EventUpdateContext,
  Vec3XYZ,
  WorldEventHandler,
  WorldEventPhase,
  WorldEventType,
} from '../../types/index.ts';

const STORM_WARNING_DURATION = 5;
const STORM_ACTIVE_DURATION = 15;
const LIGHTNING_DAMAGE_BURST = 10;
const LIGHTNING_DAMAGE_RADIUS = 38;
const LIGHTNING_DAMAGE_RADIUS_SQ = LIGHTNING_DAMAGE_RADIUS * LIGHTNING_DAMAGE_RADIUS;
const ACTIVE_PRODUCTION_MULTIPLIER = 0.45;

const MIN_STRIKE_INTERVAL = 1.6;
const MAX_STRIKE_INTERVAL = 2.6;
const BOLT_DURATION = 0.16; // 0.16s authentic double-pulse duration
const PLASMA_RING_DURATION = 0.38;
const IMPACT_DISC_DURATION = 0.48;
const SPARKS_DURATION = 0.52;
const LIGHT_FLASH_DURATION = 0.25;
const SKY_STRIKE_FLASH_DURATION = 0.15;

const SPARKS_COUNT = 32;
const DUST_WISPS_COUNT = 26;

// Pre-allocated geometry buffer sizes for 3D multi-branch lightning bolt
const MAX_BOLT_VERTICES = 512;
const MAX_BOLT_INDICES = 768;

// Wind direction vector (~35 degrees azimuth)
const WIND_ANGLE = (35 * Math.PI) / 180;
const WIND_DIR_X = Math.cos(WIND_ANGLE);
const WIND_DIR_Z = Math.sin(WIND_ANGLE);
const WIND_YAW = (Math.atan2(WIND_DIR_X, WIND_DIR_Z) * 180) / Math.PI;

// Palette definitions:
// 1. Atmospheric Slate-Indigo Storm Fog (deep twilight Martian storm pressure)
const STORM_FOG_COLOR = new pc.Color(0.18, 0.17, 0.24);
const STORM_FOG_START = 600;
const STORM_FOG_END = 2300;

// 2. Storm base lighting (subdued directional sun & cooled ambient)
const STORM_SUN_COLOR = new pc.Color(0.72, 0.68, 0.74);
const ELECTRIC_STORM_SUN_DIM_FACTOR = 0.50; // Dim sunlight by 50% during peak electric storm
const STORM_AMBIENT_COLOR = new pc.Color(0.28, 0.24, 0.28).linear();

// 3. High-altitude sheet lightning flashes (illuminating atmospheric fog and terrain ridges)
const SHEET_FLASH_AMBIENT = new pc.Color(0.32, 0.30, 0.38).linear();
const SHEET_FLASH_FOG = new pc.Color(0.24, 0.24, 0.32);
const SHEET_FLASH_LIGHT_COLOR = new pc.Color(0.65, 0.75, 0.95).linear();

// 4. Ground strike sky flash
const STRIKE_SKY_AMBIENT = new pc.Color(0.35, 0.34, 0.44).linear();
const STRIKE_SKY_FOG = new pc.Color(0.28, 0.28, 0.36);

export interface ElectricStormOptions {
  sunLight?: pc.Entity;
}

interface SparkState {
  readonly entity: pc.Entity;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

interface DustWispState {
  readonly entity: pc.Entity;
  readonly baseLength: number;
  readonly baseWidth: number;
  readonly hoverHeight: number;
  readonly speed: number;
  readonly waveSpeed: number;
  alongWind: number;
  acrossWind: number;
  wavePhase: number;
  yawOffset: number;
}

interface SegmentDef {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  coreThickness: number;
  coronaThickness: number;
}

/**
 * Creates a circular disc or annulus mesh in the XZ plane.
 */
function createRingMesh(
  device: pc.GraphicsDevice,
  innerRadius: number,
  outerRadius: number,
  segments = 32,
): pc.Mesh {
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = new Uint16Array(segments * 6);

  let pPtr = 0;
  let nPtr = 0;
  let uvPtr = 0;

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const theta = u * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    positions[pPtr++] = cosT * innerRadius;
    positions[pPtr++] = 0;
    positions[pPtr++] = sinT * innerRadius;
    normals[nPtr++] = 0;
    normals[nPtr++] = 1;
    normals[nPtr++] = 0;
    uvs[uvPtr++] = u;
    uvs[uvPtr++] = 0;

    positions[pPtr++] = cosT * outerRadius;
    positions[pPtr++] = 0;
    positions[pPtr++] = sinT * outerRadius;
    normals[nPtr++] = 0;
    normals[nPtr++] = 1;
    normals[nPtr++] = 0;
    uvs[uvPtr++] = u;
    uvs[uvPtr++] = 1;
  }

  let iPtr = 0;
  for (let i = 0; i < segments; i++) {
    const in0 = i * 2;
    const out0 = in0 + 1;
    const in1 = (i + 1) * 2;
    const out1 = in1 + 1;

    indices[iPtr++] = in0;
    indices[iPtr++] = out0;
    indices[iPtr++] = in1;

    indices[iPtr++] = in1;
    indices[iPtr++] = out0;
    indices[iPtr++] = out1;
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
 * Creates an oriented box mesh centered at origin.
 */
function createBoxMesh(
  device: pc.GraphicsDevice,
  hx: number,
  hy: number,
  hz: number,
): pc.Mesh {
  // prettier-ignore
  const positions = new Float32Array([
    -hx, -hy,  hz,   hx, -hy,  hz,   hx,  hy,  hz,  -hx,  hy,  hz,
     hx, -hy, -hz,  -hx, -hy, -hz,  -hx,  hy, -hz,   hx,  hy, -hz,
    -hx,  hy,  hz,   hx,  hy,  hz,   hx,  hy, -hz,  -hx,  hy, -hz,
    -hx, -hy, -hz,   hx, -hy, -hz,   hx, -hy,  hz,  -hx, -hy,  hz,
     hx, -hy,  hz,   hx, -hy, -hz,   hx,  hy, -hz,   hx,  hy,  hz,
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
 * Creates a planar unit quad mesh (1x1 in XZ, centered at origin, facing +Y).
 */
function createUnitQuadMesh(device: pc.GraphicsDevice): pc.Mesh {
  // prettier-ignore
  const positions = new Float32Array([
    -0.5, 0, -0.5,
     0.5, 0, -0.5,
    -0.5, 0,  0.5,
     0.5, 0,  0.5,
  ]);
  // prettier-ignore
  const normals = new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]);
  // prettier-ignore
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]);
  // prettier-ignore
  const indices = new Uint16Array([
    0, 1, 2,
    2, 1, 3,
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
 * Procedurally generates a soft, elongated, feathered dust wisp streamer texture
 * on an offscreen canvas with smooth Gaussian alpha falloff dropping to zero at all borders.
 */
function createSoftWispTexture(device: pc.GraphicsDevice): pc.Texture {
  const width = 256;
  const height = 64;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    return new pc.Texture(device, { width: 4, height: 4, format: pc.PIXELFORMAT_RGBA8 });
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new pc.Texture(device, { width: 4, height: 4, format: pc.PIXELFORMAT_RGBA8 });
  }

  ctx.clearRect(0, 0, width, height);

  // Draw 4 soft overlapping horizontal wisps with feathered falloff
  const passes = [
    { cy: 32, h: 26, peakA: 0.44, r: 185, g: 130, b: 95 },
    { cy: 26, h: 18, peakA: 0.36, r: 195, g: 140, b: 105 },
    { cy: 38, h: 20, peakA: 0.32, r: 175, g: 120, b: 88 },
    { cy: 32, h: 12, peakA: 0.28, r: 210, g: 155, b: 120 },
  ];

  for (const p of passes) {
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0.0, `rgba(${p.r}, ${p.g}, ${p.b}, 0)`);
    grad.addColorStop(0.18, `rgba(${p.r}, ${p.g}, ${p.b}, ${p.peakA * 0.4})`);
    grad.addColorStop(0.50, `rgba(${p.r}, ${p.g}, ${p.b}, ${p.peakA})`);
    grad.addColorStop(0.82, `rgba(${p.r}, ${p.g}, ${p.b}, ${p.peakA * 0.4})`);
    grad.addColorStop(1.0, `rgba(${p.r}, ${p.g}, ${p.b}, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(width * 0.5, p.cy, width * 0.48, p.h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new pc.Texture(device, {
    width,
    height,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  texture.setSource(canvas);
  return texture;
}

/**
 * Procedurally generates a soft radial impact scorch and flash texture.
 */
function createProceduralScorchTexture(device: pc.GraphicsDevice): pc.Texture {
  const size = 128;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    return new pc.Texture(device, { width: 4, height: 4, format: pc.PIXELFORMAT_RGBA8 });
  }
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new pc.Texture(device, { width: 4, height: 4, format: pc.PIXELFORMAT_RGBA8 });
  }

  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  grad.addColorStop(0.2, 'rgba(230, 240, 255, 0.85)');
  grad.addColorStop(0.5, 'rgba(160, 190, 255, 0.45)');
  grad.addColorStop(0.75, 'rgba(110, 70, 45, 0.25)');
  grad.addColorStop(1.0, 'rgba(60, 35, 20, 0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  const texture = new pc.Texture(device, {
    width: size,
    height: size,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  texture.setSource(canvas);
  return texture;
}

/**
 * 3D Electric Storm World Event Handler.
 * Fully overhauled for isometric RTS tactical gameplay:
 * - NO giant flat cloud quads floating in the sky.
 * - Atmospheric brooding slate-indigo storm fog + darkening sunlight & ambient transition over 5s warning.
 * - Periodic high-altitude sheet lightning flashes (0.08s–0.16s) brightening the sky and terrain ridges.
 * - Razor-sharp electric lightning bolts (0.55 core / 1.6 corona glow) descending from high above camera view (y + 380).
 * - Multi-stage 0.16s return-stroke double-pulse flicker.
 * - Dynamic ground point light (range ~220), plasma shockwave ring, soft impact scorch fade, and terrain-bouncing electric sparks.
 * - Low-lying soft-textured wind dust wisps skimming near terrain contours.
 * - Smooth 2.5s ease-down at end of active, and guaranteed leak-free lighting & fog restoration.
 */
export class ElectricStormFx implements WorldEventHandler {
  public readonly type: WorldEventType = 'electric_storm';
  public readonly label = 'Tempestade Elétrica';
  public readonly warningDurationSec = STORM_WARNING_DURATION;
  public readonly activeDurationSec = STORM_ACTIVE_DURATION;

  private readonly app: pc.AppBase;
  private readonly rootEntity: pc.Entity;
  private readonly customSunLight?: pc.Entity;

  // Stored scene fog baselines for leak-free, guaranteed restoration
  private hasSavedFog = false;
  private savedFogType: string | number = pc.FOG_NONE;
  private readonly savedFogColor = new pc.Color(0, 0, 0);
  private savedFogStart = 1;
  private savedFogEnd = 1000;
  private savedFogDensity = 0;

  // Reusable working color objects (prevents GC pressure)
  private readonly workingAmbient = new pc.Color();
  private readonly workingFogColor = new pc.Color();

  // Tracked resources for proper cleanup
  private readonly createdMeshes: pc.Mesh[] = [];
  private readonly createdTextures: pc.Texture[] = [];
  private readonly createdMaterials: pc.StandardMaterial[] = [];

  // 1. High-Altitude Atmospheric Sheet Lightning Fill Light
  private readonly overheadSheetLight: pc.Entity;

  // 2. 3D Lightning Visual Elements (Crisp Core + Subtle Tight Halo)
  private readonly boltCoreEntity: pc.Entity;
  private readonly boltCoreMesh: pc.Mesh;
  private readonly boltCoreMaterial: pc.StandardMaterial;

  private readonly boltCoronaEntity: pc.Entity;
  private readonly boltCoronaMesh: pc.Mesh;
  private readonly boltCoronaMaterial: pc.StandardMaterial;

  private readonly plasmaRingEntity: pc.Entity;
  private readonly plasmaRingMaterial: pc.StandardMaterial;

  private readonly impactDiscEntity: pc.Entity;
  private readonly impactDiscMaterial: pc.StandardMaterial;

  private readonly strikeLight: pc.Entity;
  private readonly sparks: SparkState[] = [];

  // 3. Low-Lying Wind Dust Wisps (Skimming terrain contours)
  private readonly dustWisps: DustWispState[] = [];
  private readonly wispMat1: pc.StandardMaterial;
  private readonly wispMat2: pc.StandardMaterial;

  // Shared geometry buffers for dynamic 3D lightning bolt updates
  private readonly corePositions = new Float32Array(MAX_BOLT_VERTICES * 3);
  private readonly coreNormals = new Float32Array(MAX_BOLT_VERTICES * 3);
  private readonly coronaPositions = new Float32Array(MAX_BOLT_VERTICES * 3);
  private readonly coronaNormals = new Float32Array(MAX_BOLT_VERTICES * 3);
  private readonly boltIndices = new Uint16Array(MAX_BOLT_INDICES);

  // Runtime State
  private isRunning = false;
  private nextStrikeTimer = 0;
  private boltActiveTimer = 0;
  private plasmaRingTimer = 0;
  private impactDiscTimer = 0;
  private sparksActiveTimer = 0;
  private lightFlashTimer = 0;
  private skyFlashTimer = 0;

  // Atmospheric sheet lightning state
  private nextSheetLightningTimer = 1.2;
  private sheetLightningTimer = 0;
  private sheetLightningDuration = 0.12;
  private sheetPeakIntensity = 1.0;
  private sheetIsDoublePulse = false;

  private strikeShakeRemaining = 0;
  private lastStrikeDistToFocus = 9999;
  private pendingBurstDamage = 0;
  private readonly hitBuildingUids = new Set<string>();
  private pendingBuildingsHit = 0;

  constructor(app: pc.AppBase, optionsOrSun?: pc.Entity | ElectricStormOptions) {
    this.app = app;
    if (optionsOrSun instanceof pc.Entity) {
      this.customSunLight = optionsOrSun;
    } else if (optionsOrSun?.sunLight) {
      this.customSunLight = optionsOrSun.sunLight;
    }

    this.rootEntity = new pc.Entity('ElectricStormFxRoot', app);
    this.app.root.addChild(this.rootEntity);
    this.rootEntity.enabled = false;

    // Cache initial scene fog baselines
    this.captureOriginalFog();

    const device = app.graphicsDevice;

    // ==========================================
    // 1. High-Altitude Atmospheric Sheet Lightning Fill Light
    // ==========================================
    this.overheadSheetLight = new pc.Entity('OverheadSheetLightningLight', app);
    this.overheadSheetLight.addComponent('light', {
      type: 'omni',
      color: SHEET_FLASH_LIGHT_COLOR,
      intensity: 0,
      range: 850,
      castShadows: false,
    });
    this.rootEntity.addChild(this.overheadSheetLight);

    // ==========================================
    // 2. Cloud-to-Ground 3D Lightning Bolt Setup
    // ==========================================
    // Core Material: Sharp, blindingly bright white-blue core filament
    this.boltCoreMaterial = new pc.StandardMaterial();
    this.boltCoreMaterial.diffuse = new pc.Color(1.0, 1.0, 1.0).linear();
    this.boltCoreMaterial.emissive = new pc.Color(1.0, 1.0, 1.0).linear();
    this.boltCoreMaterial.emissiveIntensity = 14.0;
    this.boltCoreMaterial.blendType = pc.BLEND_ADDITIVE;
    this.boltCoreMaterial.depthWrite = false;
    this.boltCoreMaterial.cull = pc.CULLFACE_NONE;
    this.boltCoreMaterial.opacity = 1.0;
    this.boltCoreMaterial.useLighting = false;
    this.boltCoreMaterial.update();
    this.createdMaterials.push(this.boltCoreMaterial);

    // Corona Material: Subtle, tight pale-blue outer ionization halo
    this.boltCoronaMaterial = new pc.StandardMaterial();
    this.boltCoronaMaterial.diffuse = new pc.Color(0.55, 0.75, 1.0).linear();
    this.boltCoronaMaterial.emissive = new pc.Color(0.60, 0.80, 1.0).linear();
    this.boltCoronaMaterial.emissiveIntensity = 4.8;
    this.boltCoronaMaterial.blendType = pc.BLEND_ADDITIVE;
    this.boltCoronaMaterial.depthWrite = false;
    this.boltCoronaMaterial.cull = pc.CULLFACE_NONE;
    this.boltCoronaMaterial.opacity = 0.75;
    this.boltCoronaMaterial.useLighting = false;
    this.boltCoronaMaterial.update();
    this.createdMaterials.push(this.boltCoronaMaterial);

    // Dynamic Lightning Meshes
    this.boltCoreMesh = new pc.Mesh(device);
    this.boltCoreMesh.setPositions(new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0]), 3);
    this.boltCoreMesh.setNormals(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3);
    this.boltCoreMesh.setIndices(new Uint16Array([0, 1, 2]));
    this.boltCoreMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.createdMeshes.push(this.boltCoreMesh);

    this.boltCoronaMesh = new pc.Mesh(device);
    this.boltCoronaMesh.setPositions(new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0]), 3);
    this.boltCoronaMesh.setNormals(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3);
    this.boltCoronaMesh.setIndices(new Uint16Array([0, 1, 2]));
    this.boltCoronaMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.createdMeshes.push(this.boltCoronaMesh);

    this.boltCoreEntity = new pc.Entity('LightningBoltCore', app);
    this.boltCoreEntity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(this.boltCoreMesh, this.boltCoreMaterial)],
      castShadows: false,
      receiveShadows: false,
    });
    this.boltCoreEntity.enabled = false;
    this.rootEntity.addChild(this.boltCoreEntity);

    this.boltCoronaEntity = new pc.Entity('LightningBoltCorona', app);
    this.boltCoronaEntity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(this.boltCoronaMesh, this.boltCoronaMaterial)],
      castShadows: false,
      receiveShadows: false,
    });
    this.boltCoronaEntity.enabled = false;
    this.rootEntity.addChild(this.boltCoronaEntity);

    // Ground Plasma Ring Entity
    const ringMesh = createRingMesh(device, 0.82, 1.0, 32);
    this.createdMeshes.push(ringMesh);

    this.plasmaRingMaterial = new pc.StandardMaterial();
    this.plasmaRingMaterial.diffuse = new pc.Color(0.48, 0.78, 1.0).linear();
    this.plasmaRingMaterial.emissive = new pc.Color(0.52, 0.82, 1.0).linear();
    this.plasmaRingMaterial.emissiveIntensity = 5.0;
    this.plasmaRingMaterial.blendType = pc.BLEND_ADDITIVE;
    this.plasmaRingMaterial.depthWrite = false;
    this.plasmaRingMaterial.cull = pc.CULLFACE_NONE;
    this.plasmaRingMaterial.opacity = 0.95;
    this.plasmaRingMaterial.update();
    this.createdMaterials.push(this.plasmaRingMaterial);

    this.plasmaRingEntity = new pc.Entity('GroundPlasmaRing', app);
    this.plasmaRingEntity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(ringMesh, this.plasmaRingMaterial)],
      castShadows: false,
      receiveShadows: false,
    });
    this.plasmaRingEntity.enabled = false;
    this.rootEntity.addChild(this.plasmaRingEntity);

    // Ground Impact Scorch Disc (instant white-hot flash and charred fade)
    const discMesh = createUnitQuadMesh(device);
    this.createdMeshes.push(discMesh);

    const scorchTexture = createProceduralScorchTexture(device);
    this.createdTextures.push(scorchTexture);

    this.impactDiscMaterial = new pc.StandardMaterial();
    this.impactDiscMaterial.diffuseMap = scorchTexture;
    this.impactDiscMaterial.opacityMap = scorchTexture;
    this.impactDiscMaterial.opacityMapChannel = 'a';
    this.impactDiscMaterial.diffuse = new pc.Color(0.85, 0.92, 1.0).linear();
    this.impactDiscMaterial.emissive = new pc.Color(0.88, 0.94, 1.0).linear();
    this.impactDiscMaterial.emissiveIntensity = 8.0;
    this.impactDiscMaterial.blendType = pc.BLEND_ADDITIVE;
    this.impactDiscMaterial.depthWrite = false;
    this.impactDiscMaterial.cull = pc.CULLFACE_NONE;
    this.impactDiscMaterial.opacity = 0.95;
    this.impactDiscMaterial.update();
    this.createdMaterials.push(this.impactDiscMaterial);

    this.impactDiscEntity = new pc.Entity('GroundImpactDisc', app);
    this.impactDiscEntity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(discMesh, this.impactDiscMaterial)],
      castShadows: false,
      receiveShadows: false,
    });
    this.impactDiscEntity.enabled = false;
    this.rootEntity.addChild(this.impactDiscEntity);

    // Transient Ground Impact Point Light (range ~180, peak intensity ~10)
    this.strikeLight = new pc.Entity('LightningStrikePointLight', app);
    this.strikeLight.addComponent('light', {
      type: 'omni',
      color: new pc.Color(0.85, 0.92, 1.0).linear(),
      intensity: 0,
      range: 180,
      castShadows: false,
    });
    this.rootEntity.addChild(this.strikeLight);

    // Rising Electric Sparks Pool
    const sparkMesh = createBoxMesh(device, 0.18, 0.18, 0.18);
    this.createdMeshes.push(sparkMesh);

    const sparkMat = new pc.StandardMaterial();
    sparkMat.diffuse = new pc.Color(0.92, 0.97, 1.0).linear();
    sparkMat.emissive = new pc.Color(0.92, 0.97, 1.0).linear();
    sparkMat.emissiveIntensity = 8.0;
    sparkMat.blendType = pc.BLEND_ADDITIVE;
    sparkMat.depthWrite = false;
    sparkMat.cull = pc.CULLFACE_NONE;
    sparkMat.opacity = 0.95;
    sparkMat.useLighting = false;
    sparkMat.update();
    this.createdMaterials.push(sparkMat);

    for (let i = 0; i < SPARKS_COUNT; i++) {
      const sp = new pc.Entity(`ElectricSpark_${i}`, app);
      sp.addComponent('render', {
        meshInstances: [new pc.MeshInstance(sparkMesh, sparkMat)],
        castShadows: false,
        receiveShadows: false,
      });
      sp.enabled = false;
      this.rootEntity.addChild(sp);

      this.sparks.push({
        entity: sp,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
      });
    }

    // ==========================================
    // 3. Low-Lying Wind Dust Wisps (Skimming terrain contours)
    // ==========================================
    const wispTexture = createSoftWispTexture(device);
    this.createdTextures.push(wispTexture);

    const wispQuadMesh = createUnitQuadMesh(device);
    this.createdMeshes.push(wispQuadMesh);

    this.wispMat1 = new pc.StandardMaterial();
    this.wispMat1.diffuseMap = wispTexture;
    this.wispMat1.opacityMap = wispTexture;
    this.wispMat1.opacityMapChannel = 'a';
    this.wispMat1.diffuse = new pc.Color(0.72, 0.48, 0.32).linear();
    this.wispMat1.emissive = new pc.Color(0.24, 0.16, 0.12).linear();
    this.wispMat1.emissiveIntensity = 0.35;
    this.wispMat1.blendType = pc.BLEND_NORMAL;
    this.wispMat1.depthWrite = false;
    this.wispMat1.cull = pc.CULLFACE_NONE;
    this.wispMat1.opacity = 0;
    this.wispMat1.useLighting = true;
    this.wispMat1.update();
    this.createdMaterials.push(this.wispMat1);

    this.wispMat2 = new pc.StandardMaterial();
    this.wispMat2.diffuseMap = wispTexture;
    this.wispMat2.opacityMap = wispTexture;
    this.wispMat2.opacityMapChannel = 'a';
    this.wispMat2.diffuse = new pc.Color(0.58, 0.46, 0.38).linear();
    this.wispMat2.emissive = new pc.Color(0.20, 0.15, 0.12).linear();
    this.wispMat2.emissiveIntensity = 0.30;
    this.wispMat2.blendType = pc.BLEND_NORMAL;
    this.wispMat2.depthWrite = false;
    this.wispMat2.cull = pc.CULLFACE_NONE;
    this.wispMat2.opacity = 0;
    this.wispMat2.useLighting = true;
    this.wispMat2.update();
    this.createdMaterials.push(this.wispMat2);

    for (let i = 0; i < DUST_WISPS_COUNT; i++) {
      const mat = i % 2 === 0 ? this.wispMat1 : this.wispMat2;
      const ent = new pc.Entity(`StormDustWisp_${i}`, app);
      ent.addComponent('render', {
        meshInstances: [new pc.MeshInstance(wispQuadMesh, mat)],
        castShadows: false,
        receiveShadows: false,
      });
      const yawOffset = (Math.random() - 0.5) * 8.0;
      ent.setEulerAngles(0, WIND_YAW + yawOffset, 0);
      ent.enabled = false;
      this.rootEntity.addChild(ent);

      this.dustWisps.push({
        entity: ent,
        baseLength: 22.0 + Math.random() * 16.0,
        baseWidth: 3.2 + Math.random() * 2.8,
        hoverHeight: 1.0 + Math.random() * 3.8,
        speed: 55.0 + Math.random() * 30.0,
        waveSpeed: 1.8 + Math.random() * 2.2,
        alongWind: (Math.random() - 0.5) * 520,
        acrossWind: (Math.random() - 0.5) * 420,
        wavePhase: Math.random() * Math.PI * 2,
        yawOffset,
      });
    }
  }

  public startWarning(ctx: EventUpdateContext): void {
    void ctx;
    this.captureOriginalFog();
    this.isRunning = true;
    this.rootEntity.enabled = true;

    for (const w of this.dustWisps) {
      w.entity.enabled = true;
    }

    this.nextSheetLightningTimer = 1.4 + Math.random() * 1.0;
    this.sheetLightningTimer = 0;
    this.hitBuildingUids.clear();
    this.pendingBuildingsHit = 0;
    this.hideBoltAndEffects();
  }

  public startActive(ctx: EventUpdateContext): void {
    void ctx;
    this.captureOriginalFog();
    this.isRunning = true;
    this.rootEntity.enabled = true;

    for (const w of this.dustWisps) {
      w.entity.enabled = true;
    }

    // Initial dramatic lightning bolt shortly after active starts (~0.8s)
    this.nextStrikeTimer = 0.8;
    this.nextSheetLightningTimer = 1.1;
    this.pendingBurstDamage = 0;
    this.hitBuildingUids.clear();
    this.pendingBuildingsHit = 0;
    this.strikeShakeRemaining = 0;
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
        buildingsHitThisFrame: 0,
      };
    }

    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0.016;
    const focusX = ctx.focusTarget.x;
    const focusZ = ctx.focusTarget.z;
    const focusY = ctx.focusTarget.y;

    // ==========================================
    // 1. Calculate Storm Intensity Progression
    // ==========================================
    let stormFactor = 1.0;
    if (phase === 'warning') {
      const warnProgress = Math.min(1.0, phaseElapsed / Math.max(0.001, this.warningDurationSec));
      // Smoothstep curve for progressive atmospheric darkening
      stormFactor = warnProgress * warnProgress * (3 - 2 * warnProgress);
    } else {
      // In final 2.5s of active, smoothly ease the storm intensity down
      if (phaseElapsed >= 12.5) {
        const easeRemaining = Math.max(0, (this.activeDurationSec - phaseElapsed) / 2.5);
        stormFactor = easeRemaining * easeRemaining * (3 - 2 * easeRemaining);
      } else {
        stormFactor = 1.0;
      }
    }

    // ==========================================
    // 2. High-Altitude Atmospheric Sheet Lightning
    // ==========================================
    let sheetPulse = 0;
    this.nextSheetLightningTimer -= safeDt;
    if (this.nextSheetLightningTimer <= 0 && this.sheetLightningTimer <= 0) {
      this.sheetLightningDuration = 0.08 + Math.random() * 0.08; // 0.08s to 0.16s
      this.sheetLightningTimer = this.sheetLightningDuration;
      this.sheetPeakIntensity = 0.85 + Math.random() * 0.35;
      this.sheetIsDoublePulse = Math.random() < 0.45;
      this.nextSheetLightningTimer = phase === 'warning'
        ? 1.6 + Math.random() * 1.2
        : 0.9 + Math.random() * 1.1;
    }

    if (this.sheetLightningTimer > 0) {
      this.sheetLightningTimer -= safeDt;
      const p = 1.0 - Math.max(0, this.sheetLightningTimer / this.sheetLightningDuration);

      if (this.sheetIsDoublePulse) {
        if (p < 0.45) {
          sheetPulse = Math.sin((p / 0.45) * Math.PI);
        } else {
          sheetPulse = Math.sin(((p - 0.45) / 0.55) * Math.PI) * 0.82;
        }
      } else {
        sheetPulse = Math.sin(p * Math.PI);
      }
      sheetPulse *= this.sheetPeakIntensity * Math.max(0.2, stormFactor);

      if (this.overheadSheetLight.light) {
        this.overheadSheetLight.setPosition(focusX, focusY + 300, focusZ);
        this.overheadSheetLight.light.intensity = 3.2 * sheetPulse;
      }
    } else if (this.overheadSheetLight.light) {
      this.overheadSheetLight.light.intensity = 0;
    }

    // ==========================================
    // 3. Ground Strike Sky Flash Pulse
    // ==========================================
    let strikeSkyPulse = 0;
    if (this.skyFlashTimer > 0) {
      this.skyFlashTimer -= safeDt;
      const norm = Math.max(0, this.skyFlashTimer / SKY_STRIKE_FLASH_DURATION);
      strikeSkyPulse = Math.sin(norm * Math.PI);
    }

    // Apply blended atmospheric lighting and scene fog
    this.applyStormLightingAndFog(stormFactor, sheetPulse, strikeSkyPulse);

    // ==========================================
    // 4. Low-Lying Soft Wind Dust Wisps Update
    // ==========================================
    const wispOpacity1 = 0.34 * stormFactor;
    const wispOpacity2 = 0.28 * stormFactor;
    this.wispMat1.opacity = wispOpacity1;
    this.wispMat1.update();
    this.wispMat2.opacity = wispOpacity2;
    this.wispMat2.update();

    const wispSpeedMultiplier = phase === 'warning' ? 0.55 : 1.0;
    for (const w of this.dustWisps) {
      w.alongWind += w.speed * wispSpeedMultiplier * safeDt;
      w.wavePhase += w.waveSpeed * safeDt;

      // Recycle upwind smoothly
      if (w.alongWind > 260) {
        w.alongWind -= 520;
        w.acrossWind = (Math.random() - 0.5) * 420;
      }

      const worldX = focusX + w.alongWind * WIND_DIR_X - w.acrossWind * WIND_DIR_Z;
      const worldZ = focusZ + w.alongWind * WIND_DIR_Z + w.acrossWind * WIND_DIR_X;
      const groundY = ctx.sampleHeight(worldX, worldZ);
      const y = groundY + w.hoverHeight + Math.sin(w.wavePhase) * 0.45;

      w.entity.setPosition(worldX, y, worldZ);

      // Smooth edge fade near boundaries so wisps never pop in
      const edgeDist = Math.max(0, 260 - Math.abs(w.alongWind)) / 60;
      const edgeFade = Math.min(1.0, edgeDist);
      const currentScale = edgeFade * stormFactor;
      w.entity.setLocalScale(
        w.baseLength * (0.85 + currentScale * 0.15),
        1,
        w.baseWidth * (0.85 + currentScale * 0.15),
      );
    }

    // ==========================================
    // 5. Active Phase Lightning Strikes & Gameplay
    // ==========================================
    if (phase === 'active' && phaseElapsed < 12.5) {
      this.nextStrikeTimer -= safeDt;
      if (this.nextStrikeTimer <= 0) {
        this.triggerLightningStrike(ctx);
        this.nextStrikeTimer =
          MIN_STRIKE_INTERVAL + Math.random() * (MAX_STRIKE_INTERVAL - MIN_STRIKE_INTERVAL);
      }
    }

    // Update Lightning Bolt Mesh Fade & Realistic 0.16s Double-Pulse Flicker
    if (this.boltActiveTimer > 0) {
      this.boltActiveTimer -= safeDt;
      if (this.boltActiveTimer <= 0) {
        this.boltCoreEntity.enabled = false;
        this.boltCoronaEntity.enabled = false;
      } else {
        const p = 1.0 - this.boltActiveTimer / BOLT_DURATION;
        let brightness = 0;
        if (p < 0.22) {
          // Primary return stroke peak
          brightness = 1.0;
        } else if (p < 0.42) {
          // Channel pause / stutter notch
          brightness = 0.22 + 0.08 * Math.sin(p * 40);
        } else if (p < 0.68) {
          // Secondary return stroke discharge surge
          brightness = 0.92;
        } else {
          // Fast exponential decay
          const decay = (1.0 - p) / 0.32;
          brightness = 0.92 * decay * decay;
        }

        // Core updates: razor-sharp blinding white core
        this.boltCoreMaterial.opacity = Math.min(1.0, brightness);
        this.boltCoreMaterial.emissiveIntensity = 14.0 * brightness;
        this.boltCoreMaterial.update();

        // Corona glow updates: tight subtle pale-blue halo
        this.boltCoronaMaterial.opacity = Math.min(1.0, brightness * 0.75);
        this.boltCoronaMaterial.emissiveIntensity = 4.8 * brightness;
        this.boltCoronaMaterial.update();
      }
    }

    // Update Ground Plasma Shockwave Ring
    if (this.plasmaRingTimer > 0) {
      this.plasmaRingTimer -= safeDt;
      if (this.plasmaRingTimer <= 0) {
        this.plasmaRingEntity.enabled = false;
      } else {
        const progress = 1.0 - this.plasmaRingTimer / PLASMA_RING_DURATION;
        const ringScale = 2.0 + progress * 20.0;
        this.plasmaRingEntity.setLocalScale(ringScale, 1, ringScale);
        this.plasmaRingMaterial.opacity = Math.max(0, (1.0 - progress) * 0.95);
        this.plasmaRingMaterial.update();
      }
    }

    // Update Ground Impact Scorch Disc
    if (this.impactDiscTimer > 0) {
      this.impactDiscTimer -= safeDt;
      if (this.impactDiscTimer <= 0) {
        this.impactDiscEntity.enabled = false;
      } else {
        const norm = this.impactDiscTimer / IMPACT_DISC_DURATION;
        const discScale = 3.0 + (1.0 - norm) * 2.5;
        this.impactDiscEntity.setLocalScale(discScale, 1, discScale);
        this.impactDiscMaterial.opacity = norm * 0.95;
        this.impactDiscMaterial.update();
      }
    }

    // Update Rising Sparks with Realistic Terrain Bouncing
    if (this.sparksActiveTimer > 0) {
      this.sparksActiveTimer -= safeDt;
      if (this.sparksActiveTimer <= 0) {
        for (const sp of this.sparks) {
          sp.entity.enabled = false;
        }
      } else {
        const norm = this.sparksActiveTimer / SPARKS_DURATION;
        const scale = Math.max(0.01, norm * 1.2);

        for (const sp of this.sparks) {
          sp.x += sp.vx * safeDt;
          sp.y += sp.vy * safeDt;
          sp.z += sp.vz * safeDt;
          sp.vy -= 64.0 * safeDt; // Gravity

          const groundY = ctx.sampleHeight(sp.x, sp.z);
          if (sp.y <= groundY + 0.12) {
            sp.y = groundY + 0.12;
            if (sp.vy < 0) {
              sp.vy = -sp.vy * 0.44; // Bounce restitution
              sp.vx *= 0.62; // Terrain friction
              sp.vz *= 0.62;
            }
          }

          sp.entity.setPosition(sp.x, sp.y, sp.z);
          sp.entity.setLocalScale(scale, scale, scale);
        }
      }
    }

    // Update Transient Point Light at Strike Point (range ~180, peak intensity ~10)
    if (this.lightFlashTimer > 0) {
      this.lightFlashTimer -= safeDt;
      if (this.strikeLight.light) {
        if (this.lightFlashTimer <= 0) {
          this.strikeLight.light.intensity = 0;
        } else {
          const norm = this.lightFlashTimer / LIGHT_FLASH_DURATION;
          this.strikeLight.light.intensity = 10.0 * Math.pow(norm, 1.8);
        }
      }
    }

    // Update Camera Shake from Lightning Strikes
    let shakeOffset: Vec3XYZ = { x: 0, y: 0, z: 0 };
    if (this.strikeShakeRemaining > 0) {
      this.strikeShakeRemaining -= safeDt;
      const maxShakeRadius = 450;
      const prox = Math.max(0, 1.0 - this.lastStrikeDistToFocus / maxShakeRadius);
      const decay = Math.max(0, this.strikeShakeRemaining / 0.38);
      const amp = prox * prox * decay * 4.8;
      const t = phaseElapsed;
      shakeOffset = {
        x: (Math.sin(t * 48.0) * 0.6 + Math.cos(t * 76.0) * 0.4) * amp,
        y: (Math.cos(t * 56.0) * 0.7 + Math.sin(t * 92.0) * 0.3) * amp,
        z: (Math.sin(t * 40.0 + 1.2) * 0.5 + Math.cos(t * 64.0) * 0.5) * amp,
      };
    }

    // Consume Burst Damage (applied exactly once per bolt)
    const damageThisFrame = this.pendingBurstDamage;
    this.pendingBurstDamage = 0;
    const buildingsHitThisFrame = this.pendingBuildingsHit;
    this.pendingBuildingsHit = 0;

    return {
      damageThisFrame,
      productionMultiplier: phase === 'warning' ? 1.0 : ACTIVE_PRODUCTION_MULTIPLIER,
      shakeOffset,
      buildingsHitThisFrame,
    };
  }

  public stop(): void {
    this.isRunning = false;
    this.hitBuildingUids.clear();
    this.pendingBuildingsHit = 0;
    this.pendingBurstDamage = 0;
    this.rootEntity.enabled = false;
    this.hideBoltAndEffects();

    this.wispMat1.opacity = 0;
    this.wispMat1.update();
    this.wispMat2.opacity = 0;
    this.wispMat2.update();

    this.restoreFog();
  }

  public destroy(): void {
    this.stop();
    this.restoreFog();

    for (const mesh of this.createdMeshes) {
      mesh.destroy();
    }
    this.createdMeshes.length = 0;

    for (const tex of this.createdTextures) {
      tex.destroy();
    }
    this.createdTextures.length = 0;

    for (const mat of this.createdMaterials) {
      mat.destroy();
    }
    this.createdMaterials.length = 0;

    this.rootEntity.destroy();
  }

  private triggerLightningStrike(ctx: EventUpdateContext): void {
    // 1. Distribute lightning strikes randomly across the operational region
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * 260;
    let strikeX = ctx.focusTarget.x + Math.cos(ang) * dist;
    let strikeZ = ctx.focusTarget.z + Math.sin(ang) * dist;

    const maxBound = Math.max(100, ctx.worldHalf * 0.85);
    strikeX = Math.max(-maxBound, Math.min(maxBound, strikeX));
    strikeZ = Math.max(-maxBound, Math.min(maxBound, strikeZ));
    const strikeY = ctx.sampleHeight(strikeX, strikeZ);

    // 2. Generate crisp 3D multi-branch lightning mesh descending from y + 380
    this.buildLightningBoltMesh(strikeX, strikeY, strikeZ);
    this.boltCoreEntity.enabled = true;
    this.boltCoronaEntity.enabled = true;
    this.boltActiveTimer = BOLT_DURATION;
    this.boltCoreMaterial.opacity = 1.0;
    this.boltCoreMaterial.update();
    this.boltCoronaMaterial.opacity = 0.75;
    this.boltCoronaMaterial.update();

    // 3. Ground Plasma Shockwave Ring
    this.plasmaRingEntity.setPosition(strikeX, strikeY + 0.16, strikeZ);
    this.plasmaRingEntity.setLocalScale(2.0, 1, 2.0);
    this.plasmaRingEntity.enabled = true;
    this.plasmaRingTimer = PLASMA_RING_DURATION;
    this.plasmaRingMaterial.opacity = 0.95;
    this.plasmaRingMaterial.update();

    // 4. Ground Impact Scorch Disc
    this.impactDiscEntity.setPosition(strikeX, strikeY + 0.12, strikeZ);
    this.impactDiscEntity.setLocalScale(3.0, 1, 3.0);
    this.impactDiscEntity.enabled = true;
    this.impactDiscTimer = IMPACT_DISC_DURATION;
    this.impactDiscMaterial.opacity = 0.95;
    this.impactDiscMaterial.update();

    // 5. Rising Electric Sparks Pool
    for (const sp of this.sparks) {
      sp.x = strikeX;
      sp.y = strikeY + 0.35;
      sp.z = strikeZ;
      const sparkAng = Math.random() * Math.PI * 2;
      const speed = 22.0 + Math.random() * 32.0;
      sp.vx = Math.cos(sparkAng) * speed;
      sp.vy = 20.0 + Math.random() * 28.0;
      sp.vz = Math.sin(sparkAng) * speed;
      sp.entity.setPosition(sp.x, sp.y, sp.z);
      sp.entity.setLocalScale(1.1, 1.1, 1.1);
      sp.entity.enabled = true;
    }
    this.sparksActiveTimer = SPARKS_DURATION;

    // 6. Transient Point Light Flash (range ~180, peak intensity 10.0)
    this.strikeLight.setPosition(strikeX, strikeY + 3.5, strikeZ);
    if (this.strikeLight.light) {
      this.strikeLight.light.intensity = 10.0;
    }
    this.lightFlashTimer = LIGHT_FLASH_DURATION;
    this.skyFlashTimer = SKY_STRIKE_FLASH_DURATION;

    // 7. Camera Shake Trigger
    this.lastStrikeDistToFocus = Math.hypot(
      ctx.focusTarget.x - strikeX,
      ctx.focusTarget.z - strikeZ,
    );
    this.strikeShakeRemaining = 0.38;

    // 8. Gameplay Burst Damage (10 damage to buildings within 38 units, once per bolt)
    let burstDamage = 0;
    if (ctx.buildings.length === 0) {
      const dx = ctx.focusTarget.x - strikeX;
      const dz = ctx.focusTarget.z - strikeZ;
      if (dx * dx + dz * dz <= 120 * 120) {
        burstDamage += LIGHTNING_DAMAGE_BURST;
      }
    } else {
      for (const b of ctx.buildings) {
        const bx = b.worldCenter?.x ?? (b.gridX + b.cols * 0.5) * 14;
        const bz = b.worldCenter?.z ?? (b.gridZ + b.rows * 0.5) * 14;
        const dx = bx - strikeX;
        const dz = bz - strikeZ;
        if (dx * dx + dz * dz <= LIGHTNING_DAMAGE_RADIUS_SQ) {
          burstDamage += LIGHTNING_DAMAGE_BURST;
          if (!this.hitBuildingUids.has(b.uid)) {
            this.hitBuildingUids.add(b.uid);
            this.pendingBuildingsHit += 1;
          }
        }
      }
    }
    this.pendingBurstDamage += burstDamage;
  }

  /**
   * Generates dual-pass 3D cross-quad geometry:
   * 1) Concentrated, thin blinding white-blue core (~0.55 trunk, 0.25 branches)
   * 2) Subtle, tight pale-blue corona glow (~1.6 trunk, 0.8 branches)
   * Originates from high above camera view (groundY + 380) down to ground strike point.
   */
  private buildLightningBoltMesh(groundX: number, groundY: number, groundZ: number): void {
    const startY = groundY + 380; // High above camera view (never cut-off in isometric view)
    const startX = groundX + (Math.random() - 0.5) * 45;
    const startZ = groundZ + (Math.random() - 0.5) * 45;

    const segments: SegmentDef[] = [];

    // Main Trunk (22 jagged micro-segments from startY to ground)
    const trunkCount = 22;
    const trunkNodes: Array<{ x: number; y: number; z: number }> = [];
    trunkNodes.push({ x: startX, y: startY, z: startZ });

    for (let i = 1; i < trunkCount; i++) {
      const alpha = i / trunkCount;
      const bx = startX + (groundX - startX) * alpha;
      const by = startY + (groundY - startY) * alpha;
      const bz = startZ + (groundZ - startZ) * alpha;

      // Sinusoidal envelope ensures zero offset at top and impact point
      const envelope = Math.sin(alpha * Math.PI);
      const jx = (Math.random() - 0.5) * 18.0 * envelope;
      const jy = (Math.random() - 0.5) * 4.0;
      const jz = (Math.random() - 0.5) * 18.0 * envelope;

      trunkNodes.push({ x: bx + jx, y: by + jy, z: bz + jz });
    }
    trunkNodes.push({ x: groundX, y: groundY, z: groundZ });

    for (let i = 0; i < trunkNodes.length - 1; i++) {
      const a = trunkNodes[i];
      const b = trunkNodes[i + 1];
      const alpha = i / (trunkNodes.length - 1);
      segments.push({
        ax: a.x,
        ay: a.y,
        az: a.z,
        bx: b.x,
        by: b.y,
        bz: b.z,
        coreThickness: 0.55 * (1.0 - alpha * 0.15),
        coronaThickness: 1.60 * (1.0 - alpha * 0.15),
      });
    }

    // Branch 1 (5 segments off node 5 - upper trunk)
    const forkIndex1 = 5;
    if (forkIndex1 < trunkNodes.length - 1) {
      let curr = trunkNodes[forkIndex1];
      const branchAng = Math.random() * Math.PI * 2;
      let dirX = Math.cos(branchAng);
      let dirZ = Math.sin(branchAng);

      for (let s = 0; s < 5; s++) {
        const nextX = curr.x + dirX * (9 + Math.random() * 8);
        const nextY = curr.y - (14 + Math.random() * 9);
        const nextZ = curr.z + dirZ * (9 + Math.random() * 8);
        segments.push({
          ax: curr.x,
          ay: curr.y,
          az: curr.z,
          bx: nextX,
          by: nextY,
          bz: nextZ,
          coreThickness: 0.25,
          coronaThickness: 0.80,
        });
        curr = { x: nextX, y: nextY, z: nextZ };
        dirX += (Math.random() - 0.5) * 0.35;
        dirZ += (Math.random() - 0.5) * 0.35;
      }
    }

    // Branch 2 (4 segments off node 10 - mid trunk)
    const forkIndex2 = 10;
    if (forkIndex2 < trunkNodes.length - 1) {
      let curr = trunkNodes[forkIndex2];
      const branchAng = Math.random() * Math.PI * 2;
      let dirX = Math.cos(branchAng);
      let dirZ = Math.sin(branchAng);

      for (let s = 0; s < 4; s++) {
        const nextX = curr.x + dirX * (8 + Math.random() * 7);
        const nextY = curr.y - (12 + Math.random() * 8);
        const nextZ = curr.z + dirZ * (8 + Math.random() * 7);
        segments.push({
          ax: curr.x,
          ay: curr.y,
          az: curr.z,
          bx: nextX,
          by: nextY,
          bz: nextZ,
          coreThickness: 0.22,
          coronaThickness: 0.75,
        });
        curr = { x: nextX, y: nextY, z: nextZ };
      }
    }

    // Branch 3 (4 segments off node 15 - lower trunk)
    const forkIndex3 = 15;
    if (forkIndex3 < trunkNodes.length - 1) {
      let curr = trunkNodes[forkIndex3];
      const branchAng = Math.random() * Math.PI * 2;
      const dirX = Math.cos(branchAng);
      const dirZ = Math.sin(branchAng);

      for (let s = 0; s < 4; s++) {
        const nextX = curr.x + dirX * (7 + Math.random() * 6);
        const nextY = curr.y - (9 + Math.random() * 7);
        const nextZ = curr.z + dirZ * (7 + Math.random() * 6);
        segments.push({
          ax: curr.x,
          ay: curr.y,
          az: curr.z,
          bx: nextX,
          by: nextY,
          bz: nextZ,
          coreThickness: 0.20,
          coronaThickness: 0.70,
        });
        curr = { x: nextX, y: nextY, z: nextZ };
      }
    }

    // Assemble cross-quad geometry for both Core and Corona
    let vPtr = 0;
    let iPtr = 0;

    for (const seg of segments) {
      if (vPtr + 8 > MAX_BOLT_VERTICES || iPtr + 12 > MAX_BOLT_INDICES) {
        break;
      }

      const dx = seg.bx - seg.ax;
      const dy = seg.by - seg.ay;
      const dz = seg.bz - seg.az;
      const len = Math.hypot(dx, dy, dz) || 1;
      const ndx = dx / len;
      const ndy = dy / len;
      const ndz = dz / len;

      // Primary perpendicular vector (U)
      let ux = 0;
      let uy = 0;
      let uz = 0;
      if (Math.abs(ndy) < 0.95) {
        ux = -ndz;
        uy = 0;
        uz = ndx;
      } else {
        ux = 0;
        uy = ndz;
        uz = -ndy;
      }
      const uLen = Math.hypot(ux, uy, uz) || 1;
      const nUx = ux / uLen;
      const nUy = uy / uLen;
      const nUz = uz / uLen;

      // Secondary perpendicular vector (V = D x U)
      const nVx = ndy * nUz - ndz * nUy;
      const nVy = ndz * nUx - ndx * nUz;
      const nVz = ndx * nUy - ndy * nUx;

      // Half thickness offsets for Core
      const cHalf = seg.coreThickness * 0.5;
      const cUx = nUx * cHalf;
      const cUy = nUy * cHalf;
      const cUz = nUz * cHalf;
      const cVx = nVx * cHalf;
      const cVy = nVy * cHalf;
      const cVz = nVz * cHalf;

      // Half thickness offsets for Corona
      const gHalf = seg.coronaThickness * 0.5;
      const gUx = nUx * gHalf;
      const gUy = nUy * gHalf;
      const gUz = nUz * gHalf;
      const gVx = nVx * gHalf;
      const gVy = nVy * gHalf;
      const gVz = nVz * gHalf;

      const baseV = vPtr;

      // ----------------------------------------
      // Quad 1 in U plane (4 vertices)
      // ----------------------------------------
      // v0: A - U
      this.writeBoltVertex(vPtr++, seg.ax - cUx, seg.ay - cUy, seg.az - cUz, cVx, cVy, cVz,
                                   seg.ax - gUx, seg.ay - gUy, seg.az - gUz, gVx, gVy, gVz);
      // v1: A + U
      this.writeBoltVertex(vPtr++, seg.ax + cUx, seg.ay + cUy, seg.az + cUz, cVx, cVy, cVz,
                                   seg.ax + gUx, seg.ay + gUy, seg.az + gUz, gVx, gVy, gVz);
      // v2: B - U
      this.writeBoltVertex(vPtr++, seg.bx - cUx, seg.by - cUy, seg.bz - cUz, cVx, cVy, cVz,
                                   seg.bx - gUx, seg.by - gUy, seg.bz - gUz, gVx, gVy, gVz);
      // v3: B + U
      this.writeBoltVertex(vPtr++, seg.bx + cUx, seg.by + cUy, seg.bz + cUz, cVx, cVy, cVz,
                                   seg.bx + gUx, seg.by + gUy, seg.bz + gUz, gVx, gVy, gVz);

      // ----------------------------------------
      // Quad 2 in V plane (4 vertices)
      // ----------------------------------------
      // v4: A - V
      this.writeBoltVertex(vPtr++, seg.ax - cVx, seg.ay - cVy, seg.az - cVz, cUx, cUy, cUz,
                                   seg.ax - gVx, seg.ay - gVy, seg.az - gVz, gUx, gUy, gUz);
      // v5: A + V
      this.writeBoltVertex(vPtr++, seg.ax + cVx, seg.ay + cVy, seg.az + cVz, cUx, cUy, cUz,
                                   seg.ax + gVx, seg.ay + gVy, seg.az + gVz, gUx, gUy, gUz);
      // v6: B - V
      this.writeBoltVertex(vPtr++, seg.bx - cVx, seg.by - cVy, seg.bz - cVz, cUx, cUy, cUz,
                                   seg.bx - gVx, seg.by - gVy, seg.bz - gVz, gUx, gUy, gUz);
      // v7: B + V
      this.writeBoltVertex(vPtr++, seg.bx + cVx, seg.by + cVy, seg.bz + cVz, cUx, cUy, cUz,
                                   seg.bx + gVx, seg.by + gVy, seg.bz + gVz, gUx, gUy, gUz);

      // Quad 1 indices (two triangles)
      this.boltIndices[iPtr++] = baseV;
      this.boltIndices[iPtr++] = baseV + 1;
      this.boltIndices[iPtr++] = baseV + 2;

      this.boltIndices[iPtr++] = baseV + 2;
      this.boltIndices[iPtr++] = baseV + 1;
      this.boltIndices[iPtr++] = baseV + 3;

      // Quad 2 indices (two triangles)
      this.boltIndices[iPtr++] = baseV + 4;
      this.boltIndices[iPtr++] = baseV + 5;
      this.boltIndices[iPtr++] = baseV + 6;

      this.boltIndices[iPtr++] = baseV + 6;
      this.boltIndices[iPtr++] = baseV + 5;
      this.boltIndices[iPtr++] = baseV + 7;
    }

    // Update Core Mesh
    this.boltCoreMesh.setPositions(this.corePositions.subarray(0, vPtr * 3), 3);
    this.boltCoreMesh.setNormals(this.coreNormals.subarray(0, vPtr * 3), 3);
    this.boltCoreMesh.setIndices(this.boltIndices.subarray(0, iPtr));
    this.boltCoreMesh.update(pc.PRIMITIVE_TRIANGLES);

    // Update Corona Mesh
    this.boltCoronaMesh.setPositions(this.coronaPositions.subarray(0, vPtr * 3), 3);
    this.boltCoronaMesh.setNormals(this.coronaNormals.subarray(0, vPtr * 3), 3);
    this.boltCoronaMesh.setIndices(this.boltIndices.subarray(0, iPtr));
    this.boltCoronaMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  private writeBoltVertex(
    idx: number,
    cPx: number, cPy: number, cPz: number,
    cNx: number, cNy: number, cNz: number,
    gPx: number, gPy: number, gPz: number,
    gNx: number, gNy: number, gNz: number,
  ): void {
    const pOff = idx * 3;

    this.corePositions[pOff] = cPx;
    this.corePositions[pOff + 1] = cPy;
    this.corePositions[pOff + 2] = cPz;
    this.coreNormals[pOff] = cNx;
    this.coreNormals[pOff + 1] = cNy;
    this.coreNormals[pOff + 2] = cNz;

    this.coronaPositions[pOff] = gPx;
    this.coronaPositions[pOff + 1] = gPy;
    this.coronaPositions[pOff + 2] = gPz;
    this.coronaNormals[pOff] = gNx;
    this.coronaNormals[pOff + 1] = gNy;
    this.coronaNormals[pOff + 2] = gNz;
  }

  /**
   * Smoothly modulates directional sunlight and ambient lighting in-place for this frame,
   * cleanly composing with any per-frame SolarCycleSystem day/night lighting, and applies
   * atmospheric brooding storm fog and sheet/strike lightning flashes.
   */
  private applyStormLightingAndFog(
    stormFactor: number,
    sheetPulse: number,
    strikeSkyPulse: number,
  ): void {
    const s = Math.max(0, Math.min(1.0, stormFactor));

    if (s <= 0.001 && sheetPulse <= 0.001 && strikeSkyPulse <= 0.001) {
      this.restoreFog();
      return;
    }

    // 1. Directional Sun Light (modulated in-place for this frame only)
    const sun = this.findSunLight();
    if (sun?.light) {
      // Modulate intensity: dim sunlight by up to 50% during peak storm
      const dimMultiplier = pc.math.lerp(1.0, ELECTRIC_STORM_SUN_DIM_FACTOR, s);
      sun.light.intensity *= dimMultiplier;

      // Add temporary flash boost during sheet lightning and sky strike flashes if sun is active
      const flashBoost = sheetPulse * 0.18 + strikeSkyPulse * 0.32;
      if (sun.light.intensity > 0.001) {
        sun.light.intensity += flashBoost;
      }

      // Modulate color: cool down towards brooding slate-indigo storm sun color
      if (s > 0.001) {
        sun.light.color.lerp(sun.light.color, STORM_SUN_COLOR, s * 0.55);
      }
      if (sheetPulse > 0.01 || strikeSkyPulse > 0.01) {
        const flashColorWeight = sheetPulse * 0.20 + strikeSkyPulse * 0.30;
        sun.light.color.lerp(sun.light.color, SHEET_FLASH_LIGHT_COLOR, Math.min(1.0, flashColorWeight));
      }
    }

    // 2. Ambient Light (modulated in-place for this frame only)
    if (this.app.scene?.ambientLight) {
      const ambient = this.app.scene.ambientLight;
      const baseBrightness = Math.max(0.001, Math.max(ambient.r, ambient.g, ambient.b));
      const brightnessScale = Math.min(1.0, baseBrightness / 0.45);

      // Cool and subdue ambient light towards stormy slate-grey, scaled by day/night brightness
      if (s > 0.001) {
        this.workingAmbient.copy(STORM_AMBIENT_COLOR).mulScalar(brightnessScale);
        ambient.lerp(ambient, this.workingAmbient, s * 0.45);
      }

      // High-altitude sheet lightning ambient flash (cold blue-grey flash)
      if (sheetPulse > 0.01) {
        this.workingAmbient.copy(SHEET_FLASH_AMBIENT).mulScalar(Math.max(0.35, brightnessScale));
        ambient.lerp(ambient, this.workingAmbient, sheetPulse * 0.28);
      }

      // Ground strike sky flash (bright electric discharge flash)
      if (strikeSkyPulse > 0.01) {
        this.workingAmbient.copy(STRIKE_SKY_AMBIENT).mulScalar(Math.max(0.40, brightnessScale));
        ambient.lerp(ambient, this.workingAmbient, strikeSkyPulse * 0.35);
      }
    }

    // 3. Atmospheric Scene Fog (pc.FOG_LINEAR)
    if (this.app.scene && this.hasSavedFog) {
      const scene = this.app.scene;
      if (scene.fog && typeof scene.fog === 'object') {
        (scene.fog as { type?: string | number }).type = pc.FOG_LINEAR;
      } else {
        try {
          (scene as unknown as { fog: string | number }).fog = pc.FOG_LINEAR;
        } catch {
          // Ignore if getter only
        }
      }

      this.workingFogColor.lerp(this.savedFogColor, STORM_FOG_COLOR, s);
      if (sheetPulse > 0.01) {
        this.workingFogColor.lerp(this.workingFogColor, SHEET_FLASH_FOG, sheetPulse * 0.20);
      }
      if (strikeSkyPulse > 0.01) {
        this.workingFogColor.lerp(this.workingFogColor, STRIKE_SKY_FOG, strikeSkyPulse * 0.25);
      }

      if (scene.fogColor) {
        scene.fogColor.copy(this.workingFogColor);
      }
      scene.fogStart = this.savedFogStart * (1 - s) + STORM_FOG_START * s;
      scene.fogEnd = this.savedFogEnd * (1 - s) + STORM_FOG_END * s;
    }
  }

  /**
   * Captures initial scene fog baselines for guaranteed leak-free restoration.
   */
  private captureOriginalFog(): void {

    if (!this.hasSavedFog && this.app.scene) {
      const scene = this.app.scene;
      if (scene.fog !== undefined) {
        if (typeof scene.fog === 'object' && scene.fog !== null) {
          const fogObj = scene.fog as {
            type?: string | number;
            color?: pc.Color;
            start?: number;
            end?: number;
            density?: number;
          };
          this.savedFogType = fogObj.type ?? pc.FOG_NONE;
          if (fogObj.color) this.savedFogColor.copy(fogObj.color);
          this.savedFogStart = fogObj.start ?? 1;
          this.savedFogEnd = fogObj.end ?? 1000;
          this.savedFogDensity = fogObj.density ?? 0;
        } else {
          this.savedFogType = scene.fog;
        }
      } else {
        this.savedFogType = pc.FOG_NONE;
      }

      if (scene.fogColor) {
        this.savedFogColor.copy(scene.fogColor);
      }
      if (typeof scene.fogStart === 'number') {
        this.savedFogStart = scene.fogStart;
      }
      if (typeof scene.fogEnd === 'number') {
        this.savedFogEnd = scene.fogEnd;
      }
      if (typeof scene.fogDensity === 'number') {
        this.savedFogDensity = scene.fogDensity;
      }
      this.hasSavedFog = true;
    }
  }

  /**
   * Restores exact original scene fog settings.
   */
  private restoreFog(): void {
    if (!this.hasSavedFog || !this.app.scene) return;
    const scene = this.app.scene;
    if (scene.fog && typeof scene.fog === 'object') {
      const fogObj = scene.fog as {
        type?: string | number;
        color?: pc.Color;
        start?: number;
        end?: number;
        density?: number;
      };
      fogObj.type = this.savedFogType;
      fogObj.color?.copy(this.savedFogColor);
      fogObj.start = this.savedFogStart;
      fogObj.end = this.savedFogEnd;
      fogObj.density = this.savedFogDensity;
    } else {
      try {
        (scene as unknown as { fog: string | number }).fog = this.savedFogType;
      } catch {
        // Ignore if getter only
      }
    }
    if (scene.fogColor) {
      scene.fogColor.copy(this.savedFogColor);
    }
    scene.fogStart = this.savedFogStart;
    scene.fogEnd = this.savedFogEnd;
    scene.fogDensity = this.savedFogDensity;
  }

  private findSunLight(): pc.Entity | null {
    if (this.customSunLight) {
      return this.customSunLight;
    }
    const marsSun = this.app.root.findByName('MarsSun') as pc.Entity | null;
    if (marsSun?.light && marsSun.light.type === 'directional') {
      return marsSun;
    }
    let directional: pc.Entity | null = null;
    this.app.root.forEach((node) => {
      if (!directional && (node as pc.Entity).light?.type === 'directional') {
        directional = node as pc.Entity;
      }
    });
    return directional;
  }

  private hideBoltAndEffects(): void {
    this.boltCoreEntity.enabled = false;
    this.boltCoronaEntity.enabled = false;
    this.plasmaRingEntity.enabled = false;
    this.impactDiscEntity.enabled = false;
    for (const sp of this.sparks) {
      sp.entity.enabled = false;
    }
    if (this.strikeLight.light) {
      this.strikeLight.light.intensity = 0;
    }
    if (this.overheadSheetLight.light) {
      this.overheadSheetLight.light.intensity = 0;
    }
    this.boltActiveTimer = 0;
    this.plasmaRingTimer = 0;
    this.impactDiscTimer = 0;
    this.sparksActiveTimer = 0;
    this.lightFlashTimer = 0;
    this.skyFlashTimer = 0;
    this.sheetLightningTimer = 0;
    this.pendingBurstDamage = 0;
    this.strikeShakeRemaining = 0;
  }
}
