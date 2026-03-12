// Main application controller
import { AppState } from './ui/state.js';
import { AudioEngine } from './audio/audio-engine.js';
import { FeatureExtractor } from './audio/feature-extractor.js';
import { VizManager } from './viz/viz-manager.js';
import { Scene3DPanel } from './viz/scene3d.js';
import { AudioEditor } from './editor/editor.js';
import { AudioExporter } from './editor/export.js';

class App {
  constructor() {
    this.state = new AppState();
    this.engine = new AudioEngine(this.state);
    this.extractor = new FeatureExtractor(this.state);
    this.vizManager = new VizManager(this.state, this.engine);
    this.editor = new AudioEditor(this.state, this.engine);
    this.scene3d = null;

    this._initUI();
    this._initViz();
    this._bindEvents();
    this._bindKeyboard();
  }

  _initUI() {
    // File input
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');

    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this._loadFile(e.target.files[0]);
    });

    // Drag and drop
    document.body.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('active');
    });
    document.body.addEventListener('dragleave', () => {
      dropZone.classList.remove('active');
    });
    document.body.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('active');
      if (e.dataTransfer.files[0]) this._loadFile(e.dataTransfer.files[0]);
    });

    // Transport controls
    document.getElementById('btn-play').addEventListener('click', () => this._togglePlay());
    document.getElementById('btn-stop').addEventListener('click', () => this.engine.stop());
    document.getElementById('btn-skip-back').addEventListener('click', () => this.engine.seek(0));

    // Volume
    document.getElementById('volume-slider').addEventListener('input', (e) => {
      this.engine.setVolume(parseFloat(e.target.value));
    });

    // Edit controls
    document.getElementById('btn-crop').addEventListener('click', () => this._cropToSelection());
    document.getElementById('btn-delete-sel').addEventListener('click', () => this._deleteSelection());
    document.getElementById('btn-export').addEventListener('click', () => this._exportWAV());
    document.getElementById('btn-separate').addEventListener('click', () => this._separate());
    document.getElementById('btn-denoise').addEventListener('click', () => this._denoise());

    // State listeners for UI updates
    this.state.on('currentTime', (t) => {
      document.getElementById('time-current').textContent = this._formatTime(t);
    });
    this.state.on('duration', (d) => {
      document.getElementById('time-total').textContent = this._formatTime(d);
    });
    this.state.on('fileName', (name) => {
      document.getElementById('file-name').textContent = name || 'No file loaded';
    });
    this.state.on('extractionProgress', (p) => {
      const bar = document.getElementById('progress-bar');
      const container = document.getElementById('progress-container');
      if (p > 0 && p < 100) {
        container.style.display = 'block';
        bar.style.width = p + '%';
      } else {
        container.style.display = 'none';
      }
    });
    this.state.on('selection', (sel) => {
      const info = document.getElementById('selection-info');
      if (sel) {
        const dur = (sel.end - sel.start).toFixed(2);
        info.textContent = `Selected: ${this._formatTime(sel.start)} - ${this._formatTime(sel.end)} (${dur}s)`;
        info.style.display = 'inline-block';
      } else {
        info.style.display = 'none';
      }
    });
  }

  _initViz() {
    this.vizManager.init('viz-container');

    // Only 3D scene — no 2D panels
    this.scene3d = new Scene3DPanel(this.state);
    this.vizManager.registerThreePanel(this.scene3d);

    // Build instrument isolation controls in the panel header
    this._buildBandControls();
  }

  _buildBandControls() {
    const header = this.scene3d.wrapper.querySelector('.viz-panel-header');

    const controls = document.createElement('div');
    controls.className = 'band-controls';

    // Band buttons
    const bands = [
      { key: 'all', label: 'All' },
      { key: 'bass', label: 'Bass (20-250Hz)' },
      { key: 'mids', label: 'Mids (250Hz-4kHz)' },
      { key: 'highs', label: 'Highs (4k-20kHz)' },
    ];

    bands.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.className = 'band-btn' + (key === 'all' ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => this.scene3d.setBand(key));
      controls.appendChild(btn);
      this.scene3d._bandButtons[key] = btn;
    });

    // Auto-rotate toggle
    const rotateBtn = document.createElement('button');
    rotateBtn.className = 'band-btn rotate-btn';
    rotateBtn.textContent = 'Auto-Rotate';
    rotateBtn.addEventListener('click', () => {
      rotateBtn.classList.toggle('active');
      this.scene3d.setAutoRotate(rotateBtn.classList.contains('active'));
    });
    controls.appendChild(rotateBtn);

    header.appendChild(controls);
  }

  _bindEvents() {
    // None needed beyond what _initUI sets up
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this._togglePlay();
          break;
        case 'Delete':
        case 'Backspace':
          if (this.state.get('selection')) {
            e.preventDefault();
            this._deleteSelection();
          }
          break;
        case 'KeyE':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            this._exportWAV();
          }
          break;
        case 'Digit1': this.scene3d.setBand('all'); break;
        case 'Digit2': this.scene3d.setBand('bass'); break;
        case 'Digit3': this.scene3d.setBand('mids'); break;
        case 'Digit4': this.scene3d.setBand('highs'); break;
      }
    });
  }

  async _loadFile(file) {
    try {
      document.getElementById('drop-zone').style.display = 'none';
      document.getElementById('main-content').style.display = 'block';

      await this.engine.loadFile(file);

      // Extract features
      const buffer = this.state.get('audioBuffer');
      const features = await this.extractor.extract(buffer, (p) => {
        // progress updates handled by state listener
      });
      this.state.set('features', features);
    } catch (err) {
      console.error('Error loading file:', err);
      alert('Error loading audio file: ' + err.message);
    }
  }

  _togglePlay() {
    if (this.state.get('isPlaying')) {
      this.engine.pause();
    } else {
      this.engine.play();
    }
  }

  async _cropToSelection() {
    const newBuffer = this.editor.crop();
    if (!newBuffer) return;
    await this._replaceBuffer(newBuffer);
  }

  async _deleteSelection() {
    const newBuffer = this.editor.deleteSelection();
    if (!newBuffer) return;
    await this._replaceBuffer(newBuffer);
  }

  async _separate() {
    const buffer = this.state.get('audioBuffer');
    if (!buffer) return;

    const btn = document.getElementById('btn-separate');
    btn.disabled = true;
    btn.textContent = 'Separating...';

    try {
      const { harmonic, percussive } = await this.editor.separateHarmonicPercussive(buffer);

      // Show dialog to choose
      const choice = prompt('Instrument separation complete!\nType "harmonic" for melodic/tonal content,\nor "percussive" for drums/transients,\nor "cancel" to abort.');

      if (choice && choice.toLowerCase().startsWith('h')) {
        await this._replaceBuffer(harmonic);
      } else if (choice && choice.toLowerCase().startsWith('p')) {
        await this._replaceBuffer(percussive);
      }
    } catch (err) {
      console.error('Separation error:', err);
      alert('Separation failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Separate';
    }
  }

  async _denoise() {
    const buffer = this.state.get('audioBuffer');
    if (!buffer) return;

    const btn = document.getElementById('btn-denoise');
    btn.disabled = true;
    btn.textContent = 'Denoising...';

    try {
      const threshold = parseFloat(prompt('Noise gate threshold (0.01 - 0.1, default 0.02):', '0.02')) || 0.02;
      const denoised = await this.editor.denoiseSpectralGate(buffer, threshold);
      await this._replaceBuffer(denoised);
    } catch (err) {
      console.error('Denoise error:', err);
      alert('Denoise failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Denoise';
    }
  }

  async _replaceBuffer(newBuffer) {
    this.engine.stop();
    this.state.update({
      audioBuffer: newBuffer,
      duration: newBuffer.duration,
      channelCount: newBuffer.numberOfChannels,
      sampleRate: newBuffer.sampleRate,
      currentTime: 0,
      selection: null,
    });

    // Re-extract features
    const features = await this.extractor.extract(newBuffer);
    this.state.set('features', features);
  }

  _exportWAV() {
    const buffer = this.state.get('audioBuffer');
    if (!buffer) return;
    const name = this.state.get('fileName').replace(/\.[^.]+$/, '') || 'audio';
    AudioExporter.exportWAV(buffer, name + '_edited.wav');
  }

  _formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
