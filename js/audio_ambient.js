// audio_ambient.js
// Мягкий генеративный эмбиент для фона (Web Audio API)

export function createAmbient(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();

  // master
  const master = ctx.createGain();
  master.gain.value = 0.0; // стартуем с 0 и плавно поднимаем
  master.connect(ctx.destination);

  // общий фильтр для "мягкости"
  const softLP = ctx.createBiquadFilter();
  softLP.type = "lowpass";
  softLP.frequency.value = 1200;
  softLP.Q.value = 0.2;
  softLP.connect(master);

  // лёгкое пространство: очень короткий delay + feedback (очень аккуратно)
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.18;
  const fb = ctx.createGain();
  fb.gain.value = 0.12;
  const delayLP = ctx.createBiquadFilter();
  delayLP.type = "lowpass";
  delayLP.frequency.value = 900;
  delayLP.Q.value = 0.1;

  // dry/wet
  const dry = ctx.createGain(); dry.gain.value = 0.85;
  const wet = ctx.createGain(); wet.gain.value = 0.30;

  // routing: input -> dry -> softLP ; input -> delay -> wet -> softLP ; feedback loop
  const input = ctx.createGain();
  input.connect(dry); dry.connect(softLP);
  input.connect(delay); delay.connect(delayLP); delayLP.connect(wet); wet.connect(softLP);
  delayLP.connect(fb); fb.connect(delay);

  // --- Noise ("воздух") ---
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const data = noiseBuf.getChannelData(0);
    // мягкий шум (псевдо-розовый-ish через накопление)
    let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
    for (let i=0; i<data.length; i++){
      const white = (Math.random()*2 - 1);
      b0 = 0.99886*b0 + white*0.0555179;
      b1 = 0.99332*b1 + white*0.0750759;
      b2 = 0.96900*b2 + white*0.1538520;
      b3 = 0.86650*b3 + white*0.3104856;
      b4 = 0.55000*b4 + white*0.5329522;
      b5 = -0.7616*b5 - white*0.0168980;
      const pink = (b0+b1+b2+b3+b4+b5+b6 + white*0.5362) * 0.11;
      b6 = white*0.115926;
      data[i] = pink;
    }
  }

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.03;

  const noiseHP = ctx.createBiquadFilter();
  noiseHP.type = "highpass";
  noiseHP.frequency.value = 120;
  noiseHP.Q.value = 0.2;

  const noiseLP = ctx.createBiquadFilter();
  noiseLP.type = "lowpass";
  noiseLP.frequency.value = 1400;
  noiseLP.Q.value = 0.1;

  noise.connect(noiseGain);
  noiseGain.connect(noiseHP);
  noiseHP.connect(noiseLP);
  noiseLP.connect(input);

  // --- Два мягких дрона ---
  const droneA = ctx.createOscillator();
  droneA.type = "sine";
  droneA.frequency.value = 74; // D2-ish

  const droneAGain = ctx.createGain();
  droneAGain.gain.value = 0.018;

  const droneAF = ctx.createBiquadFilter();
  droneAF.type = "lowpass";
  droneAF.frequency.value = 600;
  droneAF.Q.value = 0.15;

  droneA.connect(droneAGain);
  droneAGain.connect(droneAF);
  droneAF.connect(input);

  const droneB = ctx.createOscillator();
  droneB.type = "triangle";
  droneB.frequency.value = 111; // A2-ish

  const droneBGain = ctx.createGain();
  droneBGain.gain.value = 0.010;

  const droneBF = ctx.createBiquadFilter();
  droneBF.type = "lowpass";
  droneBF.frequency.value = 520;
  droneBF.Q.value = 0.2;

  droneB.connect(droneBGain);
  droneBGain.connect(droneBF);
  droneBF.connect(input);

  // --- "Дыхание" громкости (очень медленно) ---
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 1/11; // ~11 секунд цикл

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.18; // глубина дыхания

  // базовая громкость master: 0.18, плюс/минус дыхание
  const masterBase = 0.18;

  lfo.connect(lfoGain);
  lfoGain.connect(master.gain);

  function setMasterTarget(v, t=0.8){
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(v, now + t);
  }

  // Плавное "дрейфование" частот (очень небольшое)
  let driftT = 0;
  function drift(){
    driftT++;
    const now = ctx.currentTime;

    const a = 74 + Math.sin(driftT*0.07) * 0.35;
    const b = 111 + Math.sin(driftT*0.05 + 1.1) * 0.28;
    droneA.frequency.setTargetAtTime(a, now, 0.8);
    droneB.frequency.setTargetAtTime(b, now, 0.9);

    // слегка гуляет яркость шума
    noiseLP.frequency.setTargetAtTime(1200 + Math.sin(driftT*0.03)*180, now, 1.2);

    // реже
    _driftTimer = setTimeout(drift, 900);
  }
  let _driftTimer = null;

  let started = false;

  function start(){
    if (started) return;
    started = true;

    noise.start();
    droneA.start();
    droneB.start();
    lfo.start();

    // чтобы LFO реально “дышал” вокруг базы — добавим базу вручную
    master.gain.setValueAtTime(masterBase, ctx.currentTime);

    drift();
    setMasterTarget(masterBase, 1.2);
  }

  function stop(){
    if (!started) return;
    setMasterTarget(0.0, 0.8);
  }

  // вызывать на user gesture (клик по "Играть")
  async function resume(){
    if (ctx.state !== "running") await ctx.resume();
    start();
  }

  // можно привязать к состоянию игры: stress 0..1
  function setMood({ stress = 0 } = {}){
    // больше стресса -> темнее и чуть громче "воздух"
    const s = Math.min(1, Math.max(0, stress));
    noiseGain.gain.value = 0.02 + 0.03*s;
    softLP.frequency.value = 1300 - 500*s;
    // небольшой рост громкости фона
    setMasterTarget(masterBase + 0.04*s, 1.0);
  }

  function dispose(){
    clearTimeout(_driftTimer);
    try { noise.stop(); } catch {}
    try { droneA.stop(); } catch {}
    try { droneB.stop(); } catch {}
    try { lfo.stop(); } catch {}
    ctx.close();
  }

  return { ctx, resume, start, stop, setMood, dispose };
}