function compileShader(gl, type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    const msg = gl.getShaderInfoLog(sh) || 'Shader compile failed';
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
    const msg = gl.getProgramInfoLog(prog) || 'Program link failed';
    gl.deleteProgram(prog);
    throw new Error(msg);
  }
  return prog;
}

function makeGL(canvas){
  const opts = { alpha:false, antialias:true, depth:false, stencil:false, preserveDrawingBuffer:false, premultipliedAlpha:false, powerPreference:'high-performance' };
  let gl = canvas.getContext('webgl2', opts);
  if (gl) return gl;
  return canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
}

const VS_SRC = `
attribute vec2 aPos;
varying vec2 vUV;
void main(){
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS_SRC = `
precision mediump float;
varying vec2 vUV;

uniform sampler2D uScene;
uniform sampler2D uPrevTex;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uK;
uniform float uExp;
uniform float uCornerR;
uniform float uChromaPx;
uniform float uChromaMult;
uniform float uVignette;
#define MAX_RIPPLES 6
uniform vec4 uRipples[MAX_RIPPLES];
uniform float uRingWidth;
uniform float uRingBrightness;
uniform float uRingSaturation;
uniform float uRippleFade;
uniform float uWarpPx;
uniform float uWarpScale;
uniform float uWarpSpeed;
uniform float uGhostAlpha;
uniform float uGlowStrength;
uniform float uGlowRadiusPx;
uniform float uGlowBgLumaCut;
uniform float uGlowBand1;
uniform float uGlowBand2;
uniform float uGlowW1;
uniform float uGlowW2;
uniform float uGlowW3;
uniform float uGlowSoft;
uniform float uGrain;
uniform float uGrainSpeed;
uniform float uOverlay;
uniform float uTime;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float a = hash12(i), b = hash12(i+vec2(1.0,0.0)), c = hash12(i+vec2(0.0,1.0)), d = hash12(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i=0; i<4; i++) { v += a * noise2(p); p *= 2.02; a *= 0.5; }
  return v;
}
vec3 compressHighlights(vec3 c){
  float m = max(max(c.r, c.g), c.b);
  return (m > 1.0) ? (c / m) : c;
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 barrel(vec2 uv){
  vec2 d = uv - uCenter;
  d.x *= uAspect;
  float r = length(d);
  float rn = clamp(r / max(1e-4, uCornerR), 0.0, 1.0);
  float t = pow(rn, uExp);

  float scale = 1.0 + uK * t;

  d *= scale;
  d.x /= uAspect;
  return uCenter + d;
}
vec2 applyWarp(vec2 uv){
  if (uWarpPx <= 0.001) return uv;
  vec2 p = (uv - uCenter) * vec2(uAspect, 1.0);
  float t = uTime * uWarpSpeed;
  float n = fbm(p * uWarpScale + vec2(t, -t));
  float a = (n - 0.5) * 2.0;
  vec2 dir = vec2(a, (fbm(p * uWarpScale + vec2(-t, t)) - 0.5) * 2.0);
  vec2 px = (uWarpPx / uRes) * dir;
  return uv + px;
}
vec2 applyRipples(vec2 uv){
  vec2 off = vec2(0.0);
  for (int i=0; i<MAX_RIPPLES; i++){
    vec4 r = uRipples[i];
    float kind = r.w, age = r.z;
    if (age <= 0.0001) continue;
    vec2 c = r.xy;
    vec2 d = uv - c; d.x *= uAspect;
    float dist = length(d);
    vec2 dir = (dist > 1e-4) ? (d / dist) : vec2(0.0);
    float maxRadius = 0.45;
    float radialFade = 1.0 - smoothstep(maxRadius * 0.8, maxRadius, dist);
    float ampPx = 3.0, freq = 26.0, speed = 16.0, decay = 2.2;
    if (kind > 1.5){ ampPx = 6.0; freq = 18.0; speed = 5.0; decay = 1.7; }
    else if (kind > 0.5){ ampPx = 4.5; freq = 22.0; speed = 7.0; decay = 2.8; }
    float env = exp(-age * decay * max(0.001, uRippleFade));
    float wave;
    if (kind > 0.5){
      float ringR = age * 0.35;
      float band = max(0.001, uRingWidth);
      float ring = 1.0 - smoothstep(0.0, band, abs(dist - ringR));
      wave = ring * sin(dist * freq - age * speed);
    } else wave = sin(dist * freq - age * speed);
    vec2 px = (ampPx * env * wave * radialFade) / uRes;
    vec2 dirUV = vec2(dir.x / uAspect, dir.y);
    off += dirUV * px;
  }
  return uv + off;
}
vec3 sampleRGB(vec2 uv){
  vec2 duv = uv - uCenter;
  float len = max(1e-4, length(duv));
  vec2 dir = duv / len;
  vec2 d = duv; d.x *= uAspect;
  float rn = clamp(length(d) / max(1e-4, uCornerR), 0.0, 1.0);
  float t = pow(rn, max(1.0, uExp));
  float chromaPx = uChromaPx * uChromaMult;
  vec2 px = dir * ((chromaPx * t) / uRes);
  float rC = texture2D(uScene, uv + px).r;
  float gC = texture2D(uScene, uv).g;
  float bC = texture2D(uScene, uv - px).b;
  return vec3(rC, gC, bC);
}

vec3 computeGlow(vec2 uv){
  if (uGlowStrength <= 0.001 || uGlowRadiusPx <= 0.001) return vec3(0.0);

  vec2 px = vec2(1.0 / uRes.x, 1.0 / uRes.y);
  vec3 sum = vec3(0.0);
  float weight = 0.0;

  float stepPx = max(1.0, uGlowRadiusPx / 4.0);

  for (int xi = -5; xi <= 5; xi++){
    for (int yi = -5; yi <= 5; yi++){
      vec2 g = vec2(float(xi), float(yi));
      vec2 o = g * stepPx * 0.35;
      float distPx = length(o);
      if (distPx > uGlowRadiusPx) continue;

      vec3 s = texture2D(uScene, uv + o * px).rgb;
      float lum = luma(s);
      if (lum < uGlowBgLumaCut) continue;

      float nd = distPx / max(1.0, uGlowRadiusPx);
      float w = exp(-nd * nd * 3.5);
      w *= (1.0 - smoothstep(0.78, 1.0, nd));

      sum += s * w;
      weight += w;
    }
  }

  if (weight <= 0.0001) return vec3(0.0);

  vec3 glow = sum / weight;
  return glow * uGlowStrength;
}

void main(){
  vec2 uv = barrel(vUV);
  uv = applyWarp(uv);
  uv = applyRipples(uv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
  vec3 col = sampleRGB(uv);

  float ringMask = 0.0;
  for (int i=0; i<MAX_RIPPLES; i++){
    vec4 r = uRipples[i];
    float age = r.z;
    if (age <= 0.0001) continue;
    vec2 d = vUV - r.xy; d.x *= uAspect;
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
    if (b > 0.0) col *= (1.0 + b);
    if (s > 0.0){ float lum = luma(col); vec3 gray = vec3(lum); col = gray + (col - gray) * (1.0 + s); }
  }

  col += computeGlow(uv);

  if (uOverlay > 0.001){
    float ov = fbm(vUV * vec2(3.6, 2.8) + vec2(uTime * 0.03, -uTime * 0.02));
    vec3 tint = mix(vec3(0.98, 1.00, 1.05), vec3(1.05, 0.98, 1.02), ov);
    col *= mix(vec3(1.0), tint, clamp(uOverlay * 0.18, 0.0, 0.35));
  }
  if (uGrain > 0.001){
    float g = hash12(gl_FragCoord.xy + vec2(uTime * (20.0 + uGrainSpeed * 40.0)));
    col += (g - 0.5) * uGrain * 0.18;
  }
  if (uGhostAlpha > 0.001){
    vec3 prev = texture2D(uPrevTex, vUV).rgb;
    col = mix(col, prev, clamp(uGhostAlpha, 0.0, 0.96));
  }
  if (uVignette > 0.001){
    vec2 dd = vUV - uCenter; dd.x *= uAspect;
    float rn = clamp(length(dd) / max(1e-4, uCornerR), 0.0, 1.0);
    float v = 1.0 - uVignette * pow(rn, 1.8);
    col *= v;
  }
  gl_FragColor = vec4(compressHighlights(col), 1.0);
}`;

const FS_BLIT = `precision mediump float; varying vec2 vUV; uniform sampler2D uTex; void main(){ gl_FragColor = texture2D(uTex, vUV); }`;

export class WebGLPass {
  constructor(canvas){
    this.canvas = canvas; this.gl = null; this.prog = null; this.buf = null; this.tex = null;
    this._fboA = null; this._fboB = null; this._texA = null; this._texB = null; this._useA = true;
    this._progBlit = null; this.isOk = false; this._w = 0; this._h = 0; this._loc = null; this._locBlit = null;
  }
  init(){
    const gl = makeGL(this.canvas); if (!gl) return false; this.gl = gl; gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { this.prog = linkProgram(gl, VS_SRC, FS_SRC); this._progBlit = linkProgram(gl, VS_SRC, FS_BLIT); } catch(e){ console.warn('FX WebGL program failed:', e); return false; }
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this._loc = {
      aPos: gl.getAttribLocation(this.prog, 'aPos'), uScene: gl.getUniformLocation(this.prog, 'uScene'), uPrevTex: gl.getUniformLocation(this.prog, 'uPrevTex'), uRes: gl.getUniformLocation(this.prog, 'uRes'), uCenter: gl.getUniformLocation(this.prog, 'uCenter'), uAspect: gl.getUniformLocation(this.prog, 'uAspect'), uK: gl.getUniformLocation(this.prog, 'uK'), uExp: gl.getUniformLocation(this.prog, 'uExp'), uCornerR: gl.getUniformLocation(this.prog, 'uCornerR'), uChromaPx: gl.getUniformLocation(this.prog, 'uChromaPx'), uChromaMult: gl.getUniformLocation(this.prog, 'uChromaMult'), uVignette: gl.getUniformLocation(this.prog, 'uVignette'), uRipples: gl.getUniformLocation(this.prog, 'uRipples'), uRingWidth: gl.getUniformLocation(this.prog, 'uRingWidth'), uRingBrightness: gl.getUniformLocation(this.prog, 'uRingBrightness'), uRingSaturation: gl.getUniformLocation(this.prog, 'uRingSaturation'), uRippleFade: gl.getUniformLocation(this.prog, 'uRippleFade'), uWarpPx: gl.getUniformLocation(this.prog, 'uWarpPx'), uWarpScale: gl.getUniformLocation(this.prog, 'uWarpScale'), uWarpSpeed: gl.getUniformLocation(this.prog, 'uWarpSpeed'), uGhostAlpha: gl.getUniformLocation(this.prog, 'uGhostAlpha'), uGlowStrength: gl.getUniformLocation(this.prog, 'uGlowStrength'), uGlowRadiusPx: gl.getUniformLocation(this.prog, 'uGlowRadiusPx'), uGlowBgLumaCut: gl.getUniformLocation(this.prog, 'uGlowBgLumaCut'), uGlowBand1: gl.getUniformLocation(this.prog, 'uGlowBand1'), uGlowBand2: gl.getUniformLocation(this.prog, 'uGlowBand2'), uGlowW1: gl.getUniformLocation(this.prog, 'uGlowW1'), uGlowW2: gl.getUniformLocation(this.prog, 'uGlowW2'), uGlowW3: gl.getUniformLocation(this.prog, 'uGlowW3'), uGlowSoft: gl.getUniformLocation(this.prog, 'uGlowSoft'), uGrain: gl.getUniformLocation(this.prog, 'uGrain'), uGrainSpeed: gl.getUniformLocation(this.prog, 'uGrainSpeed'), uOverlay: gl.getUniformLocation(this.prog, 'uOverlay'), uTime: gl.getUniformLocation(this.prog, 'uTime')
    };
    this._locBlit = { aPos: gl.getAttribLocation(this._progBlit, 'aPos'), uTex: gl.getUniformLocation(this._progBlit, 'uTex') };
    this.isOk = true; return true;
  }
  ensureSize(w,h){ w|=0; h|=0; if (w<=0 || h<=0) return; if (this._w===w && this._h===h) return; this._w=w; this._h=h; if (this.gl){ this.gl.viewport(0,0,w,h); this._allocPingPong(w,h); } }
  _allocPingPong(w,h){
    const gl=this.gl; if(!gl) return;
    const makeTex=()=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null); return t; };
    const makeFbo=(tex)=>{ const f=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,f); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0); return f; };
    const delTex=(t)=>{ try{ if(t) gl.deleteTexture(t); }catch(_e){} }; const delFbo=(f)=>{ try{ if(f) gl.deleteFramebuffer(f); }catch(_e){} };
    delFbo(this._fboA); delFbo(this._fboB); delTex(this._texA); delTex(this._texB);
    this._texA=makeTex(); this._texB=makeTex(); this._fboA=makeFbo(this._texA); this._fboB=makeFbo(this._texB); gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  render(srcCanvas, params){
    if (!this.isOk && !this.init()) return false; const gl=this.gl; if(!gl) return false;
    const w=(this.canvas.width|0), h=(this.canvas.height|0); this.ensureSize(w,h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,srcCanvas);
    const outFbo=this._useA ? this._fboA : this._fboB; const outTex=this._useA ? this._texA : this._texB; const prevTex=this._useA ? this._texB : this._texA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo); gl.viewport(0,0,w,h); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog); gl.uniform1i(this._loc.uScene, 0); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prevTex); gl.uniform1i(this._loc.uPrevTex, 1); gl.activeTexture(gl.TEXTURE0);
    const aspect=w/Math.max(1,h); const cornerR=Math.hypot(0.5*aspect,0.5);
    gl.uniform2f(this._loc.uRes,w,h); gl.uniform2f(this._loc.uCenter,params.centerX,params.centerY); gl.uniform1f(this._loc.uAspect,aspect); gl.uniform1f(this._loc.uK,params.barrelK||0); gl.uniform1f(this._loc.uExp,params.barrelExp||2.0); gl.uniform1f(this._loc.uCornerR,cornerR); gl.uniform1f(this._loc.uChromaPx,params.chromaticPx||0); gl.uniform1f(this._loc.uChromaMult,params.chromaMult||1); gl.uniform1f(this._loc.uVignette,params.vignette||0); if (this._loc.uRipples && params.ripples instanceof Float32Array) gl.uniform4fv(this._loc.uRipples, params.ripples); gl.uniform1f(this._loc.uRingWidth, params.ringWidth ?? 0.06); gl.uniform1f(this._loc.uRingBrightness, params.ringBrightness ?? 0.10); gl.uniform1f(this._loc.uRingSaturation, params.ringSaturation ?? 0.20); gl.uniform1f(this._loc.uRippleFade, params.rippleFade ?? 1.0); gl.uniform1f(this._loc.uWarpPx, params.warpPx || 0.0); gl.uniform1f(this._loc.uWarpScale, params.warpScale || 1.0); gl.uniform1f(this._loc.uWarpSpeed, params.warpSpeed || 0.0); gl.uniform1f(this._loc.uGhostAlpha, params.ghostAlpha || 0.0); gl.uniform1f(this._loc.uGlowStrength, params.glowStrength || 0.0); gl.uniform1f(this._loc.uGlowRadiusPx, params.glowRadiusPx || 0.0); gl.uniform1f(this._loc.uGlowBgLumaCut, params.glowBgLumaCut || 0.1); gl.uniform1f(this._loc.uGlowBand1, params.glowBand1 || 0.33); gl.uniform1f(this._loc.uGlowBand2, params.glowBand2 || 0.66); gl.uniform1f(this._loc.uGlowW1, params.glowW1 || 0.35); gl.uniform1f(this._loc.uGlowW2, params.glowW2 || 0.20); gl.uniform1f(this._loc.uGlowW3, params.glowW3 || 0.10); gl.uniform1f(this._loc.uGlowSoft, params.glowSoft || 0.8); gl.uniform1f(this._loc.uGrain, params.grain || 0.0); gl.uniform1f(this._loc.uGrainSpeed, params.grainSpeed || 0.0); gl.uniform1f(this._loc.uOverlay, params.overlay || 0.0); gl.uniform1f(this._loc.uTime, params.time || 0.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.enableVertexAttribArray(this._loc.aPos); gl.vertexAttribPointer(this._loc.aPos, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,w,h); gl.useProgram(this._progBlit); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, outTex); gl.uniform1i(this._locBlit.uTex, 0); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.enableVertexAttribArray(this._locBlit.aPos); gl.vertexAttribPointer(this._locBlit.aPos, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    this._useA = !this._useA; return true;
  }
  blit(srcCanvas){
    if (!this.isOk && !this.init()) return false; const gl=this.gl; if(!gl) return false;
    const w=(this.canvas.width|0), h=(this.canvas.height|0); this.ensureSize(w,h); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,srcCanvas);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,w,h); gl.useProgram(this._progBlit); gl.uniform1i(this._locBlit.uTex, 0); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.enableVertexAttribArray(this._locBlit.aPos); gl.vertexAttribPointer(this._locBlit.aPos, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6); return true;
  }
}
