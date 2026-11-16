export type ColonyWeather = 'clear' | 'dust-storm' | 'electrical-storm';

export const COLONY_BALANCE = {
  startingOre: 120,
  baseOreCapacity: 120,
  costScalePerDuplicate: 0.35,
  orePerMinerPerSecond: 2,
  damagePerBuildingHit: 12,
  maxDamagePerDisaster: 36,
  repairOrePerPoint: 2,
  maxRepairPerAction: 10,
  solarOutput: { clear: 1, 'dust-storm': 0.15, 'electrical-storm': 0.1 },
} as const;

interface ModuleEconomy {
  cost: number;
  solar?: number;
  steady?: number;
  battery?: number;
  oreStorage?: number;
  demand?: number;
  housing?: number;
  oxygen?: number;
  miner?: boolean;
}

export const MODULE_ECONOMY: Readonly<Record<string, ModuleEconomy | undefined>> = {
  main_house: { cost: 20, steady: 4, oreStorage: 30 },
  home_colonists: { cost: 15, housing: 2, demand: 2 },
  farm: { cost: 15, oxygen: 2, demand: 2 },
  solar_panel: { cost: 10, solar: 6 },
  solar_generator: { cost: 20, solar: 14 },
  battery: { cost: 20, battery: 90 },
  geothermal_generator: { cost: 65, steady: 15 },
  reactor: { cost: 95, steady: 30 },
  machine_plant: { cost: 25, miner: true, demand: 6 },
  resource_warehouse: { cost: 15, oreStorage: 100 },
  drone_control: { cost: 20, miner: true, demand: 5 },
  drone_charging: { cost: 15, steady: 5 },
};

export function getModuleTradeoffInfo(definitionId: string): {
  cost: number;
  statsLine: string;
} {
  const mod = Object.hasOwn(MODULE_ECONOMY, definitionId)
    ? MODULE_ECONOMY[definitionId]
    : undefined;
  if (!mod) {
    return { cost: 0, statsLine: '' };
  }

  const parts: string[] = [];
  if (mod.miner) parts.push(`+${COLONY_BALANCE.orePerMinerPerSecond} minério/s`);
  if (mod.solar) parts.push(`+${mod.solar} solar`);
  if (mod.steady) parts.push(`+${mod.steady} energia`);
  if (mod.battery) parts.push(`+${mod.battery} bateria`);
  if (mod.housing || mod.oxygen) parts.push(`+${mod.housing ?? mod.oxygen} suporte`);
  if (mod.demand) parts.push(`-${mod.demand} energia`);

  return {
    cost: mod.cost,
    statsLine: parts.join(' · '),
  };
}

export function getConstructionCost(definitionId: string): number | undefined {
  return Object.hasOwn(MODULE_ECONOMY, definitionId) ? MODULE_ECONOMY[definitionId]?.cost : undefined;
}

export function getDynamicConstructionCost(
  definitionId: string,
  buildings: readonly { readonly definitionId: string }[] = [],
): number | undefined {
  const baseCost = getConstructionCost(definitionId);
  if (baseCost === undefined) return undefined;
  let count = 0;
  for (const b of buildings) {
    if (b.definitionId === definitionId) count += 1;
  }
  return Math.ceil(baseCost * (1 + count * COLONY_BALANCE.costScalePerDuplicate));
}

export interface ColonyInputs {
  readonly buildings: readonly { readonly definitionId: string }[];
  readonly weather?: ColonyWeather;
  readonly sunEfficiency?: number;
  readonly solIndex?: number;
}

export function readColonyCapacity({ buildings, weather = 'clear', sunEfficiency = 1 }: ColonyInputs) {
  let generation = 0;
  let batteryCapacity = 0;
  let oreCapacity = COLONY_BALANCE.baseOreCapacity;
  let supportDemand = 0;
  let housing = 0;
  let oxygen = 0;
  let miners = 0;
  let miningDemand = 0;
  const sunMult = Number.isFinite(sunEfficiency) ? Math.max(0, Math.min(1, sunEfficiency)) : 1;

  for (const { definitionId } of buildings) {
    const module = Object.hasOwn(MODULE_ECONOMY, definitionId) ? MODULE_ECONOMY[definitionId] : undefined;
    if (!module) continue;
    generation += (module.solar ?? 0) * COLONY_BALANCE.solarOutput[weather] * sunMult + (module.steady ?? 0);
    batteryCapacity += module.battery ?? 0;
    oreCapacity += module.oreStorage ?? 0;
    housing += module.housing ?? 0;
    oxygen += module.oxygen ?? 0;
    if (module.miner) {
      miners += 1;
      miningDemand += module.demand ?? 0;
    } else {
      supportDemand += module.demand ?? 0;
    }
  }

  const supportCapacity = Math.min(housing, oxygen);
  const supportedMiners = Math.min(miners, supportCapacity);
  return {
    generation, batteryCapacity, oreCapacity, supportDemand, supportCapacity, housing, oxygen, miners, supportedMiners,
    miningDemand: miners === 0 ? 0 : miningDemand * supportedMiners / miners,
    weather,
  };
}
