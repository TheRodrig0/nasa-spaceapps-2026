// MISSÕES: Progressão dos objetivos das missões e validação da extração.

import type { AppBase } from 'playcanvas';
import {
  type ExtractionZone,
  type InputAxesPayload,
  type PoseUpdatedPayload,
  type VolcanicStatus,
  InputEvent,
  SimulationEvent,
  VolcanicEvent,
  WalkerEvent,
} from '../../systems/events/worldEvents.ts';
import { nextCampaignMission } from '../../systems/campaign.ts';
import { MISSION_CONFIG } from '../../systems/missionConfig.ts';
import { getMissionCheckpoints, MISSIONS, type MissionId } from '../../systems/missions.ts';
import { WORLD_HALF } from '../terrain/geology.ts';
import { getExtractionEntry, getExtractionZone, type FrontSpeed } from '../extraction/extractionZone.ts';

const config = MISSION_CONFIG.volcanic;

export class VolcanicFront {
  private walker: PoseUpdatedPayload = { ...MISSION_CONFIG.walkerSpawn, y: 0 };
  private previousWalker = this.walker;
  private frontZ: number = -config.startDistance;
  private speed: FrontSpeed = config.defaultSpeed;
  private readonly extractionHeadingOffset = (2 * Math.random() - 1) * MISSION_CONFIG.extraction.headingSpreadDeg;
  private extraction = getExtractionZone(this.speed, this.extractionHeadingOffset);
  private missionId: MissionId;
  private checkpoints: ExtractionZone[];
  private completedCheckpoints = 0;
  private evacuated = false;
  private elapsedTime = 0;
  private hull: number = config.initialHull;
  private phase: VolcanicStatus['phase'] = 'preparation';
  private defeat: VolcanicStatus['defeat'] = null;
  private lastStatus?: VolcanicStatus;

  constructor(private readonly app: AppBase, missionId: MissionId = MISSIONS[0].id) {
    this.missionId = missionId;
    this.checkpoints = getMissionCheckpoints(missionId, this.extraction);
    app.on(WalkerEvent.POSE_UPDATED, this.onWalkerPose, this);
    app.on(VolcanicEvent.SET_SPEED, this.setSpeed, this);
    app.on(VolcanicEvent.SET_MISSION, this.setMission, this);
    app.on(VolcanicEvent.CONTINUE_MISSION, this.continueMission, this);
    app.on(VolcanicEvent.COMPLETE_OBJECTIVE, this.completeObjective, this);
    app.on(VolcanicEvent.START, this.start, this);
    app.on(VolcanicEvent.PAUSE, this.pause, this);
    app.on(VolcanicEvent.RESUME, this.resume, this);
    this.publishPosition();
  }

  public attachSimulation(): void {
    this.app.on(InputEvent.AXES, this.advance, this);
  }

  private onWalkerPose(pose: PoseUpdatedPayload): void {
    this.walker = pose;
  }

  private advance({ dt }: InputAxesPayload): void {
    if (this.phase !== 'operation') return;

    const previousHull = this.hull;
    const nextZ = Math.min(WORLD_HALF, this.frontZ + this.speed * dt);
    const startGap = this.previousWalker.z - this.frontZ;
    const endGap = this.walker.z - nextZ;
    let activeFraction = 1;

    if (startGap <= 0 || endGap <= 0) {
      activeFraction = startGap <= 0 ? 0 : startGap / (startGap - endGap);
      this.defeat = 'destruction';
      this.hull = 0;
    } else {
      const width = config.heatedWidth;
      let entry = 0;
      let exit = 1;
      if (startGap > width && endGap > width) {
        exit = 0;
      } else if (startGap > width) {
        entry = (startGap - width) / (startGap - endGap);
      } else if (endGap > width) {
        exit = (width - startGap) / (endGap - startGap);
      }

      const fullStepDamage = config.thermalDamagePerSecond * dt;
      const damage = fullStepDamage * (exit - entry);
      if (damage >= this.hull) {
        activeFraction = entry + this.hull / fullStepDamage;
        this.defeat = 'thermal';
      }
      // MISSÕES: A extração só é válida depois de executar todas as ações de campo.
      const extractionEntry = this.defeat === null && this.completedCheckpoints === this.checkpoints.length
        ? getExtractionEntry(
          this.previousWalker.x, this.previousWalker.z,
          this.walker.x, this.walker.z, this.extraction,
        )
        : null;
      if (extractionEntry !== null) {
        this.evacuated = true;
        activeFraction = extractionEntry;
      }
      const exposure = Math.max(0, Math.min(exit, activeFraction) - entry);
      this.hull = this.defeat ? 0 : this.hull - fullStepDamage * exposure;
    }

    this.frontZ += (nextZ - this.frontZ) * activeFraction;
    this.walker = {
      ...this.walker,
      x: this.previousWalker.x + (this.walker.x - this.previousWalker.x) * activeFraction,
      z: this.previousWalker.z + (this.walker.z - this.previousWalker.z) * activeFraction,
    };
    this.previousWalker = this.walker;
    if (this.defeat || this.evacuated) this.phase = 'ended';

    if (this.hull < previousHull) this.app.fire(WalkerEvent.HULL_DAMAGED);
    this.publishPosition();
    const elapsedStep = dt * activeFraction;
    this.elapsedTime += elapsedStep;
    this.app.fire(SimulationEvent.STEP, elapsedStep);
    this.publishStatus();
  }

  // MISSÕES: Confirma apenas o objetivo ativo e somente dentro do alcance.
  private completeObjective(index = this.completedCheckpoints): void {
    if (this.phase !== 'operation' || index !== this.completedCheckpoints) return;
    const target = this.checkpoints[index];
    if (!target || Math.hypot(target.x - this.walker.x, target.z - this.walker.z) > target.radius) return;

    this.completedCheckpoints++;
    this.publishStatus();
  }

  private setMission(id: MissionId): void {
    if (this.phase !== 'preparation' || !MISSIONS.some(mission => mission.id === id)) return;
    this.missionId = id;
    this.checkpoints = getMissionCheckpoints(id, this.extraction);
    this.publishStatus();
  }

  // MISSÕES: Traça a próxima rota a partir da posição em que o Walker evacuou.
  private continueMission(id: MissionId): void {
    if (!id || id !== nextCampaignMission(this.getStatus())) return;
    const remainingMissions = MISSIONS.length - MISSIONS.findIndex(mission => mission.id === id);
    const remainingDistance = WORLD_HALF * 0.9 - this.walker.z;
    const distance = Math.min(
      MISSION_CONFIG.extraction.distanceByFrontSpeed[this.speed],
      remainingDistance / remainingMissions,
    );
    this.missionId = id;
    this.extraction = {
      x: this.walker.x,
      z: this.walker.z + distance,
      radius: MISSION_CONFIG.extraction.radius,
    };
    this.checkpoints = getMissionCheckpoints(id, this.extraction, this.walker);
    this.completedCheckpoints = 0;
    this.evacuated = false;
    this.elapsedTime = 0;
    this.hull = config.initialHull;
    this.beginOperation();
  }

  private setSpeed(speed: number): void {
    const selectedSpeed = config.speedOptions.find(option => option === speed);
    if (this.phase !== 'preparation' || selectedSpeed === undefined) return;
    this.speed = selectedSpeed;
    this.extraction = getExtractionZone(selectedSpeed, this.extractionHeadingOffset);
    this.checkpoints = getMissionCheckpoints(this.missionId, this.extraction);
    this.publishStatus();
  }

  private start(): void {
    if (this.phase !== 'preparation') return;
    this.beginOperation();
  }

  private beginOperation(): void {
    this.previousWalker = this.walker;
    this.frontZ = this.walker.z - config.startDistance;
    this.phase = 'operation';
    this.publishPosition();
    this.publishStatus();
  }

  private pause(): void {
    if (this.phase !== 'operation') return;
    this.phase = 'paused';
    this.publishStatus();
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'operation';
    this.publishStatus();
  }

  private publishPosition(): void {
    this.app.fire(VolcanicEvent.POSITION_CHANGED, this.frontZ);
  }

  public getStatus(): VolcanicStatus {
    const gap = this.walker.z - this.frontZ;
    const dx = this.extraction.x - this.walker.x;
    const dz = this.extraction.z - this.walker.z;
    const heading = Math.atan2(dx, dz) * 180 / Math.PI;
    const relativeBearing = heading - this.walker.headingDeg;
    const target = this.checkpoints[this.completedCheckpoints] ?? this.extraction;
    const targetHeading = Math.atan2(target.x - this.walker.x, target.z - this.walker.z) * 180 / Math.PI;
    // MISSÕES: D reduz o ângulo do Walker. No HUD, valores positivos indicam virar à direita.
    const headingDifference = this.walker.headingDeg - targetHeading;
    const targetBearing = (((headingDifference + 180) % 360 + 360) % 360) - 180;
    return {
      targetBearing: Math.round(targetBearing),
      missionId: this.missionId,
      completedCheckpoints: this.completedCheckpoints,
      target,
      targetDistance: this.evacuated ? 0 : Math.ceil(Math.max(
        0, Math.hypot(target.x - this.walker.x, target.z - this.walker.z) - target.radius,
      )),
      phase: this.phase,
      distance: Math.ceil(Math.max(0, gap)),
      secondsToArrival: Math.ceil(Math.max(0, gap) / this.speed),
      speed: this.speed,
      zone: this.defeat === 'destruction' || gap <= 0
        ? 'destruction'
        : this.defeat === 'thermal' || gap <= config.heatedWidth ? 'heated' : 'safe',
      hull: Math.ceil(this.hull),
      defeat: this.defeat,
      evacuated: this.evacuated,
      extraction: this.extraction,
      distanceToExtraction: this.evacuated ? 0 : Math.ceil(Math.max(0, Math.hypot(dx, dz) - this.extraction.radius)),
      extractionBearing: Math.round(((relativeBearing + 540) % 360) - 180),
      elapsedSeconds: Math.floor(this.elapsedTime + 1e-8),
    };
  }

  private publishStatus(): void {
    const status = this.getStatus();
    const last = this.lastStatus;
    if (last?.phase === status.phase && last.distance === status.distance &&
        last.secondsToArrival === status.secondsToArrival && last.speed === status.speed &&
        last.zone === status.zone && last.hull === status.hull &&
        last.distanceToExtraction === status.distanceToExtraction &&
        last.extractionBearing === status.extractionBearing &&
        last.elapsedSeconds === status.elapsedSeconds &&
        last.missionId === status.missionId && last.completedCheckpoints === status.completedCheckpoints &&
        last.target === status.target && last.targetDistance === status.targetDistance &&
        last.targetBearing === status.targetBearing) return;

    this.lastStatus = status;
    this.app.fire(VolcanicEvent.STATUS_CHANGED, status);
  }

  destroy(): void {
    this.app.off(WalkerEvent.POSE_UPDATED, this.onWalkerPose, this);
    this.app.off(InputEvent.AXES, this.advance, this);
    this.app.off(VolcanicEvent.SET_SPEED, this.setSpeed, this);
    this.app.off(VolcanicEvent.SET_MISSION, this.setMission, this);
    this.app.off(VolcanicEvent.CONTINUE_MISSION, this.continueMission, this);
    this.app.off(VolcanicEvent.COMPLETE_OBJECTIVE, this.completeObjective, this);
    this.app.off(VolcanicEvent.START, this.start, this);
    this.app.off(VolcanicEvent.PAUSE, this.pause, this);
    this.app.off(VolcanicEvent.RESUME, this.resume, this);
  }
}
