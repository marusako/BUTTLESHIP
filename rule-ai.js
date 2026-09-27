// 旧ルール AI (第 2.6 段階までのゲームの AI)。役割ごとに人が書いたルールで命令を決める。
// 第 2.7 段階で学習した AI に置き換えるまでゲームで使い、その後は学習の「ものさし」(強さを測る相手) としてだけ使う。
// ブラウザでは window.SagittariusRuleAI、Node では require('./rule-ai.js') で使う。logic.js を先に読み込む。
(function(root){
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.SagittariusLogic;
  const {WORLD, INITIAL_SHIPS} = L;
  const FLAGSHIP_PRIORITY = 20;  // AI が敵旗艦を狙うときにスコアから引く値

  // AI プロファイル: 役割別 AI の判断に使うつまみ。値はルール AI の強さを決める
  const AI_PROFILES = {
    standard: {
      localRadius: 1200,         // 局地的な戦力比を数える半径
      flagshipRetreatRatio: 1.5, // 旗艦はこの戦力比を超えたら味方の中心へ下がる
      tankDistance: 250,         // 副艦が旗艦から離れる距離
      tankDefendRadius: 800,     // 副艦は旗艦からこの距離以内の敵を迎え撃つ
      attackerDistance: 800,     // アタッカーが普段保つ旗艦との距離 (左右)
      attackerLeash: 1500,       // アタッカーは旗艦からこの距離以内の敵を攻撃する
      attackerRetreatRatio: 1.3, // アタッカーはこの戦力比を超えたら旗艦のもとへ下がる
      speederMarkDistance: 700,  // スピーダーが敵旗艦を見張る距離 (索敵半径 750 より内側)
      speederSafeDistance: 600   // スピーダーはこれより近い敵から離れる (撃てる範囲 500 より外)
    }
  };
  // アタッカーの隊列位置の方向 (旗艦から見て [前方, 右方向] の単位ベクトル)。左・右 (副艦の前と合わせて旗艦を囲む)。
  // 旗艦からの距離は AI プロファイルの attackerDistance
  const ATTACKER_SLOTS = [[0, -1], [0, 1]];

  const alive = f => f.ships > 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 見えている敵のうち、近くて弱いほど優先 (距離 100 と初期艦艇数の 1/6 を同じ重みで比べる)。敵旗艦は最優先。
  // from からの距離で評価し、accept で対象を絞る
  function bestVisibleTarget(from, fleets, intel, accept){
    const byId = new Map(fleets.map(e => [e.id, e]));
    let best = null, bestScore = Infinity;
    for(const [id, info] of Object.entries(intel)){
      const e = byId.get(id);
      if(!info.visible || !e || !alive(e) || (accept && !accept(info))) continue;
      const score = dist(from, info) / 100 + e.ships / INITIAL_SHIPS * 6 - (e.flagship ? FLAGSHIP_PRIORITY : 0);
      if(score < bestScore){ best = id; bestScore = score; }
    }
    return best;
  }

  // 局地的な戦力比: point から radius 以内の、見えている敵の艦艇数 ÷ 味方の艦艇数
  function localForceRatio(point, team, fleets, intel, radius){
    let enemy = 0, friend = 0;
    for(const f of fleets){
      if(!alive(f) || dist(point, f) > radius) continue;
      if(f.team === team) friend += f.ships;
      else if(intel[f.id] && intel[f.id].visible) enemy += f.ships;
    }
    return friend > 0 ? enemy / friend : 0;
  }

  // 地点 from から見て、to の方向へ distance 進んだ地点 (マップ内に収める)
  function pointToward(from, to, distance){
    const d = dist(from, to) || 1;
    return {
      x: clamp(from.x + (to.x - from.x) / d * distance, 0, WORLD.w),
      y: clamp(from.y + (to.y - from.y) / d * distance, 0, WORLD.h)
    };
  }

  // 旗艦の向きを基準に [前方, 右方向] ずらした地点 (マップ内に収める)
  function offsetFrom(base, fwd, right){
    const c = Math.cos(base.heading), s = Math.sin(base.heading);
    return {x: clamp(base.x + fwd * c - right * s, 0, WORLD.w), y: clamp(base.y + fwd * s + right * c, 0, WORLD.h)};
  }

  const moveTo = p => ({type: 'move', x: p.x, y: p.y});

  // 索敵: 索敵中なら目的地に着くまで続け、なければ出る。
  // 自陣側にいるうちは敵陣側の半分 (青は上、赤は下) へ。すでに敵陣側にいればマップ全体から選ぶ
  // (敵陣側だけを探すと、すれ違った両軍が互いの空の陣地を探し続けて出会わないため)
  function explore(f, rng){
    if(f.order && f.order.explore) return f.order;
    const half = WORLD.h / 2;
    const inEnemyHalf = f.team === 'blue' ? f.y < half : f.y > half;
    const x = rng() * WORLD.w;
    const y = inEnemyHalf ? rng() * WORLD.h : f.team === 'blue' ? rng() * half : half + rng() * half;
    return {type: 'move', x, y, explore: true};
  }

  // 旗艦: 進軍する。周りが不利なら味方の中心 (いなければ自陣) へ下がる
  function flagshipDecide(f, fleets, intel, rng, p){
    if(localForceRatio(f, f.team, fleets, intel, p.localRadius) > p.flagshipRetreatRatio){
      const allies = fleets.filter(a => a.team === f.team && a !== f && alive(a));
      if(allies.length){
        return {type: 'move', x: allies.reduce((s, a) => s + a.x, 0) / allies.length, y: allies.reduce((s, a) => s + a.y, 0) / allies.length};
      }
      return {type: 'move', x: f.x, y: f.team === 'blue' ? WORLD.h - 300 : 300};
    }
    const target = bestVisibleTarget(f, fleets, intel);
    if(target) return {type: 'attack', targetId: target};

    // 見失った敵の最終確認位置 (敵旗艦を優先、なければ最も近いもの)
    const byId = new Map(fleets.map(e => [e.id, e]));
    let ghost = null;
    for(const [id, info] of Object.entries(intel)){
      if(info.visible) continue;
      const isFlag = byId.get(id) && byId.get(id).flagship;
      if(!ghost || (isFlag && !ghost.isFlag) || (isFlag === ghost.isFlag && dist(f, info) < dist(f, ghost.info))) ghost = {info, isFlag};
    }
    if(ghost) return moveTo(ghost.info);
    return explore(f, rng);
  }

  // 副艦: 旗艦のすぐそばにつき、旗艦に近づいた敵を迎え撃つ。敵が見えていれば旗艦と最も近い敵の間に入る
  function viceDecide(f, flag, fleets, intel, p){
    const threat = bestVisibleTarget(f, fleets, intel, info => dist(flag, info) <= p.tankDefendRadius);
    if(threat) return {type: 'attack', targetId: threat};
    let nearest = null;
    for(const info of Object.values(intel)){
      if(info.visible && (!nearest || dist(flag, info) < dist(flag, nearest))) nearest = info;
    }
    return moveTo(nearest ? pointToward(flag, nearest, p.tankDistance) : offsetFrom(flag, p.tankDistance, 0));
  }

  // アタッカー: 旗艦から attackerLeash 以内の敵を攻撃する。周りが不利なら旗艦のもとへ下がる
  function attackerDecide(f, flag, fleets, intel, p){
    if(localForceRatio(f, f.team, fleets, intel, p.localRadius) > p.attackerRetreatRatio) return moveTo(flag);
    const target = bestVisibleTarget(f, fleets, intel, info => dist(flag, info) <= p.attackerLeash);
    if(target) return {type: 'attack', targetId: target};
    const attackers = fleets.filter(a => a.team === f.team && a.role === 'attacker' && alive(a));
    const [fwd, right] = ATTACKER_SLOTS[Math.max(0, attackers.indexOf(f)) % ATTACKER_SLOTS.length];
    return moveTo(offsetFrom(flag, fwd * p.attackerDistance, right * p.attackerDistance));
  }

  // スピーダー: 戦わない > 見張る。近すぎる敵からは離れ、敵旗艦の位置が分かれば距離を保って見張り、分からなければ索敵する
  function speederDecide(f, fleets, intel, rng, p){
    let threat = null;
    for(const info of Object.values(intel)){
      if(info.visible && dist(f, info) < p.speederSafeDistance && (!threat || dist(f, info) < dist(f, threat))) threat = info;
    }
    if(threat) return moveTo(pointToward(threat, f, p.speederSafeDistance + 150));
    const enemyFlag = fleets.find(e => e.team !== f.team && e.flagship && alive(e));
    const info = enemyFlag && intel[enemyFlag.id];
    if(info) return moveTo(pointToward(info, f, p.speederMarkDistance));
    return explore(f, rng);
  }

  // AI の命令を決める (役割ごと)。profile は AI プロファイル (省略時は標準)
  function aiDecide(f, fleets, intel, rng, profile){
    const p = profile || AI_PROFILES.standard;
    const flag = fleets.find(a => a.team === f.team && a.flagship && alive(a));
    if(f.role === 'speeder') return speederDecide(f, fleets, intel, rng, p);
    if(!flag || flag === f || f.role === 'flagship') return flagshipDecide(f, fleets, intel, rng, p);
    if(f.role === 'vice') return viceDecide(f, flag, fleets, intel, p);
    return attackerDecide(f, flag, fleets, intel, p);
  }

  // createGame の options.controllers に渡す形の AI (profile 省略時は標準)
  function controller(profile){
    return (f, fleets, intel, rng) => aiDecide(f, fleets, intel, rng, profile);
  }

  const api = {AI_PROFILES, localForceRatio, aiDecide, controller};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusRuleAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
