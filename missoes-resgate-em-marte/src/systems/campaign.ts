// MISSÕES: Desbloqueio sequencial das missões e persistência do progresso no navegador.

import type { VolcanicStatus } from './events/worldEvents.ts';
import { getMission, MISSIONS, type MissionId } from './missions.ts';

const PROGRESS_KEY = 'resgate-em-marte:science-campaign:v1';

export function readCampaignProgress(storage?: Pick<Storage, 'getItem'>): number {
  try {
    const completed = Number((storage ?? window.localStorage).getItem(PROGRESS_KEY));
    return Number.isInteger(completed) && completed >= 0
      ? Math.min(completed, MISSIONS.length)
      : 0;
  } catch {
    return 0;
  }
}

export function saveCampaignProgress(completed: number, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  try {
    const target = storage ?? window.localStorage;
    if (completed > readCampaignProgress(target)) {
      target.setItem(PROGRESS_KEY, String(completed));
    }
  } catch {
    // The current session can continue when browser storage is unavailable.
  }
}

export function advanceCampaign(
  completed: number,
  { phase, evacuated, missionId }: Pick<VolcanicStatus, 'phase' | 'evacuated' | 'missionId'>,
): number {
  if (phase === 'ended' && evacuated && MISSIONS[completed]?.id === missionId) {
    return completed + 1;
  }
  return completed;
}

export function nextCampaignMission(
  { phase, evacuated, missionId }: Pick<VolcanicStatus, 'phase' | 'evacuated' | 'missionId'>,
): MissionId | undefined {
  if (phase !== 'ended' || !evacuated) return undefined;
  const index = MISSIONS.findIndex(mission => mission.id === missionId);
  return index >= 0 ? MISSIONS[index + 1]?.id : undefined;
}

export function getCampaignSamples(completed: number): string[] {
  return MISSIONS.slice(0, completed).flatMap(({ id }) =>
    getMission(id).checkpoints.flatMap(({ sample }) => sample ? [sample] : []),
  );
}
