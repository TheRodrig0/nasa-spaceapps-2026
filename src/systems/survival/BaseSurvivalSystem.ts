const ORE_PER_MINER_PER_SECOND = 2;
const IMPACT_DAMAGE = 25;
const IMPACT_ALERT_SECONDS = 3;

export interface BaseSurvivalState {
  readonly ore: number;
  readonly integrity: number;
  readonly impactCount: number;
  readonly impactAlert: boolean;
}

export class BaseSurvivalSystem {
  private ore = 0;
  private integrity = 100;
  private impactCount = 0;
  private impactAlertTime = 0;

  public update(dtSeconds: number, activeMiners: number): void {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return;

    this.impactAlertTime = Math.max(0, this.impactAlertTime - dtSeconds);
    if (this.integrity === 0 || !Number.isInteger(activeMiners) || activeMiners <= 0) return;

    this.ore += dtSeconds * activeMiners * ORE_PER_MINER_PER_SECOND;
  }

  public applyImpact(): void {
    if (this.integrity === 0) return;

    this.integrity = Math.max(0, this.integrity - IMPACT_DAMAGE);
    this.impactCount += 1;
    this.impactAlertTime = IMPACT_ALERT_SECONDS;
  }

  public getState(): BaseSurvivalState {
    return {
      ore: this.ore,
      integrity: this.integrity,
      impactCount: this.impactCount,
      impactAlert: this.impactAlertTime > 0,
    };
  }
}
