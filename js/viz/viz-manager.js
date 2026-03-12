// Panel layout manager and visualization coordinator
export class VizManager {
  constructor(state, engine) {
    this.state = state;
    this.engine = engine;
    this.panels = [];
    this.container = null;
    this._animFrame = null;
    this._resizeObserver = null;
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    this._resizeObserver = new ResizeObserver(() => this._resizeAll());
    this._resizeObserver.observe(this.container);
    this._startRenderLoop();
  }

  register(panel) {
    this.panels.push(panel);
    const wrapper = document.createElement('div');
    wrapper.className = `viz-panel viz-panel-${panel.id}`;
    wrapper.dataset.panelId = panel.id;

    const header = document.createElement('div');
    header.className = 'viz-panel-header';
    header.innerHTML = `<span class="viz-panel-title">${panel.title}</span>`;
    wrapper.appendChild(header);

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'viz-canvas-container';

    const canvas = document.createElement('canvas');
    canvas.id = `canvas-${panel.id}`;
    canvasContainer.appendChild(canvas);
    wrapper.appendChild(canvasContainer);

    this.container.appendChild(wrapper);
    panel.wrapper = wrapper;
    panel.canvas = canvas;
    panel.canvasCtx = canvas.getContext('2d');
    this._resizeCanvas(panel);
    if (panel.init) panel.init();
  }

  registerThreePanel(panel) {
    this.panels.push(panel);
    const wrapper = document.createElement('div');
    wrapper.className = `viz-panel viz-panel-${panel.id} viz-panel-3d`;
    wrapper.dataset.panelId = panel.id;

    const header = document.createElement('div');
    header.className = 'viz-panel-header';
    header.innerHTML = `<span class="viz-panel-title">${panel.title}</span>`;
    wrapper.appendChild(header);

    const threeContainer = document.createElement('div');
    threeContainer.className = 'viz-canvas-container viz-three-container';
    threeContainer.id = `three-${panel.id}`;
    wrapper.appendChild(threeContainer);

    this.container.appendChild(wrapper);
    panel.wrapper = wrapper;
    panel.container = threeContainer;
    if (panel.init) panel.init(threeContainer);
  }

  _resizeCanvas(panel) {
    if (!panel.canvas) return;
    const container = panel.canvas.parentElement;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    panel.canvas.width = rect.width * dpr;
    panel.canvas.height = rect.height * dpr;
    panel.canvas.style.width = rect.width + 'px';
    panel.canvas.style.height = rect.height + 'px';
    panel.canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    panel.displayWidth = rect.width;
    panel.displayHeight = rect.height;
  }

  _resizeAll() {
    for (const panel of this.panels) {
      if (panel.canvas) {
        this._resizeCanvas(panel);
      }
      if (panel.resize) panel.resize();
    }
  }

  _startRenderLoop() {
    const render = () => {
      const features = this.state.get('features');
      const currentTime = this.state.get('currentTime');
      const duration = this.state.get('duration');
      const selection = this.state.get('selection');
      const zoom = this.state.get('zoomLevel');
      const scroll = this.state.get('scrollOffset');
      const isPlaying = this.state.get('isPlaying');

      const ctx = {
        features, currentTime, duration, selection, zoom, scroll, isPlaying,
        analyserData: isPlaying ? this.engine.getAnalyserData() : null,
        timeDomainData: isPlaying ? this.engine.getTimeDomainData() : null,
      };

      for (const panel of this.panels) {
        if (panel.wrapper && panel.wrapper.offsetParent === null) continue; // hidden
        if (panel.render) {
          panel.render(ctx);
        }
      }
      this._animFrame = requestAnimationFrame(render);
    };
    this._animFrame = requestAnimationFrame(render);
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }
}
