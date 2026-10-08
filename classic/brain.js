// クラシックの学習型 AI の「脳」(小さなニューラルネットワーク) と、盤面 → 入力、出力 → 命令 の変換 (第 6 段階)。
// 描画や DOM に依存しない。ブラウザでは window.SagittariusBrain、Node では require('./brain.js') で使う。classic/logic.js を先に読み込む。
// モダンの brain.js (凍結) と同じ作りで、入力と出力をクラシックの盤面に合わせた
(function(root){
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.SagittariusLogic;
  const {WORLD, INITIAL_SHIPS, MISSILE_AMMO} = L;

  const ROLES = ['leader', 'escort']; // 隊長 (大将戦では旗艦) 用と護衛用の 2 つの脳
  const ALLY_SLOTS = 2;   // 入力に入れる近い味方の数 (自分・隊長・偵察を除く)
  const ENEMY_SLOTS = 3;  // 入力に入れる近い見えている敵の数 (= 攻撃の相手の候補)
  const GHOST_SLOTS = 2;  // 入力に入れる近い最終確認位置 (見失った敵) の数
  const INPUTS = 7 + 5 + ALLY_SLOTS * 5 + ENEMY_SLOTS * 6 + GHOST_SLOTS * 5;
  const HIDDEN = 24;
  const OUT = {moveX: 0, moveY: 1, attackNone: 2, attack0: 3, attack1: 4, attack2: 5, missile: 6};
  const OUTPUTS = 4 + ENEMY_SLOTS;
  const DIST_SCALE = 2000;  // 距離を入力にするときの目盛り (3 倍で頭打ち)
  const MOVE_REACH = 600;   // 移動の出力が最大のとき、今の位置から移動先までの距離
  const MOVE_DEADZONE = 0.05; // 移動の出力がこれより小さければ止まる

  const alive = f => f.ships > 0;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function paramCount(){
    return HIDDEN * INPUTS + HIDDEN + OUTPUTS * HIDDEN + OUTPUTS;
  }

  // 重み (長さ paramCount の配列) で入力から出力を計算する。中間層は tanh、出力はそのまま
  function forward(w, input){
    const hidden = new Float64Array(HIDDEN);
    let k = 0;
    for(let h = 0; h < HIDDEN; h++){
      let sum = 0;
      for(let i = 0; i < INPUTS; i++) sum += w[k++] * input[i];
      hidden[h] = sum;
    }
    for(let h = 0; h < HIDDEN; h++) hidden[h] = Math.tanh(hidden[h] + w[k++]);
    const out = new Float64Array(OUTPUTS);
    for(let o = 0; o < OUTPUTS; o++){
      let sum = 0;
      for(let h = 0; h < HIDDEN; h++) sum += w[k++] * hidden[h];
      out[o] = sum;
    }
    for(let o = 0; o < OUTPUTS; o++) out[o] += w[k++];
    return out;
  }

  // チームから見た向き: 赤は上下左右を逆にして (マップの中心について 180 度回して)、青と同じ見え方にする
  const flip = team => (team === 'red' ? -1 : 1);

  // from から to への相対位置を [向き x, 向き y, 距離] にする (チームから見た向き)
  function relative(from, to, team){
    const s = flip(team);
    const dx = (to.x - from.x) * s, dy = (to.y - from.y) * s;
    const d = Math.hypot(dx, dy);
    return d > 0 ? [dx / d, dy / d, Math.min(d / DIST_SCALE, 3)] : [0, 0, 0];
  }

  const byDistance = from => (a, b) => (Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const shipsRatio = f => Math.max(0, f.ships) / INITIAL_SHIPS;

  // 見えている敵を近い順に (攻撃の相手の候補と入力で同じ並びを使う)
  function visibleTargets(f, intel){
    return Object.entries(intel).filter(([, i]) => i.visible).map(([id, i]) => ({id, x: i.x, y: i.y})).sort(byDistance(f)).slice(0, ENEMY_SLOTS);
  }

  // 盤面から脳への入力を作る。敵の情報はチームの位置情報 (intel) にあるものだけ使う (見えていない敵の本当の位置や、敵の性能の配分は使わない)
  function observe(f, fleets, intel){
    const input = [];
    const push = (...v) => input.push(...v);
    const s = flip(f.team);
    const byId = new Map(fleets.map(e => [e.id, e]));

    // 自分: 位置 (チームから見て 0〜1)、隻数の割合、速度・防御・攻撃 (0〜1)、残りのミサイルの割合
    push(s > 0 ? f.x / WORLD.w : 1 - f.x / WORLD.w, s > 0 ? f.y / WORLD.h : 1 - f.y / WORLD.h, shipsRatio(f),
      f.params.speed / 100, f.params.defense / 100, f.params.attack / 100, (f.missiles || 0) / MISSILE_AMMO);

    // 味方の隊長 (自分が隊長なら「いない」)
    const leader = fleets.find(a => a.team === f.team && a.leader && alive(a) && a !== f);
    if(leader) push(1, ...relative(f, leader, f.team), shipsRatio(leader));
    else push(0, 0, 0, 0, 0);

    // 近い味方 (自分・隊長・偵察を除く)
    const allies = fleets.filter(a => a.team === f.team && alive(a) && a !== f && !a.leader && !a.scout).sort(byDistance(f));
    for(let i = 0; i < ALLY_SLOTS; i++){
      const a = allies[i];
      if(a) push(1, ...relative(f, a, f.team), shipsRatio(a));
      else push(0, 0, 0, 0, 0);
    }

    // 近い見えている敵 (見えているので隻数と旗艦かどうかも分かる)
    const targets = visibleTargets(f, intel);
    for(let i = 0; i < ENEMY_SLOTS; i++){
      const t = targets[i];
      const e = t && byId.get(t.id);
      if(t) push(1, ...relative(f, t, f.team), e ? shipsRatio(e) : 0, e && e.flagship ? 1 : 0);
      else push(0, 0, 0, 0, 0, 0);
    }

    // 近い最終確認位置 (隻数は分からない。一度見た敵なので旗艦かどうかは分かる)
    const ghosts = Object.entries(intel).filter(([, i]) => !i.visible).map(([id, i]) => ({id, x: i.x, y: i.y})).sort(byDistance(f));
    for(let i = 0; i < GHOST_SLOTS; i++){
      const g = ghosts[i];
      const e = g && byId.get(g.id);
      if(g) push(1, ...relative(f, g, f.team), e && e.flagship ? 1 : 0);
      else push(0, 0, 0, 0, 0);
    }
    return input;
  }

  // 脳の出力から命令を作る。ミサイルの誘導 / 直進は艦隊に直接設定する。
  // 攻撃の点数 (攻撃しない / 近い順の敵) がいちばん高いものを選び、攻撃しないなら移動する (小さすぎれば止まる = null)
  function decide(w, f, fleets, intel){
    const out = forward(w, observe(f, fleets, intel));
    f.missileMode = out[OUT.missile] > 0 ? 'straight' : 'guided';
    const targets = visibleTargets(f, intel);
    let best = -1, bestScore = out[OUT.attackNone];
    for(let i = 0; i < targets.length; i++){
      if(out[OUT.attack0 + i] > bestScore){ best = i; bestScore = out[OUT.attack0 + i]; }
    }
    if(best >= 0) return {type: 'attack', targetId: targets[best].id};

    const s = flip(f.team);
    const vx = Math.tanh(out[OUT.moveX]) * s, vy = Math.tanh(out[OUT.moveY]) * s;
    if(Math.hypot(vx, vy) < MOVE_DEADZONE) return null;
    return {type: 'move', x: clamp(f.x + vx * MOVE_REACH, 0, WORLD.w), y: clamp(f.y + vy * MOVE_REACH, 0, WORLD.h)};
  }

  const roleOf = f => (f.leader ? 'leader' : 'escort');

  // createGame の options.controllers に渡す形の AI。brains: 役割 (leader / escort) → 重み
  function controller(brains){
    return (f, fleets, intel) => decide(brains[roleOf(f)], f, fleets, intel);
  }

  // 学習前のランダムな脳の組 (重みは -scale〜scale)
  function randomBrainSet(rng, scale){
    const k = scale || 0.5;
    const set = {};
    for(const r of ROLES) set[r] = Float64Array.from({length: paramCount()}, () => (rng() * 2 - 1) * k);
    return set;
  }

  // 保存用 (JSON にできる形) と、その逆
  function toPlain(set){
    const o = {};
    for(const r of ROLES) o[r] = Array.from(set[r]);
    return o;
  }
  function fromPlain(o){
    const set = {};
    for(const r of ROLES){
      if(!Array.isArray(o[r]) || o[r].length !== paramCount()) throw new Error(`脳の形が違う: ${r}`);
      set[r] = Float64Array.from(o[r]);
    }
    return set;
  }

  const api = {ROLES, INPUTS, HIDDEN, OUTPUTS, OUT, MOVE_REACH, paramCount, visibleTargets, forward, observe, decide, roleOf, controller, randomBrainSet, toPlain, fromPlain};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusBrain = api;
})(typeof window !== 'undefined' ? window : globalThis);
