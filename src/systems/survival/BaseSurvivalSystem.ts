import type { BaseSurvivalState } from '../../types/index.ts';
import {
  COLONY_BALANCE,
  MODULE_ECONOMY,
  getDynamicConstructionCost,
  readColonyCapacity,
} from './economy.ts';
import type { ColonyInputs } from './economy.ts';
import { evaluateColonyStage, getRequiredStageForBuilding } from './progression.ts';

export type { BaseSurvivalState };

const IMPACT_ALERT_SECONDS = 3;

export interface SurvivalResetOptions {
  readonly startingOre?: number;
  readonly initialBattery?: number;
  readonly impactDamageMult?: number;
}

export class BaseSurvivalSystem {
  private ore: number = COLONY_BALANCE.startingOre;
  private integrity = 100;
  private impactCount = 0;
  private impactAlertTime = 0;
  private damageAccumulator = 0;
  private remainingDisasterDamage: number = COLONY_BALANCE.maxDamagePerDisaster;
  private battery = 0;
  private bonusBatteryCapacity = 0;
  private impactDamageMult = 1;
  private demand = 0;
  private miningRate = 0;
  private capacity = readColonyCapacity({ buildings: [] });
  private maxStageReached = 1;
  private stageTitle = '';
  private stageGoal = '';
  private allStagesCompleted = false;

  constructor(startingOre: number = COLONY_BALANCE.startingOre) {
    this.reset({ startingOre });
  }

  public reset(options?: SurvivalResetOptions): void {
    const startOre = options?.startingOre ?? COLONY_BALANCE.startingOre;
    const initBattery = Math.max(0, options?.initialBattery ?? 0);
    this.ore = Number.isFinite(startOre) ? Math.max(0, startOre) : COLONY_BALANCE.startingOre;
    this.integrity = 100;
    this.impactCount = 0;
    this.impactAlertTime = 0;
    this.damageAccumulator = 0;
    this.beginDisaster();
    this.bonusBatteryCapacity = initBattery;
    this.battery = initBattery;
    this.impactDamageMult = options?.impactDamageMult ?? 1;
    this.demand = 0;
    this.miningRate = 0;
    this.capacity = readColonyCapacity({ buildings: [] });
    const prog = evaluateColonyStage(1, [], this.ore, 0, 0);
    this.maxStageReached = prog.stage;
    this.stageTitle = prog.title;
    this.stageGoal = prog.goalText;
    this.allStagesCompleted = prog.allStagesCompleted;
  }

  public update(dtSeconds: number, inputs: ColonyInputs): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    this.impactAlertTime = Math.max(0, this.impactAlertTime - dtSeconds);
    const capacity = readColonyCapacity(inputs);
    this.capacity = capacity;
    const effectiveBatteryCap = capacity.batteryCapacity + this.bonusBatteryCapacity;
    this.battery = Math.min(this.battery, effectiveBatteryCap);
    this.demand = capacity.supportDemand + capacity.miningDemand;
    if (this.integrity === 0) {
      this.miningRate = 0;
      return;
    }

    const fullRate = capacity.supportedMiners * COLONY_BALANCE.orePerMinerPerSecond;
    const leftoverPower = Math.max(0, capacity.generation - capacity.supportDemand);
    const gridRate = capacity.miningDemand > 0
      ? fullRate * Math.min(1, leftoverPower / capacity.miningDemand) : 0;
    const powerDeficit = this.demand - capacity.generation;
    const batterySeconds = powerDeficit > 0 ? Math.min(dtSeconds, this.battery / powerDeficit) : 0;
    const addedOre = fullRate * batterySeconds + gridRate * (dtSeconds - batterySeconds);
    this.ore = Math.min(capacity.oreCapacity, this.ore + addedOre);
    this.battery = Math.min(effectiveBatteryCap, Math.max(0, this.battery - powerDeficit * dtSeconds));
    const atStorageCap = this.ore >= capacity.oreCapacity - 1e-6;
    this.miningRate = atStorageCap ? 0 : (this.battery > 0 ? fullRate : gridRate);

    if (
      capacity.supportDemand > 0 &&
      capacity.generation + 1e-6 < capacity.supportDemand &&
      this.battery <= 1e-6
    ) {
      this.applyContinuousDamage(dtSeconds * 2.5);
    }

    if (inputs.solIndex && inputs.solIndex >= 2 && capacity.supportCapacity === 0) {
      this.applyContinuousDamage(dtSeconds * 2.0);
    }

    const prog = evaluateColonyStage(
      this.maxStageReached,
      inputs.buildings,
      this.ore,
      capacity.generation,
      this.demand,
    );
    this.maxStageReached = prog.stage;
    this.stageTitle = prog.title;
    this.allStagesCompleted ||= prog.allStagesCompleted;
    this.stageGoal = this.allStagesCompleted ? 'Mantenha o posto de pé até a chegada da equipe no fim do 10º Sol' : prog.goalText;
  }

  public canBuild(definitionId: string, buildings: ColonyInputs['buildings']): boolean {
    return this.getBuildBlockReason(definitionId, buildings) === null;
  }

  public getBuildingCost(definitionId: string, buildings: ColonyInputs['buildings']): number {
    return getDynamicConstructionCost(definitionId, buildings) ?? 0;
  }

  public getBuildBlockReason(definitionId: string, buildings: ColonyInputs['buildings']): string | null {
    if (this.integrity === 0) return 'Base destruída';
    const cost = getDynamicConstructionCost(definitionId, buildings);
    const mod = Object.hasOwn(MODULE_ECONOMY, definitionId)
      ? MODULE_ECONOMY[definitionId]
      : undefined;
    if (cost === undefined || !mod) return 'Módulo indisponível';

    const reqStage = getRequiredStageForBuilding(definitionId);
    if (reqStage > this.maxStageReached) {
      return `Desbloqueia na Etapa ${reqStage}`;
    }

    if (mod.miner) {
      const { miners, supportCapacity, housing, oxygen } = readColonyCapacity({ buildings });
      if (miners >= supportCapacity) {
        if (housing <= supportCapacity && oxygen <= supportCapacity) {
          return 'Requer Alojamento + Estufa';
        }
        if (housing <= oxygen) {
          return 'Requer Alojamento';
        }
        return 'Requer Estufa/O₂';
      }
    }

    if (this.ore + 1e-9 < cost) {
      return 'Minério insuficiente';
    }
    return null;
  }

  public tryPayForBuilding(definitionId: string, buildings: ColonyInputs['buildings']): boolean {
    const cost = getDynamicConstructionCost(definitionId, buildings);
    if (cost === undefined || !this.canBuild(definitionId, buildings)) return false;
    this.ore = Math.max(0, this.ore - cost);
    const nextBuildings = [...buildings, { definitionId }];
    const cap = readColonyCapacity({ buildings: nextBuildings });
    this.capacity = cap;
    const prog = evaluateColonyStage(
      this.maxStageReached,
      nextBuildings,
      this.ore,
      cap.generation,
      cap.supportDemand + cap.miningDemand,
    );
    this.maxStageReached = prog.stage;
    this.stageTitle = prog.title;
    this.allStagesCompleted ||= prog.allStagesCompleted;
    this.stageGoal = this.allStagesCompleted ? 'Mantenha o posto de pé até a chegada da equipe no fim do 10º Sol' : prog.goalText;
    return true;
  }

  public beginDisaster(): void {
    this.remainingDisasterDamage = COLONY_BALANCE.maxDamagePerDisaster;
  }

  public applyDisasterDamage(buildingsHit: number, continuousDamage: number): void {
    const hit = buildingsHit > 0;
    const damage = Math.min(
      this.remainingDisasterDamage,
      hit ? COLONY_BALANCE.damagePerBuildingHit * buildingsHit : continuousDamage,
    );
    if (!Number.isFinite(damage) || damage <= 0 || this.integrity === 0) return;

    this.remainingDisasterDamage = Math.max(0, this.remainingDisasterDamage - damage);
    this.applyContinuousDamage(damage);
    if (hit) {
      this.impactCount += 1;
      this.impactAlertTime = IMPACT_ALERT_SECONDS;
    }
  }

  public applyContinuousDamage(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0 || this.integrity === 0) return;

    this.damageAccumulator += amount * this.impactDamageMult;
    const points = Math.floor(this.damageAccumulator);
    if (points <= 0) return;

    this.damageAccumulator -= points;
    this.integrity = Math.max(0, this.integrity - points);
    if (this.integrity === 0) this.miningRate = 0;
    if (this.integrity === 0) this.miningRate = 0;
    this.impactAlertTime = Math.max(this.impactAlertTime, 1.5);
  }

  public trySpendOre(amount: number): boolean {
    if (this.integrity === 0 || !Number.isFinite(amount) || amount <= 0 || this.ore < amount) return false;
    this.ore -= amount;
    return true;
  }

  public repair(): number {
    if (this.integrity === 0) return 0;
    const { repairOrePerPoint, maxRepairPerAction } = COLONY_BALANCE;
    const points = Math.min(100 - this.integrity, maxRepairPerAction, Math.floor((this.ore + 1e-9) / repairOrePerPoint));
    this.ore = Math.max(0, this.ore - points * repairOrePerPoint);
    this.integrity += points;
    return points;
  }

  public getState(): BaseSurvivalState {
    return {
      ore: this.ore,
      oreCapacity: this.capacity.oreCapacity,
      integrity: this.integrity,
      impactCount: this.impactCount,
      impactAlert: this.impactAlertTime > 0,
      generation: this.capacity.generation,
      demand: this.demand,
      battery: this.battery,
      batteryCapacity: this.capacity.batteryCapacity + this.bonusBatteryCapacity,
      miners: this.capacity.miners,
      supportCapacity: this.capacity.supportCapacity,
      housing: this.capacity.housing,
      oxygen: this.capacity.oxygen,
      miningRate: this.miningRate,
      weather: this.capacity.weather,
      stage: this.maxStageReached,
      stageTitle: this.stageTitle,
      stageGoal: this.stageGoal,
      allStagesCompleted: this.allStagesCompleted,
    };
  }
}
