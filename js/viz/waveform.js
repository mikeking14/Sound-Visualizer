// Waveform visualization with interactive selection
import { BasePanel } from './base-panel.js';

export class WaveformPanel extends BasePanel {
  constructor(state, engine) {
    super('waveform', 'Waveform', state);
    this.engine = engine;
    this._isDragging = false;
    this._dragStart = 0;
  }

  init() {
    // Mouse events for selection
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));
  }

  render(ctx) {
    if (!ctx.features || !ctx.features.waveformPeaks) {
      this.drawNoData();
      return;
    }
    this.clear();

    const peaks = ctx.features.waveformPeaks;
    const c = this.canvasCtx;
    const w = this.displayWidth;
    const h = this.displayHeight;
    const midY = h / 2;

    // Draw waveform
    const gradient = c.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#4287f5');
    gradient.addColorStop(0.5, '#42f5a7');
    gradient.addColorStop(1, '#4287f5');

    c.fillStyle = gradient;
    const numPeaks = peaks.min.length;
    const barW = w / numPeaks;

    for (let i = 0; i < numPeaks; i++) {
      const x = (i / numPeaks) * w;
      const minY = midY + peaks.min[i] * midY;
      const maxY = midY + peaks.max[i] * midY;
      c.fillRect(x, maxY, Math.max(1, barW), minY - maxY);
    }

    // Center line
    c.strokeStyle = 'rgba(255,255,255,0.1)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, midY);
    c.lineTo(w, midY);
    c.stroke();

    this.drawTimeAxis(ctx.duration);
    this.drawSelection(ctx);
    this.drawCursor(ctx);
  }

  _xToTime(x) {
    const rect = this.canvas.getBoundingClientRect();
    const relX = (x - rect.left) / rect.width;
    return relX * this.state.get('duration');
  }

  _onMouseDown(e) {
    this._isDragging = true;
    this._dragStart = this._xToTime(e.clientX);
    this.state.set('selection', null);
  }

  _onMouseMove(e) {
    if (!this._isDragging) return;
    const t = this._xToTime(e.clientX);
    const start = Math.min(this._dragStart, t);
    const end = Math.max(this._dragStart, t);
    if (end - start > 0.01) {
      this.state.set('selection', { start, end });
    }
  }

  _onMouseUp(e) {
    if (!this._isDragging) return;
    this._isDragging = false;
    const t = this._xToTime(e.clientX);
    if (Math.abs(t - this._dragStart) < 0.01) {
      // Click to seek
      this.state.set('selection', null);
      this.engine.seek(t);
    }
  }

  _onDblClick(e) {
    this.state.set('selection', null);
  }
}
