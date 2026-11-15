// MISSÕES: Definições das seis missões e posições dos objetivos de campo.

import type { ExtractionZone } from './events/worldEvents.ts';
import { MISSION_CONFIG } from './missionConfig.ts';

export interface MissionCheckpoint {
  name: string;
  action: string;
  result: string;
  fraction: number;
  offset: number;
  sample?: string;
}

interface Mission {
  id: string;
  name: string;
  briefing: string;
  checkpoints: readonly MissionCheckpoint[];
}

export const MISSIONS = [
  {
    id: 'mineral-sampling',
    name: 'Coleta de minerais',
    briefing: 'Localize o afloramento rico em óxidos de ferro, colete a rocha e sele a amostra em um tubo identificado.',
    checkpoints: [
      {
        name: 'Afloramento rico em óxidos de ferro', action: 'Coletar amostra',
        result: 'Rocha acondicionada no tubo M01.', sample: 'M01',
        fraction: 0.34, offset: -28,
      },
    ],
  },
  {
    id: 'regolith-sampling',
    name: 'Amostragem de regolito',
    briefing: 'Recolha material solto em dois pontos e registre a origem de cada amostra.',
    checkpoints: [
      {
        name: 'Regolito da planície', action: 'Coletar e registrar amostra',
        result: 'Tubo R01 · origem registrada na planície.', sample: 'R01',
        fraction: 0.30, offset: -30,
      },
      {
        name: 'Regolito da encosta', action: 'Coletar e registrar amostra',
        result: 'Tubo R02 · origem registrada na encosta.', sample: 'R02',
        fraction: 0.64, offset: 24,
      },
    ],
  },
  {
    id: 'geological-survey',
    name: 'Levantamento geológico',
    briefing: 'Escaneie dois afloramentos, compare a composição e fotografe as camadas.',
    checkpoints: [
      {
        name: 'Afloramento basáltico', action: 'Escanear e fotografar',
        result: 'Camadas fotografadas. Afloramento predominantemente basáltico.',
        fraction: 0.29, offset: 42,
      },
      {
        name: 'Afloramento com veios claros', action: 'Escanear e comparar',
        result: 'Camadas fotografadas. Veios ricos em sais contrastam com o basalto do primeiro local.',
        fraction: 0.62, offset: -36,
      },
    ],
  },
  {
    id: 'atmospheric-monitoring',
    name: 'Monitoramento atmosférico',
    briefing: 'Instale uma estação meteorológica e registre temperatura, pressão e poeira.',
    checkpoints: [
      {
        name: 'Local de instalação da estação', action: 'Instalar estação e medir',
        result: 'Leituras simuladas registradas · −54 °C · 670 Pa · poeira 0,4 mg/m³.',
        fraction: 0.42, offset: -48,
      },
    ],
  },
  {
    id: 'ancient-water',
    name: 'Busca por indícios de água antiga',
    briefing: 'Examine o depósito sedimentar e selecione uma amostra para análise posterior.',
    checkpoints: [
      {
        name: 'Depósito sedimentar', action: 'Examinar rocha sedimentar',
        result: 'Camadas finas identificadas. A origem do depósito requer análise.',
        fraction: 0.33, offset: -42,
      },
      {
        name: 'Camada sedimentar selecionada', action: 'Coletar amostra sedimentar',
        result: 'Amostra acondicionada no tubo S01 para análise posterior.', sample: 'S01',
        fraction: 0.67, offset: -20,
      },
    ],
  },
  {
    id: 'sample-cache',
    name: 'Depósito de amostras',
    briefing: 'Leve os tubos ao depósito e transmita o inventário ao centro de controle.',
    checkpoints: [
      {
        name: 'Depósito de amostras', action: 'Confirmar entrega dos tubos',
        result: 'Tubos M01, R01, R02 e S01 entregues.',
        fraction: 0.36, offset: 42,
      },
      {
        name: 'Terminal de comunicação', action: 'Transmitir inventário',
        result: 'Centro de controle confirmou o recebimento do inventário.',
        fraction: 0.70, offset: 28,
      },
    ],
  },
] as const satisfies readonly Mission[];

export type MissionId = (typeof MISSIONS)[number]['id'];

export function getMission(id: MissionId): Mission {
  return MISSIONS.find(mission => mission.id === id) ?? MISSIONS[0];
}

export function getMissionCheckpoints(
  id: MissionId,
  extraction: ExtractionZone,
  { x, z }: { x: number; z: number } = MISSION_CONFIG.walkerSpawn,
): ExtractionZone[] {
  const dx = extraction.x - x;
  const dz = extraction.z - z;
  const length = Math.hypot(dx, dz);

  return getMission(id).checkpoints.map(({ fraction, offset }) => ({
    x: x + dx * fraction + (dz / length) * offset,
    z: z + dz * fraction - (dx / length) * offset,
    radius: 22,
  }));
}
