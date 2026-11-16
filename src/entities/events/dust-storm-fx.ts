import * as pc from 'playcanvas';
import type {
  EventStepResult,
  EventUpdateContext,
  Vec3XYZ,
  WorldEventHandler,
  WorldEventPhase,
  WorldEventType,
} from '../../types/index.ts';

const DUST_STORM_WARNING_DURATION = 4;
const DUST_STORM_ACTIVE_DURATION = 18;
const DUST_STORM_PRODUCTION_MULTIPLIER = 0.55;
const ABRASIVE_DAMAGE_RATE = 0.55; // dmg/sec per exposed structure (min 1) during active storm

const DEFAULT_CLOUD_COUNT = 36;
const DEFAULT_STREAK_COUNT = 200;
const MAP_ENVELOPE_RADIUS = 560;
const DEFAULT_WIND_ANGLE = -0.65; // ~-37 degrees (blows from northwest toward southeast)
const WIND_DRIFT_SPEED = 92; // units/sec drift speed across map

// Warm rust-ochre Martian atmospheric haze palette (#b8643a)
const STORM_FOG_COLOR = new pc.Color(184 / 255, 100 / 255, 58 / 255);
const STORM_FOG_START = 520;
const STORM_FOG_END = 2100;
const DUST_STORM_SUN_DIM_FACTOR = 0.65; // Dim sunlight by 35% during peak dust storm

export interface DustStormOptions {
  sunLight?: pc.Entity;
  cloudCount?: number;
  streakCount?: number;
  windAngle?: number;
}

interface CloudInstance {
  readonly entity: pc.Entity;
  readonly material: pc.StandardMaterial;
  readonly baseScale: number;
  readonly altitude: number;
  readonly speedFactor: number;
  readonly swirlFreq: number;
  readonly swirlAmp: number;
  readonly rollSpeed: number;
  readonly pulseFreq: number;
  readonly pulseAmp: number;
  readonly phaseOffset: number;
  readonly crossOffset: number;
  readonly depthOffset: number;
  readonly baseOpacity: number;
  relX: number;
  relZ: number;
  rollAngle: number;
}

interface StreakParticle {
  relX: number;
  relZ: number;
  altitude: number;
  length: number;
  width: number;
  speed: number;
  alpha: number;
}

/**
 * Generates an offscreen soft billowing Martian dust cloud texture using multi-octave
 * FBM harmonic turbulence and radial Gaussian/cosine cloud puff clusters with smooth alpha falloff.
 */
function createCloudTexture(device: pc.GraphicsDevice, size = 256): pc.Texture {
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

  const puffs = [
    { x: 0.0, y: 0.0, r: 0.86, w: 1.0 },
    { x: -0.24, y: -0.18, r: 0.65, w: 0.82 },
    { x: 0.28, y: -0.14, r: 0.62, w: 0.78 },
    { x: -0.18, y: 0.24, r: 0.58, w: 0.76 },
    { x: 0.22, y: 0.22, r: 0.56, w: 0.72 },
    { x: -0.34, y: 0.04, r: 0.48, w: 0.64 },
    { x: 0.32, y: -0.06, r: 0.50, w: 0.66 },
  ];

  for (let py = 0; py < size; py++) {
    const ny = (py - half) / half;
    for (let px = 0; px < size; px++) {
      const nx = (px - half) / half;
      const distFromCenter = Math.hypot(nx, ny);
      if (distFromCenter >= 1.0) continue;

      // Outer bell curve ensures seamless zero-alpha perimeter
      const radialFalloff = 0.5 * (1 + Math.cos(distFromCenter * Math.PI));

      let puffSum = 0;
      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i];
        const pd = Math.hypot(nx - p.x, ny - p.y) / p.r;
        if (pd < 1.0) {
          const w = 0.5 * (1 + Math.cos(pd * Math.PI));
          puffSum += p.w * Math.pow(w, 1.35);
        }
      }

      // 4-octave harmonic turbulence (FBM)
      let fbm = 0;
      let amp = 0.5;
      let freq = 3.2;
      for (let o = 0; o < 4; o++) {
        const s =
          Math.sin(nx * freq + Math.cos(ny * freq * 0.85 + 1.3)) *
          Math.cos(ny * freq - Math.sin(nx * freq * 0.75 + 2.1));
        fbm += (s * 0.5 + 0.5) * amp;
        freq *= 2.12;
        amp *= 0.48;
      }

      const combined = puffSum * (0.64 + 0.46 * fbm) * radialFalloff;
      const density = Math.min(1.0, Math.max(0, combined * 0.94));

      // Rich Martian terracotta/ochre gradient
      const r = Math.round(198 * (0.84 + 0.26 * density) + 18 * (1 - density));
      const g = Math.round(106 * (0.8 + 0.3 * density) + 14 * (1 - density));
      const b = Math.round(60 * (0.76 + 0.34 * density) + 10 * (1 - density));
      const a = Math.round(Math.pow(density, 1.25) * 232);

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

  // Headless / fallback environment upload
  const texPixels = texture.lock() as Uint8Array | Uint8ClampedArray;
  texPixels.set(pixels);
  texture.unlock();
  return texture;
}

/**
 * Generates an offscreen horizontal aerodynamic sand streak texture with soft feathered boundaries.
 */
function createStreakTexture(device: pc.GraphicsDevice, width = 64, height = 16): pc.Texture {
  const texture = new pc.Texture(device, {
    width,
    height,
    format: pc.PIXELFORMAT_RGBA8,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    mipmaps: false,
  });

  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const v = py / (height - 1);
    const vertBell = 0.5 * (1 + Math.cos((v - 0.5) * 2 * Math.PI));

    for (let px = 0; px < width; px++) {
      const u = px / (width - 1);
      // Aerodynamic horizontal envelope: ease-in tail, sharp tapered head
      let horizEnvelope = 0;
      if (u < 0.7) {
        horizEnvelope = Math.pow(u / 0.7, 1.8);
      } else {
        horizEnvelope = Math.pow(Math.max(0, (1.0 - u) / 0.3), 1.2);
      }

      const alpha = Math.round(horizEnvelope * vertBell * 240);
      const idx = (py * width + px) * 4;
      pixels[idx] = 232;
      pixels[idx + 1] = 142;
      pixels[idx + 2] = 78;
      pixels[idx + 3] = alpha;
    }
  }

  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.createImageData(width, height);
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
 * 3D Martian Dust Storm world event handler.
 * Generates an encroaching dust front during warning that envelopes the entire visible colony
 * map into 30-40 billowing, overlapping terracotta/ochre billboards and hundreds of fast horizontal
 * sand streaks, smoothly transitions atmospheric fog and sunlight scattering, and applies gentle
 * abrasive hull wear to placed structures.
 */
export class DustStormFx implements WorldEventHandler {
  public readonly type: WorldEventType = 'dust_storm';
  public readonly label = 'Tempestade de Poeira';
  public readonly warningDurationSec = DUST_STORM_WARNING_DURATION;
  public readonly activeDurationSec = DUST_STORM_ACTIVE_DURATION;

  private readonly app: pc.AppBase;
  private readonly rootEntity: pc.Entity;
  private readonly customSunLight?: pc.Entity;

  // Stored fog baselines for leak-free restoration
  private savedFogType: string = pc.FOG_NONE;
  private readonly savedFogColor = new pc.Color(0, 0, 0);
  private savedFogStart = 1;
  private savedFogEnd = 1000;
  private savedFogDensity = 0;
  private hasSavedFog = false;

  // Reusable working color objects (prevents per-frame GC allocations)
  private readonly workingAmbient = new pc.Color();

  // Storm target lighting colors
  private readonly stormSunColor = new pc.Color(0.92, 0.52, 0.28).linear();
  private readonly stormAmbientColor = new pc.Color(0.55, 0.32, 0.18).linear();

  // Created resources tracked for proper cleanup
  private readonly createdMeshes: pc.Mesh[] = [];
  private readonly createdMaterials: pc.StandardMaterial[] = [];
  private readonly createdTextures: pc.Texture[] = [];

  // Procedural Textures & Meshes
  private readonly cloudTexture: pc.Texture;
  private readonly streakTexture: pc.Texture;
  private readonly quadMesh: pc.Mesh;

  // Billboard Clouds
  private readonly clouds: CloudInstance[] = [];
  private readonly cloudCount: number;

  // Fast Horizontal Wind-blown Sand Streaks
  private readonly streakCount: number;
  private readonly streakParticles: StreakParticle[] = [];
  private readonly streakMesh: pc.Mesh;
  private readonly streakMaterial: pc.StandardMaterial;
  private readonly streakEntity: pc.Entity;

  private readonly streakPositions: Float32Array;
  private readonly streakNormals: Float32Array;
  private readonly streakUvs: Float32Array;
  private readonly streakIndices: Uint16Array;

  // Wind Orientation
  private readonly windAngle: number;
  private readonly windDirX: number;
  private readonly windDirZ: number;
  private readonly crossDirX: number;
  private readonly crossDirZ: number;

  // Runtime State
  private isRunning = false;

  constructor(app: pc.AppBase, optionsOrSun?: pc.Entity | DustStormOptions) {
    this.app = app;
    let options: DustStormOptions = {};
    if (optionsOrSun instanceof pc.Entity) {
      this.customSunLight = optionsOrSun;
    } else if (optionsOrSun) {
      options = optionsOrSun;
      this.customSunLight = options.sunLight;
    }

    this.cloudCount = Math.max(30, Math.min(42, options.cloudCount ?? DEFAULT_CLOUD_COUNT));
    this.streakCount = Math.max(120, Math.min(300, options.streakCount ?? DEFAULT_STREAK_COUNT));
    this.windAngle = options.windAngle ?? DEFAULT_WIND_ANGLE;

    this.windDirX = Math.cos(this.windAngle);
    this.windDirZ = Math.sin(this.windAngle);
    this.crossDirX = -this.windDirZ;
    this.crossDirZ = this.windDirX;

    this.rootEntity = new pc.Entity('DustStormFxRoot', app);
    this.app.root.addChild(this.rootEntity);
    this.rootEntity.enabled = false;

    // Cache initial scene fog baselines
    this.captureOriginalFog();

    const device = app.graphicsDevice;

    // 1. Procedural Textures
    this.cloudTexture = createCloudTexture(device, 256);
    this.createdTextures.push(this.cloudTexture);

    this.streakTexture = createStreakTexture(device, 64, 16);
    this.createdTextures.push(this.streakTexture);

    // 2. Shared Quad Mesh for Cloud Billboards
    this.quadMesh = createQuadMesh(device);
    this.createdMeshes.push(this.quadMesh);

    // 3. Build 30-40 Layered Billboard Cloud Instances closer to terrain height (y = 6 to 55)
    for (let i = 0; i < this.cloudCount; i++) {
      // Subtle variations in warm ochre and terracotta
      const tone = 0.85 + (i % 5) * 0.05;
      // Translucent max opacity between 0.14 and 0.26
      const baseOpacity = 0.14 + (i / Math.max(1, this.cloudCount - 1)) * 0.12;

      const cloudMat = new pc.StandardMaterial();
      cloudMat.diffuse = new pc.Color(0.86 * tone, 0.48 * tone, 0.28 * tone).linear();
      cloudMat.diffuseMap = this.cloudTexture;
      cloudMat.opacityMap = this.cloudTexture;
      cloudMat.opacityMapChannel = 'a';
      cloudMat.blendType = pc.BLEND_NORMAL;
      cloudMat.depthWrite = false;
      cloudMat.cull = pc.CULLFACE_NONE;
      cloudMat.emissive = new pc.Color(0.32, 0.18, 0.10).linear();
      cloudMat.emissiveIntensity = 0.75;
      cloudMat.opacity = baseOpacity;
      cloudMat.useLighting = true;
      cloudMat.update();
      this.createdMaterials.push(cloudMat);

      const entity = new pc.Entity(`MartianDustCloud_${i}`, app);
      entity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(this.quadMesh, cloudMat)],
        castShadows: false,
        receiveShadows: false,
      });
      this.rootEntity.addChild(entity);

      // Layered altitudes close to terrain: ground skimming (6-22), low billow (22-40), mid-low canopy (40-55)
      let altitude: number;
      let baseScale: number;
      if (i < 16) {
        // Lower ground layer wrapping colony structures (y = 6..22)
        altitude = 6 + (i / 16) * 16;
        baseScale = 75 + Math.random() * 35;
      } else if (i < 30) {
        // Low-altitude rolling billows (y = 22..40)
        altitude = 22 + ((i - 16) / 14) * 18;
        baseScale = 95 + Math.random() * 40;
      } else {
        // Upper atmospheric drift (y = 40..55)
        altitude = 40 + ((i - 30) / Math.max(1, this.cloudCount - 30)) * 15;
        baseScale = 115 + Math.random() * 45;
      }

      // Initial cross and depth offsets for advancing front during warning
      const crossOffset = (Math.random() - 0.5) * 960;
      const depthOffset = (Math.random() - 0.5) * 240;

      // Distribute relative coordinates across map envelope
      const angle = (i / this.cloudCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const radius = 35 + Math.sqrt(Math.random()) * (MAP_ENVELOPE_RADIUS - 35);
      const relX = Math.cos(angle) * radius;
      const relZ = Math.sin(angle) * radius;

      this.clouds.push({
        entity,
        material: cloudMat,
        baseScale,
        altitude,
        speedFactor: 0.85 + Math.random() * 0.35,
        swirlFreq: 0.4 + Math.random() * 0.8,
        swirlAmp: 12 + Math.random() * 26,
        rollSpeed: (Math.random() - 0.5) * 8.0,
        pulseFreq: 0.8 + Math.random() * 1.4,
        pulseAmp: 0.05 + Math.random() * 0.08,
        phaseOffset: Math.random() * Math.PI * 2,
        crossOffset,
        depthOffset,
        baseOpacity,
        relX,
        relZ,
        rollAngle: Math.random() * 360,
      });
    }

    // 4. Hundreds of Fast Horizontal Wind-Blown Dust/Sand Streaks Skimming Close to Terrain
    this.streakPositions = new Float32Array(this.streakCount * 4 * 3);
    this.streakNormals = new Float32Array(this.streakCount * 4 * 3);
    this.streakUvs = new Float32Array(this.streakCount * 4 * 2);
    this.streakIndices = new Uint16Array(this.streakCount * 6);

    // Initialize static normals, UVs and indices for all streak quads
    for (let i = 0; i < this.streakCount; i++) {
      const v = i * 4;
      const n = v * 3;
      const u = v * 2;
      const ind = i * 6;

      // Normals facing straight up (+Y)
      this.streakNormals[n] = 0;     this.streakNormals[n + 1] = 1; this.streakNormals[n + 2] = 0;
      this.streakNormals[n + 3] = 0; this.streakNormals[n + 4] = 1; this.streakNormals[n + 5] = 0;
      this.streakNormals[n + 6] = 0; this.streakNormals[n + 7] = 1; this.streakNormals[n + 8] = 0;
      this.streakNormals[n + 9] = 0; this.streakNormals[n + 10] = 1; this.streakNormals[n + 11] = 0;

      // UVs
      this.streakUvs[u] = 0;     this.streakUvs[u + 1] = 0;
      this.streakUvs[u + 2] = 1; this.streakUvs[u + 3] = 0;
      this.streakUvs[u + 4] = 0; this.streakUvs[u + 5] = 1;
      this.streakUvs[u + 6] = 1; this.streakUvs[u + 7] = 1;

      // Triangle indices
      this.streakIndices[ind] = v;
      this.streakIndices[ind + 1] = v + 1;
      this.streakIndices[ind + 2] = v + 2;
      this.streakIndices[ind + 3] = v + 2;
      this.streakIndices[ind + 4] = v + 1;
      this.streakIndices[ind + 5] = v + 3;

      // Particle simulation state
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * MAP_ENVELOPE_RADIUS;
      this.streakParticles.push({
        relX: Math.cos(ang) * dist,
        relZ: Math.sin(ang) * dist,
        altitude: 0.3 + Math.random() * 2.5,
        length: 12 + Math.random() * 18,
        width: 0.7 + Math.random() * 0.7,
        speed: 230 + Math.random() * 140,
        alpha: 0.4 + Math.random() * 0.35,
      });
    }

    this.streakMesh = new pc.Mesh(device);
    this.streakMesh.setPositions(this.streakPositions, 3);
    this.streakMesh.setNormals(this.streakNormals, 3);
    this.streakMesh.setUvs(0, this.streakUvs);
    this.streakMesh.setIndices(this.streakIndices);
    this.streakMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.createdMeshes.push(this.streakMesh);

    this.streakMaterial = new pc.StandardMaterial();
    this.streakMaterial.diffuse = new pc.Color(0.96, 0.62, 0.34).linear();
    this.streakMaterial.diffuseMap = this.streakTexture;
    this.streakMaterial.opacityMap = this.streakTexture;
    this.streakMaterial.blendType = pc.BLEND_ADDITIVE;
    this.streakMaterial.depthWrite = false;
    this.streakMaterial.cull = pc.CULLFACE_NONE;
    this.streakMaterial.emissive = new pc.Color(0.95, 0.54, 0.28).linear();
    this.streakMaterial.emissiveIntensity = 1.6;
    this.streakMaterial.opacity = 0.7;
    this.streakMaterial.useLighting = false;
    this.streakMaterial.update();
    this.createdMaterials.push(this.streakMaterial);

    this.streakEntity = new pc.Entity('MartianSandStreaks', app);
    this.streakEntity.addComponent('render', {
      meshInstances: [new pc.MeshInstance(this.streakMesh, this.streakMaterial)],
      castShadows: false,
      receiveShadows: false,
    });
    this.rootEntity.addChild(this.streakEntity);
  }

  public startWarning(ctx: EventUpdateContext): void {
    void ctx;
    this.captureOriginalFog();
    this.isRunning = true;
    this.rootEntity.enabled = true;

    // Reset cloud positions into advancing wall on upwind side
    for (const cloud of this.clouds) {
      cloud.relX = -this.windDirX * 620 + this.crossDirX * cloud.crossOffset;
      cloud.relZ = -this.windDirZ * 620 + this.crossDirZ * cloud.crossOffset;
      cloud.material.opacity = cloud.baseOpacity * 0.3;
      cloud.material.update();
    }

    // Reset sand streaks toward upwind region
    for (const streak of this.streakParticles) {
      const upwindDist = 200 + Math.random() * 450;
      const crossDist = (Math.random() - 0.5) * 800;
      streak.relX = -this.windDirX * upwindDist + this.crossDirX * crossDist;
      streak.relZ = -this.windDirZ * upwindDist + this.crossDirZ * crossDist;
    }
  }

  public startActive(ctx: EventUpdateContext): void {
    void ctx;
    this.captureOriginalFog();
    this.isRunning = true;
    this.rootEntity.enabled = true;
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

    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0.016;
    const camera = this.findMainCamera();
    const camRot = camera?.getRotation() ?? null;

    // ==========================================
    // WARNING PHASE (4s)
    // ==========================================
    if (phase === 'warning') {
      const warnProgress = Math.min(1.0, phaseElapsed / Math.max(0.001, this.warningDurationSec));
      // Smoothstep curve for front advance and atmospheric haze
      const s = warnProgress * warnProgress * (3 - 2 * warnProgress);

      this.applyStormFogAndLighting(s);

      // Advancing dust cloud wall moves from 620 units upwind directly across focusTarget
      const frontDist = 620 * (1.0 - warnProgress);
      const wallFade = 0.3 + 0.7 * s;

      for (const cloud of this.clouds) {
        const targetX =
          ctx.focusTarget.x -
          this.windDirX * (frontDist + cloud.depthOffset) +
          this.crossDirX * cloud.crossOffset;
        const targetZ =
          ctx.focusTarget.z -
          this.windDirZ * (frontDist + cloud.depthOffset) +
          this.crossDirZ * cloud.crossOffset;

        const groundY = ctx.sampleHeight(targetX, targetZ);
        const y = groundY + cloud.altitude;

        cloud.rollAngle += cloud.rollSpeed * safeDt;
        const currentScale =
          cloud.baseScale * (1.0 + cloud.pulseAmp * Math.sin(phaseElapsed * cloud.pulseFreq + cloud.phaseOffset));

        cloud.entity.setPosition(targetX, y, targetZ);
        cloud.entity.setLocalScale(currentScale, currentScale, 1.0);
        if (camRot) {
          cloud.entity.setRotation(camRot);
          cloud.entity.rotateLocal(0, 0, cloud.rollAngle);
        } else {
          cloud.entity.setEulerAngles(-42, 45, cloud.rollAngle);
        }

        cloud.material.opacity = cloud.baseOpacity * wallFade;
        cloud.material.update();
      }

      // Wind-streaked sand particles pick up across the terrain
      const activeStreakCount = Math.floor(this.streakCount * (0.2 + 0.65 * s));
      this.updateSandStreaks(safeDt, activeStreakCount, ctx);

      // Subtle rising wind camera shake
      const breezeAmp = s * 0.16;
      const t = phaseElapsed;
      const shakeOffset: Vec3XYZ = {
        x: Math.sin(t * 8.5) * breezeAmp,
        y: Math.cos(t * 9.8) * breezeAmp * 0.45,
        z: Math.sin(t * 7.4 + 1.1) * breezeAmp,
      };

      return {
        damageThisFrame: 0,
        productionMultiplier: 1.0,
        shakeOffset,
      };
    }

    // ==========================================
    // ACTIVE PHASE (18s)
    // ==========================================
    const remainingSec = Math.max(0, this.activeDurationSec - phaseElapsed);
    let intensityFade = 1.0;
    if (remainingSec < 2.5) {
      const exitNorm = Math.max(0, remainingSec / 2.5);
      intensityFade = exitNorm * exitNorm * (3 - 2 * exitNorm);
    }

    this.applyStormFogAndLighting(intensityFade);

    // 30-40 Billowing dust clouds drifting and swirling across the entire map (radius ~550+ units)
    for (const cloud of this.clouds) {
      // Advance drift along wind vector with individual swirl
      const swirl = Math.sin(phaseElapsed * cloud.swirlFreq + cloud.phaseOffset) * cloud.swirlAmp;
      cloud.relX += (this.windDirX * WIND_DRIFT_SPEED * cloud.speedFactor + this.crossDirX * swirl * 0.25) * safeDt;
      cloud.relZ += (this.windDirZ * WIND_DRIFT_SPEED * cloud.speedFactor + this.crossDirZ * swirl * 0.25) * safeDt;

      // Wrap clouds when drifting beyond downwind perimeter back to upwind side
      const downwindProj = cloud.relX * this.windDirX + cloud.relZ * this.windDirZ;
      if (downwindProj > MAP_ENVELOPE_RADIUS) {
        cloud.relX -= this.windDirX * (MAP_ENVELOPE_RADIUS * 2);
        cloud.relZ -= this.windDirZ * (MAP_ENVELOPE_RADIUS * 2);
      }

      const worldX = ctx.focusTarget.x + cloud.relX;
      const worldZ = ctx.focusTarget.z + cloud.relZ;
      const groundY = ctx.sampleHeight(worldX, worldZ);
      const y = groundY + cloud.altitude;

      cloud.rollAngle += cloud.rollSpeed * safeDt;
      const scaleBreath = 1.0 + cloud.pulseAmp * Math.sin(phaseElapsed * cloud.pulseFreq + cloud.phaseOffset);
      const currentScale = cloud.baseScale * scaleBreath;

      cloud.entity.setPosition(worldX, y, worldZ);
      cloud.entity.setLocalScale(currentScale, currentScale, 1.0);
      if (camRot) {
        cloud.entity.setRotation(camRot);
        cloud.entity.rotateLocal(0, 0, cloud.rollAngle);
      } else {
        cloud.entity.setEulerAngles(-42, 45, cloud.rollAngle);
      }

      const subtlePulse = 1.0 + 0.08 * Math.sin(phaseElapsed * 1.5 + cloud.phaseOffset);
      cloud.material.opacity = Math.min(0.26, Math.max(0.14, cloud.baseOpacity * subtlePulse)) * intensityFade;
      cloud.material.update();
    }

    // Animate all hundreds of fast skimming sand streaks
    this.updateSandStreaks(safeDt, this.streakCount, ctx);

    // Subtle wind camera shake with harmonic gust variations
    const t = phaseElapsed;
    const gust = 0.72 + 0.28 * Math.sin(t * 1.6) * Math.cos(t * 0.85);
    const shakeAmp = 0.42 * gust * intensityFade;
    const shakeOffset: Vec3XYZ = {
      x: (Math.sin(t * 9.4) * 0.58 + Math.cos(t * 14.8) * 0.42) * shakeAmp,
      y: (Math.cos(t * 10.6) * 0.65 + Math.sin(t * 17.2) * 0.35) * shakeAmp * 0.5,
      z: (Math.sin(t * 8.6 + 1.2) * 0.54 + Math.cos(t * 13.5) * 0.46) * shakeAmp,
    };

    // Gentle abrasive hull wear across exposed base structures (or outpost fallback)
    const effectiveTargets = Math.max(1, ctx.buildings.length);
    const damageThisFrame = effectiveTargets * ABRASIVE_DAMAGE_RATE * safeDt;

    return {
      damageThisFrame,
      productionMultiplier: DUST_STORM_PRODUCTION_MULTIPLIER,
      shakeOffset,
    };
  }

  public stop(): void {
    this.isRunning = false;
    this.rootEntity.enabled = false;
    this.restoreFog();
  }

  public destroy(): void {
    this.stop();
    this.restoreFog();

    for (const tex of this.createdTextures) {
      tex.destroy();
    }
    this.createdTextures.length = 0;

    for (const mesh of this.createdMeshes) {
      mesh.destroy();
    }
    this.createdMeshes.length = 0;

    for (const mat of this.createdMaterials) {
      mat.destroy();
    }
    this.createdMaterials.length = 0;

    this.rootEntity.destroy();
  }

  /**
   * Updates horizontal wind-blown sand streaks skimming closely across the terrain surface.
   */
  private updateSandStreaks(dt: number, activeCount: number, ctx: EventUpdateContext): void {
    const hwX = this.crossDirX;
    const hwZ = this.crossDirZ;
    let pPtr = 0;

    for (let i = 0; i < this.streakCount; i++) {
      const streak = this.streakParticles[i];

      if (i < activeCount) {
        // Fast horizontal wind travel
        streak.relX += this.windDirX * streak.speed * dt;
        streak.relZ += this.windDirZ * streak.speed * dt;

        // Wrap particles when drifting past downwind perimeter
        const downwind = streak.relX * this.windDirX + streak.relZ * this.windDirZ;
        if (downwind > MAP_ENVELOPE_RADIUS) {
          streak.relX -= this.windDirX * (MAP_ENVELOPE_RADIUS * 1.95);
          streak.relZ -= this.windDirZ * (MAP_ENVELOPE_RADIUS * 1.95);
          // Randomize cross-wind offset and terrain altitude on recycle
          const crossDist = (Math.random() - 0.5) * 920;
          streak.relX += this.crossDirX * crossDist * 0.2;
          streak.relZ += this.crossDirZ * crossDist * 0.2;
          streak.altitude = 0.3 + Math.random() * 2.5;
        }

        const worldX = ctx.focusTarget.x + streak.relX;
        const worldZ = ctx.focusTarget.z + streak.relZ;

        const halfLen = streak.length * 0.5;
        const halfWid = streak.width * 0.5;

        const tailX = worldX - this.windDirX * halfLen;
        const tailZ = worldZ - this.windDirZ * halfLen;
        const headX = worldX + this.windDirX * halfLen;
        const headZ = worldZ + this.windDirZ * halfLen;

        const tailY = ctx.sampleHeight(tailX, tailZ) + streak.altitude;
        const headY = ctx.sampleHeight(headX, headZ) + streak.altitude;

        const ox = hwX * halfWid;
        const oz = hwZ * halfWid;

        // v0: Tail - offset
        this.streakPositions[pPtr++] = tailX - ox;
        this.streakPositions[pPtr++] = tailY;
        this.streakPositions[pPtr++] = tailZ - oz;

        // v1: Tail + offset
        this.streakPositions[pPtr++] = tailX + ox;
        this.streakPositions[pPtr++] = tailY;
        this.streakPositions[pPtr++] = tailZ + oz;

        // v2: Head - offset
        this.streakPositions[pPtr++] = headX - ox;
        this.streakPositions[pPtr++] = headY;
        this.streakPositions[pPtr++] = headZ - oz;

        // v3: Head + offset
        this.streakPositions[pPtr++] = headX + ox;
        this.streakPositions[pPtr++] = headY;
        this.streakPositions[pPtr++] = headZ + oz;
      } else {
        // Collapsed inactive particle quad
        for (let k = 0; k < 12; k++) {
          this.streakPositions[pPtr++] = 0;
        }
      }
    }

    this.streakMesh.setPositions(this.streakPositions, 3);
    this.streakMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /**
   * Smoothly modulates directional sunlight and ambient lighting in-place for this frame,
   * cleanly composing with any per-frame SolarCycleSystem day/night lighting, and applies
   * warm Martian dust atmospheric fog.
   */
  private applyStormFogAndLighting(blendFactor: number): void {
    const s = Math.max(0, Math.min(1, blendFactor));

    // Directional Sun Light (modulated in-place for this frame only)
    const sun = this.findSunLight();
    if (sun?.light && s > 0.001) {
      // Modulate intensity: dim sunlight by up to 35% during peak storm
      const dimMultiplier = pc.math.lerp(1.0, DUST_STORM_SUN_DIM_FACTOR, s);
      sun.light.intensity *= dimMultiplier;

      // Tint sunlight towards warm terracotta/ochre Martian dust
      sun.light.color.lerp(sun.light.color, this.stormSunColor, s * 0.55);
    }

    // Ambient Lighting (modulated in-place for this frame only)
    if (this.app.scene?.ambientLight && s > 0.001) {
      const ambient = this.app.scene.ambientLight;
      const baseBrightness = Math.max(0.001, Math.max(ambient.r, ambient.g, ambient.b));
      const brightnessScale = Math.min(1.0, baseBrightness / 0.45);

      this.workingAmbient.copy(this.stormAmbientColor).mulScalar(brightnessScale);
      ambient.lerp(ambient, this.workingAmbient, s * 0.50);
    }

    // Scene Fog
    if (this.app.scene && this.hasSavedFog) {
      const scene = this.app.scene;
      if (s > 0.005) {
        if (scene.fog && typeof scene.fog === 'object') {
          scene.fog.type = pc.FOG_LINEAR;
          scene.fog.color.lerp(this.savedFogColor, STORM_FOG_COLOR, s);
          scene.fog.start = this.savedFogStart * (1 - s) + STORM_FOG_START * s;
          scene.fog.end = this.savedFogEnd * (1 - s) + STORM_FOG_END * s;
        }
        scene.fogColor.lerp(this.savedFogColor, STORM_FOG_COLOR, s);
        scene.fogStart = this.savedFogStart * (1 - s) + STORM_FOG_START * s;
        scene.fogEnd = this.savedFogEnd * (1 - s) + STORM_FOG_END * s;
      } else {
        this.restoreFog();
      }
    }
  }

  /**
   * Captures initial scene fog baselines for guaranteed leak-free restoration.
   */
  private captureOriginalFog(): void {

    if (!this.hasSavedFog && this.app.scene) {
      const scene = this.app.scene;
      if (scene.fog && typeof scene.fog === 'object') {
        this.savedFogType = scene.fog.type;
        this.savedFogColor.copy(scene.fog.color);
        this.savedFogStart = scene.fog.start;
        this.savedFogEnd = scene.fog.end;
        this.savedFogDensity = scene.fog.density;
      }
      this.savedFogColor.copy(scene.fogColor);
      this.savedFogStart = scene.fogStart;
      this.savedFogEnd = scene.fogEnd;
      this.savedFogDensity = scene.fogDensity;
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
      scene.fog.type = this.savedFogType;
      scene.fog.color.copy(this.savedFogColor);
      scene.fog.start = this.savedFogStart;
      scene.fog.end = this.savedFogEnd;
      scene.fog.density = this.savedFogDensity;
    }
    scene.fogColor.copy(this.savedFogColor);
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

  private findMainCamera(): pc.Entity | null {
    const mainCam = this.app.root.findByName('MainCamera') as pc.Entity | null;
    if (mainCam?.camera) {
      return mainCam;
    }
    let found: pc.Entity | null = null;
    this.app.root.forEach((node) => {
      if (!found && (node as pc.Entity).camera) {
        found = node as pc.Entity;
      }
    });
    return found;
  }
}
