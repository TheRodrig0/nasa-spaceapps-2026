export const SAMPLE_ORE_COST = 15;
export const MONITORING_SECONDS = 12;

export interface ScienceConditions {
  readonly hasWarehouse: boolean;
  readonly ore: number;
  readonly generation: number;
  readonly demand: number;
  readonly infrastructureReady: boolean;
}

export interface ScienceMissionStatus {
  readonly phase: 'sample' | 'monitoring-ready' | 'monitoring' | 'transmission' | 'complete';
  readonly secondsRecorded: number;
  readonly blockedReason: string | null;
}

export class ScienceMission {
  private phase: ScienceMissionStatus['phase'] = 'sample';
  private recorded = 0;

  public reset(): void {
    this.phase = 'sample';
    this.recorded = 0;
  }

  public getStatus(conditions: ScienceConditions): ScienceMissionStatus {
    const powered = conditions.generation > 0 && conditions.generation + 1e-6 >= conditions.demand;
    let blockedReason: string | null = null;

    if (this.phase === 'sample') {
      if (!conditions.hasWarehouse) blockedReason = 'Construa um depósito para guardar a amostra.';
      else if (conditions.ore < SAMPLE_ORE_COST) blockedReason = `Reserve ${SAMPLE_ORE_COST} UJ de minério.`;
    } else if (this.phase !== 'complete' && !powered) {
      blockedReason = 'A geração precisa cobrir toda a demanda.';
    } else if (this.phase === 'transmission' && !conditions.infrastructureReady) {
      blockedReason = 'Conclua as cinco etapas da base para transmitir.';
    }

    return { phase: this.phase, secondsRecorded: Math.floor(this.recorded), blockedReason };
  }

  public advance(conditions: ScienceConditions, spendOre: (amount: number) => boolean): boolean {
    const { blockedReason } = this.getStatus(conditions);
    if (blockedReason) return false;

    switch (this.phase) {
      case 'sample':
        if (!spendOre(SAMPLE_ORE_COST)) return false;
        this.phase = 'monitoring-ready';
        return true;
      case 'monitoring-ready':
        this.phase = 'monitoring';
        return true;
      case 'transmission':
        this.phase = 'complete';
        return true;
      default:
        return false;
    }
  }

  public update(dtSeconds: number, conditions: ScienceConditions): void {
    if (this.phase !== 'monitoring' || this.getStatus(conditions).blockedReason
      || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return;

    this.recorded = Math.min(MONITORING_SECONDS, this.recorded + dtSeconds);
    if (this.recorded >= MONITORING_SECONDS - 1e-6) {
      this.recorded = MONITORING_SECONDS;
      this.phase = 'transmission';
    }
  }
}
