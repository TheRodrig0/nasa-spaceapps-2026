// MISSÕES: Seleção de missões, bloqueios da campanha e exibição do objetivo atual.

import { CircleAlert, Gamepad2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { VolcanicStatus } from '../systems/events/worldEvents.ts';
import { getMission, MISSIONS, type MissionId } from '../systems/missions.ts';
import { getCampaignSamples } from '../systems/campaign.ts';
import { MISSION_CONFIG } from '../systems/missionConfig.ts';
import { MissionResult } from './MissionResult.tsx';

interface HudOverlayProps {
  baseMode: boolean;
  completedMissions: number;
  volcanicStatus: VolcanicStatus | null;
  onToggleBaseMode: () => void;
  onVolcanicSpeedChange: (speed: number) => void;
  onMissionChange: (id: MissionId) => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onCompleteObjective: (index: number) => void;
}

const zones = {
  safe: { Icon: ShieldCheck, label: 'Zona segura', color: 'text-emerald-200' },
  heated: { Icon: TriangleAlert, label: 'Solo aquecido', color: 'text-orange-300' },
  destruction: {
    Icon: CircleAlert,
    label: 'Zona de destruição',
    color: 'text-red-300',
  },
};
const button =
  'cursor-pointer rounded-md border border-[#72472e] bg-[#2c1a13] px-2.5 py-1.5 font-semibold hover:bg-[#3d2418] aria-pressed:border-[#e6a368] aria-pressed:bg-[#573018]';

export function HudOverlay({
  baseMode,
  completedMissions,
  volcanicStatus: status,
  onToggleBaseMode,
  onVolcanicSpeedChange,
  onMissionChange,
  onStart,
  onPause,
  onResume,
  onRetry,
  onCompleteObjective,
}: HudOverlayProps) {
  const [controlsOpen, setControlsOpen] = useState(false);
  if (!status) return null;

  const { Icon: ZoneIcon, label: zoneLabel, color: zoneColor } = zones[status.zone];
  const { initialHull, speedOptions, heatedWidth, thermalDamagePerSecond } =
    MISSION_CONFIG.volcanic;
  const hullPercent = Math.ceil((100 * status.hull) / initialHull);
  const secondsToHeat = Math.ceil(
    Math.max(0, status.distance - heatedWidth) / status.speed,
  );

  // MISSÕES: Vitórias intermediárias iniciam a missão seguinte no fluxo principal.
  if (status.phase === 'ended') {
    return (
      <MissionResult
        status={status}
        hullPercent={hullPercent}
        onRetry={onRetry}
        campaignComplete={status.evacuated && status.missionId === MISSIONS.at(-1)?.id}
      />
    );
  }

  const mission = getMission(status.missionId);
  const checkpoint = mission.checkpoints[status.completedCheckpoints];
  const lastResult = mission.checkpoints[status.completedCheckpoints - 1]?.result;
  const samples = status.missionId === 'sample-cache' ? getCampaignSamples(completedMissions) : [];
  const bearing = Math.abs(status.targetBearing);
  const direction = bearing <= 5 ? 'Em frente' : bearing >= 175
    ? 'Atrás da base'
    : `Vire ${bearing}° · ${status.targetBearing < 0 ? 'A (esquerda)' : 'D (direita)'}`;
  const preparing = status.phase === 'preparation';
  const heated = status.zone === 'heated';
  const hullAccent =
    hullPercent <= 25
      ? 'bg-red-400'
      : hullPercent <= 55
        ? 'bg-amber-300'
        : 'bg-teal-300';
  const controlsButton = (
    <button
      type="button"
      aria-label="Controles"
      aria-expanded={controlsOpen}
      aria-controls="hud-controls"
      title="Controles"
      onClick={() => setControlsOpen((open) => !open)}
      className={`grid shrink-0 cursor-pointer place-items-center border text-orange-200 ${preparing
        ? 'size-9 rounded-lg border-[#72472e] bg-[#2c1a13] hover:bg-[#3d2418] aria-expanded:border-[#e6a368] aria-expanded:bg-[#573018]'
        : 'size-[1.875rem] rounded-md border-[#72472e] bg-[#2c1a13] hover:bg-[#3d2418] aria-expanded:border-[#e6a368] aria-expanded:bg-[#573018]'}`}
    >
      <Gamepad2 size={17} aria-hidden="true" />
    </button>
  );

  const controls = [
    { label: 'Dirigir a base', keys: 'WASD' },
    { label: 'Usar turbo', keys: 'Shift' },
    { label: 'Executar a ação da missão', keys: 'C' },
    { label: 'Embarcar ou Desembarcar', keys: 'E' },
    { label: 'Pausar', keys: 'ESC' },
  ];

  return (
    <div
      className={`pointer-events-none fixed left-4 z-20 w-[21rem] max-w-[calc(100%-2rem)] font-sans text-xs text-[#ffeedf] ${status.phase === 'operation' ? 'top-[4.75rem] lg:top-4' : 'top-4'}`}
    >
      <section
        aria-label={preparing ? 'Preparação da operação' : 'Estado da base'}
        className="rounded-xl border border-[#623c27] bg-[#20120e] px-3.5 py-3 shadow-xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#fff3e6]">
            {preparing ? 'Preparação da operação' : 'Estado da base'}
          </h2>
          <span role="status" className={`inline-flex items-center gap-1.5 text-xs ${zoneColor}`}>
            <ZoneIcon size={14} aria-hidden="true" />
            {zoneLabel}
          </span>
        </div>
        {preparing ? (
          <div className="pointer-events-auto mt-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="mission-select" className="font-semibold">Missão</label>
              <span className="text-[#ceb2a0]">{completedMissions}/{MISSIONS.length} concluídas</span>
            </div>
            <select
              id="mission-select"
              className="mt-1 block w-full rounded-md border border-[#72472e] bg-[#2c1a13] px-2 py-1.5"
              value={status.missionId}
              onChange={(event) => {
                const selected = MISSIONS.find(({ id }) => id === event.currentTarget.value);
                if (selected) onMissionChange(selected.id);
              }}
            >
              {MISSIONS.map(({ id, name }, index) => (
                <option key={id} value={id} disabled={index > completedMissions}>
                  {name}{index < completedMissions ? ' (concluída)' : index > completedMissions ? ' (bloqueada)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[#ceb2a0]">{mission.briefing}</p>
          </div>
        ) : (
          <div className="mt-2.5" role="status">
            <p className="font-semibold text-teal-200">{mission.name}</p>
            <p className="mt-0.5">
              {checkpoint?.name ?? 'Levar a base à zona de extração'}
              {' · '}{status.completedCheckpoints + 1}/{mission.checkpoints.length + 1}
            </p>
            <p className="mt-1 text-[#ceb2a0]">
              {checkpoint && status.targetDistance === 0
                ? 'Objetivo ao alcance. Solte W e execute a ação.'
                : `Seta amarela · ${direction} · ${status.targetDistance} UJ`}
            </p>
            {samples.length > 0 && <p className="mt-1">Inventário · {samples.join(', ')}</p>}
            {lastResult && <p className="mt-1 text-teal-200">{lastResult}</p>}
            {checkpoint && status.phase === 'operation' && status.targetDistance === 0 && (
              <button
                type="button"
                className={`pointer-events-auto mt-2 ${button}`}
                onClick={() => onCompleteObjective(status.completedCheckpoints)}
              >
                {checkpoint.action} <kbd className="ml-1 text-teal-200">C</kbd>
              </button>
            )}
          </div>
        )}
        <dl className="mt-2.5 grid grid-cols-2 divide-x divide-[#533425] border-y border-[#533425] py-2">
            <div className="pr-2">
              <dt className="text-xs text-[#ceb2a0]">Frente vulcânica</dt>
              <dd className="mt-0.5 text-xl leading-tight font-semibold tabular-nums">
                {status.distance} <span className="text-xs font-medium text-[#ceb2a0]">UJ</span>
              </dd>
              {heated && <dd className="text-[11px] text-orange-300">Dano de {thermalDamagePerSecond} UJ/s</dd>}
            </div>
            <div className="pl-3.5">
              <dt className="text-xs text-[#ceb2a0]">{heated ? 'Frente fatal em' : 'Calor em'}</dt>
              <dd className="mt-0.5 text-xl leading-tight font-semibold tabular-nums">
                {heated ? status.secondsToArrival : secondsToHeat} <span className="text-xs font-medium text-[#ceb2a0]">s</span>
                <span className="block text-[11px] font-normal text-[#ceb2a0]">Com a base parada</span>
              </dd>
            </div>
        </dl>
        <div className="mt-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-3 font-medium">
            <span id="hull-label">Casco</span>
            <span className="font-semibold tabular-nums">{hullPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-labelledby="hull-label"
            aria-valuenow={hullPercent}
            className="h-[5px] overflow-hidden rounded-full bg-orange-100/15"
          >
            <div
              className={`h-full rounded-full ${hullAccent}`}
              style={{ width: `${hullPercent}%` }}
            />
          </div>
        </div>

        {status.phase === 'preparation' && (
          <div className="pointer-events-auto mt-3">
            <p id="front-speed-label" className="mb-1.5 font-semibold">
              Velocidade da frente <span className="text-xs font-normal text-[#ceb2a0]">· dificuldade</span>
            </p>
            <div
              role="group"
              aria-labelledby="front-speed-label"
              className="grid grid-cols-3 gap-[7px]"
            >
              {speedOptions.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  aria-pressed={status.speed === speed}
                  onClick={() => onVolcanicSpeedChange(speed)}
                  className="min-h-8 cursor-pointer rounded-md border border-[#72472e] bg-[#2c1a13] px-1 font-semibold tabular-nums hover:bg-[#3d2418] aria-pressed:border-[#e6a368] aria-pressed:bg-[#573018] aria-pressed:text-[#ffe0ba]"
                >
                  {speed} <span className="text-xs">UJ/s</span>
                </button>
              ))}
            </div>
            <div className="mt-2.5 flex gap-[7px]">
              <button
                type="button"
                onClick={() => {
                  setControlsOpen(false);
                  onStart();
                }}
                className="min-w-0 flex-1 cursor-pointer rounded-lg bg-[#ff9a37] px-3 py-2 font-semibold text-[#291505] hover:bg-[#ffb163]"
              >
                Iniciar operação
              </button>
              {controlsButton}
            </div>
          </div>
        )}

        {status.phase === 'operation' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 pointer-events-auto">
            <button
              type="button"
              onClick={onToggleBaseMode}
              aria-pressed={baseMode}
              className={button}
            >
              {baseMode ? 'Voltar a dirigir' : 'Estacionar a base'}
            </button>
            <button type="button" onClick={onPause} className={button}>
              Pausar
            </button>
            {controlsButton}
            <span className="ml-auto text-orange-100/75">
              {status.speed} UJ/s
            </span>
          </div>
        )}

        {status.phase === 'paused' && (
          <div className="mt-3 pointer-events-auto">
            <p className="mb-2 font-bold">Operação pausada</p>
            <button type="button" onClick={onResume} className={button}>
              Retomar operação
            </button>
            <button
              type="button"
              onClick={onRetry}
              className={`${button} ml-2`}
            >
              Reiniciar missão
            </button>
          </div>
        )}
      </section>
      {(preparing || status.phase === 'operation') && (
        <div
          id="hud-controls"
          hidden={!controlsOpen}
          className="pointer-events-auto mt-[12px] rounded-2xl border border-[#623c27] bg-[#20120e] shadow-xl"
        >
          <dl className="space-y-1.25 px-3.5 py-3 text-orange-100/90 [&_kbd]:bg-orange-400/20 [&_kbd]:rounded-sm [&_kbd]:px-2">
            {controls.map((c) => (
              <div className="flex items-center gap-2" key={c.keys}>
                <dt>
                  <kbd>{c.keys}</kbd>
                </dt>
                <dd>{c.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
