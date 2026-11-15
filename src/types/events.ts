import type { Vec3XYZ } from './game.ts';
import type { PlacedBuilding } from './building.ts';

export type WorldEventType = 'meteor_shower' | 'tornado' | 'electric_storm' | 'dust_storm';

export type WorldEventPhase = 'cooldown' | 'warning' | 'active';

export interface ActiveEventInfo {
  type: WorldEventType;
  label: string;
  phase: Exclude<WorldEventPhase, 'cooldown'>;
  remainingSec: number;
  totalSec: number;
}

export interface EventUpdateContext {
  focusTarget: Vec3XYZ;
  buildings: readonly PlacedBuilding[];
  sampleHeight: (x: number, z: number) => number;
  worldHalf: number;
}

export interface EventStepResult {
  damageThisFrame: number;
  productionMultiplier: number;
  shakeOffset: Vec3XYZ;
  activeEvent: ActiveEventInfo | null;
}

export interface WorldEventHandler {
  readonly type: WorldEventType;
  readonly label: string;
  readonly warningDurationSec: number;
  readonly activeDurationSec: number;
  startWarning(ctx: EventUpdateContext): void;
  startActive(ctx: EventUpdateContext): void;
  update(
    dt: number,
    phase: Exclude<WorldEventPhase, 'cooldown'>,
    phaseElapsed: number,
    ctx: EventUpdateContext,
  ): Omit<EventStepResult, 'activeEvent'>;
  stop(): void;
  destroy(): void;
}
