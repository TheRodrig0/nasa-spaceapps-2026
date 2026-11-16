import { COLONY_BALANCE } from './economy.ts';

export const LOADOUT_CONFIGS = {
  standard: { startingOre: COLONY_BALANCE.startingOre, initialBattery: 0, impactDamageMult: 1 },
  hull: { startingOre: COLONY_BALANCE.startingOre - 10, initialBattery: 0, impactDamageMult: 0.75 },
  battery: { startingOre: COLONY_BALANCE.startingOre - 10, initialBattery: 40, impactDamageMult: 1 },
} as const;
