// Frame-time readout (press ` or add ?perf=1). Splits a frame into JS work and GPU work so we can
// tell whether a machine is held back by the CPU (physics, scene upkeep) or the GPU (pixels).
export class PerfMeter {
  constructor(game) {
    this.game = game;
    this.el = document.createElement('pre');
    this.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;margin:0;padding:8px 10px;font:11px/1.45 ui-monospace,Menlo,monospace;color:#e8e4d8;background:rgba(20,20,18,.72);border-radius:6px;pointer-events:none;white-space:pre;display:none';
    document.body.appendChild(this.el);
    this.on = false;
    this.t = {}; this.acc = {}; this.n = 0; this.last = performance.now(); this.frames = 0;
    this.worst = 0;
    const gl = game.renderer.getContext();
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = []; this.gpuMs = null;
    game.renderer.info.autoReset = false;
  }
  toggle(v = !this.on) { this.on = v; this.el.style.display = v ? 'block' : 'none'; }

  // wrap a stage: perf.mark('physics') ... perf.end('physics')
  mark(k) { if (this.on) this.t[k] = performance.now(); }
  end(k) { if (this.on) this.acc[k] = (this.acc[k] || 0) + performance.now() - this.t[k]; }

  gpuBegin() {
    if (!this.on || !this.ext || this.q) return;
    const gl = this.gl;
    this.q = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.q);
  }
  gpuEnd() {
    if (!this.q) return;
    const gl = this.gl;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.q); this.q = null;
  }
  pollGpu() {
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const bad = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!bad) this.gpuMs = this.gpuMs == null ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : this.gpuMs * 0.9 + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 * 0.1;
      gl.deleteQuery(q); this.pending.shift();
    }
  }

  frameEnd(dt) {
    const r = this.game.renderer;
    if (!this.on) { r.info.reset(); return; }
    this.n++; this.frames++;
    this.worst = Math.max(this.worst, dt * 1000);
    this.pollGpu();
    const now = performance.now();
    if (now - this.last < 500) return;
    const g = this.game, el = (now - this.last) / 1000, fps = this.frames / el;
    const avg = (k) => ((this.acc[k] || 0) / this.n).toFixed(1).padStart(5);
    const info = r.info;
    const w = r.domElement.width, h = r.domElement.height;
    const js = Object.keys(this.acc).reduce((a, k) => a + this.acc[k], 0) / this.n;
    const gpu = this.gpuMs;
    const verdict = gpu == null ? '' : (gpu > js * 1.2 ? 'GPU-bound (pixels/shaders)' : 'CPU-bound (JS/physics)');
    this.el.textContent =
`${fps.toFixed(0)} fps   frame ${(1000 / fps).toFixed(1)} ms   worst ${this.worst.toFixed(0)} ms
resolution ${w}x${h}  scale ${r.getPixelRatio().toFixed(2)}  tier ${g.cfg.quality}${g.direct ? ' direct' : ''}${g.lite ? ' lite' : ''}
-- CPU (ms per frame) --
physics ${avg('physics')}   scene ${avg('scene')}
analysis ${avg('analysis')}  submit ${avg('render')}
-- GPU --
${gpu == null ? 'timer unavailable in this browser' : 'render ' + gpu.toFixed(1) + ' ms   ' + verdict}
calls ${(info.render.calls / this.n) | 0}   tris ${((info.render.triangles / this.n) / 1000).toFixed(0)}k   stones ${g.stones.length}`;
    this.acc = {}; this.n = 0; this.frames = 0; this.last = now; this.worst = 0;
    r.info.reset();
  }
}
