// MISSÕES: Atalho de teclado para executar a ação de campo ao alcance.

import * as pc from 'playcanvas';
import { InputEvent, VolcanicEvent, type VolcanicStatus } from './events/worldEvents.ts';
import { MISSION_CONFIG } from './missionConfig.ts';

export class InputSystem {
  private app: pc.Application;
  private keys: Record<string, boolean> = {};
  private isOrbiting = false;
  private isPanning = false;
  private lastX = 0;
  private lastY = 0;
  private phase: VolcanicStatus['phase'] = 'preparation';
  private pendingTime = 0;
  private discardNextDelta = false;

  private readonly keyDownHandler: (e: KeyboardEvent) => void;
  private readonly keyUpHandler: (e: KeyboardEvent) => void;
  private readonly onUpdateHandler: (dt: number) => void;

  constructor(app: pc.Application) {
    this.app = app;

    if (this.app.mouse) {
      this.app.mouse.disableContextMenu();
      this.app.mouse.on(pc.EVENT_MOUSEDOWN, (e: pc.MouseEvent) => {
        if (e.button === pc.MOUSEBUTTON_LEFT) this.isOrbiting = true;
        if (e.button === pc.MOUSEBUTTON_RIGHT || e.button === pc.MOUSEBUTTON_MIDDLE) {
          this.isPanning = true;
        }
        this.lastX = e.x;
        this.lastY = e.y;
      });

      this.app.mouse.on(pc.EVENT_MOUSEUP, () => {
        this.isOrbiting = false;
        this.isPanning = false;
      });

      this.app.mouse.on(pc.EVENT_MOUSEMOVE, (e: pc.MouseEvent) => {
        const dx = e.x - this.lastX;
        const dy = e.y - this.lastY;
        this.lastX = e.x;
        this.lastY = e.y;

        if (this.isOrbiting) {
          this.app.fire(InputEvent.ORBIT, { dx, dy });
        } else if (this.isPanning) {
          this.app.fire(InputEvent.PAN, { dx, dy });
        }
      });

      this.app.mouse.on(pc.EVENT_MOUSEWHEEL, (e: pc.MouseEvent) => {
        const wheelDelta =
          typeof e.wheelDelta === 'number'
            ? e.wheelDelta
            : ((e as unknown as { wheel?: number }).wheel ?? 0);
        this.app.fire(InputEvent.ZOOM, { wheelDelta });
      });
    }

    this.keyDownHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && this.phase === 'operation') {
        this.app.fire(VolcanicEvent.PAUSE);
      }
      if (this.phase !== 'operation') return;
      if (e.code === 'KeyC' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!e.repeat) this.app.fire(VolcanicEvent.COMPLETE_OBJECTIVE);
        return;
      }
      this.keys[e.code] = true;
      if (
        !e.repeat &&
        (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'KeyB') &&
        document.activeElement?.tagName !== 'BUTTON' &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        e.preventDefault();
        this.app.fire(InputEvent.ACTION_INTERACT);
      }
    };

    this.keyUpHandler = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };

    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    window.addEventListener('blur', this.pauseOnBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChanged);
    this.app.on(VolcanicEvent.STATUS_CHANGED, this.onStatusChanged, this);

    this.onUpdateHandler = (dt: number) => {
      if (this.phase !== 'operation') return;
      if (this.discardNextDelta) {
        this.discardNextDelta = false;
        return;
      }
      this.pendingTime += dt;
      const step = MISSION_CONFIG.stepSeconds;
      while (this.phase === 'operation' && this.pendingTime + 1e-9 >= step) {
        this.pendingTime -= step;
        this.emitFrameAxes(step);
      }
    };
    this.app.on('update', this.onUpdateHandler, this);
  }

  private onStatusChanged(status: VolcanicStatus): void {
    if (this.phase === status.phase) return;
    this.phase = status.phase;
    this.discardNextDelta = this.phase === 'operation';
    this.keys = {};
    if (this.phase === 'ended') this.pendingTime = 0;
  }

  private pauseOnBlur = (): void => {
    this.isOrbiting = false;
    this.isPanning = false;
    this.app.fire(VolcanicEvent.PAUSE);
  };

  private onVisibilityChanged = (): void => {
    if (document.hidden) this.pauseOnBlur();
  };

  private isKeyPressed(code: string): boolean {
    return Boolean(this.keys[code]);
  }

  private emitFrameAxes(dt: number): void {
    let forward = 0;
    let right = 0;
    if (this.isKeyPressed('KeyW') || this.isKeyPressed('ArrowUp')) forward += 1;
    if (this.isKeyPressed('KeyS') || this.isKeyPressed('ArrowDown')) forward -= 1;
    if (this.isKeyPressed('KeyD') || this.isKeyPressed('ArrowRight')) right += 1;
    if (this.isKeyPressed('KeyA') || this.isKeyPressed('ArrowLeft')) right -= 1;

    const shiftBoost = this.isKeyPressed('ShiftLeft') || this.isKeyPressed('ShiftRight');

    this.app.fire(InputEvent.AXES, {
      forward,
      right,
      active: forward !== 0 || right !== 0,
      shiftBoost,
      dt,
    });
  }

  public destroy(): void {
    this.app.off('update', this.onUpdateHandler, this);
    this.app.off(VolcanicEvent.STATUS_CHANGED, this.onStatusChanged, this);
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    window.removeEventListener('blur', this.pauseOnBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChanged);
  }
}
