// 効果音と BGM (すべて Web Audio で合成。音声ファイルは使わない)。
// ブラウザでは <script src="sound.js"> で window.SagittariusSound に、Node では require() で読み込む
// (Node には Web Audio がないので、音を鳴らす関数は何もしない。計算の関数だけテストする)。
(function(root){
  'use strict';

  const Music = root.SagittariusMusic || (typeof require === 'function' ? require('./music.js') : null);

  const SFX_LEVEL = 0.5;   // 効果音の全体の大きさ (音量 100 のとき)
  const BGM_LEVEL = 0.28;  // BGM の全体の大きさ (音量 100 のとき)。効果音より控えめ
  const DUCK = 0.35;       // 一時停止中の BGM の大きさ (割合)
  const LOOKAHEAD = 0.2;   // BGM の音を何秒先まで予約しておくか
  const TICK_MS = 50;      // BGM の予約を見直す間隔

  // ---- 計算 (テストできる部分) ----
  // 設定の音量 0〜100 を、音の大きさ 0〜1 に (耳の感じ方に合わせて 2 乗のカーブ)
  function volumeToGain(v){
    const r = Math.min(100, Math.max(0, Number(v) || 0)) / 100;
    return r * r;
  }

  // 画面上の x 座標を左右の振り分け (-0.8〜0.8) に。端でも片耳だけにならないように 0.8 まで
  function panFromScreen(x, width){
    const p = Math.min(1, Math.max(-1, x / width * 2 - 1)) * 0.8;
    return Math.round(p * 1e9) / 1e9;
  }

  // 同じ種類 (key) の音を、interval 秒に 1 回までにする関数を作る
  function createThrottle(interval){
    const last = {};
    return (key, now) => {
      if(key in last && now - last[key] < interval - 1e-9) return false;
      last[key] = now;
      return true;
    };
  }

  // ---- Web Audio ----
  let ctx = null, sfxBus = null, bgmBus = null, noiseBuffer = null;
  let volumes = {bgm: 70, sfx: 80};
  let duck = false;

  const AudioCtor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

  // ブラウザは、ユーザーが一度操作するまで音を出させない。最初のクリック / キー入力でこれを呼ぶ
  function unlock(){
    if(!AudioCtor) return;
    if(!ctx){
      ctx = new AudioCtor();
      sfxBus = ctx.createGain();
      bgmBus = ctx.createGain();
      sfxBus.connect(ctx.destination);
      bgmBus.connect(ctx.destination);
      // 2 秒ぶんのホワイトノイズ (爆発や発砲の元になる音)
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for(let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      applyVolumes(true);
    }
    if(ctx.state === 'suspended') ctx.resume();
    if(bgm.key && !bgm.timer) startBgm(bgm.key);
  }

  function applyVolumes(immediate){
    if(!ctx) return;
    const t = ctx.currentTime;
    const sfx = volumeToGain(volumes.sfx) * SFX_LEVEL;
    const music = volumeToGain(volumes.bgm) * BGM_LEVEL * (duck ? DUCK : 1);
    if(immediate){ sfxBus.gain.value = sfx; bgmBus.gain.value = music; return; }
    sfxBus.gain.setTargetAtTime(sfx, t, 0.03);
    bgmBus.gain.setTargetAtTime(music, t, 0.1);
  }

  function setVolumes(v){
    volumes = {bgm: v.bgm, sfx: v.sfx};
    applyVolumes(false);
  }

  function setBgmDuck(on){
    duck = !!on;
    applyVolumes(false);
  }

  // 左右に振り分けてから bus へ
  function output(bus, pan){
    if(!ctx.createStereoPanner || !pan) return bus;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(bus);
    return p;
  }

  // 音量の形: attack 秒で gain まで上げ、dur 秒かけて消す
  function envelope(dest, start, dur, gain, attack){
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + (attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g.connect(dest);
    return g;
  }

  // ノイズ: filters = [{type, freq, freqEnd, Q}] を順に通す
  function noise(dest, o){
    const start = o.start || ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    let node = src;
    for(const f of o.filters || []){
      const bq = ctx.createBiquadFilter();
      bq.type = f.type;
      bq.frequency.setValueAtTime(f.freq, start);
      if(f.freqEnd) bq.frequency.exponentialRampToValueAtTime(f.freqEnd, start + o.dur);
      if(f.Q) bq.Q.value = f.Q;
      node.connect(bq);
      node = bq;
    }
    node.connect(envelope(dest, start, o.dur, o.gain, o.attack));
    src.start(start, Math.random() * 1.5);
    src.stop(start + o.dur + 0.05);
  }

  // 発振器の音: type (sine / square / sawtooth / triangle)、freq から freqEnd へ変化
  function tone(dest, o){
    const start = o.start || ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, start);
    if(o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, start + o.dur);
    if(o.detune) osc.detune.value = o.detune;
    let node = osc;
    if(o.lowpass){
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      osc.connect(lp);
      node = lp;
    }
    node.connect(envelope(dest, start, o.dur, o.gain, o.attack));
    osc.start(start);
    osc.stop(start + o.dur + 0.05);
  }

  // ---- 効果音 ----
  // 艦の大きさ → 音の高さの倍率 (大きい艦ほど低く重い音)
  const SIZE_PITCH = {large: 0.55, medium: 1, small: 1.4};

  // 発砲: 砲撃 (gun) は味方が高めで乾いた音 (M4 のイメージ)、敵が低めで重い音 (AK のイメージ)。大きさで高さを変える。
  // 爆撃機の発進 (bomber) は「シュッ」
  function fire(kind, team, pan, size){
    if(!ctx) return;
    const out = output(sfxBus, pan);
    const k = SIZE_PITCH[size] || 1;
    if(kind === 'gun' && team === 'blue'){
      noise(out, {dur: 0.06 / Math.sqrt(k), gain: 0.5, filters: [{type: 'highpass', freq: 1800 * k}, {type: 'bandpass', freq: 3200 * k, Q: 0.8}]});
      tone(out, {type: 'square', freq: 1600 * k, freqEnd: 500 * k, dur: 0.025, gain: 0.1});
    }else if(kind === 'gun'){
      noise(out, {dur: 0.11 / Math.sqrt(k), gain: 0.6, filters: [{type: 'lowpass', freq: 1400 * k}]});
      tone(out, {type: 'sine', freq: 160 * k, freqEnd: 55 * k, dur: 0.09, gain: 0.5});
    }else{
      const [from, to] = team === 'blue' ? [700, 2600] : [400, 1500];
      noise(out, {dur: 0.35, gain: 0.35, attack: 0.05, filters: [{type: 'bandpass', freq: from, freqEnd: to, Q: 2}]});
    }
  }

  // 命中: 爆撃 (bomb) だけ爆発音 (砲弾の命中は数が多いので鳴らさない)
  function hit(kind, pan){
    if(!ctx || kind !== 'bomb') return;
    const out = output(sfxBus, pan);
    noise(out, {dur: 0.6, gain: 0.7, filters: [{type: 'lowpass', freq: 1200, freqEnd: 180}]});
    tone(out, {type: 'sine', freq: 90, freqEnd: 35, dur: 0.5, gain: 0.6});
  }

  function intercept(pan){
    if(!ctx) return;
    const out = output(sfxBus, pan);
    noise(out, {dur: 0.08, gain: 0.35, filters: [{type: 'lowpass', freq: 3500}]});
    tone(out, {type: 'triangle', freq: 900, freqEnd: 300, dur: 0.06, gain: 0.1});
  }

  // 艦隊の全滅: 大きな爆発
  function destroyed(pan){
    if(!ctx) return;
    const out = output(sfxBus, pan);
    const t = ctx.currentTime;
    noise(out, {dur: 1.4, gain: 0.9, filters: [{type: 'lowpass', freq: 900, freqEnd: 120}]});
    tone(out, {type: 'sine', freq: 70, freqEnd: 28, dur: 1.2, gain: 0.8});
    noise(out, {start: t + 0.15, dur: 0.5, gain: 0.5, filters: [{type: 'lowpass', freq: 2500, freqEnd: 400}]});
  }

  // 敵の発見: レーダーの「ピッ」。敵旗艦なら「ピピッ」
  function ping(flagship){
    if(!ctx) return;
    const t = ctx.currentTime;
    tone(sfxBus, {type: 'sine', freq: 1320, dur: 0.14, gain: 0.22});
    if(flagship) tone(sfxBus, {type: 'sine', freq: 1760, start: t + 0.17, dur: 0.16, gain: 0.22});
  }

  // 勝利: 明るく上がる短いファンファーレ / 敗北: 沈んでいく和音
  function jingle(result){
    if(!ctx) return;
    const t = ctx.currentTime + 0.05;
    const f = n => Music.noteToFreq(n);
    if(result === 'win'){
      ['C5', 'E5', 'G5'].forEach((n, i) => tone(sfxBus, {type: 'sawtooth', lowpass: 2500, freq: f(n), start: t + i * 0.13, dur: 0.18, gain: 0.18}));
      ['C5', 'E5', 'G5', 'C6'].forEach(n => tone(sfxBus, {type: 'sawtooth', lowpass: 2500, freq: f(n), start: t + 0.42, dur: 1.2, gain: 0.1, attack: 0.02}));
    }else{
      ['A4', 'F4', 'D4'].forEach((n, i) => tone(sfxBus, {type: 'sawtooth', lowpass: 1200, freq: f(n), start: t + i * 0.3, dur: 0.35, gain: 0.16}));
      ['D3', 'F3', 'A3'].forEach(n => tone(sfxBus, {type: 'sawtooth', lowpass: 800, freq: f(n), start: t + 0.9, dur: 1.6, gain: 0.12, attack: 0.05}));
    }
  }

  // 設定画面で効果音の音量を動かしたときの確認用
  function preview(){ fire('shell', 'blue', 0); }

  // ---- BGM ----
  // 音色: 楽器ごとの鳴らし方 (freqs は和音なら複数)
  const VOICES = {
    pad(dest, freqs, t, dur){
      for(const fr of freqs) for(const d of [-7, 7]){
        tone(dest, {type: 'sawtooth', freq: fr, detune: d, lowpass: 1300, start: t, dur: dur + 0.3, gain: 0.07 / freqs.length * 2, attack: 0.6});
      }
    },
    bass(dest, freqs, t, dur){
      tone(dest, {type: 'sawtooth', freq: freqs[0], lowpass: 380, start: t, dur: dur * 0.95, gain: 0.35, attack: 0.01});
    },
    bell(dest, freqs, t, dur){
      tone(dest, {type: 'triangle', freq: freqs[0], start: t, dur: Math.max(dur, 1.2), gain: 0.16});
      tone(dest, {type: 'sine', freq: freqs[0] * 2, start: t, dur: 0.8, gain: 0.05});
    },
    strings(dest, freqs, t, dur){
      for(const fr of freqs) tone(dest, {type: 'sawtooth', freq: fr, lowpass: 2000, start: t, dur: dur * 0.9, gain: 0.05, attack: 0.03});
    },
    brass(dest, freqs, t, dur){
      tone(dest, {type: 'sawtooth', freq: freqs[0], lowpass: 1800, start: t, dur: dur * 0.95, gain: 0.13, attack: 0.04});
      tone(dest, {type: 'square', freq: freqs[0] / 2, lowpass: 900, start: t, dur: dur * 0.95, gain: 0.04, attack: 0.04});
    }
  };
  const DRUMS = {
    // 太鼓風のキック
    kick(dest, t){
      tone(dest, {type: 'sine', freq: 110, freqEnd: 42, start: t, dur: 0.32, gain: 0.7});
      noise(dest, {start: t, dur: 0.12, gain: 0.25, filters: [{type: 'lowpass', freq: 400}]});
    },
    snare(dest, t){
      noise(dest, {start: t, dur: 0.16, gain: 0.35, filters: [{type: 'bandpass', freq: 1800, Q: 0.7}]});
      tone(dest, {type: 'triangle', freq: 190, freqEnd: 120, start: t, dur: 0.08, gain: 0.2});
    },
    hat(dest, t){
      noise(dest, {start: t, dur: 0.04, gain: 0.08, filters: [{type: 'highpass', freq: 7000}]});
    }
  };

  const bgm = {key: null, timer: null, events: [], loopLen: 0, origin: 0, index: 0, loop: 0, gain: null};

  function startBgm(key){
    const song = Music.SONGS[key];
    bgm.events = Music.buildSchedule(song);
    bgm.loopLen = Music.loopSeconds(song);
    bgm.origin = ctx.currentTime + 0.1;
    bgm.index = 0;
    bgm.loop = 0;
    bgm.gain = ctx.createGain();
    bgm.gain.connect(bgmBus);
    bgm.timer = setInterval(scheduleBgm, TICK_MS);
    scheduleBgm();
  }

  // LOOKAHEAD 秒先までの音を予約する。曲の最後まで来たら頭に戻る (ループ)
  function scheduleBgm(){
    const until = ctx.currentTime + LOOKAHEAD;
    for(;;){
      const ev = bgm.events[bgm.index];
      const when = bgm.origin + bgm.loop * bgm.loopLen + ev.time;
      if(when > until) break;
      if(ev.drum) DRUMS[ev.drum](bgm.gain, when);
      else VOICES[ev.voice](bgm.gain, ev.freqs, when, ev.dur);
      bgm.index++;
      if(bgm.index >= bgm.events.length){ bgm.index = 0; bgm.loop++; }
    }
  }

  // 曲を流す (同じ曲が流れていれば何もしない)。音が使えるようになる前なら、使えるようになってから流す
  function playBgm(key){
    if(bgm.key === key && (bgm.timer || !ctx)) return;
    stopBgm();
    bgm.key = key;
    if(ctx && ctx.state !== 'suspended') startBgm(key);
  }

  function stopBgm(){
    bgm.key = null;
    if(bgm.timer){ clearInterval(bgm.timer); bgm.timer = null; }
    if(ctx && bgm.gain){
      // 予約済みの音も含めて、すっと消す
      const g = bgm.gain;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => g.disconnect(), 800);
      bgm.gain = null;
    }
  }

  const api = {
    volumeToGain, panFromScreen, createThrottle,
    unlock, setVolumes, setBgmDuck, fire, hit, intercept, destroyed, ping, jingle, preview, playBgm, stopBgm
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusSound = api;
})(typeof window !== 'undefined' ? window : globalThis);
