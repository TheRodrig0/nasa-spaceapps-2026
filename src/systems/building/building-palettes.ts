import * as pc from 'playcanvas';

type MaterialSlot = 'Mat_Hull' | 'Mat_Trim' | 'Mat_Accent' | 'Mat_Detail';

type TextureKey = 'hull' | 'solar' | 'metal' | 'greenhouse';

const TEXTURE_PATHS: Record<TextureKey, { albedo: string; normal: string }> = {
  hull: {
    albedo: '/base/texture/mars_hull_panels.png',
    normal: '/base/texture/mars_hull_panels_normal.png',
  },
  solar: {
    albedo: '/base/texture/solar_cells.png',
    normal: '/base/texture/solar_cells_normal.png',
  },
  metal: {
    albedo: '/base/texture/industrial_metal.png',
    normal: '/base/texture/industrial_metal_normal.png',
  },
  greenhouse: {
    albedo: '/base/texture/greenhouse_glass.png',
    normal: '/base/texture/greenhouse_glass_normal.png',
  },
};

type SlotStyle = {
  tex: TextureKey;
  tint: readonly [number, number, number];
  tiling: number;
  gloss: number;
  metalness: number;
  bumpiness: number;
  emissive?: readonly [number, number, number];
  emissiveUsesAlbedo?: boolean;
  emissiveIntensity?: number;
  glassOpacity?: number;
};

function makeDefaultSlots(): Record<MaterialSlot, SlotStyle> {
  return {
    Mat_Hull: { tex: 'hull', tint: [1, 1, 1], tiling: 0.65, gloss: 0.4, metalness: 0.16, bumpiness: 0.55 },
    Mat_Trim: { tex: 'metal', tint: [0.85, 0.87, 0.9], tiling: 1.0, gloss: 0.48, metalness: 0.48, bumpiness: 0.7 },
    Mat_Accent: { tex: 'metal', tint: [0.82, 0.46, 0.3], tiling: 1.0, gloss: 0.45, metalness: 0.3, bumpiness: 0.65 },
    Mat_Detail: { tex: 'metal', tint: [0.58, 0.62, 0.66], tiling: 1.0, gloss: 0.52, metalness: 0.52, bumpiness: 0.5 },
  };
}

function getBuildingSlots(defId: string): Record<MaterialSlot, SlotStyle> {
  const slots = makeDefaultSlots();

  if (defId === 'solar_panel' || defId === 'solar_generator') {
    slots.Mat_Accent = {
      tex: 'solar',
      tint: [1, 1, 1],
      tiling: 2.6,
      gloss: 0.92,
      metalness: 0.22,
      bumpiness: 0.75,
      emissive: [0.42, 0.62, 1.0],
      emissiveUsesAlbedo: true,
      emissiveIntensity: 0.45,
    };
    return slots;
  }

  if (defId === 'farm') {
    slots.Mat_Accent = {
      tex: 'greenhouse',
      tint: [0.88, 1.0, 0.92],
      tiling: 1.4,
      gloss: 0.95,
      metalness: 0.05,
      bumpiness: 0.45,
      emissive: [0.16, 0.42, 0.22],
      emissiveUsesAlbedo: true,
      emissiveIntensity: 0.55,
      glassOpacity: 0.66,
    };
    return slots;
  }

  if (defId === 'battery') {
    slots.Mat_Trim = {
      tex: 'metal',
      tint: [0.42, 0.88, 1.0],
      tiling: 1.2,
      gloss: 0.96,
      metalness: 0.08,
      bumpiness: 0.35,
      emissive: [0.14, 0.58, 0.82],
      emissiveIntensity: 0.95,
      glassOpacity: 0.58,
    };
    slots.Mat_Accent = {
      tex: 'metal',
      tint: [0.35, 0.78, 0.95],
      tiling: 1.0,
      gloss: 0.68,
      metalness: 0.42,
      bumpiness: 0.65,
      emissive: [0.05, 0.22, 0.34],
      emissiveIntensity: 1.0,
    };
    return slots;
  }

  if (defId === 'reactor') {
    slots.Mat_Hull = { tex: 'metal', tint: [0.88, 0.9, 0.94], tiling: 0.9, gloss: 0.5, metalness: 0.45, bumpiness: 0.7 };
    slots.Mat_Accent = {
      tex: 'metal',
      tint: [0.42, 0.82, 0.96],
      tiling: 1.0,
      gloss: 0.65,
      metalness: 0.45,
      bumpiness: 0.7,
      emissive: [0.06, 0.24, 0.34],
      emissiveIntensity: 1.1,
    };
    return slots;
  }

  if (defId === 'geothermal_generator') {
    slots.Mat_Hull = { tex: 'metal', tint: [0.84, 0.8, 0.76], tiling: 0.9, gloss: 0.46, metalness: 0.42, bumpiness: 0.7 };
    slots.Mat_Accent = {
      tex: 'metal',
      tint: [0.95, 0.54, 0.28],
      tiling: 1.0,
      gloss: 0.48,
      metalness: 0.35,
      bumpiness: 0.7,
      emissive: [0.22, 0.07, 0.02],
      emissiveIntensity: 1.0,
    };
    return slots;
  }

  if (defId === 'machine_plant' || defId === 'resource_warehouse') {
    slots.Mat_Hull = { tex: 'hull', tint: [0.94, 0.92, 0.88], tiling: 0.65, gloss: 0.36, metalness: 0.24, bumpiness: 0.55 };
    slots.Mat_Accent = { tex: 'metal', tint: [0.9, 0.66, 0.3], tiling: 1.0, gloss: 0.44, metalness: 0.38, bumpiness: 0.7 };
    return slots;
  }

  if (defId === 'drone_control' || defId === 'drone_charging') {
    slots.Mat_Accent = { tex: 'metal', tint: [0.46, 0.78, 0.86], tiling: 1.0, gloss: 0.55, metalness: 0.36, bumpiness: 0.65 };
    return slots;
  }

  return slots;
}

export class BuildingMaterialLibrary {
  private readonly app: pc.AppBase;
  private readonly textures = new Map<string, pc.Texture>();
  private readonly matCache = new Map<string, pc.StandardMaterial>();
  private readonly createdMaterials: pc.StandardMaterial[] = [];

  constructor(app: pc.AppBase) {
    this.app = app;
    this.preloadAll();
  }

  private preloadAll(): void {
    (Object.keys(TEXTURE_PATHS) as TextureKey[]).forEach((key) => {
      const paths = TEXTURE_PATHS[key];
      this.loadRepeatTexture(paths.albedo, `${key}_albedo`);
      this.loadRepeatTexture(paths.normal, `${key}_normal`);
    });
  }

  private loadRepeatTexture(url: string, cacheKey: string): void {
    this.app.assets.loadFromUrl(url, 'texture', (err, asset) => {
      if (err || !asset?.resource) return;
      const tex = asset.resource as pc.Texture;
      tex.addressU = pc.ADDRESS_REPEAT;
      tex.addressV = pc.ADDRESS_REPEAT;
      tex.anisotropy = 4;
      this.textures.set(cacheKey, tex);
      this.refreshMaterials();
    });
  }

  private refreshMaterials(): void {
    for (const [key, mat] of this.matCache.entries()) {
      const [defId, slotName] = key.split('::') as [string, MaterialSlot];
      const spec = getBuildingSlots(defId)[slotName];
      if (!spec) continue;
      const albedo = this.textures.get(`${spec.tex}_albedo`);
      const normal = this.textures.get(`${spec.tex}_normal`);
      if (albedo) {
        mat.diffuseMap = albedo;
        mat.diffuseMapTiling.set(spec.tiling, spec.tiling);
        if (spec.emissiveUsesAlbedo) {
          mat.emissiveMap = albedo;
          mat.emissiveMapTiling.set(spec.tiling, spec.tiling);
        }
      }
      if (normal) {
        mat.normalMap = normal;
        mat.normalMapTiling.set(spec.tiling, spec.tiling);
      }
      mat.update();
    }
  }

  public applyMaterials(root: pc.Entity, defId: string, isGhost: boolean): void {
    const slotSpecs = getBuildingSlots(defId);
    const renders = root.findComponents('render') as pc.RenderComponent[];

    for (const r of renders) {
      r.castShadows = !isGhost;
      r.receiveShadows = !isGhost;
      for (const mi of r.meshInstances) {
        const origName = mi.material?.name;
        const slot: MaterialSlot =
          origName === 'Mat_Hull' ||
          origName === 'Mat_Trim' ||
          origName === 'Mat_Accent' ||
          origName === 'Mat_Detail'
            ? origName
            : 'Mat_Hull';

        if (isGhost) {
          const ghostMat = this.buildMaterial(slotSpecs[slot], true);
          mi.material = ghostMat;
        } else {
          const cacheKey = `${defId}::${slot}`;
          let mat = this.matCache.get(cacheKey);
          if (!mat) {
            mat = this.buildMaterial(slotSpecs[slot], false);
            this.matCache.set(cacheKey, mat);
          }
          mi.material = mat;
        }
      }
    }
  }

  private buildMaterial(spec: SlotStyle, isGhost: boolean): pc.StandardMaterial {
    const mat = new pc.StandardMaterial();
    const albedo = this.textures.get(`${spec.tex}_albedo`);
    const normal = this.textures.get(`${spec.tex}_normal`);
    if (albedo) {
      mat.diffuseMap = albedo;
      mat.diffuseMapTiling.set(spec.tiling, spec.tiling);
    }
    if (normal) {
      mat.normalMap = normal;
      mat.normalMapTiling.set(spec.tiling, spec.tiling);
    }

    mat.diffuse = new pc.Color(spec.tint[0], spec.tint[1], spec.tint[2]);
    mat.bumpiness = spec.bumpiness;
    mat.gloss = spec.gloss;

    if (spec.glassOpacity !== undefined && !isGhost) {
      mat.useMetalness = false;
      mat.specular = new pc.Color(0.95, 0.98, 1.0);
      mat.opacity = spec.glassOpacity;
      mat.blendType = pc.BLEND_NORMAL;
      mat.depthWrite = false;
    } else {
      mat.useMetalness = true;
      mat.metalness = spec.metalness;
    }

    if (spec.emissive && !isGhost) {
      if (spec.emissiveUsesAlbedo && albedo) {
        mat.emissiveMap = albedo;
        mat.emissiveMapTiling.set(spec.tiling, spec.tiling);
      }
      mat.emissive = new pc.Color(spec.emissive[0], spec.emissive[1], spec.emissive[2]);
      mat.emissiveIntensity = spec.emissiveIntensity ?? 1.0;
    }

    if (isGhost) {
      mat.opacity = 0.62;
      mat.blendType = pc.BLEND_NORMAL;
      mat.depthWrite = false;
      mat.emissiveIntensity = 1.1;
    }

    mat.update();
    this.createdMaterials.push(mat);
    return mat;
  }

  public destroy(): void {
    for (const mat of this.createdMaterials) mat.destroy();
    this.createdMaterials.length = 0;
    this.matCache.clear();
    this.textures.clear();
  }
}
