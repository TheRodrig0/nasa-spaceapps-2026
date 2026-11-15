// MISSÕES: Os eventos vulcânicos também comunicam a seleção e o objetivo ativo das missões.

import type { MissionId } from '../missions.ts';
import type { AppBase } from 'playcanvas';
import { DayPhase } from '../time/types.ts';
import type { DayPhase as DayPhaseType } from '../time/types.ts';

export type CameraFocusMode = 'walker' | 'explorer';
export type TimePreset = 'day' | 'dusk' | 'night';

export const InputEvent = {
  ORBIT: 'input:orbit',
  PAN: 'input:pan',
  ZOOM: 'input:zoom',
  AXES: 'input:axes',
  ACTION_INTERACT: 'input:action-interact',
} as const;

export interface InputOrbitPayload {
  dx: number;
  dy: number;
}

export interface InputPanPayload {
  dx: number;
  dy: number;
}

export interface InputZoomPayload {
  wheelDelta: number;
}

export interface InputAxesPayload {
  forward: number;
  right: number;
  active: boolean;
  shiftBoost: boolean;
  dt: number;
}

export const TerrainEvent = {
  REGENERATE_RANDOM: 'terrain:regenerate-random',
  SEED_CHANGED: 'terrain:seed-changed',
  SAMPLE_HEIGHT: 'terrain:sample-height',
  MESH_STATS_CHANGED: 'terrain:mesh-stats-changed',
} as const;

export interface TerrainMeshStats {
  chunks: number;
  detailedChunks: number;
  triangles: number;
}

export interface TerrainSeedChangedPayload {
  seed: number;
}

export interface TerrainHeightQuery {
  x: number;
  z: number;
  outY: number;
}

export const VolcanicEvent = {
  POSITION_CHANGED: 'volcanic:position-changed',
  STATUS_CHANGED: 'volcanic:status-changed',
  SET_SPEED: 'volcanic:set-speed',
  // MISSÕES: Seleção da missão na preparação.
  SET_MISSION: 'volcanic:set-mission',
  CONTINUE_MISSION: 'volcanic:continue-mission',
  COMPLETE_OBJECTIVE: 'volcanic:complete-objective',
  START: 'volcanic:start',
  PAUSE: 'volcanic:pause',
  RESUME: 'volcanic:resume',
} as const;

export const SimulationEvent = {
  STEP: 'simulation:step',
} as const;

export interface ExtractionZone {
  x: number;
  z: number;
  radius: number;
}

export interface VolcanicStatus {
  phase: 'preparation' | 'operation' | 'paused' | 'ended';
  distance: number;
  secondsToArrival: number;
  speed: number;
  zone: 'safe' | 'heated' | 'destruction';
  hull: number;
  defeat: 'destruction' | 'thermal' | null;
  evacuated: boolean;
  extraction: ExtractionZone;
  distanceToExtraction: number;
  extractionBearing: number;
  elapsedSeconds: number;
  // MISSÕES: Estado da missão usado pelo painel, minimapa e marcador.
  missionId: MissionId;
  completedCheckpoints: number;
  target: ExtractionZone;
  targetDistance: number;
  targetBearing: number;
}

export type WalkerBiomeStyle = 'island' | 'citadel';

export const WalkerEvent = {
  HULL_DAMAGED: 'walker:hull-damaged',
  POSE_UPDATED: 'walker:pose-updated',
  SET_BOOST: 'walker:set-boost',
  BOOST_CHANGED: 'walker:boost-changed',
  SET_BASE_MODE: 'walker:set-base-mode',
  BASE_MODE_CHANGED: 'walker:base-mode-changed',
  LANTERN_STATE_CHANGED: 'walker:lantern-state-changed',
  FOOT_STEPPED: 'walker:foot-stepped',
  DOWNLOAD_GLB: 'walker:download-glb',
  SET_BIOME_STYLE: 'walker:set-biome-style',
} as const;

export interface WalkerBiomeStylePayload {
  style: WalkerBiomeStyle;
}

export interface WalkerBaseModePayload {
  baseMode: boolean;
}

export interface PoseUpdatedPayload {
  x: number;
  y: number;
  z: number;
  headingDeg: number;
}

export interface WalkerBoostPayload {
  enabled: boolean;
}

export interface WalkerLanternStatePayload {
  active: boolean;
  phase: DayPhaseType;
}

export interface WalkerFootSteppedPayload {
  legIndex: number;
  namePrefix: string;
  x: number;
  y: number;
  z: number;
  intensity: number;
}

export const PlayerEvent = {
  POSE_UPDATED: 'player:pose-updated',
  BOARDING_STATE_CHANGED: 'player:boarding-state-changed',
  TOGGLE_BOARDING: 'player:toggle-boarding',
} as const;

export interface PlayerBoardingStatePayload {
  isBoarded: boolean;
  canBoard: boolean;
  distanceToWalker: number;
}

export const CameraEvent = {
  SET_FOCUS_MODE: 'camera:set-focus-mode',
  FOCUS_MODE_CHANGED: 'camera:focus-mode-changed',
  STATE_UPDATED: 'camera:state-updated',
  CLEAR_COLOR: 'camera:clear-color',
} as const;

export interface CameraFocusModePayload {
  mode: CameraFocusMode;
}

export interface CameraStateUpdatedPayload {
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  camDist: number;
}

export interface CameraClearColorPayload {
  r: number;
  g: number;
  b: number;
}

/**
 * Pure rule for automatic night lanterns:
 * Lanterns turn ON automatically during NIGHT (19:00..05:00) and stay OFF during DAWN, DAY, and DUSK.
 */
export function shouldEnableNightLanterns(phase: DayPhaseType): boolean {
  return phase === DayPhase.NIGHT;
}

/**
 * Computes exact disembark world coordinates in front of the Tortuga's open mouth entrance.
 */
export function computeDisembarkWorldPosition(
  walkerX: number,
  walkerZ: number,
  walkerHeadingDeg: number
): [number, number] {
  const rad = (walkerHeadingDeg * Math.PI) / 180;
  const forwardX = Math.sin(rad);
  const forwardZ = Math.cos(rad);
  // Spawn right in front of the Tortuga's lowered head & open mouth (24.5m forward)
  return [
    walkerX + forwardX * 24.5,
    walkerZ + forwardZ * 24.5,
  ];
}

const sharedHeightQuery: TerrainHeightQuery = { x: 0, z: 0, outY: 0 };

/**
 * Queries terrain elevation at (x, z) strictly via the PlayCanvas event bus.
 */
export function sampleHeightViaEvent(app: AppBase, x: number, z: number): number {
  sharedHeightQuery.x = x;
  sharedHeightQuery.z = z;
  sharedHeightQuery.outY = 0;
  app.fire(TerrainEvent.SAMPLE_HEIGHT, sharedHeightQuery);
  return sharedHeightQuery.outY;
}
