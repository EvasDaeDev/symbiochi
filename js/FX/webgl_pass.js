// js/FX/webgl_pass.js
// WebGL fullscreen post-process pass for CRT-like barrel distortion + chromatic aberration.
// Pure view-layer: does not touch game state.

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
  uniform sampler2D uTex;
  uniform vec2 uRes;
  uniform vec2 uCenter;
  uniform float uAspect;
  uniform float uK;
  uniform float uExp;
  uniform float uCornerR;
  uniform float uChromaPx;
  uniform float uVignette;
  uniform float uSmooth; // 0..1

  // Non-linear barrel: minimal at center, increases to edges by pow(r, uExp).
  // Uses aspect-correct radius and a compensating pre-zoom so the distorted image
  // still fills the frame (avoids black borders).
  vec2 barrel(vec2 uv){
    vec2 d = uv - uCenter;

    // aspect-correct space
    d.x *= uAspect;

    float r = length(d);
    float rn = clamp(r / max(1e-4, uCornerR), 0.0, 1.0);
    float t = pow(rn, uExp);

    // Max scale at edges is (1 + uK). Pre-zoom by its inverse to keep corners in-bounds.
    float zoom = 1.0 / (1.0 + uK);

    float scale = 1.0 + uK * t;
    d *= zoom * scale;

    // back to UV space
    d.x /= uAspect;
    return uCenter + d;
  }

  vec3 sampleRGB(vec2 uv){
    vec2 duv = uv - uCenter;
    float len = max(1e-4, length(duv));
    vec2 dir = duv / len;

    // Make chroma stronger near edges (also non-linear).
    vec2 d = duv;
    d.x *= uAspect;
    float rn = clamp(length(d) / max(1e-4, uCornerR), 0.0, 1.0);
    float t = pow(rn, max(1.0, uExp));

    vec2 px = dir * ((uChromaPx * t) / uRes);
    float rC = texture2D(uTex, uv + px).r;
    float gC = texture2D(uTex, uv).g;
    float bC = texture2D(uTex, uv - px).b;
    return vec3(rC, gC, bC);
  }

  void main(){
    vec2 uv = barrel(vUV);

    // Outside: black (should be rare due to zoom compensation).
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    vec3 col = sampleRGB(uv);

    // Simple AA: blend with 4-neighbor samples (very light), stronger near edges.
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
      float a = uSmooth * edge;
      col = mix(col, avg, a);
    }

    // Vignette (subtle, non-linear).
    if (uVignette > 0.001){
      vec2 dd = vUV - uCenter;
      dd.x *= uAspect;
      float rn = clamp(length(dd) / max(1e-4, uCornerR), 0.0, 1.0);
      float v = 1.0 - uVignette * pow(rn, 1.8);
      col *= v;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class WebGLPass {
  constructor(canvas){
    this.canvas = canvas;
    this.gl = null;
    this.prog = null;
    this.buf = null;
    this.tex = null;
    this.isOk = false;
    this._w = 0;
    this._h = 0;

    this._loc = null;
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

    // Texture
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // LINEAR makes distortion look smooth.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Uniform/attrib locations
    this._loc = {
      aPos: gl.getAttribLocation(this.prog, "aPos"),
      uTex: gl.getUniformLocation(this.prog, "uTex"),
      uRes: gl.getUniformLocation(this.prog, "uRes"),
      uCenter: gl.getUniformLocation(this.prog, "uCenter"),
      uAspect: gl.getUniformLocation(this.prog, "uAspect"),
      uK: gl.getUniformLocation(this.prog, "uK"),
      uExp: gl.getUniformLocation(this.prog, "uExp"),
      uCornerR: gl.getUniformLocation(this.prog, "uCornerR"),
      uChromaPx: gl.getUniformLocation(this.prog, "uChromaPx"),
      uVignette: gl.getUniformLocation(this.prog, "uVignette"),
      uSmooth: gl.getUniformLocation(this.prog, "uSmooth"),
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

    gl.useProgram(this.prog);

    // Upload latest scene into texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    // texImage2D with canvas is supported in WebGL1/2.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
    gl.uniform1i(this._loc.uTex, 0);

    // Uniforms
	const k = params.barrelK;
	const exp = params.barrelExp;
	const chroma = params.chromaticPx;
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
    gl.uniform1f(this._loc.uVignette, vignette);
    gl.uniform1f(this._loc.uSmooth, smooth);

    // Draw quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this._loc.aPos);
    gl.vertexAttribPointer(this._loc.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
  }
}
