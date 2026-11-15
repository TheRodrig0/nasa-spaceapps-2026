// MISSÕES: Inicializa a missão selecionada e conecta o marcador flutuante ao mundo.

import { CameraSystem } from '../systems/CameraSystem.ts';
import { EngineSystem } from '../systems/EngineSystem.ts';
import { InputSystem } from '../systems/InputSystem.ts';
import { SimulationEvent } from '../systems/events/worldEvents.ts';
import type { MissionId } from '../systems/missions.ts';
import { MISSION_CONFIG } from '../systems/missionConfig.ts';
import TimeSystem from '../systems/time/index.ts';
import { DustManager } from './effects/DustManager.ts';
import { MissionWaypoint } from './missions/MissionWaypoint.ts';
import { PlayerController } from './player/PlayerController.ts';
import Sky from './sky/index.ts';
import { TerrainManager } from './terrain/TerrainManager.ts';
import { VolcanicFront } from './volcanic/VolcanicFront.ts';
import { SteampunkWalker } from './walker/SteampunkWalker.ts';

export type { CameraFocusMode, TimePreset } from '../systems/events/worldEvents.ts';

/**
 * Pure event-driven PlayCanvas World container.
 * All subsystems (Terrain, Camera, Sky, Time, Player, Spider-Walker, Dust, Input)
 * communicate exclusively through PlayCanvas events (`app.fire` / `app.on` / `app.off`).
 */
export class WorldManager {
  private engine: EngineSystem;
  private terrain: TerrainManager;
  private camera: CameraSystem;
  private sky: Sky;
  private player: PlayerController;
  private walker: SteampunkWalker;
  private dust: DustManager;
  private volcanicFront: VolcanicFront;
  private missionWaypoint: MissionWaypoint;
  private time: TimeSystem;
  private input: InputSystem;

  constructor(canvas: HTMLCanvasElement, initialSeed = MISSION_CONFIG.mapSeed, missionId?: MissionId) {
    this.engine = new EngineSystem(canvas);
    const { app, isHeadless } = this.engine;

    // 1. Terrain listens to TerrainEvent.SAMPLE_HEIGHT & TerrainEvent.REGENERATE_RANDOM
    this.terrain = new TerrainManager(app, initialSeed, isHeadless);

    // 2. Camera listens to InputEvent.*, WalkerEvent.POSE_UPDATED, PlayerEvent.POSE_UPDATED, CameraEvent.*
    this.camera = new CameraSystem(app);

    // 3. Sky listens to TimeEvent.TICK & CameraEvent.STATE_UPDATED
    this.sky = new Sky(app, isHeadless);

    // 4. Explorer & Spider-Walker listen to InputEvent.AXES, TimeEvent.TICK, TerrainEvent.SEED_CHANGED, etc.
    this.player = new PlayerController(app, isHeadless);
    // MISSÕES: Inicializa as regras da missão com o mundo da tentativa atual.
    this.volcanicFront = new VolcanicFront(app, missionId);
    this.missionWaypoint = new MissionWaypoint(app);
    this.walker = new SteampunkWalker(app, isHeadless);

    // 5. DustManager listens to WalkerEvent.FOOT_STEPPED to emit Martian dust puffs at the feet
    this.dust = new DustManager(app, isHeadless);

    this.time = new TimeSystem(app, {
      initialHour: 17.6,
      initialDay: 1,
      dayDurationMinutes: 4.0,
      timeScale: 1.0,
    }, SimulationEvent.STEP);

    this.volcanicFront.attachSimulation();

    this.input = new InputSystem(app);

    // Emit initial TimeEvent.TICK & TimeEvent.PHASE_CHANGED so Sky and automatic Night Lanterns synchronize
    this.time.initialize();
  }

  public getVolcanicStatus() {
    return this.volcanicFront.getStatus();
  }

  public getTerrainMeshStats() {
    return this.terrain.getMeshStats();
  }

  public fire(eventName: string, payload?: unknown): void {
    this.engine.app.fire(eventName, payload);
  }

  public on<T = unknown>(eventName: string, handler: (payload: T) => void): void {
    this.engine.app.on(eventName, handler as (arg: unknown) => void);
  }

  public off<T = unknown>(eventName: string, handler: (payload: T) => void): void {
    this.engine.app.off(eventName, handler as (arg: unknown) => void);
  }

  public destroy(): void {
    this.input.destroy();
    this.time.destroy();
    this.dust.destroy();
    this.missionWaypoint.destroy();
    this.volcanicFront.destroy();
    this.walker.destroy();
    this.player.destroy();
    this.sky.destroy();
    this.camera.destroy();
    this.terrain.destroy();
    this.engine.destroy();
  }
}
