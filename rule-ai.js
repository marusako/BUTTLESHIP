// 旧型 AI (第 3.0 段階までのゲームの AI)。役割ごとに人が書いたルールで命令を決める。
// 第 2.7 段階で学習した AI に置き換えるまでゲームで使い、その後は学習の「ものさし」(強さを測る相手) としてだけ使う。
// ブラウザでは window.SagittariusRuleAI、Node では require('./rule-ai.js') で使う。logic.js を先に読み込む。
(function(root){
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.SagittariusLogic;
  const {WORLD, hpRatio, expectedDamage} = L;

  // AI プロファイル: 役割別 AI の判断に使うつまみ。値はルール AI の強さを決める
  const AI_PROFILES = {
    standard: {
      localRadius: 1200,         // 局地的な戦力比を数える半径
      targetWeight: 10,          // 狙いの点数で、期待ダメージの割合 (1 で頭打ち) に掛ける重み (距離 100 が 1 点)
      flagshipWeight: 2.5,       // 敵旗艦の期待ダメージの割合に、さらに掛ける倍率 (旗艦を倒せば勝ちなので優先する)
      flagshipHoldHp: 0.5,       // 旗艦は HP の割合がこれ以下で、見えている敵旗艦より弱ければ粘る (撃ち合いを避けて下がる)
      flagshipHoldDistance: 800, // 粘るときに敵旗艦から保つ距離 (戦艦の射程 650 の外)
      guardRadius: 900,          // 味方の旗艦からこの距離以内の敵を「旗艦への脅威」とする (第 3.6 段階)
      guardWeight: 10,           // 旗艦以外の艦は、旗艦への脅威の狙いの点数からこれを引いて優先する
      escortRetreatHp: 0.4,      // 巡洋艦・空母は HP の割合がこれ以下なら旗艦の後ろへ下がる
      escortRetreatDistance: 400, // 下がる先 (旗艦の後ろの距離)
      flagshipRetreatRatio: 1.5, // 旗艦はこの戦力比を超えたら味方の中心へ下がる
      carrierDistance: 500,      // 空母が普段つく旗艦の後ろの距離
      carrierSafeDistance: 800,  // 空母はこれより近い敵から離れる
      attackerDistance: 550,     // アタッカーが普段保つ旗艦との距離 (左右。第 3.9 段階で 700 → 550)
      attackerForward: 350,      // アタッカーが普段いる位置の、旗艦より前 (進む向き) の距離 (第 3.6 段階: 旗艦の前に出て守る。第 3.9 段階で 200 → 350: 巡洋艦も敵の射程に入り弾を引き受ける)
      attackerLeash: 1500,       // アタッカーは旗艦からこの距離以内の敵を攻撃する
      attackerRetreatRatio: 1.3, // アタッカーはこの戦力比を超えたら旗艦のもとへ下がる
      speederMarkDistance: 880,  // 駆逐艦が敵旗艦を見張る距離 (駆逐艦の索敵距離 900 より内側、強化中の巡洋艦の射程 675 より外。第 3.8 段階で 690 → 880)
      speederSafeDistance: 660,  // 駆逐艦はこれより近い敵から離れる (どの艦種の砲の射程 (最大 650) よりも外)
      speederBoostAvoidDistance: 700, // 駆逐艦は、強化中の敵巡洋艦がこれより近ければ NP が満タンでも離れる (巡洋艦の射程 450 の外)
      speederRetreatHp: 0.5,     // 駆逐艦は HP の割合がこれ以下なら、味方の旗艦のもとへ下がる
      speederFinalEngageRange: 1500, // 最終戦で NP が満タンの駆逐艦は、敵旗艦が見えていなければこれより近い見えている敵に特殊攻撃をしに行く (第 3.9 段階)
      speederCarrierDistance: 1300 // 駆逐艦は、見えている敵空母とこれだけ離れる (爆撃機の射程 1200 の外。NP が満タンなら攻める)
    }
  };
  // 巡洋艦の隊列位置の方向 (旗艦から見て [前方, 右方向] の単位ベクトル)。1 隻目は左、2 隻目は右。
  // 旗艦からの距離は AI プロファイルの attackerDistance
  const ATTACKER_SLOTS = [[0, -1], [0, 1]];

  const alive = f => f.ships > 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 見えている敵のうち、点数が最も小さい敵を選ぶ。点数 = 距離 / 100 − targetWeight × 効きめ。
  // 効きめ = f の通常攻撃 1 発の期待ダメージ ÷ 相手の今の HP (1 で頭打ち)。敵旗艦は flagshipWeight 倍。
  // 命中率と装甲を見るので、弾がかすりしか入らない相手より、よく効く相手を狙う。accept(info, e) で対象を絞る。
  // 旗艦以外の艦は、味方の旗艦から guardRadius 以内の敵 (旗艦への脅威) の点数から guardWeight を引く (旗艦の命を最優先)
  function bestVisibleTarget(f, fleets, intel, p, accept){
    const byId = new Map(fleets.map(e => [e.id, e]));
    const flag = ownFlag(f, fleets);
    let best = null, bestScore = Infinity;
    for(const [id, info] of Object.entries(intel)){
      const e = byId.get(id);
      if(!info.visible || !e || !alive(e) || (accept && !accept(info, e))) continue;
      const effect = Math.min(1, expectedDamage(f, e) / e.ships) * (e.flagship ? p.flagshipWeight : 1);
      const threat = flag && dist(flag, info) <= p.guardRadius ? p.guardWeight : 0;
      const score = dist(f, info) / 100 - p.targetWeight * effect - threat;
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

  // 味方の生きている旗艦 (自分が旗艦・旗艦がいなければ null)
  const ownFlag = (f, fleets) => fleets.find(a => a.team === f.team && a.flagship && alive(a) && a !== f) || null;

  // 見えている敵旗艦 (いなければ null)
  function visibleEnemyFlag(f, fleets, intel){
    const e = fleets.find(a => a.team !== f.team && a.flagship && alive(a));
    return e && intel[e.id] && intel[e.id].visible ? e : null;
  }

  // 旗艦: 進軍する。周りが不利なら味方の中心 (いなければ自陣) へ下がる。
  // HP が flagshipHoldHp 以下で、見えている敵旗艦より弱ければ粘る: 敵旗艦から flagshipHoldDistance 以内なら離れ、
  // 敵旗艦は狙わずにほかの敵を撃つ (両旗艦の撃ち合いだけで決まる・同時に沈む試合を減らす)
  function flagshipDecide(f, fleets, intel, rng, p){
    const enemyFlag = visibleEnemyFlag(f, fleets, intel);
    const hold = f.flagship && enemyFlag && hpRatio(f) <= p.flagshipHoldHp && hpRatio(f) < hpRatio(enemyFlag);
    if(hold && dist(f, intel[enemyFlag.id]) < p.flagshipHoldDistance) return moveTo(pointToward(intel[enemyFlag.id], f, p.flagshipHoldDistance + 150));
    if(localForceRatio(f, f.team, fleets, intel, p.localRadius) > p.flagshipRetreatRatio){
      const allies = fleets.filter(a => a.team === f.team && a !== f && alive(a));
      if(allies.length){
        return {type: 'move', x: allies.reduce((s, a) => s + a.x, 0) / allies.length, y: allies.reduce((s, a) => s + a.y, 0) / allies.length};
      }
      return {type: 'move', x: f.x, y: f.team === 'blue' ? WORLD.h - 300 : 300};
    }
    const target = bestVisibleTarget(f, fleets, intel, p, hold ? (info, e) => e !== enemyFlag : null);
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
    if(hpRatio(f) <= p.escortRetreatHp) return moveTo(offsetFrom(flag, -p.escortRetreatDistance, 0)); // 各艦の命 (第 3.6 段階)
    let threat = null;
    for(const info of Object.values(intel)){
      if(info.visible && dist(f, info) < p.carrierSafeDistance && (!threat || dist(f, info) < dist(f, threat))) threat = info;
    }
    if(threat) return moveTo(pointToward(threat, f, p.carrierSafeDistance + 150));
    return moveTo(offsetFrom(flag, -p.carrierDistance, 0));
  }

  // 巡洋艦: 旗艦から attackerLeash 以内の敵を攻撃する。周りが不利なら旗艦のもとへ下がる
  function attackerDecide(f, flag, fleets, intel, p){
    if(hpRatio(f) <= p.escortRetreatHp) return moveTo(offsetFrom(flag, -p.escortRetreatDistance, 0)); // 各艦の命 (第 3.6 段階)
    if(localForceRatio(f, f.team, fleets, intel, p.localRadius) > p.attackerRetreatRatio) return moveTo(flag);
    const target = bestVisibleTarget(f, fleets, intel, p, info => dist(flag, info) <= p.attackerLeash);
    if(target) return {type: 'attack', targetId: target};
    const attackers = fleets.filter(a => a.team === f.team && a.role === 'cruiser' && alive(a));
    const [fwd, right] = ATTACKER_SLOTS[Math.max(0, attackers.indexOf(f)) % ATTACKER_SLOTS.length];
    return moveTo(offsetFrom(flag, fwd * p.attackerDistance + p.attackerForward, right * p.attackerDistance));
  }

  // 見えている敵のうち、accept(e) を満たし、from から distance より近い最も近い敵 ({e, info}。なければ null)
  function nearestVisibleEnemy(from, fleets, intel, distance, accept){
    let best = null;
    for(const e of fleets){
      const info = intel[e.id];
      if(e.team === from.team || !alive(e) || !info || !info.visible || !accept(e)) continue;
      if(dist(from, info) < distance && (!best || dist(from, info) < dist(from, best.info))) best = {e, info};
    }
    return best;
  }

  // 駆逐艦 (第 3.8 段階): 役割は索敵・偵察が約 8 割、最終戦の特殊攻撃が約 2 割。通常攻撃では戦わない。
  // まず身を守る (第 3.4 段階): HP が speederRetreatHp 以下なら味方の旗艦のもとへ下がり、強化中の敵巡洋艦が近ければ離れる。
  // 最終戦 (NP が満タン。NP は最終戦の間だけたまる (第 3.9 段階)) なら特殊攻撃 (射程に入ると自動で使う) をしに行く: 旗艦への脅威 (第 3.6 段階)
  // → 見えている敵旗艦 → speederFinalEngageRange 以内の見えている敵 → 敵旗艦の最終確認位置へ移動。
  // それ以外は偵察: 敵空母の爆撃機の射程と近すぎる敵からは離れ、敵旗艦の位置が分かれば距離を保って見張り、分からなければ索敵する
  function finalBattleOrder(f, flag, fleets, intel, p){
    if(!flag || !f.special || !(f.charge >= L.CHARGE_MAX)) return null;
    const threat = nearestVisibleEnemy(flag, fleets, intel, p.guardRadius, () => true);
    if(threat) return {type: 'attack', targetId: threat.e.id};
    const enemyFlag = visibleEnemyFlag(f, fleets, intel);
    if(enemyFlag) return {type: 'attack', targetId: enemyFlag.id};
    const near = nearestVisibleEnemy(f, fleets, intel, p.speederFinalEngageRange, () => true);
    if(near) return {type: 'attack', targetId: near.e.id};
    const lost = fleets.find(e => e.team !== f.team && e.flagship && alive(e));
    const info = lost && intel[lost.id];
    return info ? moveTo(info) : null;
  }

  function speederDecide(f, fleets, intel, rng, p){
    const flag = ownFlag(f, fleets);
    if(flag && hpRatio(f) <= p.speederRetreatHp) return moveTo(flag);
    const boosted = nearestVisibleEnemy(f, fleets, intel, p.speederBoostAvoidDistance, e => e.role === 'cruiser' && e.boost > 0);
    if(boosted) return moveTo(pointToward(boosted.info, f, p.speederBoostAvoidDistance + 150));
    const final = finalBattleOrder(f, flag, fleets, intel, p);
    if(final) return final;
    const carrier = nearestVisibleEnemy(f, fleets, intel, p.speederCarrierDistance, e => e.role === 'carrier');
    if(carrier) return moveTo(pointToward(carrier.info, f, p.speederCarrierDistance + 150));
    let threat = null;
    for(const info of Object.values(intel)){
      if(info.visible && dist(f, info) < p.speederSafeDistance && (!threat || dist(f, info) < dist(f, threat))) threat = info;
    }
    if(threat) return moveTo(pointToward(threat, f, p.speederSafeDistance + 150));
    const enemyFlag = fleets.find(e => e.team !== f.team && e.flagship && alive(e));
    const info = enemyFlag && intel[enemyFlag.id];
    if(info) return moveTo(shadowPoint(f, enemyFlag, info, fleets, intel, p));
    return explore(f, rng);
  }

  // 敵旗艦を見張る位置 (第 3.8 段階): 敵旗艦から speederMarkDistance の円の上で、見えているほかの敵 (護衛) から speederSafeDistance 以上
  // 離れた位置のうち、自分に最も近いところ。どこも近ければ、ほかの敵から最も離れたところ。ほかの敵がいなければ自分の側
  const SHADOW_DIRECTIONS = 16;
  function shadowPoint(f, enemyFlag, info, fleets, intel, p){
    const others = [];
    for(const e of fleets){
      const o = intel[e.id];
      if(e !== enemyFlag && e.team !== f.team && alive(e) && o && o.visible) others.push(o);
    }
    const base = pointToward(info, f, p.speederMarkDistance);
    const clearance = pt => others.reduce((m, o) => Math.min(m, dist(pt, o)), Infinity);
    if(clearance(base) >= p.speederSafeDistance) return base;
    const start = Math.atan2(f.y - info.y, f.x - info.x);
    let best = base, bestSafe = null, bestClear = clearance(base);
    for(let k = 1; k < SHADOW_DIRECTIONS; k++){
      const a = start + 2 * Math.PI * k / SHADOW_DIRECTIONS;
      const pt = {x: clamp(info.x + Math.cos(a) * p.speederMarkDistance, 0, WORLD.w), y: clamp(info.y + Math.sin(a) * p.speederMarkDistance, 0, WORLD.h)};
      const c = clearance(pt);
      if(c >= p.speederSafeDistance){ if(!bestSafe || dist(f, pt) < dist(f, bestSafe)) bestSafe = pt; }
      else if(c > bestClear){ best = pt; bestClear = c; }
    }
    return bestSafe || best;
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
