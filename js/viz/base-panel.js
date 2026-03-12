// Base class for all 2D canvas visualization panels
export class BasePanel {
  constructor(id, title, state) {
    this.id = id;
    this.title = title;
    this.state = state;
    this.canvas = null;
    this.canvasCtx = null;
    this.wrapper = null;
    this.displayWidth = 0;
    this.displayHeight = 0;
  }

  init() {}
  resize() {}
  render(ctx) {}

  clear() {
    if (!this.canvasCtx) return;
    this.canvasCtx.fillStyle = '#1a1a2e';
    this.canvasCtx.fillRect(0, 0, this.displayWidth, this.displayHeight);
  }

  drawNoData() {
    this.clear();
    this.canvasCtx.fillStyle = '#555';
    this.canvasCtx.font = '14px "Inter", sans-serif';
    this.canvasCtx.textAlign = 'center';
    this.canvasCtx.fillText('No audio loaded', this.displayWidth / 2, this.displayHeight / 2);
  }

  // Draw playback cursor
  drawCursor(ctx) {
    if (!ctx.duration) return;
    const x = (ctx.currentTime / ctx.duration) * this.displayWidth;
    this.canvasCtx.strokeStyle = '#ff4444';
    this.canvasCtx.lineWidth = 1.5;
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(x, 0);
    this.canvasCtx.lineTo(x, this.displayHeight);
    this.canvasCtx.stroke();
  }

  // Draw selection region
  drawSelection(ctx) {
    if (!ctx.selection || !ctx.duration) return;
    const x1 = (ctx.selection.start / ctx.duration) * this.displayWidth;
    const x2 = (ctx.selection.end / ctx.duration) * this.displayWidth;
    this.canvasCtx.fillStyle = 'rgba(66, 135, 245, 0.2)';
    this.canvasCtx.fillRect(x1, 0, x2 - x1, this.displayHeight);
    this.canvasCtx.strokeStyle = 'rgba(66, 135, 245, 0.6)';
    this.canvasCtx.lineWidth = 1;
    this.canvasCtx.beginPath();
    this.canvasCtx.moveTo(x1, 0); this.canvasCtx.lineTo(x1, this.displayHeight);
    this.canvasCtx.moveTo(x2, 0); this.canvasCtx.lineTo(x2, this.displayHeight);
    this.canvasCtx.stroke();
  }

  // Draw time axis labels
  drawTimeAxis(duration) {
    if (!duration) return;
    const c = this.canvasCtx;
    c.fillStyle = '#888';
    c.font = '10px "Inter", sans-serif';
    c.textAlign = 'center';
    const numLabels = Math.min(10, Math.floor(this.displayWidth / 80));
    for (let i = 0; i <= numLabels; i++) {
      const t = (i / numLabels) * duration;
      const x = (i / numLabels) * this.displayWidth;
      c.fillText(this._formatTime(t), x, this.displayHeight - 2);
    }
  }

  // Draw Y axis label
  drawYLabel(label) {
    const c = this.canvasCtx;
    c.save();
    c.fillStyle = '#888';
    c.font = '10px "Inter", sans-serif';
    c.translate(10, this.displayHeight / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = 'center';
    c.fillText(label, 0, 0);
    c.restore();
  }

  _formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return `${m}:${sec.padStart(4, '0')}`;
  }
}

// Time-series line chart panel
export class LineChartPanel extends BasePanel {
  constructor(id, title, state, featureKey, color, yLabel, options = {}) {
    super(id, title, state);
    this.featureKey = featureKey;
    this.color = color;
    this.yLabel = yLabel;
    this.normalize = options.normalize !== false;
    this.logScale = options.logScale || false;
  }

  render(ctx) {
    if (!ctx.features || !ctx.features[this.featureKey]) {
      this.drawNoData();
      return;
    }
    this.clear();

    const data = ctx.features[this.featureKey];
    const c = this.canvasCtx;
    const w = this.displayWidth;
    const h = this.displayHeight;
    const margin = { top: 5, bottom: 15, left: 20, right: 5 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    // Find range
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    if (min === max) { min -= 1; max += 1; }

    // Draw line
    c.strokeStyle = this.color;
    c.lineWidth = 1.2;
    c.beginPath();

    const step = Math.max(1, Math.floor(data.length / plotW));
    for (let px = 0; px < plotW; px++) {
      const idx = Math.floor((px / plotW) * data.length);
      const val = data[idx];
      const y = margin.top + plotH - ((val - min) / (max - min)) * plotH;
      if (px === 0) c.moveTo(margin.left + px, y);
      else c.lineTo(margin.left + px, y);
    }
    c.stroke();

    // Fill under curve
    c.lineTo(margin.left + plotW, margin.top + plotH);
    c.lineTo(margin.left, margin.top + plotH);
    c.closePath();
    c.fillStyle = this.color.replace(')', ', 0.15)').replace('rgb', 'rgba');
    c.fill();

    this.drawTimeAxis(ctx.duration);
    this.drawYLabel(this.yLabel);
    this.drawSelection(ctx);
    this.drawCursor(ctx);
  }
}

// Heatmap panel (for spectrogram, chromagram, MFCC)
export class HeatmapPanel extends BasePanel {
  constructor(id, title, state, featureKey, yLabels, colorMap, options = {}) {
    super(id, title, state);
    this.featureKey = featureKey;
    this.yLabels = yLabels;
    this.colorMap = colorMap || 'viridis';
    this.logScale = options.logScale || false;
    this._imageData = null;
    this._lastLength = 0;
  }

  render(ctx) {
    if (!ctx.features || !ctx.features[this.featureKey] || ctx.features[this.featureKey].length === 0) {
      this.drawNoData();
      return;
    }
    this.clear();

    const data = ctx.features[this.featureKey];
    const c = this.canvasCtx;
    const w = this.displayWidth;
    const h = this.displayHeight;
    const margin = { top: 2, bottom: 15, left: 5, right: 5 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    const numBins = data[0].length;
    const numFrames = data.length;

    // Find global range
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < numFrames; i++) {
      for (let j = 0; j < numBins; j++) {
        let v = data[i][j];
        if (this.logScale) v = Math.log10(v + 1e-10);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === max) { min -= 1; max += 1; }

    // Draw heatmap
    const cellW = plotW / numFrames;
    const cellH = plotH / numBins;

    // Use image data for performance
    const stepX = Math.max(1, Math.floor(numFrames / plotW));
    for (let px = 0; px < plotW; px++) {
      const frameIdx = Math.floor((px / plotW) * numFrames);
      for (let py = 0; py < plotH; py++) {
        const binIdx = numBins - 1 - Math.floor((py / plotH) * numBins);
        let v = data[frameIdx][binIdx];
        if (this.logScale) v = Math.log10(v + 1e-10);
        const norm = (v - min) / (max - min);
        const color = this._getColor(norm);
        c.fillStyle = color;
        c.fillRect(margin.left + px, margin.top + py, 1, 1);
      }
    }

    this.drawTimeAxis(ctx.duration);
    this.drawSelection(ctx);
    this.drawCursor(ctx);
  }

  _getColor(t) {
    t = Math.max(0, Math.min(1, t));
    if (this.colorMap === 'viridis') {
      const r = Math.round(68 + t * (253 - 68));
      const g = Math.round(1 + t * (231 - 1));
      const b = Math.round(84 + (1 - Math.abs(t - 0.5) * 2) * (150 - 84));
      return `rgb(${r},${g},${b})`;
    } else if (this.colorMap === 'magma') {
      const r = Math.round(t * 255);
      const g = Math.round(t * t * 180);
      const b = Math.round(80 + t * 175);
      return `rgb(${r},${g},${b})`;
    } else if (this.colorMap === 'inferno') {
      const r = Math.round(t * 250);
      const g = Math.round(t * t * 200);
      const b = Math.round(30 + (1 - t) * 100 + t * 50);
      return `rgb(${r},${g},${b})`;
    }
    // Default hot
    const r = Math.round(Math.min(255, t * 510));
    const g = Math.round(Math.max(0, (t - 0.4) * 425));
    const b = Math.round(Math.max(0, (t - 0.7) * 850));
    return `rgb(${r},${g},${b})`;
  }
}
