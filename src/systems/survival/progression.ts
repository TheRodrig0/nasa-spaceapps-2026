export interface ColonyStageDefinition {
  readonly stage: number;
  readonly title: string;
  readonly goalText: string;
  readonly unlockedIds: readonly string[];
}

export const COLONY_STAGES: ReadonlyArray<ColonyStageDefinition> = [
  {
    stage: 1,
    title: 'Fundação',
    goalText: 'Construa Base Central e Painel ou Gerador Solar',
    unlockedIds: ['main_house', 'solar_panel', 'solar_generator'],
  },
  {
    stage: 2,
    title: 'Suporte de Vida',
    goalText: 'Construa Alojamento e Estufa / O₂',
    unlockedIds: ['home_colonists', 'farm'],
  },
  {
    stage: 3,
    title: 'Extração e Reserva',
    goalText: 'Construa Usina + Bateria e acumule 60 UJ',
    unlockedIds: ['machine_plant', 'battery', 'resource_warehouse'],
  },
  {
    stage: 4,
    title: 'Energia Estável',
    goalText: 'Construa Gerador Geotérmico + Depósito e 2 mineradoras',
    unlockedIds: ['geothermal_generator', 'drone_control', 'drone_charging'],
  },
  {
    stage: 5,
    title: 'Autossuficiência',
    goalText: 'Construa Reator (ou 3 mineradoras estáveis) até o 10º Sol',
    unlockedIds: ['reactor'],
  },
];

export interface ProgressionStatus {
  readonly stage: number;
  readonly title: string;
  readonly goalText: string;
  readonly allStagesCompleted: boolean;
}

export function getRequiredStageForBuilding(definitionId: string): number {
  for (const entry of COLONY_STAGES) {
    if (entry.unlockedIds.includes(definitionId)) {
      return entry.stage;
    }
  }
  return 1;
}

export function evaluateProgression(
  buildings: readonly { readonly definitionId: string }[],
  ore: number,
  generation: number,
  demand: number,
  currentStage = 1,
): { unlockedStage: number; allStagesCompleted: boolean } {
  const counts = new Map<string, number>();
  for (const { definitionId } of buildings) {
    counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1);
  }
  const has = (id: string, min = 1): boolean => (counts.get(id) ?? 0) >= min;
  const miners = (counts.get('machine_plant') ?? 0) + (counts.get('drone_control') ?? 0);

  let stage = Math.max(1, Math.min(5, currentStage));
  const stage1Done = has('main_house') && (has('solar_panel') || has('solar_generator'));
  if (stage === 1 && stage1Done) stage = 2;

  const stage2Done = stage >= 2 && has('home_colonists') && has('farm');
  if (stage === 2 && stage2Done) stage = 3;

  const stage3Done = stage >= 3 && has('machine_plant') && has('battery') && ore + 1e-6 >= 60;
  if (stage === 3 && stage3Done) stage = 4;

  const stage4Done =
    stage >= 4 && has('geothermal_generator') && has('resource_warehouse') && miners >= 2;
  if (stage === 4 && stage4Done) stage = 5;

  const stage5Done =
    stage >= 5 && (has('reactor') || (miners >= 3 && generation + 1e-6 >= demand));

  return { unlockedStage: stage, allStagesCompleted: stage5Done };
}

export function evaluateColonyStage(
  currentMaxStage: number,
  buildings: readonly { readonly definitionId: string }[],
  ore: number,
  generation: number,
  demand: number,
): ProgressionStatus {
  const evalResult = evaluateProgression(buildings, ore, generation, demand, currentMaxStage);
  const stage = evalResult.unlockedStage;
  const def = COLONY_STAGES[stage - 1] ?? COLONY_STAGES[0];
  return {
    stage,
    title: def.title,
    goalText: evalResult.allStagesCompleted
      ? 'Base autossuficiente — resista até o fim do 10º Sol'
      : def.goalText,
    allStagesCompleted: evalResult.allStagesCompleted,
  };
}
