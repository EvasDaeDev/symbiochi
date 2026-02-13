// js/FX/webgl_pass.js
// WebGL fullscreen post-process pipeline (single shader pass into an offscreen FBO + blit).
//
// Эффекты (всё в WebGL, view-only):
//  - Barrel distortion (CRT-ish)
//  - Chromatic aberration (динамическая: low HP / флэш от мутаций)
//  - Ghosting/afterimage (mix с предыдущим финальным кадром)
//  - Jelly distortion: ripples + shockwave + radial blast (клик / мутация / почкование)
//  - Нелинейный glow (дешёвый pseudo-bloom)
//  - Perlin/FBM warp (лёгкое "плавание" фона)
//  - Аккуратный overlay + grain
//
// Важно: этот слой НЕ изменяет state. Он получает параметры извне.

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
// - subtle vignette
// - simple AA: tiny neighbor blend (helps smooth distortion edges)
const FS_SRC = `
  precision mediump float;
  varying vec2 vUV;

  uniform sampler2D uScene;   // текущий Canvas2D кадр
  uniform sampler2D uPrev;    // предыдущий финальный кадр (для ghosting)
  uniform vec2 uRes;
  uniform vec2 uCenter;
  uniform float uAspect;
  uniform float uK;
  uniform float uExp;
  uniform float uCornerR;

  // Хроматическая аберрация
  uniform float uChromaPx;     // базовая сила (в пикселях)
  uniform float uChromaMult;   // динамический множитель (low HP + всплески)

  // Виньетка + лёгкое сглаживание
  uniform float uVignette;
  uniform float uSmooth;

  // Ghosting
  uniform float uGhostAlpha;

  // Jelly distortion / волны
  #define MAX_RIPPLES 6
  uniform vec4 uRipples[MAX_RIPPLES];

  // Warp ("плывущий" фон)
  uniform float uWarpPx;
  uniform float uWarpScale;
  uniform float uWarpSpeed;

  // Glow
  uniform float uGlowStrength;
  uniform float uGlowThreshold;
  uniform float uGlowCurve;
  uniform float uGlowRadiusPx;

  // Overlay + grain
  uniform float uGrain;
  uniform float uGrainSpeed;
  uniform float uOverlay;

  uniform float uTime; // секунды

  // ---------- Noise helpers ----------
  float hash12(vec2 p){
    // дешёвый хэш (без texture noise)
    vec3 p3  = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise2(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    // smoothstep
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

      // Параметры по типу (всё эмпирически, правится легко):
      float ampPx = 3.0;
      float freq = 26.0;
      float speed = 6.0;
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

      float env = exp(-age * decay);

      // Для SHOCK/BLAST делаем "кольцо" (ударная волна), для TAP — обычную синусоиду.
      float wave;
      if (kind > 0.5){
        float ringR = age * 0.35;      // радиус кольца в UV (примерно)
        float band = 0.06;            // толщина кольца
        float ring = 1.0 - smoothstep(0.0, band, abs(dist - ringR));
        wave = ring * sin(dist * freq - age * speed);
      } else {
        wave = sin(dist * freq - age * speed);
      }

      vec2 px = (ampPx * env * wave) / uRes;
      // dir сейчас в aspect-space: x уже *aspect. Возвращаем в UV-space.
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

  // ---------- Glow (pseudo-bloom) ----------
  float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec3 glowAround(vec2 uv){
    if (uGlowStrength <= 0.001) return vec3(0.0);
    vec2 tpx = 1.0 / uRes;
    vec2 rpx = (uGlowRadiusPx) * tpx;

    // 8 соседей + центр
    vec3 c0 = texture2D(uScene, uv).rgb;
    vec3 c1 = texture2D(uScene, uv + vec2( rpx.x, 0.0)).rgb;
    vec3 c2 = texture2D(uScene, uv + vec2(-rpx.x, 0.0)).rgb;
    vec3 c3 = texture2D(uScene, uv + vec2(0.0,  rpx.y)).rgb;
    vec3 c4 = texture2D(uScene, uv + vec2(0.0, -rpx.y)).rgb;
    vec3 c5 = texture2D(uScene, uv + vec2( rpx.x,  rpx.y)).rgb;
    vec3 c6 = texture2D(uScene, uv + vec2(-rpx.x,  rpx.y)).rgb;
    vec3 c7 = texture2D(uScene, uv + vec2( rpx.x, -rpx.y)).rgb;
    vec3 c8 = texture2D(uScene, uv + vec2(-rpx.x, -rpx.y)).rgb;

    vec3 avg = (c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8) / 9.0;

    // нелинейная маска по яркости
    float m = smoothstep(uGlowThreshold, 1.0, luma(c0));
    m = pow(m, uGlowCurve);
    return avg * (uGlowStrength * m);
  }

  // ---------- Overlay / grain ----------
  vec3 applyOverlay(vec2 uv, vec3 col){
    if (uGrain > 0.001){
      float g = (hash12(uv * uRes + uTime * uGrainSpeed) - 0.5) * 2.0;
      col += g * uGrain;
    }
    if (uOverlay > 0.001){
      // мягкий "цветной" overlay на основе шума
      float n = fbm((uv - uCenter) * 2.0 + vec2(uTime*0.08, -uTime*0.06));
      vec3 tint = vec3(0.6 + 0.4*n, 0.55, 0.7 - 0.4*n);
      col = mix(col, col * tint, uOverlay);
    }
    return col;
  }

  void main(){
    // Порядок:
    // 1) barrel -> 2) warp -> 3) ripples -> 4) sampleRGB -> 5) glow -> 6) AA/vignette -> 7) ghost -> 8) overlay/grain

    vec2 uv = barrel(vUV);
    uv = applyWarp(uv);
    uv = applyRipples(uv);

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    vec3 col = sampleRGB(uv);
    col += glowAround(uv);

    // лёгкое сглаживание по краям
    if (uSmooth > 0.001){
      vec2 tpx = 1.0 / uRes;
      vec3 n1 = sampleRGB(uv + vec2(tpx.x, 0.0));
      vec3 n2 = sampleRGB(uv - vec2(tpx.x, 0.0));
      vec3 n3 = sampleRGB(uv + vec2(0.0, tpx.y));
      vec3 n4 = sampleRGB(uv - vec2(0.0, tpx.y));
      vec3 avg = (n1 + n2 + n3 + n4) * 0.25;
      vec2 dd = vUV - uCenter;
      dd.x *= uAspect;
      float rn = clamp(length(dd) / max(1e-4, uCornerR), 0.0, 1.0);
      float edge = smoothstep(0.15, 1.0, pow(rn, 1.4));
      col = mix(col, avg, uSmooth * edge);
    }

    // виньетка
    if (uVignette > 0.001){
      vec2 dd = vUV - uCenter;
      dd.x *= uAspect;
      float rn = clamp(length(dd) / max(1e-4, uCornerR), 0.0, 1.0);
      float v = 1.0 - uVignette * pow(rn, 1.8);
      col *= v;
    }

    // ghosting: смешиваем с предыдущим финальным кадром
    if (uGhostAlpha > 0.001){
      vec3 prev = texture2D(uPrev, vUV).rgb;
      col = mix(col, prev, uGhostAlpha);
    }

    col = applyOverlay(vUV, col);
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
    this.prevTex = null; // uPrev
    this._prevFbo = null; // FBO для prevTex (обновляем через рендер, без glCopyTexSubImage2D)
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

    // Canvas2D has a top-left origin, but WebGL texture coordinates use (0,0)
    // at the bottom-left. Flip Y on upload so the final image isn't upside-down.
    // (Safe to set once; applies to subsequent texImage2D calls.)
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
    // LINEAR makes distortion look smooth.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Предыдущий финальный кадр (ghosting)
    this.prevTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // FBO под prevTex: так мы можем копировать финальный кадр через обычный рендер-проход.
    // Это надёжнее, чем glCopyTexSubImage2D: на некоторых платформах default framebuffer может быть RGB (без альфы)
    // и тогда copyTexSubImage2D в RGBA текстуру даёт GL_INVALID_OPERATION.
    this._prevFbo = gl.createFramebuffer();

    // Uniform/attrib locations
    this._loc = {
      aPos: gl.getAttribLocation(this.prog, "aPos"),
      uScene: gl.getUniformLocation(this.prog, "uScene"),
      uPrev: gl.getUniformLocation(this.prog, "uPrev"),
      uRes: gl.getUniformLocation(this.prog, "uRes"),
      uCenter: gl.getUniformLocation(this.prog, "uCenter"),
      uAspect: gl.getUniformLocation(this.prog, "uAspect"),
      uK: gl.getUniformLocation(this.prog, "uK"),
      uExp: gl.getUniformLocation(this.prog, "uExp"),
      uCornerR: gl.getUniformLocation(this.prog, "uCornerR"),
      uChromaPx: gl.getUniformLocation(this.prog, "uChromaPx"),
      uChromaMult: gl.getUniformLocation(this.prog, "uChromaMult"),
      uVignette: gl.getUniformLocation(this.prog, "uVignette"),
      uSmooth: gl.getUniformLocation(this.prog, "uSmooth"),
      uGhostAlpha: gl.getUniformLocation(this.prog, "uGhostAlpha"),
      uRipples: gl.getUniformLocation(this.prog, "uRipples"),
      uWarpPx: gl.getUniformLocation(this.prog, "uWarpPx"),
      uWarpScale: gl.getUniformLocation(this.prog, "uWarpScale"),
      uWarpSpeed: gl.getUniformLocation(this.prog, "uWarpSpeed"),
      uGlowStrength: gl.getUniformLocation(this.prog, "uGlowStrength"),
      uGlowThreshold: gl.getUniformLocation(this.prog, "uGlowThreshold"),
      uGlowCurve: gl.getUniformLocation(this.prog, "uGlowCurve"),
      uGlowRadiusPx: gl.getUniformLocation(this.prog, "uGlowRadiusPx"),
      uGrain: gl.getUniformLocation(this.prog, "uGrain"),
      uGrainSpeed: gl.getUniformLocation(this.prog, "uGrainSpeed"),
      uOverlay: gl.getUniformLocation(this.prog, "uOverlay"),
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

      // (Пере)создаём ping-pong текстуры для вывода
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

    // Удаляем старые
    const delTex = (t)=>{ try{ if (t) gl.deleteTexture(t); }catch(_e){} };
    const delFbo = (f)=>{ try{ if (f) gl.deleteFramebuffer(f); }catch(_e){} };
    delFbo(this._fboA); delFbo(this._fboB);
    delTex(this._texA); delTex(this._texB);

    this._texA = makeTex();
    this._texB = makeTex();
    this._fboA = makeFbo(this._texA);
    this._fboB = makeFbo(this._texB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // И prevTex тоже выделяем, чтобы ghosting не читал "пустоту"
    gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // Привязываем prevTex к отдельному framebuffer.
    // Дальше, в конце render(), мы будем рендерить outTex -> prevTex через blit-программу.
    // Это кросс-платформенно и не зависит от формата default framebuffer.
    if (this._prevFbo){
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._prevFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.prevTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
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

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prevTex);
    gl.uniform1i(this._loc.uPrev, 1);

    // Uniforms
    const k = params.barrelK;
    const exp = params.barrelExp;
    const chroma = params.chromaticPx;
    const chromaMult = params.chromaMult;
    const vignette = params.vignette;
    const smooth = params.smooth;
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
    gl.uniform1f(this._loc.uSmooth, smooth);

    gl.uniform1f(this._loc.uGhostAlpha, params.ghostAlpha || 0.0);

    // Ripples array
    if (this._loc.uRipples && params.ripples instanceof Float32Array){
      gl.uniform4fv(this._loc.uRipples, params.ripples);
    }

    gl.uniform1f(this._loc.uWarpPx, params.warpPx || 0.0);
    gl.uniform1f(this._loc.uWarpScale, params.warpScale || 1.0);
    gl.uniform1f(this._loc.uWarpSpeed, params.warpSpeed || 0.0);

    gl.uniform1f(this._loc.uGlowStrength, params.glowStrength || 0.0);
    gl.uniform1f(this._loc.uGlowThreshold, params.glowThreshold || 0.0);
    gl.uniform1f(this._loc.uGlowCurve, params.glowCurve || 1.0);
    gl.uniform1f(this._loc.uGlowRadiusPx, params.glowRadiusPx || 1.0);

    gl.uniform1f(this._loc.uGrain, params.grain || 0.0);
    gl.uniform1f(this._loc.uGrainSpeed, params.grainSpeed || 1.0);
    gl.uniform1f(this._loc.uOverlay, params.overlay || 0.0);
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

    // 5) Кладём outTex в prevTex (для ghosting в следующем кадре)
    // ВАЖНО: НЕ используем glCopyTexSubImage2D.
    // На некоторых платформах default framebuffer создаётся в RGB565 (без альфы),
    // и копирование в RGBA-текстуру приводит к GL_INVALID_OPERATION.
    // Поэтому делаем обычный blit в отдельный FBO, привязанный к prevTex.
    if (this._prevFbo){
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._prevFbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this._progBlit);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, outTex);
      gl.uniform1i(this._locBlit.uTex, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(this._locBlit.aPos);
      gl.vertexAttribPointer(this._locBlit.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // swap ping-pong
    this._useA = !this._useA;
    return true;
  }
}
