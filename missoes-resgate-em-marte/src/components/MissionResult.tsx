// MISSÕES: Resultado das missões e resumo da campanha científica.

import { useEffect, useRef } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { getCampaignSamples } from '../systems/campaign.ts';
import { getMission, MISSIONS } from '../systems/missions.ts';
import type { VolcanicStatus } from '../systems/events/worldEvents.ts';

export function MissionResult({
  status,
  hullPercent,
  onRetry,
  campaignComplete,
}: {
  status: VolcanicStatus;
  hullPercent: number;
  onRetry: () => void;
  campaignComplete: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const minutes = Math.floor(status.elapsedSeconds / 60);
  const seconds = String(status.elapsedSeconds % 60).padStart(2, '0');
  const Icon = status.evacuated ? CircleCheck : CircleAlert;
  const mission = getMission(status.missionId);
  const outcome = campaignComplete ? 'Campanha concluída' : status.evacuated ? 'Missão concluída' : 'Base perdida';
  const explanation = status.evacuated
    ? 'A base chegou à zona de extração.'
    : status.defeat === 'destruction'
      ? 'A frente vulcânica atingiu a base.'
      : 'O dano térmico zerou o casco.';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="mission-result-title"
      onCancel={event => event.preventDefault()}
      className="hud-panel fixed inset-0 m-auto w-[min(26rem,calc(100%-2rem))] rounded-2xl p-5 text-orange-50 backdrop:bg-black/60 sm:p-6"
    >
      <div className={`flex items-center gap-2.5 ${status.evacuated ? 'text-teal-200' : 'text-red-200'}`}>
        <Icon aria-hidden="true" size={24} />
        <h2 id="mission-result-title" className="text-xl font-bold">{outcome}</h2>
      </div>
      <p className="mt-2 font-semibold">{mission.name}</p>
      <p className="mt-1 text-sm text-orange-100/80">{explanation}</p>
      {mission.checkpoints.length > 0 && (
        <p className="mt-1 text-sm text-orange-100/80">
          Objetivos de campo concluídos {status.completedCheckpoints}/{mission.checkpoints.length}
        </p>
      )}
      <dl className="my-5 grid grid-cols-2 divide-x divide-orange-200/15 border-y border-orange-200/15 py-3 font-mono-tech">
        <div>
          <dt className="text-xs text-orange-100/75">Tempo de operação</dt>
          <dd className="mt-1 text-xl font-bold">{minutes}:{seconds}</dd>
        </div>
        <div className="pl-4">
          <dt className="text-xs text-orange-100/75">Casco restante</dt>
          <dd className="mt-1 text-xl font-bold">{hullPercent}%</dd>
        </div>
      </dl>
      {campaignComplete && (
        <p className="mb-4 text-sm text-teal-200">
          {MISSIONS.length} missões concluídas. Tubos entregues e inventário transmitido · {getCampaignSamples(MISSIONS.length).join(', ')}.
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="w-full cursor-pointer rounded-lg bg-orange-400 px-3 py-2.5 text-sm font-bold text-orange-950 hover:bg-orange-300"
      >
        Voltar à preparação
      </button>
    </dialog>
  );
}
