export interface Vec2XZ {
  x: number;
  z: number;
}

export const WorldBridgeEvent = {
  TERRAIN_SAMPLE_HEIGHT: 'terrain:sample-height',
  IMPACT_STATE_CHANGED: 'volcanic:impact-changed',
  WALKER_POSE_UPDATED: 'walker:pose-updated',
} as const;
export type WorldBridgeEvent = (typeof WorldBridgeEvent)[keyof typeof WorldBridgeEvent];

export interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

export type RgbColorTuple = [number, number, number];

export interface TerrainHeightQuery {
  x: number;
  z: number;
  outY: number;
}

export interface TerrainMeshStats {
  chunks: number;
  detailedChunks: number;
  triangles: number;
}

export interface PoseUpdatedPayload {
  x: number;
  z: number;
}

export interface CameraStateUpdatedPayload {
  x: number;
  z: number;
}

export interface TerrainSeedChangedPayload {
  seed: number;
}

export interface TerrainChunk<TEntity = unknown> {
  entity: TEntity;
  cx: number;
  cz: number;
  detailed: boolean;
}

export type ImpactPhase = 'idle' | 'meteor_falling' | 'impact_flash' | 'spreading';

export interface ImpactStatePayload {
  center: Vec2XZ;
  spreadRadius: number;
  shockwaveRadius: number;
  craterRadius: number;
  timeSeconds: number;
}

export interface ImpactHeightSampler {
  sampleHeightAt(x: number, z: number): number;
  getHeightMapTexture(): unknown;
  getFractureTexture(): unknown;
}

export interface VolcanicShakeOffset {
  x: number;
  y: number;
  z: number;
}

export const TerrainEvent = {
  SAMPLE_HEIGHT: WorldBridgeEvent.TERRAIN_SAMPLE_HEIGHT,
  REGENERATE_RANDOM: 'terrain:regenerate-random',
  MESH_STATS_CHANGED: 'terrain:mesh-stats-changed',
  SEED_CHANGED: 'terrain:seed-changed',
} as const;
export type TerrainEvent = (typeof TerrainEvent)[keyof typeof TerrainEvent];

export const TerrainCameraEvent = {
  STATE_UPDATED: 'camera:state-updated',
} as const;
export type TerrainCameraEvent = (typeof TerrainCameraEvent)[keyof typeof TerrainCameraEvent];

export const TerrainPlayerEvent = {
  POSE_UPDATED: 'player:pose-updated',
} as const;
export type TerrainPlayerEvent = (typeof TerrainPlayerEvent)[keyof typeof TerrainPlayerEvent];
