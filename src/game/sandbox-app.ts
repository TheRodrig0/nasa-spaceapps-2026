import { DustStormFx, ElectricStormFx, MeteorShowerFx, TornadoFx } from '../entities/index.ts';
import {
  BaseSurvivalSystem,
  BuildSystem,
  EventManager,
  SolarCycleSystem,
  TerrainManager,
  WORLD_HALF,
} from '../systems/index.ts';
import type { ColonyWeather } from '../systems/index.ts';
import { TerrainCameraEvent, WorldBridgeEvent } from '../types/index.ts';
import type { ActiveEventInfo, EventUpdateContext, GameState } from '../types/index.ts';
import { mountBuildMenu, mountSurvivalHud } from '../ui/index.ts';
import { LOADOUT_CONFIGS } from '../systems/survival/loadouts.ts';
import type { DifficultyId, GameSettings, LoadoutId } from '../ui/index.ts';
import { IsometricCameraController } from './input-controller.ts';
import { createCrewSandboxApp, createMainCamera, createMarsSun } from './scene-setup.ts';

const INITIAL_CAMERA_SPEED = 56;
const INITIAL_IMPACT_CENTER = { x: 0, z: -240 } as const;
const INITIAL_FOCUS_XZ = { x: 0, z: -110 } as const;
const INITIAL_DISTANCE = 720;
const INITIAL_YAW = 45;
const INITIAL_PITCH = -42;

const SETTINGS_STORAGE_KEY = 'mars-colony-settings-v1';

const DEFAULT_SETTINGS: GameSettings = {
  cameraSpeed: 'normal',
  resolutionScale: 'native',
  solDurationSec: 48,
};

const DIFFICULTY_COOLDOWNS = {
  calm: { minSec: 32, maxSec: 48 },
  normal: { minSec: 22, maxSec: 38 },
  intense: { minSec: 13, maxSec: 24 },
} as const;

function loadSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      cameraSpeed:
        parsed.cameraSpeed === 'slow' ||
        parsed.cameraSpeed === 'normal' ||
        parsed.cameraSpeed === 'fast'
          ? parsed.cameraSpeed
          : DEFAULT_SETTINGS.cameraSpeed,
      resolutionScale:
        parsed.resolutionScale === 'performance' || parsed.resolutionScale === 'native'
          ? parsed.resolutionScale
          : DEFAULT_SETTINGS.resolutionScale,
      solDurationSec:
        parsed.solDurationSec === 36 ||
        parsed.solDurationSec === 48 ||
        parsed.solDurationSec === 72
          ? parsed.solDurationSec
          : DEFAULT_SETTINGS.solDurationSec,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: GameSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage unavailability
  }
}

function resolveCanvas(): HTMLCanvasElement {
  const canvas =
    document.getElementById('application-canvas') ?? document.getElementById('app-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas #application-canvas não encontrado.');
  }
  return canvas;
}

/**
 * Bootstraps the PlayCanvas scene, Mars terrain, progression survival loop,
 * procedural disaster events, and screen lifecycle (menu, pause, settings, end).
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

  buildSystem.setEconomyHooks({
    canBuild: (definitionId, buildings) => survivalSystem.canBuild(definitionId, buildings),
    tryPayForBuilding: (definitionId, buildings) =>
      survivalSystem.tryPayForBuilding(definitionId, buildings),
    getBuildBlockReason: (definitionId, buildings) =>
      survivalSystem.getBuildBlockReason(definitionId, buildings),
    getBuildCost: (definitionId, buildings) =>
      survivalSystem.getBuildingCost(definitionId, buildings),
  });

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

  let flowState: 'menu' | 'playing' | 'paused' | 'victory' | 'defeat' = 'menu';
  let endReason: string | undefined;
  let loadout: LoadoutId = 'standard';
  let difficulty: DifficultyId = 'normal';
  let settings: GameSettings = loadSettings();
  let settingsOpen = false;
  let latestSol = solarCycle.getState();
  let latestActiveEvent: ActiveEventInfo | null = null;

  const uiRoot = document.getElementById('ui-root');

  const applySettings = (next: GameSettings): void => {
    settings = next;
    saveSettings(next);
    const speedMult = next.cameraSpeed === 'slow' ? 0.65 : next.cameraSpeed === 'fast' ? 1.65 : 1;
    isometricCamera.setPanSpeedMultiplier(speedMult);
    solarCycle.setSolDurationSec(next.solDurationSec);
    const targetRatio =
      next.resolutionScale === 'performance' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    app.graphicsDevice.maxPixelRatio = targetRatio;
    app.resizeCanvas();
  };

  const syncFlowMode = (): void => {
    const isPlaying = flowState === 'playing' && !settingsOpen;
    app.timeScale = isPlaying ? 1 : 0;
    buildSystem.setEnabled(isPlaying);
    isometricCamera.setInputEnabled(isPlaying);
    if (uiRoot) {
      uiRoot.style.display = isPlaying ? '' : 'none';
    }
  };

  const pushHudUpdate = (): void => {
    survivalHud.update(
      {
        ...survivalSystem.getState(),
        sol: latestSol,
        activeEvent: latestActiveEvent,
        status: flowState,
        endReason,
      },
      {
        loadout,
        difficulty,
        settings,
        settingsOpen,
      },
    );
  };

  const startMission = (): void => {
    buildSystem.clearPlacedBuildings();
    eventManager.reset();
    const diff = DIFFICULTY_COOLDOWNS[difficulty];
    eventManager.setCooldownRange(diff.minSec, diff.maxSec);
    solarCycle.reset();
    survivalSystem.reset(LOADOUT_CONFIGS[loadout]);

    endReason = undefined;
    latestActiveEvent = null;
    latestSol = solarCycle.getState();

    isometricCamera.setFocus(INITIAL_FOCUS_XZ.x, INITIAL_FOCUS_XZ.z, initialGroundY, true);
    isometricCamera.setDistance(INITIAL_DISTANCE, true);
    isometricCamera.setAngles(INITIAL_YAW, INITIAL_PITCH, true);
    isometricCamera.update(0.001, state, camera, sampleHeight);
    camera.setPosition(state.cameraPos.x, state.cameraPos.y, state.cameraPos.z);

    settingsOpen = false;
    flowState = 'playing';
    syncFlowMode();
    pushHudUpdate();
  };

  const pauseGame = (): void => {
    if (flowState !== 'playing') return;
    flowState = 'paused';
    syncFlowMode();
    pushHudUpdate();
  };

  const resumeGame = (): void => {
    if (flowState !== 'paused') return;
    settingsOpen = false;
    flowState = 'playing';
    syncFlowMode();
    pushHudUpdate();
  };

  const goToMainMenu = (): void => {
    buildSystem.clearPlacedBuildings();
    eventManager.reset();
    solarCycle.reset();
    survivalSystem.reset(LOADOUT_CONFIGS[loadout]);
    endReason = undefined;
    latestActiveEvent = null;
    latestSol = solarCycle.getState();
    settingsOpen = false;
    flowState = 'menu';
    syncFlowMode();
    pushHudUpdate();
  };

  const survivalHud = mountSurvivalHud(
    {
      ...survivalSystem.getState(),
      sol: latestSol,
      activeEvent: latestActiveEvent,
      status: flowState,
      endReason,
    },
    {
      loadout,
      difficulty,
      settings,
      settingsOpen,
    },
    {
      onRepair: () => {
        if (flowState !== 'playing') return;
        if (survivalSystem.repair() > 0) {
          pushHudUpdate();
        }
      },
      onStartMission: startMission,
      onPause: pauseGame,
      onResume: resumeGame,
      onRestart: startMission,
      onMainMenu: goToMainMenu,
      onToggleSettings: (open) => {
        if (open && flowState === 'playing') {
          flowState = 'paused';
        }
        settingsOpen = open;
        syncFlowMode();
        pushHudUpdate();
      },
      onUpdateSettings: (next) => {
        applySettings(next);
        pushHudUpdate();
      },
      onSelectLoadout: (nextLoadout) => {
        loadout = nextLoadout;
        pushHudUpdate();
      },
      onSelectDifficulty: (nextDiff) => {
        difficulty = nextDiff;
        pushHudUpdate();
      },
    },
  );

  applySettings(settings);
  syncFlowMode();
  pushHudUpdate();

  const onResize = (): void => {
    app.resizeCanvas();
  };
  window.addEventListener('resize', onResize);

  const onGlobalKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      if (settingsOpen) {
        settingsOpen = false;
        syncFlowMode();
        pushHudUpdate();
        return;
      }
      if (flowState === 'playing') {
        if (buildSystem.getSelectedDefinition()) return;
        pauseGame();
      } else if (flowState === 'paused') {
        resumeGame();
      }
    } else if (e.code === 'KeyP') {
      if (flowState === 'playing' && !settingsOpen) {
        pauseGame();
      } else if (flowState === 'paused' && !settingsOpen) {
        resumeGame();
      }
    }
  };
  window.addEventListener('keydown', onGlobalKeyDown, true);

  let lastRealTimeMs = performance.now();

  app.on('update', (rawDt: number) => {
    const nowMs = performance.now();
    const realDt = Math.min(0.05, Math.max(0.001, (nowMs - lastRealTimeMs) / 1000));
    lastRealTimeMs = nowMs;

    if (flowState === 'menu') {
      isometricCamera.orbitIdle(realDt * 5.5);
      isometricCamera.update(realDt, state, camera, sampleHeight);
      camera.setPosition(state.cameraPos.x, state.cameraPos.y, state.cameraPos.z);
      const focusXZ = { x: state.focusTarget.x, z: state.focusTarget.z };
      app.fire(WorldBridgeEvent.WALKER_POSE_UPDATED, focusXZ);
      app.fire(TerrainCameraEvent.STATE_UPDATED, focusXZ);
      return;
    }

    if (flowState !== 'playing' || settingsOpen) {
      return;
    }

    const safeRawDt = Number.isFinite(rawDt) ? rawDt : 0.016;
    const dt = Math.min(Math.max(0, safeRawDt), 0.1);
    if (dt <= 0) return;

    state.elapsedTime += dt;

    isometricCamera.update(dt, state, camera, sampleHeight);

    const solState = solarCycle.update(dt, state.focusTarget);
    latestSol = solState;

    const eventCtx: EventUpdateContext = {
      focusTarget: state.focusTarget,
      buildings: buildSystem.getPlacedBuildings(),
      sampleHeight,
      worldHalf: WORLD_HALF,
      solIndex: solState.solIndex,
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

    const eventStep = eventManager.update(dt, eventCtx);
    latestActiveEvent = eventStep.activeEvent;

    camera.setPosition(
      state.cameraPos.x + eventStep.shakeOffset.x,
      state.cameraPos.y + eventStep.shakeOffset.y,
      state.cameraPos.z + eventStep.shakeOffset.z,
    );

    buildSystem.update();

    const weather: ColonyWeather =
      eventStep.activeEvent?.phase === 'active'
        ? eventStep.activeEvent.type === 'dust_storm'
          ? 'dust-storm'
          : eventStep.activeEvent.type === 'electric_storm'
            ? 'electrical-storm'
            : 'clear'
        : 'clear';

    const buildingsHit = eventStep.buildingsHitThisFrame ?? 0;
    if (buildingsHit > 0) {
      survivalSystem.applyImpact(buildingsHit);
    }

    if (
      eventStep.damageThisFrame > 0 &&
      (eventStep.activeEvent?.type === 'dust_storm' ||
        buildSystem.getPlacedCount() === 0 ||
        buildingsHit === 0)
    ) {
      survivalSystem.applyContinuousDamage(
        eventStep.damageThisFrame * (buildingsHit > 0 ? 0 : 1),
      );
    }

    survivalSystem.update(dt, {
      buildings: buildSystem.getPlacedBuildings(),
      weather,
      sunEfficiency: solState.sunEfficiency,
      solIndex: solState.solIndex,
    });

    const nextSurvival = survivalSystem.getState();
    if (nextSurvival.integrity <= 0) {
      flowState = 'defeat';
      endReason = 'A integridade estrutural da base chegou a 0%.';
      eventManager.stopCurrentEvent();
      syncFlowMode();
    } else if (solState.completed) {
      if (nextSurvival.allStagesCompleted) {
        flowState = 'victory';
        endReason = 'A equipe de revezamento chegou. O posto está pronto para continuar a pesquisa.';
      } else {
        flowState = 'defeat';
        endReason = 'A equipe de revezamento chegou antes de o posto ficar autossuficiente.';
      }
      eventManager.stopCurrentEvent();
      syncFlowMode();
    }

    pushHudUpdate();

    const focusXZ = { x: state.focusTarget.x, z: state.focusTarget.z };
    app.fire(WorldBridgeEvent.WALKER_POSE_UPDATED, focusXZ);
    app.fire(TerrainCameraEvent.STATE_UPDATED, focusXZ);
  });

  const onBeforeUnload = (): void => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onGlobalKeyDown, true);
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
