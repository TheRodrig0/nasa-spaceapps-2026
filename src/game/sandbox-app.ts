import { DustStormFx, ElectricStormFx, MeteorShowerFx, TornadoFx } from '../entities/index.ts';
import {
  BaseSurvivalSystem,
  BuildSystem,
  EventManager,
  SolarCycleSystem,
  TerrainManager,
  WORLD_HALF,
} from '../systems/index.ts';
import { TerrainCameraEvent, WorldBridgeEvent } from '../types/index.ts';
import type { EventUpdateContext, GameState } from '../types/index.ts';
import { mountBuildMenu, mountSurvivalHud } from '../ui/index.ts';
import { IsometricCameraController } from './input-controller.ts';
import { createCrewSandboxApp, createMainCamera, createMarsSun } from './scene-setup.ts';

const INITIAL_CAMERA_SPEED = 56;
const INITIAL_IMPACT_CENTER = { x: 0, z: -240 } as const;
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

/**
 * Bootstraps the PlayCanvas scene, Mars terrain, procedural world disaster events
 * (meteor showers, tornadoes, electric storms), and 3D tactical isometric camera loop.
 */
export async function bootstrapGame(): Promise<void> {
  const canvas = resolveCanvas();
  const app = await createCrewSandboxApp(canvas);

  const sunLight = createMarsSun(app);
  const camera = createMainCamera(app);

  const terrainManager = new TerrainManager(app, 4092, false, { ...INITIAL_IMPACT_CENTER });

  const eventManager = new EventManager();
  eventManager.registerHandler(new MeteorShowerFx(app));
  eventManager.registerHandler(new TornadoFx(app));
  eventManager.registerHandler(new ElectricStormFx(app, sunLight));
  eventManager.registerHandler(new DustStormFx(app, sunLight));

  const buildSystem = new BuildSystem(app, canvas, camera, terrainManager);
  app.root.addChild(buildSystem.entity);
  const unmountBuildMenu = mountBuildMenu(buildSystem);

  const solarCycle = new SolarCycleSystem(app, sunLight);

  const survivalSystem = new BaseSurvivalSystem();
  const survivalHud = mountSurvivalHud({ ...survivalSystem.getState(), sol: solarCycle.getState() });

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

  const onResize = (): void => {
    app.resizeCanvas();
  };
  window.addEventListener('resize', onResize);

  app.on('update', (rawDt: number) => {
    const safeRawDt = Number.isFinite(rawDt) ? rawDt : 0.016;
    const dt = Math.min(Math.max(0, safeRawDt), 0.1);
    state.elapsedTime += dt;

    isometricCamera.update(dt, state, camera, sampleHeight);

    const eventCtx: EventUpdateContext = {
      focusTarget: state.focusTarget,
      buildings: buildSystem.getPlacedBuildings(),
      sampleHeight,
      worldHalf: WORLD_HALF,
    };

    let trigger = isometricCamera.consumeEventTrigger();
    while (trigger) {
      if (trigger === 'random') {
        eventManager.triggerRandomEvent(eventCtx, false);
      } else {
        eventManager.triggerEvent(trigger, eventCtx, false);
      }
      trigger = isometricCamera.consumeEventTrigger();
    }

    const solState = solarCycle.update(dt, state.focusTarget);

    const eventStep = eventManager.update(dt, eventCtx);

    camera.setPosition(
      state.cameraPos.x + eventStep.shakeOffset.x,
      state.cameraPos.y + eventStep.shakeOffset.y,
      state.cameraPos.z + eventStep.shakeOffset.z,
    );

    buildSystem.update();

    if (eventStep.damageThisFrame > 0) {
      survivalSystem.applyDamage(eventStep.damageThisFrame);
    }
    const activeMiners = buildSystem.getActiveMinerCount();
    survivalSystem.update(dt, activeMiners, eventStep.productionMultiplier, eventStep.activeEvent);
    survivalHud.update({ ...survivalSystem.getState(), sol: solState });

    const focusXZ = { x: state.focusTarget.x, z: state.focusTarget.z };
    app.fire(WorldBridgeEvent.WALKER_POSE_UPDATED, focusXZ);
    app.fire(TerrainCameraEvent.STATE_UPDATED, focusXZ);
  });

  const onBeforeUnload = (): void => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('beforeunload', onBeforeUnload);
    survivalHud.dispose();
    unmountBuildMenu();
    buildSystem.dispose();
    isometricCamera.dispose();
    eventManager.destroy();
    terrainManager.destroy();
  };
  window.addEventListener('beforeunload', onBeforeUnload);
}
