import { COLONY_BALANCE, getConstructionCost, readColonyCapacity } from './economy.ts';
import type { ColonyInputs, ColonyWeather } from './economy.ts';

const IMPACT_ALERT_SECONDS = 3;

export interface BaseSurvivalState {
  readonly ore: number;
  readonly integrity: number;
  readonly impactCount: number;
  readonly impactAlert: boolean;
  readonly generation: number;
  readonly demand: number;
  readonly battery: number;
  readonly batteryCapacity: number;
  readonly miners: number;
  readonly supportCapacity: number;
  readonly miningRate: number;
  readonly weather: ColonyWeather;
}

export class BaseSurvivalSystem {
  private ore: number;
  private integrity = 100;
  private impactCount = 0;
  private impactAlertTime = 0;
  private battery = 0;
  private demand = 0;
  private miningRate = 0;
  private capacity = readColonyCapacity({ buildings: [] });

  constructor(startingOre: number = COLONY_BALANCE.startingOre) {
    this.ore = Number.isFinite(startingOre) ? Math.max(0, startingOre) : COLONY_BALANCE.startingOre;
  }

  public update(dtSeconds: number, inputs: ColonyInputs): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;
    this.impactAlertTime = Math.max(0, this.impactAlertTime - dtSeconds);
    const capacity = readColonyCapacity(inputs);
    this.capacity = capacity;
    this.battery = Math.min(this.battery, capacity.batteryCapacity);
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
    this.ore += fullRate * batterySeconds + gridRate * (dtSeconds - batterySeconds);
    this.battery = Math.min(capacity.batteryCapacity, Math.max(0, this.battery - powerDeficit * dtSeconds));
    this.miningRate = this.battery > 0 ? fullRate : gridRate;
  }

  public canBuild(definitionId: string, buildings: ColonyInputs['buildings']): boolean {
    const cost = getConstructionCost(definitionId);
    if (this.integrity === 0 || cost === undefined || this.ore + 1e-9 < cost) return false;
    if (definitionId !== 'machine_plant') return true;

    const { miners, supportCapacity } = readColonyCapacity({ buildings });
    return miners < supportCapacity;
  }

  public tryPayForBuilding(definitionId: string, buildings: ColonyInputs['buildings']): boolean {
    const cost = getConstructionCost(definitionId);
    if (cost === undefined || !this.canBuild(definitionId, buildings)) return false;
    this.ore = Math.max(0, this.ore - cost);
    return true;
  }

  public applyImpact(buildingsHit = 1): void {
    if (!Number.isInteger(buildingsHit) || buildingsHit <= 0 || this.integrity === 0) return;

    this.integrity = Math.max(0, this.integrity - COLONY_BALANCE.damagePerBuildingHit * buildingsHit);
    if (this.integrity === 0) this.miningRate = 0;
    this.impactCount += 1;
    this.impactAlertTime = IMPACT_ALERT_SECONDS;
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
      integrity: this.integrity,
      impactCount: this.impactCount,
      impactAlert: this.impactAlertTime > 0,
      generation: this.capacity.generation,
      demand: this.demand,
      battery: this.battery,
      batteryCapacity: this.capacity.batteryCapacity,
      miners: this.capacity.miners,
      supportCapacity: this.capacity.supportCapacity,
      miningRate: this.miningRate,
      weather: this.capacity.weather,
    };
  }
}
