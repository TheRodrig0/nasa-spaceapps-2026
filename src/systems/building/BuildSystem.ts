import * as pc from 'playcanvas';
import type {
  BuildEconomyHooks,
  BuildingDefinition,
  CellInvalidReason,
  CellValidation,
  ImpactHeightSampler,
  PlacedBuilding,
  PlacementPreview,
  Vec3XYZ,
} from '../../types/index.ts';
import { BuildingMaterialLibrary } from './building-palettes.ts';

const CELL_SIZE = 14;
const MAX_CELL_RELIEF = 2.6;
const MAX_FOOTPRINT_DELTA = 4.8;
const WORLD_BUILD_LIMIT = 2480;
const MAX_PREVIEW_CELLS = 16;

function cellKey(gx: number, gz: number): string {
  return `${gx},${gz}`;
}

function createTileMaterial(r: number, g: number, b: number, opacity: number): pc.StandardMaterial {
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color(r, g, b);
  mat.emissive = new pc.Color(r * 0.75, g * 0.75, b * 0.75);
  mat.emissiveIntensity = 1.4;
  mat.opacity = opacity;
  mat.blendType = pc.BLEND_NORMAL;
  mat.depthWrite = false;
  mat.update();
  return mat;
}

function computeLocalBounds(entity: pc.Entity): pc.BoundingBox | null {
  entity.getWorldTransform();
  const renders = entity.findComponents('render') as pc.RenderComponent[];
  const box = new pc.BoundingBox();
  let hasAny = false;
  for (const r of renders) {
    for (const mi of r.meshInstances) {
      if (!hasAny) {
        box.copy(mi.aabb);
        hasAny = true;
      } else {
        box.add(mi.aabb);
      }
    }
  }
  return hasAny ? box : null;
}

export class BuildSystem {
  public readonly entity: pc.Entity;

  private readonly app: pc.AppBase;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: pc.Entity;
  private readonly terrain: ImpactHeightSampler;

  private readonly occupiedCells = new Set<string>();
  private readonly placedBuildings: PlacedBuilding[] = [];
  private readonly glbCache = new Map<string, pc.ContainerResource>();
  private readonly glbPending = new Map<string, Promise<pc.ContainerResource>>();
  private readonly materialLibrary: BuildingMaterialLibrary;

  private readonly previewRoot: pc.Entity;
  private readonly tilePool: pc.Entity[] = [];
  private readonly validTileMat: pc.StandardMaterial;
  private readonly invalidTileMat: pc.StandardMaterial;

  private ghostRoot: pc.Entity | null = null;
  private ghostDefId: string | null = null;
  private ghostValidState: boolean | null = null;

  private economyHooks: BuildEconomyHooks | null = null;
  private enabled = true;
  private selectedDef: BuildingDefinition | null = null;
  private rotationDeg = 0;
  private currentPreview: PlacementPreview | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private uidCounter = 1;

  private readonly nearVec = new pc.Vec3();
  private readonly farVec = new pc.Vec3();
  private readonly rayDir = new pc.Vec3();

  private readonly onStateListeners = new Set<() => void>();

  private readonly handleMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerX = e.clientX - rect.left;
    this.pointerY = e.clientY - rect.top;
    this.pointerInside = true;
  };

  private readonly handleMouseLeave = (): void => {
    this.pointerInside = false;
  };

  private readonly handleMouseDown = (e: MouseEvent): void => {
    if (!this.enabled || e.button !== 0 || !this.selectedDef) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointerX = e.clientX - rect.left;
    this.pointerY = e.clientY - rect.top;
    this.pointerInside = true;
    this.updatePreview();
    if (this.currentPreview?.allValid && this.canAffordSelected()) {
      void this.placeFromPreview(this.currentPreview);
    }
  };

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || !this.selectedDef) return;
    if (e.code === 'KeyF' && !e.repeat) {
      this.rotateSelection();
    } else if (e.code === 'Escape' && !e.repeat) {
      this.selectBuilding(null);
    }
  };

  constructor(
    app: pc.AppBase,
    canvas: HTMLCanvasElement,
    camera: pc.Entity,
    terrain: ImpactHeightSampler,
  ) {
    this.app = app;
    this.canvas = canvas;
    this.camera = camera;
    this.terrain = terrain;

    this.entity = new pc.Entity('BaseBuildingsRoot');
    this.previewRoot = new pc.Entity('BuildPreviewRoot');
    this.entity.addChild(this.previewRoot);

    this.materialLibrary = new BuildingMaterialLibrary(app);
    this.validTileMat = createTileMaterial(0.14, 0.92, 0.42, 0.65);
    this.invalidTileMat = createTileMaterial(1.0, 0.18, 0.22, 0.72);

    for (let i = 0; i < MAX_PREVIEW_CELLS; i++) {
      const tile = new pc.Entity(`PreviewTile_${i}`);
      tile.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false });
      tile.setLocalScale(CELL_SIZE * 0.88, 0.45, CELL_SIZE * 0.88);
      tile.enabled = false;
      this.previewRoot.addChild(tile);
      this.tilePool.push(tile);
    }

    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  public onChange(listener: () => void): () => void {
    this.onStateListeners.add(listener);
    return () => this.onStateListeners.delete(listener);
  }

  private emitChange(): void {
    for (const cb of this.onStateListeners) cb();
  }

  public getSelectedDefinition(): BuildingDefinition | null {
    return this.selectedDef;
  }

  public getRotationDeg(): number {
    return this.rotationDeg;
  }

  public getCurrentPreview(): PlacementPreview | null {
    return this.currentPreview;
  }

  public getPlacedCount(): number {
    return this.placedBuildings.length;
  }

  public getPlacedBuildings(): readonly PlacedBuilding[] {
    return this.placedBuildings;
  }

  public getActiveMinerCount(): number {
    let count = 0;
    for (const building of this.placedBuildings) {
      if (building.definitionId === 'machine_plant') {
        count += 1;
      }
    }
    return count;
  }

  public setEconomyHooks(hooks: BuildEconomyHooks | null): void {
    this.economyHooks = hooks;
  }

  public canAffordSelected(): boolean {
    if (!this.selectedDef) return false;
    return this.economyHooks?.canBuild(this.selectedDef.id, this.placedBuildings) ?? true;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hidePreview();
    }
  }

  public getBuildCost(definitionId: string, fallbackCost: number): number {
    return this.economyHooks?.getBuildCost?.(definitionId, this.placedBuildings) ?? fallbackCost;
  }

  public clearPlacedBuildings(): void {
    const children = [...this.entity.children];
    for (const child of children) {
      if (child !== this.previewRoot) {
        child.destroy();
      }
    }
    this.occupiedCells.clear();
    this.placedBuildings.length = 0;
    this.uidCounter = 1;
    this.selectedDef = null;
    this.ghostValidState = null;
    this.hidePreview();
    this.emitChange();
  }

  public getBuildBlockReason(definitionId: string): string | null {
    return this.economyHooks?.getBuildBlockReason?.(definitionId, this.placedBuildings) ?? null;
  }

  public tryPlaceBuilding(): boolean {
    if (!this.enabled || !this.selectedDef || !this.currentPreview?.allValid) return false;
    if (!this.canAffordSelected()) return false;
    void this.placeFromPreview(this.currentPreview);
    return true;
  }

  public selectBuilding(def: BuildingDefinition | null): void {
    if (!this.enabled && def !== null) return;
    if (this.selectedDef?.id === def?.id) {
      this.selectedDef = null;
    } else {
      this.selectedDef = def;
      this.rotationDeg = 0;
    }
    this.ghostValidState = null;

    if (!this.selectedDef) {
      this.hidePreview();
    } else {
      void this.ensureGhostEntity(this.selectedDef);
    }
    this.emitChange();
  }

  public rotateSelection(): void {
    if (!this.enabled || !this.selectedDef) return;
    this.rotationDeg = (this.rotationDeg + 90) % 360;
    this.ghostValidState = null;
    this.updatePreview();
    this.emitChange();
  }

  public update(): void {
    if (!this.enabled || !this.selectedDef || !this.pointerInside) {
      if (!this.enabled || !this.selectedDef) this.hidePreview();
      return;
    }
    this.updatePreview();
  }

  public dispose(): void {
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.validTileMat.destroy();
    this.invalidTileMat.destroy();
    this.materialLibrary.destroy();
    this.entity.destroy();
  }

  private loadGlb(glbFile: string): Promise<pc.ContainerResource> {
    const cached = this.glbCache.get(glbFile);
    if (cached) return Promise.resolve(cached);

    const pending = this.glbPending.get(glbFile);
    if (pending) return pending;

    const promise = new Promise<pc.ContainerResource>((resolve, reject) => {
      this.app.assets.loadFromUrl(`/base/glb/${glbFile}`, 'container', (err, asset) => {
        this.glbPending.delete(glbFile);
        if (err || !asset?.resource) {
          reject(err ?? new Error(`Falha ao carregar ${glbFile}`));
          return;
        }
        const resource = asset.resource as pc.ContainerResource;
        this.glbCache.set(glbFile, resource);
        resolve(resource);
      });
    });

    this.glbPending.set(glbFile, promise);
    return promise;
  }

  private applyBuildingMaterial(root: pc.Entity, defId: string, isGhost: boolean): void {
    this.materialLibrary.applyMaterials(root, defId, isGhost);
  }

  private async ensureGhostEntity(def: BuildingDefinition): Promise<void> {
    if (this.ghostDefId === def.id && this.ghostRoot) return;
    if (this.ghostRoot) {
      this.ghostRoot.destroy();
      this.ghostRoot = null;
    }
    this.ghostDefId = def.id;

    try {
      const container = await this.loadGlb(def.glbFile);
      if (this.selectedDef?.id !== def.id) return;

      const wrapper = this.buildScaledWrapper(container, def, 0, true);
      wrapper.enabled = false;
      this.previewRoot.addChild(wrapper);
      this.ghostRoot = wrapper;
      this.ghostValidState = null;
      this.updatePreview();
    } catch {
      // Ignore transient load error in preview
    }
  }

  private buildScaledWrapper(
    container: pc.ContainerResource,
    def: BuildingDefinition,
    rotationDeg: number,
    isGhost: boolean,
  ): pc.Entity {
    const wrapper = new pc.Entity(isGhost ? `Ghost_${def.id}` : `Building_${def.id}`);
    const model = container.instantiateRenderEntity();
    wrapper.addChild(model);

    this.applyBuildingMaterial(model, def.id, isGhost);

    const box = computeLocalBounds(model);
    if (box) {
      const size = box.halfExtents.clone().mulScalar(2);
      const targetW = def.cols * CELL_SIZE * 0.88;
      const targetD = def.rows * CELL_SIZE * 0.88;
      const sx = size.x > 0.001 ? targetW / size.x : 1;
      const sz = size.z > 0.001 ? targetD / size.z : 1;
      const uniformScale = Math.min(sx, sz);

      model.setLocalScale(uniformScale, uniformScale, uniformScale);
      const minY = box.getMin().y * uniformScale;
      const centerX = box.center.x * uniformScale;
      const centerZ = box.center.z * uniformScale;
      model.setLocalPosition(-centerX, -minY, -centerZ);
    }

    if (isGhost) {
      const renders = model.findComponents('render') as pc.RenderComponent[];
      for (const r of renders) {
        for (const mi of r.meshInstances) {
          const baseMat = mi.material instanceof pc.StandardMaterial ? mi.material : new pc.StandardMaterial();
          const ghostMat = baseMat.clone() as pc.StandardMaterial;
          ghostMat.opacity = 0.62;
          ghostMat.blendType = pc.BLEND_NORMAL;
          ghostMat.depthWrite = false;
          ghostMat.emissiveIntensity = 1.25;
          ghostMat.update();
          mi.material = ghostMat;
        }
      }
    }

    wrapper.setEulerAngles(0, rotationDeg, 0);
    return wrapper;
  }

  private tintGhost(allValid: boolean): void {
    if (!this.ghostRoot || this.ghostValidState === allValid) return;
    this.ghostValidState = allValid;

    const rCol = allValid ? 0.25 : 1.0;
    const gCol = allValid ? 1.0 : 0.22;
    const bCol = allValid ? 0.48 : 0.22;

    const renders = this.ghostRoot.findComponents('render') as pc.RenderComponent[];
    for (const r of renders) {
      for (const mi of r.meshInstances) {
        if (mi.material instanceof pc.StandardMaterial) {
          mi.material.diffuse = new pc.Color(rCol, gCol, bCol);
          mi.material.emissive = new pc.Color(rCol * 0.65, gCol * 0.65, bCol * 0.65);
          mi.material.update();
        }
      }
    }
  }

  private pickTerrainPoint(): Vec3XYZ | null {
    const cam = this.camera.camera;
    if (!cam) return null;

    cam.screenToWorld(this.pointerX, this.pointerY, cam.nearClip, this.nearVec);
    cam.screenToWorld(this.pointerX, this.pointerY, 100, this.farVec);
    this.rayDir.sub2(this.farVec, this.nearVec).normalize();

    if (this.rayDir.y >= -0.02) return null;

    let prevT = 10;
    let prevDiff = this.nearVec.y + this.rayDir.y * prevT - this.terrain.sampleHeightAt(
      this.nearVec.x + this.rayDir.x * prevT,
      this.nearVec.z + this.rayDir.z * prevT,
    );

    for (let t = 35; t <= 3400; t += 26) {
      const px = this.nearVec.x + this.rayDir.x * t;
      const py = this.nearVec.y + this.rayDir.y * t;
      const pz = this.nearVec.z + this.rayDir.z * t;
      const diff = py - this.terrain.sampleHeightAt(px, pz);

      if (diff <= 0 && prevDiff > 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) * 0.5;
          const mx = this.nearVec.x + this.rayDir.x * mid;
          const my = this.nearVec.y + this.rayDir.y * mid;
          const mz = this.nearVec.z + this.rayDir.z * mid;
          if (my - this.terrain.sampleHeightAt(mx, mz) > 0) {
            lo = mid;
          } else {
            hi = mid;
          }
        }
        const hitT = (lo + hi) * 0.5;
        const hx = this.nearVec.x + this.rayDir.x * hitT;
        const hz = this.nearVec.z + this.rayDir.z * hitT;
        return { x: hx, y: this.terrain.sampleHeightAt(hx, hz), z: hz };
      }

      prevT = t;
      prevDiff = diff;
    }

    return null;
  }

  private evaluateFootprint(
    def: BuildingDefinition,
    hit: Vec3XYZ,
    rotationDeg: number,
  ): PlacementPreview {
    const swap = rotationDeg === 90 || rotationDeg === 270;
    const cols = swap ? def.rows : def.cols;
    const rows = swap ? def.cols : def.rows;

    const centerGridX = Math.round(hit.x / CELL_SIZE - cols * 0.5);
    const centerGridZ = Math.round(hit.z / CELL_SIZE - rows * 0.5);

    const cellsMeta: Array<{
      gx: number;
      gz: number;
      cx: number;
      cz: number;
      centerY: number;
      minH: number;
      maxH: number;
    }> = [];

    let sumCenterY = 0;
    const inset = CELL_SIZE * 0.44;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = centerGridX + c;
        const gz = centerGridZ + r;
        const cx = (gx + 0.5) * CELL_SIZE;
        const cz = (gz + 0.5) * CELL_SIZE;

        const hCenter = this.terrain.sampleHeightAt(cx, cz);
        const h1 = this.terrain.sampleHeightAt(cx - inset, cz - inset);
        const h2 = this.terrain.sampleHeightAt(cx + inset, cz - inset);
        const h3 = this.terrain.sampleHeightAt(cx - inset, cz + inset);
        const h4 = this.terrain.sampleHeightAt(cx + inset, cz + inset);

        const minH = Math.min(hCenter, h1, h2, h3, h4);
        const maxH = Math.max(hCenter, h1, h2, h3, h4);

        sumCenterY += hCenter;
        cellsMeta.push({ gx, gz, cx, cz, centerY: hCenter, minH, maxH });
      }
    }

    const baseY = sumCenterY / cellsMeta.length;
    const cells: CellValidation[] = [];
    let allValid = true;

    for (const m of cellsMeta) {
      let reason: CellInvalidReason = 'ok';
      if (Math.abs(m.cx) > WORLD_BUILD_LIMIT || Math.abs(m.cz) > WORLD_BUILD_LIMIT) {
        reason = 'bounds';
      } else if (this.occupiedCells.has(cellKey(m.gx, m.gz))) {
        reason = 'occupied';
      } else if (
        m.maxH - m.minH > MAX_CELL_RELIEF ||
        Math.abs(m.maxH - baseY) > MAX_FOOTPRINT_DELTA ||
        Math.abs(m.minH - baseY) > MAX_FOOTPRINT_DELTA
      ) {
        reason = 'relief';
      }

      const valid = reason === 'ok';
      if (!valid) allValid = false;
      cells.push({
        gx: m.gx,
        gz: m.gz,
        valid,
        reason,
        centerY: m.centerY,
      });
    }

    return {
      definition: def,
      gridX: centerGridX,
      gridZ: centerGridZ,
      cols,
      rows,
      rotationDeg,
      allValid,
      cells,
      baseY,
    };
  }

  private updatePreview(): void {
    if (!this.selectedDef) {
      this.hidePreview();
      return;
    }

    const hit = this.pickTerrainPoint();
    if (!hit) {
      this.hidePreview();
      return;
    }

    const preview = this.evaluateFootprint(this.selectedDef, hit, this.rotationDeg);
    this.currentPreview = preview;

    for (let i = 0; i < this.tilePool.length; i++) {
      const tile = this.tilePool[i];
      if (i < preview.cells.length) {
        const cell = preview.cells[i];
        const cx = (cell.gx + 0.5) * CELL_SIZE;
        const cz = (cell.gz + 0.5) * CELL_SIZE;
        tile.enabled = true;
        tile.setPosition(cx, cell.centerY + 0.45, cz);
        const mi = tile.render?.meshInstances[0];
        if (mi) {
          mi.material = cell.valid ? this.validTileMat : this.invalidTileMat;
        }
      } else {
        tile.enabled = false;
      }
    }

    if (this.ghostRoot) {
      const centerX = (preview.gridX + preview.cols * 0.5) * CELL_SIZE;
      const centerZ = (preview.gridZ + preview.rows * 0.5) * CELL_SIZE;
      this.ghostRoot.enabled = true;
      this.ghostRoot.setPosition(centerX, preview.baseY + 0.6, centerZ);
      this.ghostRoot.setEulerAngles(0, preview.rotationDeg, 0);
      this.tintGhost(preview.allValid && this.canAffordSelected());
    }
  }

  private hidePreview(): void {
    this.currentPreview = null;
    for (const tile of this.tilePool) {
      tile.enabled = false;
    }
    if (this.ghostRoot) {
      this.ghostRoot.enabled = false;
    }
  }

  private async placeFromPreview(preview: PlacementPreview): Promise<void> {
    if (
      this.economyHooks &&
      !this.economyHooks.canBuild(preview.definition.id, this.placedBuildings)
    ) {
      return;
    }

    for (const cell of preview.cells) {
      if (!cell.valid || this.occupiedCells.has(cellKey(cell.gx, cell.gz))) {
        return;
      }
    }

    for (const cell of preview.cells) {
      this.occupiedCells.add(cellKey(cell.gx, cell.gz));
    }

    const centerX = (preview.gridX + preview.cols * 0.5) * CELL_SIZE;
    const centerZ = (preview.gridZ + preview.rows * 0.5) * CELL_SIZE;
    let minCellY = preview.baseY;
    for (const cell of preview.cells) {
      if (cell.centerY < minCellY) minCellY = cell.centerY;
    }

    try {
      const container = await this.loadGlb(preview.definition.glbFile);

      if (
        this.economyHooks &&
        !this.economyHooks.tryPayForBuilding(preview.definition.id, this.placedBuildings)
      ) {
        for (const cell of preview.cells) {
          this.occupiedCells.delete(cellKey(cell.gx, cell.gz));
        }
        return;
      }

      const buildingEntity = this.buildScaledWrapper(
        container,
        preview.definition,
        preview.rotationDeg,
        false,
      );
      const seatY = Math.min(preview.baseY, minCellY + 0.35) - 0.35;
      buildingEntity.setPosition(centerX, seatY, centerZ);
      this.entity.addChild(buildingEntity);

      const placed: PlacedBuilding = {
        uid: `bld_${this.uidCounter++}`,
        definitionId: preview.definition.id,
        gridX: preview.gridX,
        gridZ: preview.gridZ,
        cols: preview.cols,
        rows: preview.rows,
        rotationDeg: preview.rotationDeg,
        worldCenter: { x: centerX, y: preview.baseY, z: centerZ },
      };
      this.placedBuildings.push(placed);
      this.emitChange();
    } catch {
      // Roll back cell reservation if asset load fails
      for (const cell of preview.cells) {
        this.occupiedCells.delete(cellKey(cell.gx, cell.gz));
      }
    }
  }
}
