import type { ActiveEventInfo } from './events.ts';

export type SolarPhase = 'dawn' | 'day' | 'dusk' | 'night';

export interface SolarCycleState {
  solIndex: number;
  targetSols: number;
  solProgress: number;
  phase: SolarPhase;
  sunEfficiency: number;
  completed: boolean;
}

export interface BaseSurvivalState {
  ore: number;
  integrity: number;
  impactCount: number;
  impactAlert: boolean;
  activeEvent: ActiveEventInfo | null;
  energyGen?: number;
  energyDemand?: number;
  batteryStored?: number;
  batteryCapacity?: number;
  energyRatio?: number;
  sol?: SolarCycleState;
  status?: 'playing' | 'victory' | 'defeat';
  repairCostOre?: number;
  repairGainIntegrity?: number;
  canRepair?: boolean;
}
