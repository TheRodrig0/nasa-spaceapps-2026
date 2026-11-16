import type { ActiveEventInfo } from './events.ts';
import type { ColonyWeather } from '../systems/survival/economy.ts';
import type { ScienceMissionStatus } from '../systems/survival/science-mission.ts';

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
  readonly ore: number;
  readonly oreCapacity: number;
  readonly integrity: number;
  readonly impactCount: number;
  readonly impactAlert: boolean;
  readonly generation: number;
  readonly demand: number;
  readonly battery: number;
  readonly batteryCapacity: number;
  readonly miners: number;
  readonly supportCapacity: number;
  readonly housing?: number;
  readonly oxygen?: number;
  readonly miningRate: number;
  readonly weather: ColonyWeather;
  readonly stage: number;
  readonly stageTitle: string;
  readonly stageGoal: string;
  readonly allStagesCompleted?: boolean;
  readonly sol?: SolarCycleState;
  readonly activeEvent?: ActiveEventInfo | null;
  readonly science?: ScienceMissionStatus;
  readonly status?: 'menu' | 'playing' | 'paused' | 'victory' | 'defeat';
  readonly endReason?: string;
}
