// js/FX/webgl_pass.js
// WebGL fullscreen post-process pipeline (single shader pass into an offscreen FBO + blit).
//
// ОСТАВЛЕНО (view-only):
//  - Barrel distortion (CRT-ish)
//  - Chromatic aberration
//  - Jelly distortion: ripples + shockwave + radial blast
//  - Ripple ring brightness (локальная подсветка по кольцу)
//  - Perlin/FBM warp (лёгкое "плавание" фона)
//  - Vignette
//
// УБРАНО ИЗ ШЕЙДЕРА И ИЗ РАСЧЁТА:
//  - Ghosting/afterimage
//  - Glow
//  - Grain
//  - Overlay
//  - Smooth/AA

function compileShader(gl, type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    const msg = gl.getShaderInfoLog(sh) || "Shader compile failed";
    gl.deleteShader(sh);
    throw new Error(msg);
  }
  return sh;
}

function linkProgram(gl, vsSrc, fsSrc){
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)){
    const msg = gl.getProgramInfoLog(prog) || "Program link failed";
    gl.deleteProgram(prog);
    throw new Error(msg);
  }
  return prog;
}

function makeGL(canvas){
  // Prefer WebGL2, fall back to WebGL1.
  const opts = {
    alpha: false,
    antialias: true, // MSAA where available
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  };

  let gl = canvas.getContext("webgl2", opts);
  if (gl) return gl;
  gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
  return gl;
}

// Fullscreen quad, clip-space.
const VS_SRC = `
  attribute vec2 aPos;
  varying vec2 vUV;
  void main(){
    vUV = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

// Fragment shader:
// - barrel distortion (with aspect compensation)
// - chromatic aberration (radial RGB sampling)
// - ripples + ring brightness
// - warp + vignette
const FS_SRC = `
  precision mediump float;
  varying vec2 vUV;

  uniform sampler2D uScene;   // текущий Canvas2D кадр
  uniform vec2 uRes;
  uniform vec2 uCenter;
  uniform float uAspect;
  uniform float uK;
  uniform float uExp;
  uniform float uCornerR;

  // Хроматическая аберрация
  uniform float uChromaPx;     // базовая сила (в пикселях)
  uniform float uChromaMult;   // динамический множитель (low HP + всплески)

  // Виньетка
  uniform float uVignette;

  // Jelly distortion / волны
  #define MAX_RIPPLES 6
  uniform vec4 uRipples[MAX_RIPPLES];

  // -------------------------------------------------
  // ЛОКАЛЬНАЯ ПОДСВЕТКА ОТ RIPPLE (по кольцу)
  // uRingWidth: толщина кольца (UV 0..1). Чем больше — тем шире.
  // uRingBrightness: +яркость в кольце (0.10 = +10%).
  // uRippleFade: множитель затухания всей волны (1.0 = как было; 1.5 быстрее; 0.7 медленнее).
  // -------------------------------------------------
  uniform float uRingWidth;
  uniform float uRingBrightness;
  uniform float uRingSaturation;
  uniform float uRippleFade;

  // Warp ("плывущий" фон)
  uniform float uWarpPx;
  uniform float uWarpScale;
  uniform float uWarpSpeed;

  uniform float uTime; // секунды

  // ---------- Noise helpers ----------
  float hash12(vec2 p){
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise2(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0 - 2.0*f);
    float a = hash12(i + vec2(0.0,0.0));
    float b = hash12(i + vec2(1.0,0.0));
    float c = hash12(i + vec2(0.0,1.0));
    float d = hash12(i + vec2(1.0,1.0));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }

  float fbm(vec2 p){
    float v = 0.0;
    float a = 0.5;
    for (int i=0; i<4; i++){
      v += a * noise2(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  // Hue-preserving highlight compression:
  // If any channel goes above 1.0, normalize by max channel.
  vec3 compressHighlights(vec3 c){
    float m = max(max(c.r, c.g), c.b);
    return (m > 1.0) ? (c / m) : c;
  }

  // ---------- Barrel (как раньше) ----------
  vec2 barrel(vec2 uv){
    vec2 d = uv - uCenter;
    d.x *= uAspect;
    float r = length(d);
    float rn = clamp(r / max(1e-4, uCornerR), 0.0, 1.0);
    float t = pow(rn, uExp);
    float zoom = 1.0 / (1.0 + uK);
    float scale = 1.0 + uK * t;
    d *= zoom * scale;
    d.x /= uAspect;
    return uCenter + d;
  }

  // ---------- Jelly distortion (ripples + warp) ----------
  vec2 applyWarp(vec2 uv){
    if (uWarpPx <= 0.001) return uv;
    vec2 p = (uv - uCenter) * vec2(uAspect, 1.0);
    float t = uTime * uWarpSpeed;
    float n = fbm(p * uWarpScale + vec2(t, -t));
    float a = (n - 0.5) * 2.0; // -1..1
    vec2 dir = vec2(a, (fbm(p * uWarpScale + vec2(-t, t)) - 0.5) * 2.0);
    vec2 px = (uWarpPx / uRes) * dir;
    return uv + px;
  }

  vec2 applyRipples(vec2 uv){
    vec2 off = vec2(0.0);
    for (int i=0; i<MAX_RIPPLES; i++){
      vec4 r = uRipples[i];
      // r = (x, y, ageSec, kind)
      float kind = r.w;
      float age = r.z;
      if (age <= 0.0001) continue;
      vec2 c = r.xy;

      vec2 d = uv - c;
      d.x *= uAspect;
      float dist = length(d);
      vec2 dir = (dist > 1e-4) ? (d / dist) : vec2(0.0);

      // Ограничение влияния по радиусу (чтобы волна не работала на весь экран)
      float maxRadius = 0.45;
      float radialFade = 1.0 - smoothstep(maxRadius * 0.8, maxRadius, dist);

      // Параметры по типу (всё эмпирически, правится легко):
      float ampPx = 3.0;
      float freq = 26.0;
      float speed = 16.0;
      float decay = 2.2;
      if (kind > 1.5){
        // BLAST
        ampPx = 6.0;
        freq = 18.0;
        speed = 5.0;
        decay = 1.7;
      } else if (kind > 0.5){
        // SHOCK
        ampPx = 4.5;
        freq = 22.0;
        speed = 7.0;
        decay = 2.8;
      }

      // Общее затухание волны: decay (по типу) * uRippleFade (глобальный множитель)
      float env = exp(-age * decay * max(0.001, uRippleFade));

      // Для SHOCK/BLAST делаем "кольцо" (ударная волна), для TAP — обычную синусоиду.
      float wave;
      if (kind > 0.5){
        float ringR = age * 0.35;      // радиус кольца в UV (примерно)
        float band = max(0.001, uRingWidth); // толщина кольца (настраиваемая)
        float ring = 1.0 - smoothstep(0.0, band, abs(dist - ringR));
        wave = ring * sin(dist * freq - age * speed);
      } else {
        wave = sin(dist * freq - age * speed);
      }

      vec2 px = (ampPx * env * wave * radialFade) / uRes;
      vec2 dirUV = vec2(dir.x / uAspect, dir.y);
      off += dirUV * px;
    }
    return uv + off;
  }

  // ---------- Chromatic aberration ----------
  vec3 sampleRGB(vec2 uv){
    vec2 duv = uv - uCenter;
    float len = max(1e-4, length(duv));
    vec2 dir = duv / len;

    vec2 d = duv;
    d.x *= uAspect;
    float rn = clamp(length(d) / max(1e-4, uCornerR), 0.0, 1.0);
    float t = pow(rn, max(1.0, uExp));

    float chromaPx = uChromaPx * uChromaMult;
    vec2 px = dir * ((chromaPx * t) / uRes);
    float rC = texture2D(uScene, uv + px).r;
    float gC = texture2D(uScene, uv).g;
    float bC = texture2D(uScene, uv - px).b;
    return vec3(rC, gC, bC);
  }

  void main(){
    // Порядок:
    // 1) barrel -> 2) warp -> 3) ripples -> 4) sampleRGB -> 5) ring brightness -> 6) vignette

    vec2 uv = barrel(vUV);
    uv = applyWarp(uv);
    uv = applyRipples(uv);

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    vec3 col = sampleRGB(uv);

    // -------------------------------------------------
    // ЛОКАЛЬНАЯ ПОДСВЕТКА В КОЛЬЦЕ RIPPLE
    // -------------------------------------------------
    float ringMask = 0.0;
    for (int i=0; i<MAX_RIPPLES; i++){
      vec4 r = uRipples[i];
      float age = r.z;
      if (age <= 0.0001) continue;
      vec2 d = vUV - r.xy;
      d.x *= uAspect;
      float dist = length(d);
      float ringR = age * 0.35;
      float band = max(0.001, uRingWidth);
      float m = 1.0 - smoothstep(0.0, band, abs(dist - ringR));
      float fade = exp(-age * max(0.001, uRippleFade));
      ringMask = max(ringMask, m * fade);
    }

    if (ringMask > 0.001){
      float b = (uRingBrightness > 0.00001) ? (uRingBrightness * ringMask) : 0.0;
      float s = (uRingSaturation > 0.00001) ? (uRingSaturation * ringMask) : 0.0;

      if (b > 0.0){
        col *= (1.0 + b);
      }
      if (s > 0.0){
        // Saturation boost without whitening: scale chroma around luminance
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 gray = vec3(lum);
        col = gray + (col - gray) * (1.0 + s);
      }
      col = compressHighlights(col);
    }

    // виньетка
    if (uVignette > 0.001){
      vec2 dd = vUV - uCenter;
      dd.x *= uAspect;
      float rn = clamp(length(dd) / max(1e-4, uCornerR), 0.0, 1.0);
      float v = 1.0 - uVignette * pow(rn, 1.8);
      col *= v;
    }

    col = compressHighlights(col);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Простой blit в экран (без эффекта) — нужен, потому что основной шейдер рисует в FBO.
const FS_BLIT = `
  precision mediump float;
  varying vec2 vUV;
  uniform sampler2D uTex;
  void main(){
    gl_FragColor = texture2D(uTex, vUV);
  }
`;

export class WebGLPass {
  constructor(canvas){
    this.canvas = canvas;
    this.gl = null;
    this.prog = null;
    this.buf = null;
    this.tex = null; // uScene
    this._fboA = null;
    this._fboB = null;
    this._texA = null;
    this._texB = null;
    this._useA = true;
    this._progBlit = null;
    this.isOk = false;
    this._w = 0;
    this._h = 0;

    this._loc = null;
    this._locBlit = null;
  }

  init(){
    const gl = makeGL(this.canvas);
    if (!gl) return false;
    this.gl = gl;

    // Flip Y on upload so the final image isn't upside-down.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    try {
      this.prog = linkProgram(gl, VS_SRC, FS_SRC);
      this._progBlit = linkProgram(gl, VS_SRC, FS_BLIT);
    } catch (e){
      console.warn("FX WebGL program failed:", e);
      return false;
    }

    // Quad buffer
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]), gl.STATIC_DRAW);

    // Texture (текущая сцена)
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Uniform/attrib locations
    this._loc = {
      aPos: gl.getAttribLocation(this.prog, "aPos"),
      uScene: gl.getUniformLocation(this.prog, "uScene"),
      uRes: gl.getUniformLocation(this.prog, "uRes"),
      uCenter: gl.getUniformLocation(this.prog, "uCenter"),
      uAspect: gl.getUniformLocation(this.prog, "uAspect"),
      uK: gl.getUniformLocation(this.prog, "uK"),
      uExp: gl.getUniformLocation(this.prog, "uExp"),
      uCornerR: gl.getUniformLocation(this.prog, "uCornerR"),
      uChromaPx: gl.getUniformLocation(this.prog, "uChromaPx"),
      uChromaMult: gl.getUniformLocation(this.prog, "uChromaMult"),
      uVignette: gl.getUniformLocation(this.prog, "uVignette"),
      uRipples: gl.getUniformLocation(this.prog, "uRipples"),
      uRingWidth: gl.getUniformLocation(this.prog, "uRingWidth"),
      uRingBrightness: gl.getUniformLocation(this.prog, "uRingBrightness"),
      uRingSaturation: gl.getUniformLocation(this.prog, "uRingSaturation"),
      uRippleFade: gl.getUniformLocation(this.prog, "uRippleFade"),
      uWarpPx: gl.getUniformLocation(this.prog, "uWarpPx"),
      uWarpScale: gl.getUniformLocation(this.prog, "uWarpScale"),
      uWarpSpeed: gl.getUniformLocation(this.prog, "uWarpSpeed"),
      uTime: gl.getUniformLocation(this.prog, "uTime"),
    };

    this._locBlit = {
      aPos: gl.getAttribLocation(this._progBlit, "aPos"),
      uTex: gl.getUniformLocation(this._progBlit, "uTex"),
    };

    this.isOk = true;
    return true;
  }

  ensureSize(w, h){
    w = w | 0;
    h = h | 0;
    if (w <= 0 || h <= 0) return;
    if (this._w === w && this._h === h) return;
    this._w = w;
    this._h = h;
    if (this.gl){
      this.gl.viewport(0, 0, w, h);
      this._allocPingPong(w, h);
    }
  }

  _allocPingPong(w, h){
    const gl = this.gl;
    if (!gl) return;

    const makeTex = ()=>{
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    };

    const makeFbo = (tex)=>{
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return f;
    };

    const delTex = (t)=>{ try{ if (t) gl.deleteTexture(t); }catch(_e){} };
    const delFbo = (f)=>{ try{ if (f) gl.deleteFramebuffer(f); }catch(_e){} };
    delFbo(this._fboA); delFbo(this._fboB);
    delTex(this._texA); delTex(this._texB);

    this._texA = makeTex();
    this._texB = makeTex();
    this._fboA = makeFbo(this._texA);
    this._fboB = makeFbo(this._texB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(srcCanvas, params){
    if (!this.isOk){
      if (!this.init()) return false;
    }

    const gl = this.gl;
    if (!gl) return false;

    const w = (this.canvas.width|0);
    const h = (this.canvas.height|0);
    this.ensureSize(w, h);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 1) Upload latest scene into texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

    // 2) Выбираем FBO, куда рисуем результат
    const outFbo = this._useA ? this._fboA : this._fboB;
    const outTex = this._useA ? this._texA : this._texB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 3) Основной FX шейдер (в FBO)
    gl.useProgram(this.prog);
    gl.uniform1i(this._loc.uScene, 0);

    const k = params.barrelK;
    const exp = params.barrelExp;
    const chroma = params.chromaticPx;
    const chromaMult = params.chromaMult;
    const vignette = params.vignette;
    const cx = params.centerX;
    const cy = params.centerY;
    const aspect = w / Math.max(1, h);

    gl.uniform2f(this._loc.uRes, w, h);
    gl.uniform2f(this._loc.uCenter, cx, cy);
    gl.uniform1f(this._loc.uAspect, aspect);
    gl.uniform1f(this._loc.uK, k);
    gl.uniform1f(this._loc.uExp, exp);
    const cornerR = Math.hypot(0.5*aspect, 0.5);
    gl.uniform1f(this._loc.uCornerR, cornerR);
    gl.uniform1f(this._loc.uChromaPx, chroma);
    gl.uniform1f(this._loc.uChromaMult, chromaMult);
    gl.uniform1f(this._loc.uVignette, vignette);

    // Ripples array
    if (this._loc.uRipples && params.ripples instanceof Float32Array){
      gl.uniform4fv(this._loc.uRipples, params.ripples);
    }

    // Ring brightness + fade
    if (this._loc.uRingWidth)       gl.uniform1f(this._loc.uRingWidth, (params.ringWidth ?? 0.06));
    if (this._loc.uRingBrightness)  gl.uniform1f(this._loc.uRingBrightness, (params.ringBrightness ?? 0.10));
    if (this._loc.uRingSaturation)  gl.uniform1f(this._loc.uRingSaturation, (params.ringSaturation ?? 0.20));
    if (this._loc.uRippleFade)      gl.uniform1f(this._loc.uRippleFade, (params.rippleFade ?? 1.0));

    gl.uniform1f(this._loc.uWarpPx, params.warpPx || 0.0);
    gl.uniform1f(this._loc.uWarpScale, params.warpScale || 1.0);
    gl.uniform1f(this._loc.uWarpSpeed, params.warpSpeed || 0.0);

    gl.uniform1f(this._loc.uTime, params.time || 0.0);

    // Draw quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this._loc.aPos);
    gl.vertexAttribPointer(this._loc.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 4) Blit из outTex в экран
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this._progBlit);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, outTex);
    gl.uniform1i(this._locBlit.uTex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this._locBlit.aPos);
    gl.vertexAttribPointer(this._locBlit.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // swap ping-pong
    this._useA = !this._useA;
    return true;
  }

  // Fast path: just blit srcCanvas to the screen with WebGL.
  blit(srcCanvas){
    if (!this.isOk){
      if (!this.init()) return false;
    }
    const gl = this.gl;
    if (!gl) return false;

    const w = (this.canvas.width|0);
    const h = (this.canvas.height|0);
    this.ensureSize(w, h);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this._progBlit);
    gl.uniform1i(this._locBlit.uTex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this._locBlit.aPos);
    gl.vertexAttribPointer(this._locBlit.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }
}
