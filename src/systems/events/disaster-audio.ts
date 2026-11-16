import type { ActiveEventInfo, EventStepResult } from '../../types/events.ts';

type ImpactSound = NonNullable<EventStepResult['groundImpact']>;
type LoopSound = 'tornado' | 'dust_storm' | 'electric_storm';
type Sound = 'warning' | ImpactSound | LoopSound;

const SAMPLE_RATE = 22050;
const TAU = Math.PI * 2;
const MAX_GAIN = 0.5;
const THUNDER_URL = new URL('./assets/thunder.mp3', import.meta.url);
export const DEFAULT_DISASTER_VOLUME = 35;
const durations: Record<Sound, number> = {
  warning: 0.48,
  meteor: 0.9,
  lightning: 1.2,
  tornado: 4,
  dust_storm: 4,
  electric_storm: 4,
};

function createSound(context: AudioContext, sound: Sound): AudioBuffer {
  const duration = durations[sound];
  const buffer = context.createBuffer(1, duration * SAMPLE_RATE, SAMPLE_RATE);
  const samples = buffer.getChannelData(0);
  let seed = 9521;
  let bass = 0;
  let wind = 0;

  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    bass += 0.022 * (noise - bass);
    wind += 0.16 * (noise - wind);
    const swell = Math.sin(TAU * t / duration);
    let sample: number;

    switch (sound) {
      case 'warning': {
        const second = t >= 0.23;
        const beat = second ? t - 0.23 : t;
        const pulse = Math.max(0, Math.min(1, beat / 0.014, (0.15 - beat) / 0.044));
        sample = Math.sin(TAU * (second ? 590 : 440) * beat) * pulse * 0.24;
        break;
      }
      case 'meteor':
        sample = (bass * 1.7 + Math.sin(TAU * (66 * t - 19 * t * t)) * 0.42) * Math.exp(-5.4 * t)
          + noise * 0.32 * Math.exp(-28 * t);
        break;
      case 'lightning':
        sample = (noise - wind) * 0.4 * (Math.exp(-27 * t) + 0.45 * Math.exp(-75 * Math.abs(t - 0.085)))
          + bass * 1.5 * Math.exp(-3.7 * t);
        break;
      case 'tornado':
        sample = (bass + wind * 0.25 + Math.sin(TAU * 44 * t) * 0.065) * (0.75 + 0.25 * swell);
        break;
      case 'dust_storm':
        sample = (wind * 0.46 + (noise - wind) * 0.07) * (0.76 + 0.24 * swell);
        break;
      case 'electric_storm':
        sample = wind * 0.23 + Math.sin(TAU * 58 * t) * (0.024 + 0.014 * swell);
        break;
    }

    const edge = Math.min(1, t / 0.006, (duration - t) / 0.02);
    samples[i] = sample * edge;
  }

  return buffer;
}

export class DisasterAudio {
  private context?: AudioContext;
  private output?: GainNode;
  private thunder?: AudioBuffer;
  private enabled = true;
  private volume = DEFAULT_DISASTER_VOLUME;
  private phase = '';
  private loop?: AudioBufferSourceNode;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly buffers = new Map<Sound, AudioBuffer>();

  public unlock(): void {
    if (!this.enabled || typeof AudioContext === 'undefined') return;
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return;
      }
      this.output = this.context.createGain();
      this.output.gain.value = MAX_GAIN * this.volume / 100;
      this.output.connect(this.context.destination);
      void this.loadThunder(this.context);
    }
    if (this.context.state !== 'running') void this.context.resume().catch(() => {});
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  public setVolume(volume: number): void {
    if (this.volume === volume) return;
    this.volume = volume;
    if (this.context && this.output) {
      this.output.gain.setTargetAtTime(MAX_GAIN * volume / 100, this.context.currentTime, 0.02);
    }
  }

  public update(event: ActiveEventInfo | null, impact?: ImpactSound): void {
    if (!this.enabled || this.context?.state !== 'running') return;

    const phase = event ? `${event.type}:${event.phase}` : '';
    if (phase !== this.phase) {
      this.phase = phase;
      this.loop?.stop();
      this.loop = undefined;
      if (event?.phase === 'warning') {
        this.play('warning');
      } else if (event && event.type !== 'meteor_shower') {
        this.loop = this.play(event.type, true);
      }
    }

    if (impact) this.play(impact);
  }

  public stop(): void {
    for (const source of this.sources) source.stop();
    this.sources.clear();
    this.loop = undefined;
    this.phase = '';
  }

  public dispose(): void {
    this.stop();
    this.buffers.clear();
    this.thunder = undefined;
    if (this.context) void this.context.close().catch(() => {});
  }

  private async loadThunder(context: AudioContext): Promise<void> {
    try {
      const response = await fetch(THUNDER_URL);
      if (!response.ok) return;
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (context.state !== 'closed') this.thunder = buffer;
    } catch {}
  }

  private play(sound: Sound, loop = false): AudioBufferSourceNode | undefined {
    if (!this.context || !this.output) return;
    let buffer = (sound === 'lightning' ? this.thunder : undefined) ?? this.buffers.get(sound);
    if (!buffer) {
      buffer = createSound(this.context, sound);
      this.buffers.set(sound, buffer);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(this.output);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    this.sources.add(source);
    source.start();
    return source;
  }
}
