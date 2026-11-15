import type { BuildingCategory, BuildingDefinition } from '../../types/index.ts';

export const BUILDING_CATEGORIES: ReadonlyArray<{ id: BuildingCategory; label: string }> = [
  { id: 'casas', label: 'Casas' },
  { id: 'energia', label: 'Energia' },
  { id: 'mineracao', label: 'Mineração' },
];

export const BUILDING_CATALOG: ReadonlyArray<BuildingDefinition> = [
  // Casas
  {
    id: 'main_house',
    name: 'Base Central',
    category: 'casas',
    glbFile: 'Main_house.glb',
    cols: 3,
    rows: 3,
    description: 'Núcleo de comando do posto avançado.',
  },
  {
    id: 'home_colonists',
    name: 'Alojamento',
    category: 'casas',
    glbFile: 'Home_colonists.glb',
    cols: 2,
    rows: 2,
    description: 'Módulo habitacional pressurizado.',
  },
  {
    id: 'farm',
    name: 'Estufa / O₂',
    category: 'casas',
    glbFile: 'Farm.glb',
    cols: 2,
    rows: 2,
    description: 'Cultivo e suporte de vida.',
  },

  // Energia
  {
    id: 'solar_panel',
    name: 'Painel Solar',
    category: 'energia',
    glbFile: 'Solar_panel.glb',
    cols: 2,
    rows: 1,
    description: 'Captação solar compacta.',
  },
  {
    id: 'solar_generator',
    name: 'Gerador Solar',
    category: 'energia',
    glbFile: 'Solar_generator.glb',
    cols: 2,
    rows: 2,
    description: 'Estação de geração fotovoltaica.',
  },
  {
    id: 'battery',
    name: 'Bateria',
    category: 'energia',
    glbFile: 'Research_center.glb',
    cols: 3,
    rows: 2,
    description: 'Armazenamento de energia de alta capacidade.',
  },
  {
    id: 'geothermal_generator',
    name: 'Gerador Geotérmico',
    category: 'energia',
    glbFile: 'Geothermal_generator.glb',
    cols: 2,
    rows: 2,
    description: 'Extração térmica do subsolo marciano.',
  },
  {
    id: 'reactor',
    name: 'Reator',
    category: 'energia',
    glbFile: 'Reactor.glb',
    cols: 3,
    rows: 3,
    description: 'Fonte de energia de alta capacidade.',
  },

  // Mineração
  {
    id: 'machine_plant',
    name: 'Usina de Mineração',
    category: 'mineracao',
    glbFile: 'Machine_building_plant.glb',
    cols: 3,
    rows: 2,
    description: 'Processamento de regolito e ligas.',
  },
  {
    id: 'resource_warehouse',
    name: 'Depósito',
    category: 'mineracao',
    glbFile: 'Resource_warehouse.glb',
    cols: 2,
    rows: 2,
    description: 'Armazenamento de minério bruto.',
  },
  {
    id: 'drone_control',
    name: 'Controle de Drones',
    category: 'mineracao',
    glbFile: 'Drone_control_center.glb',
    cols: 2,
    rows: 2,
    description: 'Coordenação de drones extratores.',
  },
  {
    id: 'drone_charging',
    name: 'Estação de Drones',
    category: 'mineracao',
    glbFile: 'Drone_charging_station.glb',
    cols: 2,
    rows: 1,
    description: 'Doca de recarga rápida.',
  },
];
