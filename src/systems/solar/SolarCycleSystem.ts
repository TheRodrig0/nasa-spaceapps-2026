import * as pc from 'playcanvas';
import type { SolarCycleState, SolarPhase, Vec3XYZ } from '../../types/index.ts';

export const SOL_DURATION_SEC = 48;
export const TARGET_SOLS = 10;

const SUN_DISTANCE = 850;

// Color keyframes
const COLOR_DAY_SUN = new pc.Color(1.0, 0.88, 0.76);
const COLOR_DAY_AMBIENT = new pc.Color(0.44, 0.26, 0.20);

const COLOR_DUSK_MID_SUN = new pc.Color(1.0, 0.46, 0.18);
const COLOR_DUSK_MID_AMBIENT = new pc.Color(0.32, 0.18, 0.18);

const COLOR_NIGHT_SUN = new pc.Color(0.40, 0.52, 0.75);
const COLOR_NIGHT_AMBIENT = new pc.Color(0.18, 0.16, 0.22);

const COLOR_DAWN_MID_SUN = new pc.Color(1.0, 0.56, 0.28);
const COLOR_DAWN_MID_AMBIENT = new pc.Color(0.30, 0.20, 0.21);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(out: pc.Color, a: pc.Color, b: pc.Color, t: number): pc.Color {
  out.r = lerp(a.r, b.r, t);
  out.g = lerp(a.g, b.g, t);
  out.b = lerp(a.b, b.b, t);
  out.a = 1.0;
  return out;
}

export class SolarCycleSystem {
  public readonly solDurationSec: number;
  public readonly targetSols: number;

  private readonly app: pc.AppBase;
  private readonly sunLight: pc.Entity;

  private elapsedSec = 0;

  // Scratch objects to avoid GC per frame
  private readonly currentSunColor = new pc.Color();
  private readonly currentAmbientColor = new pc.Color();

  constructor(
    app: pc.AppBase,
    sunLight: pc.Entity,
    options?: { solDurationSec?: number; targetSols?: number },
  ) {
    this.app = app;
    this.sunLight = sunLight;
    this.solDurationSec = options?.solDurationSec ?? SOL_DURATION_SEC;
    this.targetSols = options?.targetSols ?? TARGET_SOLS;

    this.updateVisuals(0, undefined);
  }

  public reset(): void {
    this.elapsedSec = 0;
    this.updateVisuals(0, undefined);
  }

  public getElapsedTotalSec(): number {
    return this.elapsedSec;
  }

  public getState(): SolarCycleState {
    const rawProgress = (this.elapsedSec % this.solDurationSec) / this.solDurationSec;
    const completed = this.elapsedSec >= this.targetSols * this.solDurationSec;
    const rawSolIndex = Math.floor(this.elapsedSec / this.solDurationSec) + 1;
    const solIndex = Math.min(this.targetSols, rawSolIndex);
    const solProgress = completed ? 1.0 : rawProgress;

    const phase = this.evaluatePhase(rawProgress);
    const sunEfficiency = this.evaluateEfficiency(phase, rawProgress);

    return {
      solIndex,
      targetSols: this.targetSols,
      solProgress,
      phase,
      sunEfficiency,
      completed,
    };
  }

  public update(dt: number, focusTarget?: Vec3XYZ): SolarCycleState {
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.elapsedSec += safeDt;

    const cycleProgress = (this.elapsedSec % this.solDurationSec) / this.solDurationSec;
    const completed = this.elapsedSec >= this.targetSols * this.solDurationSec;
    const rawSolIndex = Math.floor(this.elapsedSec / this.solDurationSec) + 1;
    const solIndex = Math.min(this.targetSols, rawSolIndex);
    const solProgress = completed ? 1.0 : cycleProgress;

    const phase = this.evaluatePhase(cycleProgress);
    const sunEfficiency = this.evaluateEfficiency(phase, cycleProgress);

    this.updateVisuals(cycleProgress, focusTarget);

    return {
      solIndex,
      targetSols: this.targetSols,
      solProgress,
      phase,
      sunEfficiency,
      completed,
    };
  }

  private evaluatePhase(progress: number): SolarPhase {
    if (progress >= 0.08 && progress < 0.58) {
      return 'day';
    }
    if (progress >= 0.58 && progress < 0.70) {
      return 'dusk';
    }
    if (progress >= 0.70 && progress < 0.92) {
      return 'night';
    }
    return 'dawn';
  }

  private evaluateEfficiency(phase: SolarPhase, progress: number): number {
    switch (phase) {
      case 'day':
        return 1.0;
      case 'dusk': {
        const t = clamp((progress - 0.58) / 0.12, 0, 1);
        return 1.0 - t;
      }
      case 'night':
        return 0.0;
      case 'dawn': {
        const dawnT = progress >= 0.92 ? (progress - 0.92) / 0.16 : (progress + 0.08) / 0.16;
        return clamp(dawnT, 0, 1);
      }
    }
  }

  private updateVisuals(progress: number, focusTarget?: Vec3XYZ): void {
    let pitch = 45;
    let yaw = 35;
    let intensity = 1.75;

    if (progress >= 0.08 && progress < 0.58) {
      // Day (0.08..0.58): warm Martian daylight (~1.75 intensity)
      const dayT = (progress - 0.08) / 0.50;
      pitch = 24 + 30 * Math.sin(dayT * Math.PI);
      yaw = 25 + 75 * dayT;
      intensity = 1.75;

      this.currentSunColor.copy(COLOR_DAY_SUN);
      this.currentAmbientColor.copy(COLOR_DAY_AMBIENT);
    } else if (progress >= 0.58 && progress < 0.70) {
      // Dusk (0.58..0.70): golden-amber sunset transitioning to cool slate-blue
      const duskT = clamp((progress - 0.58) / 0.12, 0, 1);
      pitch = 24 - 8 * duskT;
      yaw = 100 + 40 * duskT;
      intensity = lerp(1.75, 0.35, duskT);

      if (duskT < 0.5) {
        const tHalf = duskT / 0.5;
        lerpColor(this.currentSunColor, COLOR_DAY_SUN, COLOR_DUSK_MID_SUN, tHalf);
        lerpColor(this.currentAmbientColor, COLOR_DAY_AMBIENT, COLOR_DUSK_MID_AMBIENT, tHalf);
      } else {
        const tHalf = (duskT - 0.5) / 0.5;
        lerpColor(this.currentSunColor, COLOR_DUSK_MID_SUN, COLOR_NIGHT_SUN, tHalf);
        lerpColor(this.currentAmbientColor, COLOR_DUSK_MID_AMBIENT, COLOR_NIGHT_AMBIENT, tHalf);
      }
    } else if (progress >= 0.70 && progress < 0.92) {
      // Night (0.70..0.92): cool readable Martian night (~0.35 intensity)
      const nightT = (progress - 0.70) / 0.22;
      pitch = 34 + 4 * Math.sin(nightT * Math.PI);
      yaw = 140 + 80 * nightT;
      intensity = 0.35;

      this.currentSunColor.copy(COLOR_NIGHT_SUN);
      this.currentAmbientColor.copy(COLOR_NIGHT_AMBIENT);
    } else {
      // Dawn (0.92..1.00 & 0.00..0.08): warm sunrise transitioning from cool slate-blue
      const dawnT = progress >= 0.92 ? (progress - 0.92) / 0.16 : (progress + 0.08) / 0.16;
      const clampedDawnT = clamp(dawnT, 0, 1);
      pitch = lerp(34, 24, clampedDawnT);
      yaw = (220 + 165 * clampedDawnT) % 360;
      intensity = lerp(0.35, 1.75, clampedDawnT);

      if (clampedDawnT < 0.5) {
        const tHalf = clampedDawnT / 0.5;
        lerpColor(this.currentSunColor, COLOR_NIGHT_SUN, COLOR_DAWN_MID_SUN, tHalf);
        lerpColor(this.currentAmbientColor, COLOR_NIGHT_AMBIENT, COLOR_DAWN_MID_AMBIENT, tHalf);
      } else {
        const tHalf = (clampedDawnT - 0.5) / 0.5;
        lerpColor(this.currentSunColor, COLOR_DAWN_MID_SUN, COLOR_DAY_SUN, tHalf);
        lerpColor(this.currentAmbientColor, COLOR_DAWN_MID_AMBIENT, COLOR_DAY_AMBIENT, tHalf);
      }
    }

    const light = this.sunLight.light;
    if (light) {
      light.color = this.currentSunColor;
      light.intensity = intensity;
    }
    this.app.scene.ambientLight = this.currentAmbientColor;

    const radPitch = pitch * (Math.PI / 180);
    const radYaw = yaw * (Math.PI / 180);
    const tx = focusTarget?.x ?? 0;
    const ty = focusTarget?.y ?? 0;
    const tz = focusTarget?.z ?? 0;

    const lx = tx + Math.sin(radYaw) * Math.cos(radPitch) * SUN_DISTANCE;
    const ly = ty + Math.sin(radPitch) * SUN_DISTANCE;
    const lz = tz + Math.cos(radYaw) * Math.cos(radPitch) * SUN_DISTANCE;

    this.sunLight.setPosition(lx, ly, lz);
    this.sunLight.setEulerAngles(pitch, yaw, 0);
  }
}
