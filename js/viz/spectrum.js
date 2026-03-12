// Real-time frequency spectrum visualization
import { BasePanel } from './base-panel.js';

export class SpectrumPanel extends BasePanel {
  constructor(state) {
    super('spectrum', 'Frequency Spectrum', state);
  }

  render(ctx) {
    this.clear();
    const c = this.canvasCtx;
    const w = this.displayWidth;
    const h = this.displayHeight;

    if (ctx.analyserData && ctx.isPlaying) {
      // Live spectrum from analyser
      const data = ctx.analyserData;
      const barCount = Math.min(data.length, Math.floor(w / 2));
      const barW = w / barCount;

      for (let i = 0; i < barCount; i++) {
        // data is in dB, typically -100 to 0
        const val = (data[i] + 100) / 100;
        const barH = Math.max(0, val) * h;
        const hue = (i / barCount) * 280;
        c.fillStyle = `hsl(${hue}, 80%, 55%)`;
        c.fillRect(i * barW, h - barH, barW - 1, barH);
      }
    } else if (ctx.features && ctx.features.spectrogram && ctx.features.spectrogram.length > 0) {
      // Static: show spectrum at current time
      const frameIdx = Math.floor((ctx.currentTime / ctx.duration) * ctx.features.spectrogram.length);
      const frame = ctx.features.spectrogram[Math.min(frameIdx, ctx.features.spectrogram.length - 1)];
      if (frame) {
        const barCount = Math.min(frame.length, Math.floor(w / 2));
        const barW = w / barCount;

        let max = 0;
        for (let i = 0; i < frame.length; i++) if (frame[i] > max) max = frame[i];
        if (max === 0) max = 1;

        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor((i / barCount) * frame.length);
          const val = frame[idx] / max;
          const barH = val * (h - 15);
          const hue = (i / barCount) * 280;
          c.fillStyle = `hsl(${hue}, 80%, 55%)`;
          c.fillRect(i * barW, h - 15 - barH, barW - 1, barH);
        }
      }
    } else {
      this.drawNoData();
      return;
    }

    // Frequency labels
    c.fillStyle = '#888';
    c.font = '10px "Inter", sans-serif';
    c.textAlign = 'center';
    const sr = this.state.get('sampleRate') || 44100;
    const labels = [100, 500, 1000, 5000, 10000, 20000].filter(f => f <= sr / 2);
    for (const freq of labels) {
      const x = (freq / (sr / 2)) * w;
      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      c.fillText(label, x, h - 2);
    }
  }
}
