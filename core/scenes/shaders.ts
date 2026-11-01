// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The scenes themselves: small GLSL ES 1.0 fragment programs (WebGL 1, so they
// run on every GPU Electron supports, and on the software renderer). Each one
// defines `vec3 scene(vec2 uv, vec2 p)`: uv is 0..1 over the screen, p is
// centred and corrected for the aspect ratio, multiplied by the scale control.
// Colours come only from the palette (u_pal), so every palette fits every scene.
// Kept cheap on purpose: at most 4 octaves of value noise per pixel.

export const VERTEX = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export const PRELUDE = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_pal[4];
uniform float u_intensity;
uniform float u_scale;
uniform float u_grain;
uniform float u_vignette;
uniform float u_seed;
uniform vec2 u_mouse;
uniform float u_fade;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21) + u_seed * 0.013); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
vec3 pal(float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  if (t < 1.0) return mix(u_pal[0], u_pal[1], t);
  if (t < 2.0) return mix(u_pal[1], u_pal[2], t - 1.0);
  return mix(u_pal[2], u_pal[3], t - 2.0);
}
`;

const MAIN = `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y * u_scale + u_mouse * 0.03;
  vec3 c = scene(uv, p);
  float v = smoothstep(1.25, 0.2, length(uv - 0.5) * 1.6);
  c *= mix(1.0, v, u_vignette);
  c += (hash(gl_FragCoord.xy + fract(u_time) * 100.0) - 0.5) * u_grain * 0.12;
  gl_FragColor = vec4(c * u_fade, 1.0);
}
`;

const BODIES: Record<string, string> = {
  aurora: `
vec3 scene(vec2 uv, vec2 p) {
  float t = u_time * 0.05;
  vec3 c = pal(0.05 + uv.y * 0.18);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float band = p.y - 0.15 * fi + 0.1 - 0.25 * fbm(vec2(p.x * 1.4 + t * (1.0 + fi * 0.3), fi * 3.1 + t));
    float glow = exp(-abs(band) * (9.0 - u_intensity * 4.0)) * smoothstep(-0.4, 0.4, p.y + 0.3);
    float curtain = 0.6 + 0.4 * noise(vec2(p.x * 9.0 + t * 4.0, fi));
    c += pal(0.55 + 0.15 * fi) * glow * curtain * (0.5 + u_intensity);
  }
  float stars = step(0.996, hash(floor(gl_FragCoord.xy * 0.5))) * smoothstep(-0.1, 0.4, p.y);
  return c + stars * pal(1.0) * 0.6;
}`,
  nebula: `
vec3 scene(vec2 uv, vec2 p) {
  float t = u_time * 0.02;
  float n = fbm(p * 1.6 + vec2(t, -t * 0.7) + fbm(p * 2.0 - t) * 0.8);
  vec3 c = pal(n * (0.6 + u_intensity * 0.5));
  vec2 g = floor(gl_FragCoord.xy / 3.0);
  float s = hash(g);
  float tw = 0.5 + 0.5 * sin(u_time * (1.0 + s * 3.0) + s * 40.0);
  c += step(0.995, s) * tw * pal(1.0);
  return c;
}`,
  mesh: `
vec3 scene(vec2 uv, vec2 p) {
  float t = u_time * 0.07;
  vec2 a = vec2(sin(t * 1.1), cos(t * 0.9)) * 0.5;
  vec2 b = vec2(cos(t * 0.7 + 2.0), sin(t * 1.3 + 1.0)) * 0.55;
  vec2 d = vec2(sin(t * 0.5 + 4.0), cos(t * 0.8 + 3.0)) * 0.45;
  float wa = 1.0 / (0.15 + dot(p - a, p - a));
  float wb = 1.0 / (0.15 + dot(p - b, p - b));
  float wd = 1.0 / (0.15 + dot(p - d, p - d));
  vec3 c = (pal(0.33) * wa + pal(0.66) * wb + pal(1.0) * wd + pal(0.0) * 2.0) / (wa + wb + wd + 2.0);
  return mix(pal(0.2), c, 0.6 + u_intensity * 0.4);
}`,
  lava: `
vec3 scene(vec2 uv, vec2 p) {
  float t = u_time * 0.15;
  float f = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(t * (0.3 + fi * 0.07) + fi * 2.1) * 0.6, sin(t * (0.2 + fi * 0.05) + fi * 1.3) * 0.45);
    f += (0.02 + 0.01 * fi * u_intensity) / dot(p - c, p - c);
  }
  float edge = smoothstep(0.9, 1.1, f);
  return mix(pal(0.1 + uv.y * 0.15), pal(0.55 + clamp(f - 1.0, 0.0, 1.0) * 0.45), edge);
}`,
  silk: `
vec3 scene(vec2 uv, vec2 p) {
  float t = u_time * 0.08;
  float w = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    w += sin(p.x * (2.0 + fi) + p.y * (1.5 - fi * 0.4) + t * (1.0 + fi * 0.5) + sin(p.y * 3.0 + t + fi));
  }
  w = w / 3.0;
  float sheen = pow(0.5 + 0.5 * sin(w * 3.14159 * (1.0 + u_intensity)), 3.0);
  return mix(pal(0.15 + 0.25 * (w * 0.5 + 0.5)), pal(0.9), sheen * 0.6);
}`,
  contours: `
vec3 scene(vec2 uv, vec2 p) {
  float h = fbm(p * 1.3 + u_time * 0.01) + 0.15 * sin(u_time * 0.05);
  float lines = abs(fract(h * (10.0 + u_intensity * 8.0)) - 0.5);
  float line = smoothstep(0.06, 0.0, lines);
  float major = smoothstep(0.03, 0.0, abs(fract(h * 2.0) - 0.5));
  return mix(pal(0.0), pal(0.66), line * 0.55 + major * 0.35);
}`,
  hexes: `
vec3 scene(vec2 uv, vec2 p) {
  vec2 q = p * 6.0;
  vec2 r = vec2(1.0, 1.732);
  vec2 a = mod(q, r) - r * 0.5;
  vec2 b = mod(q - r * 0.5, r) - r * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = q - g;
  float d = max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y));
  float wave = 0.5 + 0.5 * sin(length(id) * 0.6 - u_time * 0.8 + noise(id * 0.3) * 4.0);
  float cell = smoothstep(0.5, 0.46, d);
  return mix(pal(0.0), pal(0.2 + wave * 0.6 * u_intensity + 0.1), cell);
}`,
  rain: `
vec3 scene(vec2 uv, vec2 p) {
  vec3 c = pal(0.1 + uv.y * 0.25 + fbm(p * 2.0 + u_time * 0.02) * 0.2);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = p * vec2(30.0 + fi * 15.0, 2.0 + fi);
    q.y += u_time * (2.5 + fi) ;
    q.x += q.y * 0.08;
    vec2 cell = floor(q);
    float h = hash(cell + fi * 7.0);
    float streak = step(0.9 - u_intensity * 0.08, h) * smoothstep(0.0, 0.6, fract(q.y)) * smoothstep(0.1, 0.0, abs(fract(q.x) - 0.5));
    c += pal(0.85) * streak * (0.25 - fi * 0.06);
  }
  return c;
}`,
  snow: `
vec3 scene(vec2 uv, vec2 p) {
  vec3 c = pal(0.05 + uv.y * 0.3);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float s = 6.0 + fi * 5.0;
    vec2 q = p * s;
    q.y += u_time * (0.4 + fi * 0.25);
    q.x += sin(q.y * 0.5 + fi) * 0.3 + u_time * 0.1;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = hash(cell + fi * 13.0);
    vec2 o = vec2(hash(cell + 1.3), hash(cell + 2.7)) - 0.5;
    float flake = step(1.0 - (0.35 + u_intensity * 0.4), h) * smoothstep(0.12 - fi * 0.025, 0.0, length(f - o * 0.6));
    c += pal(1.0) * flake * (0.9 - fi * 0.2);
  }
  return c;
}`,
  ocean: `
vec3 scene(vec2 uv, vec2 p) {
  float horizon = 0.1;
  if (p.y > horizon) {
    float cl = fbm(vec2(p.x * 1.5 + u_time * 0.01, p.y * 4.0));
    return mix(pal(0.75), pal(1.0), cl * 0.6 + (p.y - horizon) * 0.4);
  }
  float depth = horizon - p.y + 0.02;
  vec2 q = vec2(p.x / depth, 1.0 / depth);
  float w = 0.0;
  w += sin(q.x * 0.6 + q.y * 0.8 - u_time * 0.9) * 0.5;
  w += sin(q.x * 1.3 - q.y * 0.5 - u_time * 1.3) * 0.25;
  w += fbm(q * 0.4 + u_time * 0.1) * 0.5;
  float crest = smoothstep(0.55, 0.9, w) * u_intensity;
  vec3 c = mix(pal(0.25), pal(0.5), clamp(w * 0.5 + 0.4, 0.0, 1.0));
  c = mix(c, pal(0.75), smoothstep(0.25, 0.0, depth) * 0.5);
  return c + pal(1.0) * crest * 0.35;
}`,
  dunes: `
vec3 scene(vec2 uv, vec2 p) {
  vec3 c = pal(0.95 - uv.y * 0.35);
  vec2 sun = vec2(0.35, 0.2);
  c += pal(1.0) * smoothstep(0.12, 0.0, length(p - sun)) * 0.8;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float x = p.x * (1.0 + fi * 0.4) + u_time * 0.01 * (fi + 1.0) + fi * 3.0;
    float ridge = -0.05 - fi * 0.13 + 0.08 * sin(x * 2.0) + 0.05 * fbm(vec2(x * 2.0, fi));
    float m = smoothstep(0.004, -0.004, p.y - ridge);
    float shade = 0.15 + fi * 0.13 + 0.15 * smoothstep(-0.05, 0.05, cos(x * 2.0)) * u_intensity;
    c = mix(c, pal(0.6 - shade), m);
  }
  return c;
}`,
  rays: `
vec3 scene(vec2 uv, vec2 p) {
  vec2 src = vec2(-0.6, 0.65);
  vec2 d = p - src;
  float a = atan(d.y, d.x);
  float r = length(d);
  float beams = 0.0;
  beams += noise(vec2(a * 18.0, u_time * 0.15));
  beams += noise(vec2(a * 31.0, u_time * 0.1 + 7.0)) * 0.5;
  beams = pow(beams / 1.5, 3.0) * smoothstep(1.8, 0.0, r) * (0.6 + u_intensity);
  vec3 c = pal(0.15 + uv.y * 0.3 + fbm(p * 1.5 + u_time * 0.02) * 0.15);
  return c + pal(0.95) * beams * 0.8;
}`,
  fireflies: `
vec3 scene(vec2 uv, vec2 p) {
  vec3 c = pal(0.02 + uv.y * 0.22);
  float ground = smoothstep(0.01, -0.01, p.y + 0.3 + 0.04 * fbm(vec2(p.x * 3.0, 0.0)));
  c = mix(c, pal(0.0), ground);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    vec2 o = vec2(hash(vec2(fi, 1.0)), hash(vec2(fi, 2.0))) * 2.0 - 1.0;
    vec2 pos = vec2(o.x * 0.9 + sin(u_time * 0.2 + fi) * 0.15, o.y * 0.35 - 0.1 + cos(u_time * 0.27 + fi * 1.7) * 0.1);
    float blink = smoothstep(0.3, 1.0, sin(u_time * (0.5 + hash(vec2(fi, 3.0))) + fi * 2.0));
    c += pal(1.0) * blink * (0.0015 + u_intensity * 0.0015) / (dot(p - pos, p - pos) + 0.0006);
  }
  return c;
}`,
  koi: `
vec3 scene(vec2 uv, vec2 p) {
  float rip = fbm(p * 3.0 + vec2(u_time * 0.05, -u_time * 0.04));
  vec3 c = mix(pal(0.2), pal(0.45), rip);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float t = u_time * (0.05 + fi * 0.01) + fi * 1.9;
    vec2 pos = vec2(cos(t) * (0.5 + fi * 0.08), sin(t * 1.3) * 0.35);
    vec2 dir = normalize(vec2(-sin(t) * (0.5 + fi * 0.08), cos(t * 1.3) * 0.35 * 1.3));
    vec2 q = p - pos;
    vec2 l = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
    float body = smoothstep(0.012, 0.0, l.y * l.y * 30.0 + (l.x + 0.03) * (l.x + 0.03) * 2.5 - 0.0025 - 0.02 * u_intensity * 0.1);
    c = mix(c, i == 0 || i == 3 ? pal(0.95) : pal(0.75), body * 0.85);
  }
  float caustic = pow(noise(p * 9.0 + u_time * 0.3), 4.0);
  return c + pal(1.0) * caustic * 0.25;
}`,
};

/** The full fragment program for a scene (falls back to the first one). */
export function fragmentFor(id: string): string {
  return `${PRELUDE}\n${BODIES[id] ?? BODIES.aurora}\n${MAIN}`;
}

export const SHADER_IDS = Object.keys(BODIES);
