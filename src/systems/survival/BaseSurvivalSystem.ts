import type { ActiveEventInfo, BaseSurvivalState } from '../../types/index.ts';

export type { BaseSurvivalState };

const ORE_PER_MINER_PER_SECOND = 2;
const IMPACT_DAMAGE = 25;
const IMPACT_ALERT_SECONDS = 3;

export class BaseSurvivalSystem {
  private ore = 0;
  private integrity = 100;
  private impactCount = 0;
  private impactAlertTime = 0;
  private activeEvent: ActiveEventInfo | null = null;

  public update(
    dtSeconds: number,
    activeMiners: number,
    productionMultiplier = 1.0,
    activeEvent: ActiveEventInfo | null = null,
  ): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;

    this.impactAlertTime = Math.max(0, this.impactAlertTime - dtSeconds);
    this.activeEvent = activeEvent;
    if (this.integrity <= 0 || !Number.isInteger(activeMiners) || activeMiners <= 0) return;

    const mult = Number.isFinite(productionMultiplier) ? Math.max(0, productionMultiplier) : 1.0;
    this.ore += dtSeconds * activeMiners * ORE_PER_MINER_PER_SECOND * mult;
  }

  public applyDamage(amount: number): void {
    if (this.integrity <= 0 || !Number.isFinite(amount) || amount <= 0) return;

    this.integrity = Math.max(0, this.integrity - amount);
    if (amount >= 1) {
      this.impactCount += 1;
      this.impactAlertTime = IMPACT_ALERT_SECONDS;
    }
  }

  public applyImpact(): void {
    this.applyDamage(IMPACT_DAMAGE);
  }

  public getState(): BaseSurvivalState {
    const displayIntegrity =
      this.integrity <= 0 ? 0 : Math.max(1, Math.round(this.integrity));
    return {
      ore: this.ore,
      integrity: displayIntegrity,
      impactCount: this.impactCount,
      impactAlert: this.impactAlertTime > 0,
      activeEvent: this.activeEvent,
    };
  }
}
