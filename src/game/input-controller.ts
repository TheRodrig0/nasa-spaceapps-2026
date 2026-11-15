import type { Entity } from 'playcanvas';
import type { GameState, IsometricCameraConfig, Vec3XYZ } from '../types/index.ts';

const DEFAULT_YAW = 45;
const DEFAULT_PITCH = -42;
const MIN_PITCH = -70;
const MAX_PITCH = -25;
const MIN_DISTANCE = 140;
const MAX_DISTANCE = 1500;
const DEFAULT_DISTANCE = 720;
const BASE_PAN_SPEED = 240;
const KEY_ROTATE_SPEED = 85;
const DRAG_ORBIT_SENSITIVITY = 0.22;
const TURBO_MULTIPLIER = 2.4;
const DEFAULT_WORLD_LIMIT = 2600;
const MIN_CAMERA_TERRAIN_CLEARANCE = 14;

const FOCUS_DAMPING = 12;
const ZOOM_DAMPING = 10;
const ROTATION_DAMPING = 14;
const ELEVATION_DAMPING = 10;

/**
 * 3D Tactical Isometric Camera Controller for Mars base building.
 *
 * Features:
 * - Low-distortion isometric framing (pitch ~ -42°, yaw ~ 45°).
 * - Smooth WASD / Arrow keys panning along camera's ground projection.
 * - Proportional mouse wheel zoom (140m close inspect to 1500m tactical map).
 * - Smooth yaw rotation (Q / E or Right-click drag orbit).
 * - Middle-drag or Shift/Ctrl+Right-drag map panning with visible cursor (no pointer lock).
 * - Terrain elevation tracking at focus point + mountain anti-clipping clearance.
 * - R triggers meteor strike at current camera ground focus point.
 */
export class IsometricCameraController {
  private readonly canvas: HTMLCanvasElement;
  private readonly target: Window;
  private readonly onResetImpact?: () => void;
  private readonly defaultHeightSampler?: (x: number, z: number) => number;
  private readonly keysDown = new Set<string>();

  private readonly minPitch: number;
  private readonly maxPitch: number;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly basePanSpeed: number;
  private readonly keyRotateSpeed: number;
  private readonly worldLimit: number;

  private targetFocusX: number;
  private targetFocusZ: number;
  private currentFocusX: number;
  private currentFocusY: number;
  private currentFocusZ: number;

  private targetDistance: number;
  private currentDistance: number;

  private targetYaw: number;
  private currentYaw: number;
  private targetPitch: number;
  private currentPitch: number;

  private isMiddleDragging = false;
  private isRightDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private resetRequested = false;
  private disposed = false;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.keysDown.add(event.code);
    if (event.code === 'KeyR' && !event.repeat) {
      this.resetRequested = true;
      this.onResetImpact?.();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code);
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 1) {
      this.isMiddleDragging = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      event.preventDefault();
    } else if (event.button === 2) {
      this.isRightDragging = true;
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
      event.preventDefault();
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 1) {
      this.isMiddleDragging = false;
    } else if (event.button === 2) {
      this.isRightDragging = false;
    }
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isMiddleDragging && !this.isRightDragging) {
      return;
    }

    const dx = event.clientX - this.lastMouseX;
    const dy = event.clientY - this.lastMouseY;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;

    if (this.isMiddleDragging || (this.isRightDragging && (event.shiftKey || event.ctrlKey))) {
      const yawRad = this.currentYaw * (Math.PI / 180);
      const sinYaw = Math.sin(yawRad);
      const cosYaw = Math.cos(yawRad);
      const gForwardX = -sinYaw;
      const gForwardZ = -cosYaw;
      const rightX = cosYaw;
      const rightZ = -sinYaw;

      const dragFactor = (this.currentDistance / Math.max(300, window.innerHeight)) * 1.5;
      this.targetFocusX -= (rightX * dx - gForwardX * dy) * dragFactor;
      this.targetFocusZ -= (rightZ * dx - gForwardZ * dy) * dragFactor;
      this.clampFocusTarget();
    } else if (this.isRightDragging) {
      this.targetYaw += dx * DRAG_ORBIT_SENSITIVITY;
      this.targetPitch = Math.max(
        this.minPitch,
        Math.min(this.maxPitch, this.targetPitch - dy * DRAG_ORBIT_SENSITIVITY),
      );
    }
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const zoomRatio = event.deltaY > 0 ? 1.15 : 0.87;
    this.targetDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.targetDistance * zoomRatio),
    );
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly handleBlur = (): void => {
    this.clear();
  };

  constructor(
    canvas: HTMLCanvasElement,
    target: Window = window,
    onResetImpact?: () => void,
    defaultHeightSampler?: (x: number, z: number) => number,
    initialFocus?: { x: number; y?: number; z: number },
    initialDistance = DEFAULT_DISTANCE,
    initialYaw = DEFAULT_YAW,
    initialPitch = DEFAULT_PITCH,
    config?: IsometricCameraConfig,
  ) {
    this.canvas = canvas;
    this.target = target;
    this.onResetImpact = onResetImpact;
    this.defaultHeightSampler = defaultHeightSampler;

    this.minPitch = config?.minPitch ?? MIN_PITCH;
    this.maxPitch = config?.maxPitch ?? MAX_PITCH;
    this.minDistance = config?.minDistance ?? MIN_DISTANCE;
    this.maxDistance = config?.maxDistance ?? MAX_DISTANCE;
    this.basePanSpeed = config?.panSpeed ?? BASE_PAN_SPEED;
    this.keyRotateSpeed = config?.rotateSpeed ?? KEY_ROTATE_SPEED;
    this.worldLimit = config?.worldLimit ?? DEFAULT_WORLD_LIMIT;

    const startX = initialFocus?.x ?? 0;
    const startZ = initialFocus?.z ?? -110;
    const startY = initialFocus?.y ?? (defaultHeightSampler ? defaultHeightSampler(startX, startZ) : 0);

    this.targetFocusX = startX;
    this.targetFocusZ = startZ;
    this.currentFocusX = startX;
    this.currentFocusY = startY;
    this.currentFocusZ = startZ;

    const startDist = Math.max(this.minDistance, Math.min(this.maxDistance, initialDistance));
    this.targetDistance = startDist;
    this.currentDistance = startDist;

    const startYaw = initialYaw;
    this.targetYaw = startYaw;
    this.currentYaw = startYaw;

    const startPitch = Math.max(this.minPitch, Math.min(this.maxPitch, initialPitch));
    this.targetPitch = startPitch;
    this.currentPitch = startPitch;

    this.target.addEventListener('keydown', this.handleKeyDown);
    this.target.addEventListener('keyup', this.handleKeyUp);
    this.target.addEventListener('mouseup', this.handleMouseUp);
    this.target.addEventListener('mousemove', this.handleMouseMove);
    this.target.addEventListener('blur', this.handleBlur);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  public consumeImpactReset(): boolean {
    const requested = this.resetRequested;
    this.resetRequested = false;
    return requested;
  }

  public getFocus(): Vec3XYZ {
    return {
      x: this.currentFocusX,
      y: this.currentFocusY,
      z: this.currentFocusZ,
    };
  }

  public getDistance(): number {
    return this.currentDistance;
  }

  public setFocus(x: number, z: number, y?: number, snap = false): void {
    this.targetFocusX = x;
    this.targetFocusZ = z;
    this.clampFocusTarget();
    if (snap) {
      this.currentFocusX = this.targetFocusX;
      this.currentFocusZ = this.targetFocusZ;
      if (y !== undefined) {
        this.currentFocusY = y;
      }
    }
  }

  public setDistance(dist: number, snap = false): void {
    this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, dist));
    if (snap) {
      this.currentDistance = this.targetDistance;
    }
  }

  public setAngles(yaw: number, pitch: number, snap = false): void {
    this.targetYaw = yaw;
    this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, pitch));
    if (snap) {
      this.currentYaw = this.targetYaw;
      this.currentPitch = this.targetPitch;
    }
  }

  private clampFocusTarget(): void {
    this.targetFocusX = Math.max(-this.worldLimit, Math.min(this.worldLimit, this.targetFocusX));
    this.targetFocusZ = Math.max(-this.worldLimit, Math.min(this.worldLimit, this.targetFocusZ));
  }

  public update(
    dt: number,
    state: GameState,
    camera: Entity,
    heightSampler?: (x: number, z: number) => number,
  ): void {
    const sampler = heightSampler ?? this.defaultHeightSampler;

    // 1. Process keyboard orbit (Q / E)
    if (this.keysDown.has('KeyQ')) {
      this.targetYaw += this.keyRotateSpeed * dt;
    }
    if (this.keysDown.has('KeyE')) {
      this.targetYaw -= this.keyRotateSpeed * dt;
    }

    // 2. Process keyboard pan (WASD / Arrows)
    let forwardAxis = 0;
    let rightAxis = 0;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) forwardAxis += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) forwardAxis -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) rightAxis += 1;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) rightAxis -= 1;

    // Optional keyboard zoom (PageUp / PageDown / Equal / Minus)
    if (this.keysDown.has('PageUp') || this.keysDown.has('Equal') || this.keysDown.has('NumpadAdd')) {
      this.targetDistance = Math.max(this.minDistance, this.targetDistance * (1 - 1.2 * dt));
    }
    if (this.keysDown.has('PageDown') || this.keysDown.has('Minus') || this.keysDown.has('NumpadSubtract')) {
      this.targetDistance = Math.min(this.maxDistance, this.targetDistance * (1 + 1.2 * dt));
    }

    if (forwardAxis !== 0 || rightAxis !== 0) {
      const yawRad = this.currentYaw * (Math.PI / 180);
      const sinYaw = Math.sin(yawRad);
      const cosYaw = Math.cos(yawRad);
      const gForwardX = -sinYaw;
      const gForwardZ = -cosYaw;
      const rightX = cosYaw;
      const rightZ = -sinYaw;

      const len = Math.hypot(forwardAxis, rightAxis);
      const normF = forwardAxis / len;
      const normR = rightAxis / len;

      const isBoost = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
      const boostMultiplier = isBoost ? TURBO_MULTIPLIER : 1;
      const zoomRatio = this.currentDistance / DEFAULT_DISTANCE;
      const currentPanSpeed = this.basePanSpeed * zoomRatio * boostMultiplier;
      const step = currentPanSpeed * dt;

      this.targetFocusX += (gForwardX * normF + rightX * normR) * step;
      this.targetFocusZ += (gForwardZ * normF + rightZ * normR) * step;
      this.clampFocusTarget();
    }

    // 3. Smooth Damping (framerate-independent)
    const focusAlpha = 1 - Math.exp(-FOCUS_DAMPING * dt);
    this.currentFocusX += (this.targetFocusX - this.currentFocusX) * focusAlpha;
    this.currentFocusZ += (this.targetFocusZ - this.currentFocusZ) * focusAlpha;

    const zoomAlpha = 1 - Math.exp(-ZOOM_DAMPING * dt);
    this.currentDistance += (this.targetDistance - this.currentDistance) * zoomAlpha;

    const rotAlpha = 1 - Math.exp(-ROTATION_DAMPING * dt);
    this.currentYaw += (this.targetYaw - this.currentYaw) * rotAlpha;
    this.currentPitch += (this.targetPitch - this.currentPitch) * rotAlpha;

    // 4. Terrain Height Tracking at focus point
    const groundY = sampler ? sampler(this.currentFocusX, this.currentFocusZ) : 0;
    const elevAlpha = 1 - Math.exp(-ELEVATION_DAMPING * dt);
    this.currentFocusY += (groundY - this.currentFocusY) * elevAlpha;

    // 5. Update Camera Entity Orientation
    camera.setEulerAngles(this.currentPitch, this.currentYaw, 0);

    // 6. Compute 3D Camera Position from Focus Target
    const pitchRad = this.currentPitch * (Math.PI / 180);
    const yawRad = this.currentYaw * (Math.PI / 180);
    const cosPitch = Math.cos(pitchRad);
    const sinPitch = Math.sin(pitchRad);
    const cosYaw = Math.cos(yawRad);
    const sinYaw = Math.sin(yawRad);

    const fX = -sinYaw * cosPitch;
    const fY = sinPitch;
    const fZ = -cosYaw * cosPitch;

    let camX = this.currentFocusX - fX * this.currentDistance;
    let camY = this.currentFocusY - fY * this.currentDistance;
    let camZ = this.currentFocusZ - fZ * this.currentDistance;

    // 7. Ground Clearance Clamp: Camera never clips into Mars mountains or crater rims
    if (sampler) {
      const camTerrainY = sampler(camX, camZ);
      const minSafeY = camTerrainY + MIN_CAMERA_TERRAIN_CLEARANCE;
      if (camY < minSafeY) {
        camY = minSafeY;
      }
    }

    // 8. Sync state
    state.cameraPos.x = camX;
    state.cameraPos.y = camY;
    state.cameraPos.z = camZ;
    state.yaw = this.currentYaw;
    state.pitch = this.currentPitch;
    if (!state.focusTarget) {
      state.focusTarget = { x: this.currentFocusX, y: this.currentFocusY, z: this.currentFocusZ };
    } else {
      state.focusTarget.x = this.currentFocusX;
      state.focusTarget.y = this.currentFocusY;
      state.focusTarget.z = this.currentFocusZ;
    }
    state.cameraDistance = this.currentDistance;
  }

  public clear(): void {
    this.keysDown.clear();
    this.isMiddleDragging = false;
    this.isRightDragging = false;
    this.resetRequested = false;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.target.removeEventListener('mouseup', this.handleMouseUp);
    this.target.removeEventListener('mousemove', this.handleMouseMove);
    this.target.removeEventListener('blur', this.handleBlur);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.clear();
  }
}
