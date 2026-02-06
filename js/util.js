import { BAR_MAX } from "./world.js";


export function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash32(seed, n, ...rest){
  let x = (seed >>> 0);
  if (n !== undefined){
    x = (x ^ ((n * 0x9E3779B1) >>> 0)) >>> 0;
  }
  for (const extra of rest){
    if (extra === undefined) continue;
    x = (x ^ ((extra * 0x9E3779B1) >>> 0)) >>> 0;
  }
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
export function clamp01(x){ return clamp(x,0,1); }
export function nowSec(){ return Math.floor(Date.now()/1000); }
export function pick(rng, arr){ return arr[Math.floor(rng()*arr.length)]; }

export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

export function fmtAgeSeconds(sec){
  if (sec < 60) return `${sec}с`;
  const m = Math.floor(sec/60);
  if (m < 60) return `${m}м`;
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${h}ч ${mm}м`;
}

export function key(x,y){ return `${x},${y}`; }
export function parseKey(k){ const [x,y]=k.split(",").map(Number); return [x,y]; }

export function barPct(x){
  return Math.round(clamp(x, 0, BAR_MAX)*100);
}

export function base64UrlEncode(bytes){
  const toUrl = (str) => str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (typeof btoa !== "undefined"){
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk){
      const slice = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode(...slice);
    }
    return toUrl(btoa(binary));
  }
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3){
    const b1 = bytes[i];
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    const t1 = b1 >> 2;
    const t2 = ((b1 & 3) << 4) | (b2 != null ? (b2 >> 4) : 0);
    const t3 = b2 != null ? (((b2 & 15) << 2) | (b3 != null ? (b3 >> 6) : 0)) : 64;
    const t4 = b3 != null ? (b3 & 63) : 64;
    out += table[t1] + table[t2] + (t3 === 64 ? "=" : table[t3]) + (t4 === 64 ? "=" : table[t4]);
  }
  return toUrl(out);
}

export function base64UrlDecode(str){
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  if (typeof atob !== "undefined"){
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const rev = new Uint8Array(256);
  rev.fill(255);
  for (let i = 0; i < table.length; i++) rev[table.charCodeAt(i)] = i;
  let validLen = padded.length;
  if (padded.endsWith("==")) validLen -= 2;
  else if (padded.endsWith("=")) validLen -= 1;
  const outLen = Math.floor((validLen * 3) / 4);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < padded.length; i += 4){
    const c1 = rev[padded.charCodeAt(i)];
    const c2 = rev[padded.charCodeAt(i + 1)];
    const c3 = rev[padded.charCodeAt(i + 2)];
    const c4 = rev[padded.charCodeAt(i + 3)];
    const b1 = (c1 << 2) | (c2 >> 4);
    const b2 = ((c2 & 15) << 4) | (c3 >> 2);
    const b3 = ((c3 & 3) << 6) | c4;
    if (outIdx < outLen) out[outIdx++] = b1;
    if (outIdx < outLen && c3 !== 255) out[outIdx++] = b2;
    if (outIdx < outLen && c4 !== 255) out[outIdx++] = b3;
  }
  return out;
}

async function streamToUint8Array(stream){
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true){
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks){
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function deflateBytes(bytes){
  if (typeof CompressionStream === "undefined") return { bytes, compressed: false };
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  const out = await streamToUint8Array(cs.readable);
  return { bytes: out, compressed: true };
}

export async function inflateBytes(bytes){
  if (typeof DecompressionStream === "undefined") throw new Error("no decompression");
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return await streamToUint8Array(ds.readable);
}
