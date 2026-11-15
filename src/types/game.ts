import type { ImpactPhase, Vec2XZ } from './terrain.ts';

export interface Vec3XYZ {
  x: number;
  y: number;
  z: number;
}

export interface IsometricCameraConfig {
  defaultYaw?: number;
  defaultPitch?: number;
  minPitch?: number;
  maxPitch?: number;
  minDistance?: number;
  maxDistance?: number;
  defaultDistance?: number;
  panSpeed?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  worldLimit?: number;
}

export interface GameState {
  cameraPos: Vec3XYZ;
  focusTarget: Vec3XYZ;
  cameraDistance: number;
  yaw: number;
  pitch: number;
  moveSpeed: number;
  impactCenter: Vec2XZ;
  impactPhase: ImpactPhase;
  phaseElapsed: number;
  spreadRadius: number;
  shockwaveRadius: number;
  elapsedTime: number;
}
