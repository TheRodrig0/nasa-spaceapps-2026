import {
  CRATER_RADIUS,
  IMPACT_FLASH_DURATION,
  MAX_SPREAD_RADIUS,
  METEOR_FALL_DURATION,
  SHOCKWAVE_MAX_RADIUS,
  VolcanicFrontFx,
} from '../entities/volcanic/index.ts';
import { BuildSystem, TerrainManager, WORLD_HALF } from '../systems/index.ts';
import { TerrainCameraEvent, WorldBridgeEvent } from '../types/index.ts';
import type { GameState } from '../types/index.ts';
import { mountBuildMenu } from '../ui/index.ts';
import { IsometricCameraController } from './input-controller.ts';
import { createCrewSandboxApp, createMainCamera, createMarsSun } from './scene-setup.ts';

const INITIAL_CAMERA_SPEED = 56;
const INITIAL_IMPACT_CENTER = { x: 0, z: -240 } as const;
const SHOCKWAVE_SPEED = 780;
const INITIAL_FOCUS_XZ = { x: 0, z: -110 } as const;
const INITIAL_DISTANCE = 720;
const INITIAL_YAW = 45;
const INITIAL_PITCH = -42;

function resolveCanvas(): HTMLCanvasElement {
  const canvas =
    document.getElementById('application-canvas') ?? document.getElementById('app-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas #application-canvas não encontrado.');
  }
  return canvas;
}

function advanceImpactState(dt: number, state: GameState): void {
  if (state.impactPhase === 'idle') {
    return;
  }

  state.phaseElapsed += dt;

  if (state.impactPhase === 'meteor_falling') {
    if (state.phaseElapsed >= METEOR_FALL_DURATION) {
      state.impactPhase = 'impact_flash';
      state.phaseElapsed = 0;
      state.spreadRadius = CRATER_RADIUS * 0.92;
      state.shockwaveRadius = 48;
    }
    return;
  }

  state.shockwaveRadius = Math.min(
    SHOCKWAVE_MAX_RADIUS,
    state.shockwaveRadius + SHOCKWAVE_SPEED * dt,
  );

  const postImpactSec =
    state.impactPhase === 'impact_flash'
      ? state.phaseElapsed
      : IMPACT_FLASH_DURATION + state.phaseElapsed;
  const burstBoost = 380 * Math.exp(-postImpactSec * 1.15);
  const currentSpreadSpeed = 140 + burstBoost;
  state.spreadRadius = Math.min(MAX_SPREAD_RADIUS, state.spreadRadius + currentSpreadSpeed * dt);

  if (state.impactPhase === 'impact_flash' && state.phaseElapsed >= IMPACT_FLASH_DURATION) {
    state.impactPhase = 'spreading';
    state.phaseElapsed = 0;
  }
}

/**
 * Bootstraps the PlayCanvas scene, Mars terrain, colossal asteroid impact + meteorite swarm,
 * and 3D tactical isometric camera loop (R triggers a new strike at current camera focus).
 */
export async function bootstrapGame(): Promise<void> {
  const canvas = resolveCanvas();
  const app = await createCrewSandboxApp(canvas);

  createMarsSun(app);
  const camera = createMainCamera(app);

  const terrainManager = new TerrainManager(app, 4092, false, { ...INITIAL_IMPACT_CENTER });
  const volcanicFx = new VolcanicFrontFx(app);
  app.root.addChild(volcanicFx.entity);

  const buildSystem = new BuildSystem(app, canvas, camera, terrainManager);
  app.root.addChild(buildSystem.entity);
  const unmountBuildMenu = mountBuildMenu(buildSystem);

  const sampleHeight = (x: number, z: number): number => terrainManager.sampleHeightAt(x, z);

  const initialGroundY = sampleHeight(INITIAL_FOCUS_XZ.x, INITIAL_FOCUS_XZ.z);
  const state: GameState = {
    cameraPos: { x: 0, y: 0, z: 0 },
    focusTarget: { x: INITIAL_FOCUS_XZ.x, y: initialGroundY, z: INITIAL_FOCUS_XZ.z },
    cameraDistance: INITIAL_DISTANCE,
    yaw: INITIAL_YAW,
    pitch: INITIAL_PITCH,
    moveSpeed: INITIAL_CAMERA_SPEED,
    impactCenter: { ...INITIAL_IMPACT_CENTER },
    impactPhase: 'idle',
    phaseElapsed: 0,
    spreadRadius: 0,
    shockwaveRadius: 0,
    elapsedTime: 0,
  };

  const isometricCamera = new IsometricCameraController(
    canvas,
    window,
    undefined,
    sampleHeight,
    { x: INITIAL_FOCUS_XZ.x, y: initialGroundY, z: INITIAL_FOCUS_XZ.z },
    INITIAL_DISTANCE,
    INITIAL_YAW,
    INITIAL_PITCH,
  );

  // Prime initial camera transform immediately before first render
  isometricCamera.update(0.001, state, camera, sampleHeight);
  camera.setPosition(state.cameraPos.x, state.cameraPos.y, state.cameraPos.z);

  app.fire(WorldBridgeEvent.IMPACT_STATE_CHANGED, {
    center: state.impactCenter,
    spreadRadius: state.spreadRadius,
    shockwaveRadius: state.shockwaveRadius,
    craterRadius: CRATER_RADIUS,
    timeSeconds: state.elapsedTime,
  });

  const onResize = (): void => {
    app.resizeCanvas();
  };
  window.addEventListener('resize', onResize);

  app.on('update', (rawDt: number) => {
    const dt = Math.min(Math.max(0, rawDt), 0.1);
    state.elapsedTime += dt;

    isometricCamera.update(dt, state, camera, sampleHeight);

    if (isometricCamera.consumeImpactReset()) {
      const limit = WORLD_HALF - 160;
      state.impactCenter = {
        x: Math.max(-limit, Math.min(limit, state.focusTarget.x)),
        z: Math.max(-limit, Math.min(limit, state.focusTarget.z)),
      };
      state.impactPhase = 'meteor_falling';
      state.phaseElapsed = 0;
      state.spreadRadius = 0;
      state.shockwaveRadius = 0;
    }

    advanceImpactState(dt, state);

    app.fire(WorldBridgeEvent.IMPACT_STATE_CHANGED, {
      center: state.impactCenter,
      spreadRadius: state.spreadRadius,
      shockwaveRadius: state.shockwaveRadius,
      craterRadius: CRATER_RADIUS,
      timeSeconds: state.elapsedTime,
    });

    const shake = volcanicFx.update(dt, state, terrainManager, camera);

    camera.setPosition(
      state.cameraPos.x + shake.x,
      state.cameraPos.y + shake.y,
      state.cameraPos.z + shake.z,
    );

    buildSystem.update();

    const focusXZ = { x: state.focusTarget.x, z: state.focusTarget.z };
    app.fire(WorldBridgeEvent.WALKER_POSE_UPDATED, focusXZ);
    app.fire(TerrainCameraEvent.STATE_UPDATED, focusXZ);
  });

  const onBeforeUnload = (): void => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('beforeunload', onBeforeUnload);
    unmountBuildMenu();
    buildSystem.dispose();
    isometricCamera.dispose();
    volcanicFx.destroy();
    terrainManager.destroy();
  };
  window.addEventListener('beforeunload', onBeforeUnload);
}
