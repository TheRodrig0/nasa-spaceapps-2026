// MISSÕES: O minimapa aponta para o objetivo ativo da missão ou para a extração.

import { useEffect, useState } from 'react';
import {
  type ExtractionZone,
  type PoseUpdatedPayload,
  VolcanicEvent,
  WalkerEvent,
} from '../systems/events/worldEvents.ts';
import { MISSION_CONFIG } from '../systems/missionConfig.ts';
import type { WorldManager } from '../world/WorldManager.ts';

const MAP_SIZE = 160;
const CENTER = MAP_SIZE / 2;
const SCALE = MAP_SIZE / 2000;
const MARKER_LIMIT = CENTER - 11;
const { walkerSpawn, volcanic } = MISSION_CONFIG;
const initialFrame: { walker: PoseUpdatedPayload; frontZ: number } = {
  walker: { ...walkerSpawn, y: 0 },
  frontZ: walkerSpawn.z - volcanic.startDistance,
};

interface MinimapProps {
  world: WorldManager;
  target: ExtractionZone;
  targetLabel: string;
  showTarget: boolean;
  targetDistance: number;
}

export function Minimap({
  world,
  target,
  targetLabel,
  showTarget,
  targetDistance,
}: MinimapProps) {
  const [frame, setFrame] = useState(initialFrame);

  useEffect(() => {
    let { walker, frontZ } = initialFrame;
    let shown = initialFrame;
    const onPose = (pose: PoseUpdatedPayload) => {
      walker = pose;
    };
    const onFront = (z: number) => {
      frontZ = z;
    };
    world.on(WalkerEvent.POSE_UPDATED, onPose);
    world.on(VolcanicEvent.POSITION_CHANGED, onFront);
    const timer = window.setInterval(() => {
      if (
        frontZ === shown.frontZ &&
        walker.x === shown.walker.x &&
        walker.z === shown.walker.z &&
        walker.headingDeg === shown.walker.headingDeg
      )
        return;
      shown = { walker, frontZ };
      setFrame(shown);
    }, 100);
    return () => {
      window.clearInterval(timer);
      world.off(WalkerEvent.POSE_UPDATED, onPose);
      world.off(VolcanicEvent.POSITION_CHANGED, onFront);
    };
  }, [world]);

  const { walker, frontZ } = frame;
  const x = (target.x - walker.x) * SCALE;
  const y = (walker.z - target.z) * SCALE;
  const markerScale =
    MARKER_LIMIT / Math.max(MARKER_LIMIT, Math.abs(x), Math.abs(y));
  const frontY = CENTER + (walker.z - frontZ) * SCALE;
  const heatY = frontY - volcanic.heatedWidth * SCALE;

  return (
    <section
      aria-label="Minimapa"
      className="hud-panel w-[min(38vw,26dvh,11rem)] shrink-0 rounded-xl p-2 text-orange-100 font-mono-tech"
    >
      <div className="flex justify-between items-center text-xs [&>span]:flex [&>span]:items-center [&>span]:gap-1">
        <h2 className="mb-1 font-bold text-orange-300">Minimapa</h2>
        <span className="font-bold text-teal-200">
          <span aria-hidden="true">◆ </span>
          <span>{showTarget ? `${targetDistance} UJ` : '-'}</span>
        </span>
      </div>
      <svg
        className="block w-full rounded-md border border-orange-400/30 bg-[#351b15]"
        viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
        role="img"
        aria-label={showTarget
          ? `Vista de cima centrada na base, com a posição de ${targetLabel.toLowerCase()} e da frente vulcânica`
          : 'Vista de cima centrada na base, com a posição da frente vulcânica'}
      >
        <defs>
          <pattern
            id="minimap-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M20 0H0V20"
              fill="none"
              stroke="#fde1ba"
              strokeOpacity="0.18"
            />
          </pattern>
        </defs>
        <rect width={MAP_SIZE} height={MAP_SIZE} fill="url(#minimap-grid)" />
        <rect
          y={heatY}
          width={MAP_SIZE}
          height={frontY - heatY}
          fill="#fb923c"
          fillOpacity="0.55"
        />
        <rect
          y={frontY}
          width={MAP_SIZE}
          height={Math.max(0, MAP_SIZE - frontY)}
          fill="#9f2217"
          fillOpacity="0.8"
        />
        <path d={`M0 ${frontY}H${MAP_SIZE}`} stroke="#ff994b" strokeWidth="2" />
        {showTarget && <g
          transform={`translate(${CENTER + x * markerScale} ${CENTER + y * markerScale})`}
        >
          <path
            d="M0 -7L7 0L0 7L-7 0Z"
            fill={markerScale === 1 ? '#5eead4' : '#351b15'}
            stroke="#99f6e4"
            strokeWidth="2"
          />
        </g>}
        <g
          transform={`translate(${CENTER} ${CENTER}) rotate(${walker.headingDeg})`}
        >
          <path
            d="M0 -10L7 8L0 5L-7 8Z"
            fill="#fff7ec"
            stroke="#21120d"
            strokeWidth="1.5"
          />
        </g>
      </svg>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-tight">
        <span className="font-bold text-teal-200">
          <span aria-hidden="true">◆ </span>{targetLabel}
        </span>
        <span className="text-orange-200">
          <span aria-hidden="true" className="text-orange-400">
            ━{' '}
          </span>
          Frente
        </span>
      </div>
    </section>
  );
}
