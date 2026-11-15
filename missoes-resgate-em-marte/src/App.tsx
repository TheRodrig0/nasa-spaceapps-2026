// MISSÕES: Integração da seleção, do progresso e da retomada das missões ao jogo.

import { useCallback, useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay.tsx';
import { Minimap } from './components/Minimap.tsx';
import { TerrainStatsPanel } from './components/TerrainStatsPanel.tsx';
import { VolcanicProximity } from './components/VolcanicProximity.tsx';
import {
  CameraEvent,
  TerrainEvent,
  type TerrainMeshStats,
  VolcanicEvent,
  type VolcanicStatus,
  WalkerBaseModePayload,
  WalkerEvent,
} from './systems/events/worldEvents.ts';
import { WorldManager } from './world/WorldManager.ts';
import { MISSIONS, type MissionId } from './systems/missions.ts';
import { advanceCampaign, nextCampaignMission, readCampaignProgress, saveCampaignProgress } from './systems/campaign.ts';
import { MISSION_CONFIG } from './systems/missionConfig.ts';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [world, setWorld] = useState<WorldManager | null>(null);
  // MISSÕES: Restaura a campanha e seleciona a primeira missão pendente.
  const [completedMissions, setCompletedMissions] = useState(() => readCampaignProgress());
  const missionRef = useRef<MissionId>(
    MISSIONS[Math.min(completedMissions, MISSIONS.length - 1)].id,
  );
  const [attempt, setAttempt] = useState(0);
  const speedRef = useRef<number>(MISSION_CONFIG.volcanic.defaultSpeed);
  const [baseMode, setBaseMode] = useState<boolean>(false);
  const [volcanicStatus, setVolcanicStatus] = useState<VolcanicStatus | null>(
    null,
  );
  const [terrainStats, setTerrainStats] = useState<TerrainMeshStats | null>(
    null,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const world = new WorldManager(canvas, MISSION_CONFIG.mapSeed, missionRef.current);
    setWorld(world);
    setBaseMode(false);
    setVolcanicStatus(world.getVolcanicStatus());
    setTerrainStats(world.getTerrainMeshStats());

    const onBaseModeChanged = (p: WalkerBaseModePayload) =>
      setBaseMode(p.baseMode);
    world.on(WalkerEvent.BASE_MODE_CHANGED, onBaseModeChanged);
    let destroyed = false;
    // MISSÕES: Continua no mesmo mundo depois que os ouvintes processarem a vitória.
    const onVolcanicStatusChanged = (status: VolcanicStatus) => {
      if (status.phase === 'ended' && status.evacuated) {
        setCompletedMissions(completed => advanceCampaign(completed, status));
        const nextMission = nextCampaignMission(status);
        if (nextMission) {
          missionRef.current = nextMission;
          queueMicrotask(() => {
            if (!destroyed) world.fire(VolcanicEvent.CONTINUE_MISSION, nextMission);
          });
          return;
        }
      }
      setVolcanicStatus(status);
    };
    world.on(VolcanicEvent.STATUS_CHANGED, onVolcanicStatusChanged);
    world.on(TerrainEvent.MESH_STATS_CHANGED, setTerrainStats);

    // MISSÕES: Mantém a dificuldade ao criar uma nova tentativa manual.
    world.fire(VolcanicEvent.SET_SPEED, speedRef.current);

    return () => {
      destroyed = true;
      world.off(WalkerEvent.BASE_MODE_CHANGED, onBaseModeChanged);
      world.off(VolcanicEvent.STATUS_CHANGED, onVolcanicStatusChanged);
      world.off(TerrainEvent.MESH_STATS_CHANGED, setTerrainStats);
      world.destroy();
    };
  }, [attempt]);

  useEffect(() => {
    saveCampaignProgress(completedMissions);
  }, [completedMissions]);

  const handleToggleBaseMode = useCallback(() => {
    const next = !baseMode;
    if (!next) {
      world?.fire(CameraEvent.SET_FOCUS_MODE, { mode: 'walker' });
    }
    world?.fire(WalkerEvent.SET_BASE_MODE, { baseMode: next });
  }, [baseMode, world]);

  return (
    <main
      className="relative w-screen h-screen overflow-hidden bg-[#1a0804]"
      data-state={volcanicStatus?.phase ?? 'preparation'}
      data-seed={MISSION_CONFIG.mapSeed}
      data-walker-mode={baseMode ? 'base' : 'walker'}
    >
      <canvas
        id="application-canvas"
        ref={canvasRef}
        key={attempt}
        data-testid="planet-canvas"
        className="w-full h-full block"
      />
      <VolcanicProximity status={volcanicStatus} />
      <HudOverlay
        baseMode={baseMode}
        completedMissions={completedMissions}
        volcanicStatus={volcanicStatus}
        onToggleBaseMode={handleToggleBaseMode}
        onVolcanicSpeedChange={(speed) => {
          speedRef.current = speed;
          world?.fire(VolcanicEvent.SET_SPEED, speed);
        }}
        onMissionChange={(id) => {
          if (!MISSIONS.some((mission, index) => mission.id === id && index <= completedMissions)) return;
          missionRef.current = id;
          world?.fire(VolcanicEvent.SET_MISSION, id);
        }}
        onStart={() => world?.fire(VolcanicEvent.START)}
        onPause={() => world?.fire(VolcanicEvent.PAUSE)}
        onResume={() => world?.fire(VolcanicEvent.RESUME)}
        onRetry={() => setAttempt(current => current + 1)}
        onCompleteObjective={(index) => world?.fire(VolcanicEvent.COMPLETE_OBJECTIVE, index)}
      />
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-20 flex items-end justify-between gap-2 sm:inset-x-4 sm:bottom-4">
        {world && volcanicStatus && (
          <Minimap
            key={attempt}
            world={world}
            target={volcanicStatus.target}
            showTarget={volcanicStatus.phase !== 'preparation'}
            targetDistance={volcanicStatus.targetDistance}
            targetLabel={volcanicStatus.target === volcanicStatus.extraction ? 'Extração' : 'Objetivo'}
          />
        )}
        {terrainStats && <TerrainStatsPanel stats={terrainStats} />}
      </div>
    </main>
  );
}
