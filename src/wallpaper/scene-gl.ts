// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Draws a scene (core/scenes/shaders.ts) with WebGL 1 at a capped frame rate
// and a reduced resolution, and stops completely when told to or when the
// window is hidden or covered. Reports how fast it really draws.

import { paletteFloats } from '../../core/scenes/catalog';
import { fragmentFor, VERTEX } from '../../core/scenes/shaders';
import { frameInterval } from '../../core/scenes/policy';
import type { Palette, SceneParams } from '../../core/scenes/types';

interface Prog { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }

const UNIFORMS = ['u_res', 'u_time', 'u_pal', 'u_intensity', 'u_scale', 'u_grain', 'u_vignette', 'u_seed', 'u_mouse', 'u_fade'];

export class SceneRenderer {
  private gl: WebGLRenderingContext;
  private progs = new Map<string, Prog>();
  private cur: { id: string; pal: number[]; params: SceneParams } | null = null;
  private next: { id: string; pal: number[]; params: SceneParams } | null = null;
  private raf = 0;
  private running = false;
  private fps = 30;
  private scale = 0.75;
  private time = 0;
  private last = 0;
  private lastDraw = 0;
  private fade = 1;
  private frames = 0;
  private drawMs = 0;
  private statAt = performance.now();
  private onFrame?: () => void;
  stats = { fps: 0, frameMs: 0 };
  onStats?: (s: { fps: number; frameMs: number }) => void;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private compile(id: string): Prog {
    const have = this.progs.get(id);
    if (have) return have;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fragmentFor(id)));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));
    const p = { prog, u };
    this.progs.set(id, p);
    return p;
  }

  /** Shows a scene; changing scene cross-fades through black, changing only colours or controls is instant. */
  setScene(id: string, palette: Palette, params: SceneParams) {
    const s = { id, pal: paletteFloats(palette), params };
    if (!this.cur || !this.running) { this.cur = s; this.next = null; this.fade = 1; }
    else if (this.cur.id !== id) this.next = s;
    else this.cur = s;
    if (!this.running) this.drawOnce();
  }

  setPolicy(run: boolean, fps: number, scale: number) {
    this.fps = Math.max(1, fps);
    this.scale = Math.min(1, Math.max(0.25, scale));
    this.resize();
    if (run && !this.running) this.start();
    else if (!run && this.running) this.stop();
  }

  private onVisibility = () => {
    // Chromium marks a window hidden when it is minimised, on another space, or fully covered.
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; } else if (this.running && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  };

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr * this.scale));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  start() {
    this.running = true;
    this.last = performance.now();
    if (!document.hidden && !this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stats = { fps: 0, frameMs: 0 };
    this.onStats?.(this.stats);
  }

  /** One frame, then call back (for still pictures and the first paint). */
  drawOnce(cb?: () => void) {
    this.onFrame = cb;
    this.resize();
    this.draw();
    if (cb) requestAnimationFrame(() => { this.onFrame?.(); this.onFrame = undefined; });
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (!this.running) return;
    const iv = frameInterval(this.fps);
    if (now - this.lastDraw >= iv - 2) {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.lastDraw = now;
      this.time += dt * (this.cur?.params.speed ?? 1);
      // Cross-fade: down to black, swap, back up.
      if (this.next) { this.fade = Math.max(0, this.fade - dt * 2.5); if (this.fade === 0) { this.cur = this.next; this.next = null; } }
      else if (this.fade < 1) this.fade = Math.min(1, this.fade + dt * 1.8);
      const t0 = performance.now();
      this.draw();
      this.drawMs += performance.now() - t0;
      this.frames++;
    } else this.last = this.last || now;
    if (now - this.statAt >= 5000) {
      this.stats = { fps: (this.frames * 1000) / (now - this.statAt), frameMs: this.frames ? this.drawMs / this.frames : 0 };
      this.onStats?.(this.stats);
      this.frames = 0;
      this.drawMs = 0;
      this.statAt = now;
    }
    if (!document.hidden) this.raf = requestAnimationFrame(this.tick);
  };

  private draw() {
    const s = this.cur;
    if (!s) return;
    const gl = this.gl;
    let p: Prog;
    try { p = this.compile(s.id); } catch (e) { console.error(e); return; }
    gl.useProgram(p.prog);
    const loc = gl.getAttribLocation(p.prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(p.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(p.u.u_time, this.time + s.params.seed * 3.7);
    gl.uniform3fv(p.u.u_pal, s.pal);
    gl.uniform1f(p.u.u_intensity, s.params.intensity);
    gl.uniform1f(p.u.u_scale, s.params.scale);
    gl.uniform1f(p.u.u_grain, s.params.grain);
    gl.uniform1f(p.u.u_vignette, s.params.vignette);
    gl.uniform1f(p.u.u_seed, s.params.seed);
    gl.uniform2f(p.u.u_mouse, 0, 0);
    gl.uniform1f(p.u.u_fade, this.fade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
