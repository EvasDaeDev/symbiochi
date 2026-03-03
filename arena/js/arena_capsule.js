// Autonomous capsule import/export for arena.
// Supports Symbiochi capsules: AES-256-GCM + PBKDF2-SHA256.

function b64ToU8(b64){
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
function u8ToB64(u8){
  let s='';
  for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]);
  return btoa(s);
}

export function randomKey(len=16){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out='';
  for(let i=0;i<len;i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function deriveAesKey(keyStr, saltU8, iters){
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(keyStr||'')),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: saltU8, iterations: iters, hash:'SHA-256' },
    baseKey,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}

async function sha256Hex(u8){
  const hash = await crypto.subtle.digest('SHA-256', u8);
  const b = new Uint8Array(hash);
  let hex='';
  for(const v of b){
    hex += v.toString(16).padStart(2,'0');
  }
  return hex;
}

export async function parseCapsuleFile(file){
  const text = await file.text();
  let obj;
  try{ obj = JSON.parse(text); }catch{ throw new Error('bad_format'); }
  if(!obj || obj.format !== 'symbiochi-capsule') throw new Error('bad_format');
  if(obj.version !== 1) throw new Error('bad_version');
  return obj;
}

export async function decryptCapsule(capsuleObj, keyStr){
  try{
    const salt = b64ToU8(capsuleObj.payloadSalt);
    const iv = b64ToU8(capsuleObj.payloadIv);
    const encPayload = b64ToU8(capsuleObj.payloadEnc);
    const iters = Number.isFinite(capsuleObj.kdfIters) ? capsuleObj.kdfIters : 200000;

    const aesKey = await deriveAesKey(keyStr, salt, iters);
    const plainBuf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, aesKey, encPayload);
    const plainU8 = new Uint8Array(plainBuf);

    if(capsuleObj.payloadHash){
      const hex = await sha256Hex(plainU8);
      if(String(hex) !== String(capsuleObj.payloadHash)) throw new Error('bad_hash');
    }

    const txt = new TextDecoder().decode(plainU8);
    const payload = JSON.parse(txt);
    return payload;
  }catch(e){
    const msg = String(e?.message||'');
    if(msg.includes('bad_hash')) throw new Error('corrupt');
    // AES-GCM throws OperationError on bad key
    if(msg.includes('OperationError')) throw new Error('bad_key');
    if(msg.includes('bad_format')) throw new Error('bad_format');
    throw new Error('bad_key');
  }
}

export async function encryptCapsule(payloadObj, keyStr, headerExtra={}){
  const createdAt = Math.floor(Date.now()/1000);
  const capsuleId = headerExtra.capsuleId || crypto.randomUUID();
  const organismId = headerExtra.organismId || payloadObj?.organismState?.organismId || crypto.randomUUID();

  const payloadTxt = JSON.stringify(payloadObj);
  const payloadU8 = new TextEncoder().encode(payloadTxt);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iters = 200000;

  const aesKey = await deriveAesKey(keyStr, salt, iters);
  const encBuf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, aesKey, payloadU8);
  const encU8 = new Uint8Array(encBuf);

  const payloadHash = await sha256Hex(payloadU8);

  const capsule = {
    format: 'symbiochi-capsule',
    version: 1,
    capsuleId,
    organismId,
    createdAt,
    fairPlay: payloadObj?.meta?.fairPlay ?? true,
    payloadAlg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    kdfIters: iters,
    payloadSalt: u8ToB64(salt),
    payloadIv: u8ToB64(iv),
    payloadEnc: u8ToB64(encU8),
    payloadHash,
  };

  return capsule;
}

export function downloadCapsule(capsuleObj, filenameBase='fighter'){
  const blob = new Blob([JSON.stringify(capsuleObj)], { type:'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filenameBase}.sbh`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}

