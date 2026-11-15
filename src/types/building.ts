import type { Vec3XYZ } from './game.ts';

export type BuildingCategory = 'casas' | 'energia' | 'mineracao';

export type CellInvalidReason = 'ok' | 'relief' | 'occupied' | 'bounds';

export interface BuildEconomyHooks {
  canAfford: (cost: number) => boolean;
  onSpend: (cost: number) => void;
}

export interface BuildingDefinition {
  id: string;
  name: string;
  category: BuildingCategory;
  glbFile: string;
  cols: number;
  rows: number;
  description: string;
  oreCost: number;
  solarGen?: number;
  constantGen?: number;
  energyDemand?: number;
  batteryCapacity?: number;
  orePerSec?: number;
  oreBonusMultiplier?: number;
}

export interface CellValidation {
  gx: number;
  gz: number;
  valid: boolean;
  reason: CellInvalidReason;
  centerY: number;
}

export interface PlacementPreview {
  definition: BuildingDefinition;
  gridX: number;
  gridZ: number;
  cols: number;
  rows: number;
  rotationDeg: number;
  allValid: boolean;
  cells: CellValidation[];
  baseY: number;
}

export interface PlacedBuilding {
  uid: string;
  definitionId: string;
  gridX: number;
  gridZ: number;
  cols: number;
  rows: number;
  rotationDeg: number;
  worldCenter: Vec3XYZ;
}
