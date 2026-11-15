import * as pc from 'playcanvas';
import {
  TerrainCameraEvent,
  TerrainEvent,
  TerrainPlayerEvent,
  WorldBridgeEvent,
} from '../../types/index.ts';
import type {
  CameraStateUpdatedPayload,
  Crater,
  ImpactStatePayload,
  PoseUpdatedPayload,
  TerrainChunk,
  TerrainHeightQuery,
  TerrainMeshStats,
  Vec2XZ,
} from '../../types/index.ts';
import { createTerrainChunkMesh } from './chunk-mesh.ts';
import { createCratersForSeed, samplePlanetHeight, WORLD_HALF } from './geology.ts';
import { createVolcanicTerrainMaterial } from './volcanic-shader.ts';

const CHUNKS_PER_SIDE = 12;
const CHUNK_SIZE = (WORLD_HALF * 2) / CHUNKS_PER_SIDE;
const DETAIL_RADIUS = CHUNK_SIZE * 1.2;
const DETAIL_EXIT_RADIUS = CHUNK_SIZE * 1.55;
const HEIGHTMAP_MIN = -250;
const HEIGHTMAP_RANGE = 900;

export class TerrainManager {
  private app: pc.AppBase;
  private chunks: TerrainChunk<pc.Entity>[] = [];
  private sharedMaterial: pc.StandardMaterial;
  private readonly fractureTexture: pc.Texture;
  private readonly heightMapBytes: Uint8Array;
  private heightMapTexture: pc.Texture | null = null;
  private readonly impactCenterArr = new Float32Array(2);
  private seed: number;
  private craters: Crater[];
  private isHeadless: boolean;
  private readonly cellsPerChunk: number;
  private readonly cellsPerSide: number;
  private readonly cellSize: number;
  private readonly heights: Float32Array;
  private readonly coords: Float64Array;
  private readonly walker = new pc.Vec2();
  private readonly explorer = new pc.Vec2();
  private readonly camera = new pc.Vec2();
  private readonly detailSamples = [this.walker, this.explorer, this.camera];
  private lastDetailCheck = -Infinity;

  private readonly onSampleHeightHandler: (q: TerrainHeightQuery) => void;
  private readonly onRegenerateRandomHandler: () => void;

  constructor(
    app: pc.AppBase,
    initialSeed = 4092,
    isHeadless = false,
    initialImpactCenter: Vec2XZ = { x: 0, z: -140 },
  ) {
    this.app = app;
    this.isHeadless = isHeadless;
    this.cellsPerChunk = isHeadless ? 18 : 20;
    this.cellsPerSide = CHUNKS_PER_SIDE * this.cellsPerChunk;
    this.cellSize = (WORLD_HALF * 2) / this.cellsPerSide;
    this.heights = new Float32Array((this.cellsPerSide + 1) ** 2);
    this.heightMapBytes = new Uint8Array((this.cellsPerSide + 1) ** 2 * 4);
    this.coords = Float64Array.from(
      { length: this.cellsPerSide + 1 },
      (_, i) => -WORLD_HALF + i * this.cellSize,
    );
    this.seed = initialSeed;
    this.craters = createCratersForSeed(initialSeed);

    const { material, fractureTexture } = createVolcanicTerrainMaterial(
      app.graphicsDevice,
      initialImpactCenter,
    );
    this.sharedMaterial = material;
    this.fractureTexture = fractureTexture;
    this.impactCenterArr[0] = initialImpactCenter.x;
    this.impactCenterArr[1] = initialImpactCenter.z;

    this.onSampleHeightHandler = (q: TerrainHeightQuery) => {
      q.outY = this.sampleHeightAt(q.x, q.z);
    };
    this.onRegenerateRandomHandler = () => {
      this.regenerateRandomSeed();
    };

    this.toggleEventListeners(true);
    this.buildChunks();
  }

  public getHeightMapTexture(): pc.Texture {
    if (!this.heightMapTexture) {
      throw new Error('Heightmap texture not initialized.');
    }
    return this.heightMapTexture;
  }

  public getFractureTexture(): pc.Texture {
    return this.fractureTexture;
  }

  public setImpactState(state: ImpactStatePayload): void {
    this.impactCenterArr[0] = state.center.x;
    this.impactCenterArr[1] = state.center.z;
    this.sharedMaterial.setParameter('uImpactCenter', this.impactCenterArr);
    this.sharedMaterial.setParameter('uSpreadRadius', state.spreadRadius);
    this.sharedMaterial.setParameter('uShockwaveRadius', state.shockwaveRadius);
    this.sharedMaterial.setParameter('uCraterRadius', state.craterRadius);
    this.sharedMaterial.setParameter('uTime', state.timeSeconds);
  }

  private trackWalker({ x, z }: PoseUpdatedPayload): void {
    this.walker.set(x, z);
  }

  private trackExplorer({ x, z }: PoseUpdatedPayload): void {
    this.explorer.set(x, z);
  }

  private needsDetail(cx: number, cz: number, radius: number): boolean {
    const minX = -WORLD_HALF + cx * CHUNK_SIZE;
    const minZ = -WORLD_HALF + cz * CHUNK_SIZE;
    return this.detailSamples.some(({ x, y: z }) => {
      const dx = Math.max(minX - x, 0, x - minX - CHUNK_SIZE);
      const dz = Math.max(minZ - z, 0, z - minZ - CHUNK_SIZE);
      return dx * dx + dz * dz < radius * radius;
    });
  }

  public updateRenderDetail({ x, z }: CameraStateUpdatedPayload): void {
    const now = performance.now();
    if (now - this.lastDetailCheck < 200) return;
    this.lastDetailCheck = now;
    this.camera.set(x, z);

    let changed = false;
    for (const chunk of this.chunks) {
      const radius = chunk.detailed ? DETAIL_EXIT_RADIUS : DETAIL_RADIUS;
      const detailed = this.needsDetail(chunk.cx, chunk.cz, radius);
      if (detailed === chunk.detailed) continue;

      const mesh = this.createChunkMesh(chunk.cx, chunk.cz, detailed);
      chunk.entity.render!.meshInstances = [new pc.MeshInstance(mesh, this.sharedMaterial)];
      chunk.detailed = detailed;
      changed = true;
    }
    if (changed) this.app.fire(TerrainEvent.MESH_STATS_CHANGED, this.getMeshStats());
  }

  public getMeshStats(): TerrainMeshStats {
    let detailedChunks = 0;
    let triangles = 0;
    for (const { entity, detailed } of this.chunks) {
      if (detailed) detailedChunks++;
      triangles += (entity.render?.meshInstances?.[0]?.mesh?.primitive[0]?.count ?? 0) / 3;
    }

    return { chunks: this.chunks.length, detailedChunks, triangles };
  }

  public sampleHeightAt(x: number, z: number): number {
    if (Math.abs(x) > WORLD_HALF || Math.abs(z) > WORLD_HALF) {
      return samplePlanetHeight(x, z, this.seed, this.craters);
    }

    const gridX = (x + WORLD_HALF) / this.cellSize;
    const gridZ = (z + WORLD_HALF) / this.cellSize;
    const ix = Math.min(Math.floor(gridX), this.cellsPerSide - 1);
    const iz = Math.min(Math.floor(gridZ), this.cellsPerSide - 1);
    const u = gridX - ix;
    const v = gridZ - iz;
    const stride = this.cellsPerSide + 1;
    const i = iz * stride + ix;
    const a = this.heights[i];
    const b = this.heights[i + 1];
    const c = this.heights[i + stride];
    const d = this.heights[i + stride + 1];

    if ((ix + iz) % 2 === 0) {
      return u + v <= 1
        ? a + u * (b - a) + v * (c - a)
        : d + (1 - u) * (c - d) + (1 - v) * (b - d);
    }
    return u >= v
      ? a + u * (b - a) + v * (d - b)
      : a + u * (d - c) + v * (c - a);
  }

  public regenerateRandomSeed(): number {
    const nextSeed = Math.floor(1000 + Math.random() * 9000);
    this.seed = nextSeed;
    this.craters = createCratersForSeed(nextSeed);
    this.buildChunks();
    this.app.fire(TerrainEvent.SEED_CHANGED, { seed: nextSeed });
    return nextSeed;
  }

  public buildChunks(): void {
    for (const { entity } of this.chunks) {
      entity.destroy();
    }
    this.chunks = [];

    const stride = this.cellsPerSide + 1;
    const coords = this.coords;
    for (let z = 0; z < stride; z++) {
      for (let x = 0; x < stride; x++) {
        const idx = z * stride + x;
        const h = samplePlanetHeight(coords[x], coords[z], this.seed, this.craters);
        this.heights[idx] = h;

        const norm = Math.max(0, Math.min(1, (h - HEIGHTMAP_MIN) / HEIGHTMAP_RANGE));
        const q = Math.round(norm * 65535);
        const offset = idx * 4;
        this.heightMapBytes[offset] = (q >> 8) & 255;
        this.heightMapBytes[offset + 1] = q & 255;
        this.heightMapBytes[offset + 2] = 0;
        this.heightMapBytes[offset + 3] = 255;
      }
    }

    if (this.heightMapTexture) {
      this.heightMapTexture.upload();
    } else {
      this.heightMapTexture = new pc.Texture(this.app.graphicsDevice, {
        name: 'MarsHeightMapTexture',
        width: stride,
        height: stride,
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: pc.FILTER_NEAREST,
        magFilter: pc.FILTER_NEAREST,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        levels: [this.heightMapBytes],
      });
    }

    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const detailed = this.needsDetail(cx, cz, DETAIL_RADIUS);
        const mesh = this.createChunkMesh(cx, cz, detailed);
        const entity = new pc.Entity(`PlanetChunk_${cx}_${cz}`);
        entity.addComponent('render', {
          meshInstances: [new pc.MeshInstance(mesh, this.sharedMaterial)],
          castShadows: !this.isHeadless,
          receiveShadows: !this.isHeadless,
        });
        this.app.root.addChild(entity);
        this.chunks.push({ entity, cx, cz, detailed });
      }
    }
    this.app.fire(TerrainEvent.MESH_STATS_CHANGED, this.getMeshStats());
  }

  public destroy(): void {
    this.toggleEventListeners(false);
    for (const { entity } of this.chunks) {
      entity.destroy();
    }
    this.chunks = [];
    this.sharedMaterial.destroy();
    this.fractureTexture.destroy();
    this.heightMapTexture?.destroy();
    this.heightMapTexture = null;
  }

  private createChunkMesh(cx: number, cz: number, detailed: boolean): pc.Mesh {
    return createTerrainChunkMesh({
      graphicsDevice: this.app.graphicsDevice,
      cx,
      cz,
      detailed,
      isHeadless: this.isHeadless,
      cellsPerChunk: this.cellsPerChunk,
      cellsPerSide: this.cellsPerSide,
      seed: this.seed,
      coords: this.coords,
      heights: this.heights,
    });
  }

  private toggleEventListeners(register: boolean): void {
    const bindings: ReadonlyArray<readonly [string, (...args: any[]) => void]> = [
      [TerrainEvent.SAMPLE_HEIGHT, this.onSampleHeightHandler],
      [TerrainEvent.REGENERATE_RANDOM, this.onRegenerateRandomHandler],
      [WorldBridgeEvent.IMPACT_STATE_CHANGED, this.setImpactState],
      [WorldBridgeEvent.WALKER_POSE_UPDATED, this.trackWalker],
      [TerrainPlayerEvent.POSE_UPDATED, this.trackExplorer],
      [TerrainCameraEvent.STATE_UPDATED, this.updateRenderDetail],
    ];

    for (const [event, handler] of bindings) {
      if (register) {
        this.app.on(event, handler, this);
      } else {
        this.app.off(event, handler, this);
      }
    }
  }
}
