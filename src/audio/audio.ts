// 音效引擎：优先使用 public/sounds 下的采样（若存在），否则 Web Audio 实时合成。
// 音量与音调随撞击速度缩放，模拟真实撞击听感。

export type SfxName = 'ball' | 'cushion' | 'pocket' | 'strike';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples = new Map<SfxName, AudioBuffer>();
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  /** 需在用户手势后调用 */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      // 预生成噪声缓冲
      const len = this.ctx.sampleRate * 0.3;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.loadSamples();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private async loadSamples() {
    const files: Array<[SfxName, string]> = [
      ['ball', 'sounds/ball-hit.wav'],
      ['cushion', 'sounds/cushion.wav'],
      ['pocket', 'sounds/pocket.wav'],
      ['strike', 'sounds/cue-strike.wav'],
    ];
    for (const [name, url] of files) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        this.samples.set(name, await this.ctx!.decodeAudioData(buf));
      } catch {
        // 无采样则用合成
      }
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
  }

  /** speed: 撞击法向速度 m/s，用于音量/音调缩放 */
  play(name: SfxName, speed = 1) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    if (this.samples.has(name)) {
      this.playSample(name, speed, t);
    } else {
      this.synth(name, speed, t);
    }
  }

  private playSample(name: SfxName, speed: number, t: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.samples.get(name)!;
    src.playbackRate.value = 0.9 + Math.min(0.35, speed * 0.04) + Math.random() * 0.06;
    const g = this.ctx!.createGain();
    const vol = Math.min(1, 0.25 + speed * 0.18);
    g.gain.value = vol;
    src.connect(g).connect(this.master!);
    src.start(t);
  }

  private synth(name: SfxName, speed: number, t: number) {
    const ctx = this.ctx!;
    const out = this.master!;
    const intensity = Math.min(1, 0.2 + speed * 0.16);

    if (name === 'ball') {
      // 清脆撞击：高频噪声 + 短促正弦
      const nb = ctx.createBufferSource();
      nb.buffer = this.noiseBuf!;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 5200 + Math.min(2500, speed * 500);
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(intensity * 0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      nb.connect(bp).connect(g).connect(out);
      nb.start(t);
      nb.stop(t + 0.05);

      const osc = ctx.createOscillator();
      osc.frequency.value = 2600 + Math.min(1400, speed * 260);
      const og = ctx.createGain();
      og.gain.setValueAtTime(intensity * 0.35, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.028);
      osc.connect(og).connect(out);
      osc.start(t);
      osc.stop(t + 0.04);
    } else if (name === 'cushion') {
      // 闷响：低通噪声脉冲
      const nb = ctx.createBufferSource();
      nb.buffer = this.noiseBuf!;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420 + speed * 60;
      const g = ctx.createGain();
      g.gain.setValueAtTime(intensity * 0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      nb.connect(lp).connect(g).connect(out);
      nb.start(t);
      nb.stop(t + 0.12);
    } else if (name === 'pocket') {
      // 进袋：库边闷响 ×2（袋壁弹跳）+ 低频落底
      for (const [dt, vol] of [
        [0, 0.5],
        [0.07, 0.35],
        [0.16, 0.55],
      ] as const) {
        const nb = ctx.createBufferSource();
        nb.buffer = this.noiseBuf!;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = dt === 0.16 ? 220 : 500;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t + dt);
        g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.08);
        nb.connect(lp).connect(g).connect(out);
        nb.start(t + dt);
        nb.stop(t + dt + 0.1);
      }
    } else if (name === 'strike') {
      // 皮头击球：中频 click
      const nb = ctx.createBufferSource();
      nb.buffer = this.noiseBuf!;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(1, 0.3 + speed * 0.08), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      nb.connect(bp).connect(g).connect(out);
      nb.start(t);
      nb.stop(t + 0.06);
    }
  }
}
