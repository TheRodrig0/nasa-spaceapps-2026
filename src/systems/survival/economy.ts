export type ColonyWeather = 'clear' | 'dust-storm' | 'electrical-storm';

export const COLONY_BALANCE = {
  startingOre: 120,
  orePerMinerPerSecond: 2,
  damagePerBuildingHit: 25,
  repairOrePerPoint: 2,
  maxRepairPerAction: 10,
  solarOutput: { clear: 1, 'dust-storm': 0.15, 'electrical-storm': 0.1 },
} as const;

interface ModuleEconomy {
  cost: number;
  solar?: number;
  steady?: number;
  battery?: number;
  demand?: number;
  housing?: number;
  oxygen?: number;
  miner?: boolean;
}

export const MODULE_ECONOMY: Readonly<Record<string, ModuleEconomy | undefined>> = {
  main_house: { cost: 20 },
  home_colonists: { cost: 15, housing: 2, demand: 2 },
  farm: { cost: 15, oxygen: 2, demand: 2 },
  solar_panel: { cost: 10, solar: 6 },
  solar_generator: { cost: 20, solar: 14 },
  battery: { cost: 20, battery: 90 },
  geothermal_generator: { cost: 65, steady: 15 },
  reactor: { cost: 95, steady: 30 },
  machine_plant: { cost: 25, miner: true, demand: 6 },
  resource_warehouse: { cost: 15 },
  drone_control: { cost: 20 },
  drone_charging: { cost: 15 },
};

export function getConstructionCost(definitionId: string): number | undefined {
  return Object.hasOwn(MODULE_ECONOMY, definitionId) ? MODULE_ECONOMY[definitionId]?.cost : undefined;
}

export interface ColonyInputs {
  readonly buildings: readonly { readonly definitionId: string }[];
  readonly weather?: ColonyWeather;
}

export function readColonyCapacity({ buildings, weather = 'clear' }: ColonyInputs) {
  let generation = 0;
  let batteryCapacity = 0;
  let supportDemand = 0;
  let housing = 0;
  let oxygen = 0;
  let miners = 0;
  let miningDemand = 0;

  for (const { definitionId } of buildings) {
    const module = Object.hasOwn(MODULE_ECONOMY, definitionId) ? MODULE_ECONOMY[definitionId] : undefined;
    if (!module) continue;
    generation += (module.solar ?? 0) * COLONY_BALANCE.solarOutput[weather] + (module.steady ?? 0);
    batteryCapacity += module.battery ?? 0;
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
    generation, batteryCapacity, supportDemand, supportCapacity, miners, supportedMiners,
    miningDemand: miners === 0 ? 0 : miningDemand * supportedMiners / miners,
    weather,
  };
}
