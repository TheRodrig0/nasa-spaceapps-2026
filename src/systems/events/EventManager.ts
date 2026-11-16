import type {
  ActiveEventInfo,
  EventStepResult,
  EventUpdateContext,
  WorldEventHandler,
  WorldEventPhase,
  WorldEventType,
} from '../../types/index.ts';

/**
 * Configuration options for the EventManager lifecycle.
 */
export interface EventManagerOptions {
  /** Minimum random cooldown in seconds before the next event triggers (default: 22). */
  minCooldownSec?: number;
  /** Maximum random cooldown in seconds before the next event triggers (default: 38). */
  maxCooldownSec?: number;
  /** Initial cooldown override in seconds. Defaults to a random duration between min and max. */
  initialCooldownSec?: number;
}

const DEFAULT_MIN_COOLDOWN_SEC = 22;
const DEFAULT_MAX_COOLDOWN_SEC = 38;

/**
 * Central event manager orchestrating world disaster events (meteor showers, tornadoes,
 * electric storms) across cooldown, warning, and active phases.
 */
export class EventManager {
  private minCooldownSec: number;
  private maxCooldownSec: number;
  private readonly handlers = new Map<WorldEventType, WorldEventHandler>();

  private phase: WorldEventPhase = 'cooldown';
  private phaseElapsed = 0;
  private phaseDuration = 0;
  private cooldownRemaining = 0;
  private currentHandler: WorldEventHandler | null = null;
  private lastEventType: WorldEventType | null = null;

  constructor(options: EventManagerOptions = {}) {
    this.minCooldownSec = Math.max(0, options.minCooldownSec ?? DEFAULT_MIN_COOLDOWN_SEC);
    this.maxCooldownSec = Math.max(
      this.minCooldownSec,
      options.maxCooldownSec ?? DEFAULT_MAX_COOLDOWN_SEC,
    );
    this.cooldownRemaining = options.initialCooldownSec ?? this.randomCooldown();
  }

  /**
   * Registers an event handler for a specific world event type.
   */
  public registerHandler(handler: WorldEventHandler): void {
    this.handlers.set(handler.type, handler);
  }

  /**
   * Retrieves a registered handler by event type.
   */
  public getHandler(type: WorldEventType): WorldEventHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Returns all registered event types.
   */
  public getRegisteredTypes(): WorldEventType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Current lifecycle phase ('cooldown' | 'warning' | 'active').
   */
  public getCurrentPhase(): WorldEventPhase {
    return this.phase;
  }

  /**
   * Returns remaining cooldown in seconds, or 0 if currently in warning or active phase.
   */
  public getCooldownRemaining(): number {
    return this.phase === 'cooldown' ? Math.max(0, this.cooldownRemaining) : 0;
  }

  /**
   * Retrieves active event info if an event is currently in warning or active phase.
   */
  public getActiveEvent(): ActiveEventInfo | null {
    if (this.phase === 'cooldown' || !this.currentHandler) {
      return null;
    }

    const remainingSec = Math.max(0, this.phaseDuration - this.phaseElapsed);
    return {
      type: this.currentHandler.type,
      label: this.currentHandler.label,
      phase: this.phase,
      remainingSec,
      totalSec: this.phaseDuration,
    };
  }

  /**
   * Manually or debug triggers an event of the specified type.
   * Cancels any running event.
   *
   * @param type Event type to trigger.
   * @param ctx Execution context.
   * @param skipWarning If true, starts directly in the active phase.
   * @returns true if handler was found and started, false otherwise.
   */
  public triggerEvent(
    type: WorldEventType,
    ctx: EventUpdateContext,
    skipWarning = false,
  ): boolean {
    const handler = this.handlers.get(type);
    if (!handler) {
      return false;
    }
    this.startHandler(handler, ctx, skipWarning);
    return true;
  }

  /**
   * Manually triggers a random registered event (avoiding repetition if possible).
   */
  public triggerRandomEvent(
    ctx: EventUpdateContext,
    skipWarning = false,
  ): boolean {
    const handler = this.pickRandomHandler();
    if (!handler) {
      return false;
    }
    this.startHandler(handler, ctx, skipWarning);
    return true;
  }

  /**
   * Stops any currently active event and resets state to cooldown.
   */
  public stopCurrentEvent(): void {
    if (this.currentHandler) {
      this.currentHandler.stop();
      this.currentHandler = null;
    }
    this.phase = 'cooldown';
    this.phaseElapsed = 0;
    this.phaseDuration = 0;
    this.cooldownRemaining = this.randomCooldown();
  }

  public setCooldownRange(minSec: number, maxSec: number): void {
    this.minCooldownSec = Math.max(2, minSec);
    this.maxCooldownSec = Math.max(this.minCooldownSec, maxSec);
    if (this.phase === 'cooldown') {
      this.cooldownRemaining = Math.min(this.cooldownRemaining, this.maxCooldownSec);
    }
  }

  public reset(): void {
    this.lastEventType = null;
    this.stopCurrentEvent();
  }

  /**
   * Ticks the event manager, updating active/warning events or advancing cooldown.
   *
   * @param dt Frame delta time in seconds.
   * @param ctx World context for height queries and building references.
   */
  public update(dt: number, ctx: EventUpdateContext): EventStepResult {
    if (!Number.isFinite(dt) || dt <= 0) {
      return {
        damageThisFrame: 0,
        productionMultiplier: 1.0,
        shakeOffset: { x: 0, y: 0, z: 0 },
        buildingsHitThisFrame: 0,
        activeEvent: this.getActiveEvent(),
      };
    }

    // Cooldown lifecycle
    if (this.phase === 'cooldown') {
      this.cooldownRemaining -= dt;
      if (this.cooldownRemaining <= 0) {
        const handler = this.pickRandomHandler();
        if (handler) {
          this.startHandler(handler, ctx, false);
          return {
            damageThisFrame: 0,
            productionMultiplier: 1.0,
            shakeOffset: { x: 0, y: 0, z: 0 },
            buildingsHitThisFrame: 0,
            activeEvent: this.getActiveEvent(),
          };
        }
        // No handlers registered yet: reset cooldown
        this.cooldownRemaining = this.randomCooldown();
      }

      return {
        damageThisFrame: 0,
        productionMultiplier: 1.0,
        shakeOffset: { x: 0, y: 0, z: 0 },
        buildingsHitThisFrame: 0,
        activeEvent: null,
      };
    }

    const handler = this.currentHandler;
    if (!handler) {
      this.stopCurrentEvent();
      return {
        damageThisFrame: 0,
        productionMultiplier: 1.0,
        shakeOffset: { x: 0, y: 0, z: 0 },
        activeEvent: null,
      };
    }

    // Advance phase timer
    this.phaseElapsed += dt;
    const currentPhase = this.phase;
    const step = handler.update(dt, currentPhase, this.phaseElapsed, ctx);

    // Check phase completions
    if (this.phase === 'warning') {
      if (this.phaseElapsed >= this.phaseDuration) {
        this.phase = 'active';
        this.phaseElapsed = 0;
        this.phaseDuration = Math.max(0, handler.activeDurationSec);
        handler.startActive(ctx);

        if (this.phaseDuration === 0) {
          handler.stop();
          this.currentHandler = null;
          this.phase = 'cooldown';
          this.phaseElapsed = 0;
          this.phaseDuration = 0;
          this.cooldownRemaining = this.randomCooldown(ctx.solIndex);
        }
      }
    } else if (this.phase === 'active') {
      if (this.phaseElapsed >= this.phaseDuration) {
        handler.stop();
        this.currentHandler = null;
        this.phase = 'cooldown';
        this.phaseElapsed = 0;
        this.phaseDuration = 0;
        this.cooldownRemaining = this.randomCooldown(ctx.solIndex);
      }
    }

    const rawDamage = step.damageThisFrame ?? 0;
    const damageThisFrame = Number.isFinite(rawDamage) ? Math.max(0, rawDamage) : 0;

    const rawMultiplier = step.productionMultiplier ?? 1.0;
    const productionMultiplier = Number.isFinite(rawMultiplier)
      ? Math.max(0, Math.min(1, rawMultiplier))
      : 1.0;

    const rawShake = step.shakeOffset;
    const shakeOffset = {
      x: Number.isFinite(rawShake?.x) ? rawShake.x : 0,
      y: Number.isFinite(rawShake?.y) ? rawShake.y : 0,
      z: Number.isFinite(rawShake?.z) ? rawShake.z : 0,
    };

    return {
      damageThisFrame,
      productionMultiplier,
      shakeOffset,
      buildingsHitThisFrame: Math.max(0, Math.floor(step.buildingsHitThisFrame ?? 0)),
      groundImpact: step.groundImpact,
      activeEvent: this.getActiveEvent(),
    };
  }

  /**
   * Destroys all registered handlers and resets the manager.
   */
  public destroy(): void {
    if (this.currentHandler) {
      this.currentHandler.stop();
      this.currentHandler = null;
    }
    for (const handler of this.handlers.values()) {
      handler.destroy();
    }
    this.handlers.clear();
    this.phase = 'cooldown';
    this.phaseElapsed = 0;
    this.phaseDuration = 0;
  }

  private startHandler(
    handler: WorldEventHandler,
    ctx: EventUpdateContext,
    skipWarning: boolean,
  ): void {
    if (this.currentHandler) {
      this.currentHandler.stop();
    }
    this.currentHandler = handler;
    this.lastEventType = handler.type;

    if (skipWarning || handler.warningDurationSec <= 0) {
      this.phase = 'active';
      this.phaseElapsed = 0;
      this.phaseDuration = Math.max(0, handler.activeDurationSec);
      handler.startActive(ctx);

      if (this.phaseDuration === 0) {
        handler.stop();
        this.currentHandler = null;
        this.phase = 'cooldown';
        this.phaseElapsed = 0;
        this.phaseDuration = 0;
        this.cooldownRemaining = this.randomCooldown(ctx.solIndex);
      }
    } else {
      this.phase = 'warning';
      this.phaseElapsed = 0;
      this.phaseDuration = Math.max(0, handler.warningDurationSec);
      handler.startWarning(ctx);
    }
  }

  private pickRandomHandler(): WorldEventHandler | null {
    const allHandlers = Array.from(this.handlers.values());
    if (allHandlers.length === 0) {
      return null;
    }
    if (allHandlers.length === 1) {
      return allHandlers[0];
    }

    // Avoid repeating the exact same event twice in a row when > 1 handler exists
    const candidates = allHandlers.filter((h) => h.type !== this.lastEventType);
    const pool = candidates.length > 0 ? candidates : allHandlers;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }

  private randomCooldown(solIndex = 1): number {
    const sol = Math.max(1, Math.min(10, Math.floor(solIndex || 1)));
    const scale = sol === 1 ? 1.25 : 1.1 - ((sol - 2) / 8) * 0.62;
    return (this.minCooldownSec + Math.random() * (this.maxCooldownSec - this.minCooldownSec)) * scale;
  }
}
