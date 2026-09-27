// 旧ルール AI (第 2.6 段階までのゲームの AI)。役割ごとに人が書いたルールで命令を決める。
// 第 2.7 段階で学習した AI に置き換えるまでゲームで使い、その後は学習の「ものさし」(強さを測る相手) としてだけ使う。
// ブラウザでは window.SagittariusRuleAI、Node では require('./rule-ai.js') で使う。logic.js を先に読み込む。
(function(root){
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.SagittariusLogic;
  const {WORLD, hpRatio} = L;
  const FLAGSHIP_PRIORITY = 20;  // AI が敵旗艦を狙うときにスコアから引く値

  // AI プロファイル: 役割別 AI の判断に使うつまみ。値はルール AI の強さを決める
  const AI_PROFILES = {
    standard: {
      localRadius: 1200,         // 局地的な戦力比を数える半径
      flagshipRetreatRatio: 1.5, // 旗艦はこの戦力比を超えたら味方の中心へ下がる
      carrierDistance: 500,      // 空母が普段つく旗艦の後ろの距離
      carrierSafeDistance: 800,  // 空母はこれより近い敵から離れる
      attackerDistance: 800,     // アタッカーが普段保つ旗艦との距離 (左右)
      attackerLeash: 1500,       // アタッカーは旗艦からこの距離以内の敵を攻撃する
      attackerRetreatRatio: 1.3, // アタッカーはこの戦力比を超えたら旗艦のもとへ下がる
      speederMarkDistance: 690,  // 駆逐艦が敵旗艦を見張る距離 (駆逐艦の索敵距離 700 より内側)
      speederSafeDistance: 660   // 駆逐艦はこれより近い敵から離れる (どの艦種の砲の射程 (最大 650) よりも外)
    }
  };
  // 巡洋艦の隊列位置の方向 (旗艦から見て [前方, 右方向] の単位ベクトル)。1 隻目は左、2 隻目は右。
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
      const score = dist(from, info) / 100 + hpRatio(e) * 6 - (e.flagship ? FLAGSHIP_PRIORITY : 0);
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

  // 空母: 旗艦 (戦艦) の後ろにつく。近すぎる敵からは離れる (攻撃は爆撃機が自動で行う)
  function carrierDecide(f, flag, fleets, intel, p){
    let threat = null;
    for(const info of Object.values(intel)){
      if(info.visible && dist(f, info) < p.carrierSafeDistance && (!threat || dist(f, info) < dist(f, threat))) threat = info;
    }
    if(threat) return moveTo(pointToward(threat, f, p.carrierSafeDistance + 150));
    return moveTo(offsetFrom(flag, -p.carrierDistance, 0));
  }

  // 巡洋艦: 旗艦から attackerLeash 以内の敵を攻撃する。周りが不利なら旗艦のもとへ下がる
  function attackerDecide(f, flag, fleets, intel, p){
    if(localForceRatio(f, f.team, fleets, intel, p.localRadius) > p.attackerRetreatRatio) return moveTo(flag);
    const target = bestVisibleTarget(f, fleets, intel, info => dist(flag, info) <= p.attackerLeash);
    if(target) return {type: 'attack', targetId: target};
    const attackers = fleets.filter(a => a.team === f.team && a.role === 'cruiser' && alive(a));
    const [fwd, right] = ATTACKER_SLOTS[Math.max(0, attackers.indexOf(f)) % ATTACKER_SLOTS.length];
    return moveTo(offsetFrom(flag, fwd * p.attackerDistance, right * p.attackerDistance));
  }

  // 駆逐艦: NP が満タンなら、見えている最も近い敵を攻撃しに行く (特殊攻撃は射程に入ると自動で使う)。
  // それ以外は 戦わない > 見張る。近すぎる敵からは離れ、敵旗艦の位置が分かれば距離を保って見張り、分からなければ索敵する
  function speederDecide(f, fleets, intel, rng, p){
    if(f.special && f.charge >= L.CHARGE_MAX){
      let target = null;
      for(const [id, info] of Object.entries(intel)) if(info.visible && (!target || dist(f, info) < dist(f, target.info))) target = {id, info};
      if(target) return {type: 'attack', targetId: target.id};
    }
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

  // AI の命令を決める (艦種ごと)。profile は AI プロファイル (省略時は標準)。
  // 戦艦 = 旗艦の動き、空母 = 旗艦の後ろ、巡洋艦 = 旗艦の左右で戦う、駆逐艦 = 偵察と見張り (交戦を避ける)。旗艦がいなければ旗艦の動き
  function aiDecide(f, fleets, intel, rng, profile){
    const p = profile || AI_PROFILES.standard;
    const flag = fleets.find(a => a.team === f.team && a.flagship && alive(a));
    if(f.role === 'destroyer') return speederDecide(f, fleets, intel, rng, p);
    if(!flag || flag === f || f.role === 'battleship') return flagshipDecide(f, fleets, intel, rng, p);
    if(f.role === 'carrier') return carrierDecide(f, flag, fleets, intel, p);
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
