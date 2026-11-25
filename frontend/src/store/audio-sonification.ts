import { useEffect, useRef, useCallback, useState } from 'react';

interface SoundProfile {
  volume: number;
  successPitch: number;
  failurePitch: number;
  keeperTone: string;
  enabled: boolean;
}

interface AudioEvent {
  type: 'success' | 'failure' | 'gas_exhausted' | 'keeper_execute' | 'task_complete';
  gasUsed: number;
  keeperId: string;
  value: number;
  timestamp: number;
}

const DEFAULT_PROFILE: SoundProfile = {
  volume: 0.5,
  successPitch: 440,
  failurePitch: 220,
  keeperTone: 'pentatonic',
  enabled: true,
};

const PENTATONIC_SCALE = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25];
const DISSONANT_INTERVALS = [100, 150, 200, 300];

export class AudioSonificationEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private profile: SoundProfile;
  private isPlaying = false;
  private muted = false;
  private settingsKey = 'sorotask_audio_settings';

  constructor(profile?: Partial<SoundProfile>) {
    this.profile = { ...DEFAULT_PROFILE, ...profile };
    this.loadSettings();
  }

  private async initContext(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.profile.volume;
      this.masterGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  private loadSettings(): void {
    try {
      const stored = localStorage.getItem(this.settingsKey);
      if (stored) {
        const settings = JSON.parse(stored);
        this.profile = { ...DEFAULT_PROFILE, ...settings };
        this.muted = settings.muted || false;
      }
    } catch {}
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(
        this.settingsKey,
        JSON.stringify({ ...this.profile, muted: this.muted })
      );
    } catch {}
  }

  async playEvent(event: AudioEvent): Promise<void> {
    await this.initContext();
    if (!this.audioContext || !this.masterGain) return;

    if (this.muted || !this.profile.enabled) return;

    switch (event.type) {
      case 'success':
        await this.playSuccess(event);
        break;
      case 'failure':
        await this.playFailure(event);
        break;
      case 'gas_exhausted':
        await this.playGasExhausted(event);
        break;
      case 'keeper_execute':
        await this.playKeeperExecute(event);
        break;
      case 'task_complete':
        await this.playTaskComplete(event);
        break;
    }
  }

  private async playSuccess(event: AudioEvent): Promise<void> {
    const baseFreq = this.calculateSuccessPitch(event);
    const osc1 = this.audioContext!.createOscillator();
    const osc2 = this.audioContext!.createOscillator();
    const gainNode = this.audioContext!.createGain();

    osc1.type = 'sine';
    osc1.frequency.value = baseFreq;
    osc2.type = 'sine';
    osc2.frequency.value = baseFreq * 1.5;

    gainNode.gain.value = this.profile.volume * 0.3;
    gainNode.connect(this.masterGain);
    osc1.connect(gainNode);
    osc2.connect(gainNode);

    osc1.start();
    osc2.start();

    await this.sleep(800);

    osc1.stop();
    osc2.stop();
  }

  private async playFailure(event: AudioEvent): Promise<void> {
    const baseFreq = this.profile.failurePitch;
    const osc = this.audioContext!.createOscillator();
    const gainNode = this.audioContext!.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = baseFreq;
    osc.frequency.linearRampToValueAtTime(
      baseFreq * 0.5,
      this.audioContext!.currentTime + 0.5
    );

    gainNode.gain.value = this.profile.volume * 0.4;
    gainNode.connect(this.masterGain);
    osc.connect(gainNode);

    osc.start();
    await this.sleep(600);
    osc.stop();
  }

  private async playGasExhausted(event: AudioEvent): Promise<void> {
    const osc = this.audioContext!.createOscillator();
    const gainNode = this.audioContext!.createGain();

    osc.type = 'square';
    osc.frequency.value = 100;
    osc.frequency.linearRampToValueAtTime(50, this.audioContext!.currentTime + 1);

    gainNode.gain.value = this.profile.volume * 0.3;
    gainNode.connect(this.masterGain);
    osc.connect(gainNode);

    osc.start();
    await this.sleep(1000);
    osc.stop();
  }

  private async playKeeperExecute(event: AudioEvent): Promise<void> {
    const baseFreq = this.calculateKeeperPitch(event);
    const numNotes = Math.min(Math.floor(event.gasUsed / 1000000) + 1, 8);

    for (let i = 0; i < numNotes; i++) {
      const osc = this.audioContext!.createOscillator();
      const gainNode = this.audioContext!.createGain();

      osc.type = 'triangle';
      osc.frequency.value = PENTATONIC_SCALE[i % PENTATONIC_SCALE.length];

      gainNode.gain.value = this.profile.volume * 0.15;
      gainNode.connect(this.masterGain);
      osc.connect(gainNode);

      osc.start(this.audioContext!.currentTime + i * 0.1);
      osc.stop(this.audioContext!.currentTime + i * 0.1 + 0.15);
    }
  }

  private async playTaskComplete(event: AudioEvent): Promise<void> {
    const notes = [523.25, 587.33, 659.25, 783.99];

    for (let i = 0; i < notes.length; i++) {
      const osc = this.audioContext!.createOscillator();
      const gainNode = this.audioContext!.createGain();

      osc.type = 'sine';
      osc.frequency.value = notes[i];

      gainNode.gain.value = this.profile.volume * 0.2;
      gainNode.connect(this.masterGain);
      osc.connect(gainNode);

      osc.start(this.audioContext!.currentTime + i * 0.2);
      osc.stop(this.audioContext!.currentTime + i * 0.2 + 0.3);
    }
  }

  private calculateSuccessPitch(event: AudioEvent): number {
    const valueScale = Math.log2(event.value + 1) / 10;
    const gasScale = Math.log2(event.gasUsed + 1) / 20;
    return this.profile.successPitch * (1 + valueScale * gasScale);
  }

  private calculateKeeperPitch(event: AudioEvent): number {
    const keeperIndex = event.keeperId.charCodeAt(event.keeperId.length - 1) % PENTATONIC_SCALE.length;
    return PENTATONIC_SCALE[keeperIndex];
  }

  setProfile(profile: Partial<SoundProfile>): void {
    this.profile = { ...this.profile, ...profile };
    this.saveSettings();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : this.profile.volume;
    }
    this.saveSettings();
  }

  getProfile(): SoundProfile {
    return { ...this.profile };
  }

  isMuted(): boolean {
    return this.muted;
  }

  async dispose(): Promise<void> {
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function useAudioEngine() {
  const engineRef = useRef<AudioSonificationEngine | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  if (!engineRef.current) {
    engineRef.current = new AudioSonificationEngine();
  }

  const playEvent = useCallback(async (event: AudioEvent) => {
    setIsPlaying(true);
    await engineRef.current?.playEvent(event);
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
    };
  }, []);

  return { playEvent, isPlaying };
}
