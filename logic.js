// 描画や DOM に依存しないゲームロジック。
// ブラウザでは window.SagittariusLogic、Node では require('./logic.js') で使う。
(function(root){
  'use strict';

  const WORLD = {w: 4000, h: 3000};
  const INITIAL_SHIPS = 3000;
  const PARAM_TOTAL = 100;
  const PARAM_MIN = 10;
  const SENSOR_RANGE = 450;      // 索敵半径
  const BEAM_RANGE = 260;        // ビーム射程 (索敵半径より短い)
  const GHOST_CLEAR_RANGE = 150; // 最終確認位置にこの距離まで近づいて敵がいなければ記録を消す
  const ATTACK_STOP_RATIO = 0.8; // 攻撃命令では射程のこの割合まで近づいて止まる
  const ATTACK_COEF = 0.002;     // 1 隻・攻撃 1 あたりの毎秒ダメージ (艦艇数)
  const DEFENSE_HALF = 50;       // 防御がこの値のとき受けるダメージが半分になる
  const FIREPOWER_FLOOR = 0.3;   // 火力計算に使う艦艇数の下限 (初期艦艇数に対する割合)
  const RETREAT_RATIO = 0.35;    // AI はこの割合を下回ると後退する
  const AI_THINK_INTERVAL = 1;   // AI が命令を考え直す間隔 (秒)
  const TEAMS = ['blue', 'red'];

  // AI 艦隊のパラメータの型
  const AI_PRESETS = [
    {name: '高速型', params: {speed: 50, defense: 20, attack: 30}},
    {name: '重装型', params: {speed: 20, defense: 50, attack: 30}},
    {name: '攻撃型', params: {speed: 25, defense: 20, attack: 55}},
    {name: '均等型', params: {speed: 34, defense: 33, attack: 33}}
  ];

  const alive = f => f.ships > 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function validateParams(p){
    const keys = ['speed', 'defense', 'attack'];
    if(!keys.every(k => Number.isInteger(p[k]) && p[k] >= PARAM_MIN)) return false;
    return keys.reduce((s, k) => s + p[k], 0) === PARAM_TOTAL;
  }

  // 最大移動速度 (px/秒)
  function maxSpeed(params){
    return 40 + 2.4 * params.speed;
  }

  // 受けるダメージの倍率 (防御 0 で 1、DEFENSE_HALF で 0.5)
  function mitigation(params){
    return DEFENSE_HALF / (DEFENSE_HALF + params.defense);
  }

  // attacker が target に与える毎秒ダメージ (艦艇数)
  function beamDps(attacker, target){
    const firepower = Math.max(attacker.ships, INITIAL_SHIPS * FIREPOWER_FLOOR);
    return firepower * ATTACK_COEF * attacker.params.attack * mitigation(target.params);
  }

  // team から見えている (味方のどれかの索敵範囲内の) 生存中の敵
  function visibleEnemies(fleets, team){
    const eyes = fleets.filter(f => f.team === team && alive(f));
    return fleets.filter(f => f.team !== team && alive(f) && eyes.some(e => dist(e, f) <= SENSOR_RANGE));
  }

  // 敵の位置情報 (intel: 敵 id → {x, y, visible}) を更新する。
  // 見失った敵は最終確認位置を残し、味方がその近くまで行って確かめたら消す
  function updateIntel(intel, fleets, team){
    const eyes = fleets.filter(f => f.team === team && alive(f));
    const seen = new Set(visibleEnemies(fleets, team).map(f => f.id));
    for(const f of fleets){
      if(f.team === team) continue;
      if(!alive(f)){ delete intel[f.id]; continue; }
      if(seen.has(f.id)){ intel[f.id] = {x: f.x, y: f.y, visible: true}; continue; }
      const info = intel[f.id];
      if(!info) continue;
      if(info.visible){ info.visible = false; continue; } // 見失った直後は記録を残す
      if(eyes.some(e => dist(e, info) <= GHOST_CLEAR_RANGE)) delete intel[f.id];
    }
  }

  // 射程内の敵 (visible: 見えている敵の一覧) から攻撃対象を選ぶ。攻撃命令の相手を優先する
  function chooseTarget(f, visible){
    const inRange = visible.filter(e => alive(e) && dist(f, e) <= BEAM_RANGE);
    if(f.order && f.order.type === 'attack'){
      const ordered = inRange.find(e => e.id === f.order.targetId);
      if(ordered) return ordered;
    }
    let best = null;
    for(const e of inRange) if(!best || dist(f, e) < dist(f, best)) best = e;
    return best;
  }

  // 命令に従って dt 秒ぶん移動する
  function moveFleet(f, dt, intel){
    const o = f.order;
    if(!o) return;
    let dest, stopAt;
    if(o.type === 'move'){
      dest = o;
      stopAt = 0;
    }else{
      const info = intel[o.targetId];
      if(!info){ f.order = null; return; }
      dest = info;
      stopAt = info.visible ? BEAM_RANGE * ATTACK_STOP_RATIO : 0;
    }
    const d = dist(f, dest);
    const step = maxSpeed(f.params) * dt;
    if(d - stopAt <= step){
      if(d > stopAt){
        const k = (d - stopAt) / d;
        f.x += (dest.x - f.x) * k;
        f.y += (dest.y - f.y) * k;
      }
      // 移動先に着いた / 見失った相手の最終確認位置に着いた
      if(o.type === 'move' || !intel[o.targetId].visible) f.order = null;
      return;
    }
    f.x += (dest.x - f.x) / d * step;
    f.y += (dest.y - f.y) / d * step;
  }

  // 敵味方の生存状況から勝敗を返す (青チーム視点)。決着前は null
  function checkOutcome(fleets){
    const blueAlive = fleets.some(f => f.team === 'blue' && alive(f));
    const redAlive = fleets.some(f => f.team === 'red' && alive(f));
    if(blueAlive && redAlive) return null;
    if(blueAlive) return 'win';
    if(redAlive) return 'lose';
    return 'draw';
  }

  // AI の命令を決める
  function aiDecide(f, fleets, intel, rng){
    const allies = fleets.filter(a => a.team === f.team && a !== f && alive(a));

    // 損害が大きければ味方の中心へ下がる (味方がいなければ下がる先がないので戦い続ける)
    if(f.ships < INITIAL_SHIPS * RETREAT_RATIO && allies.length){
      const x = allies.reduce((s, a) => s + a.x, 0) / allies.length;
      const y = allies.reduce((s, a) => s + a.y, 0) / allies.length;
      return {type: 'move', x, y};
    }

    // 見えている敵: 近くて弱いほど優先 (距離 100 と艦艇数 500 を同じ重みで比べる)
    const byId = new Map(fleets.map(e => [e.id, e]));
    let best = null, bestScore = Infinity;
    for(const [id, info] of Object.entries(intel)){
      const e = byId.get(id);
      if(!info.visible || !e || !alive(e)) continue;
      const score = dist(f, info) / 100 + e.ships / 500;
      if(score < bestScore){ best = id; bestScore = score; }
    }
    if(best) return {type: 'attack', targetId: best};

    // 見失った敵の最終確認位置
    let ghost = null;
    for(const info of Object.values(intel)){
      if(!info.visible && (!ghost || dist(f, info) < dist(f, ghost))) ghost = info;
    }
    if(ghost) return {type: 'move', x: ghost.x, y: ghost.y};

    // 手がかりなし: 索敵中なら目的地に着くまで続け、なければ敵陣側の半分のどこかへ出る
    if(f.order && f.order.explore) return f.order;
    const half = WORLD.w / 2;
    const x = f.team === 'blue' ? half + rng() * half : rng() * half;
    return {type: 'move', x, y: rng() * WORLD.h, explore: true};
  }

  function createGame(playerParams, rng){
    const fleets = [];
    for(const team of TEAMS){
      for(let i = 0; i < 5; i++){
        const isPlayer = team === 'blue' && i === 0;
        const preset = AI_PRESETS[Math.floor(rng() * AI_PRESETS.length) % AI_PRESETS.length];
        fleets.push({
          id: `${team}${i + 1}`,
          team,
          name: `${team === 'blue' ? '味方' : '敵'}第${i + 1}艦隊`,
          x: team === 'blue' ? 300 : WORLD.w - 300,
          y: 700 + i * 400,
          ships: INITIAL_SHIPS,
          params: Object.assign({}, isPlayer ? playerParams : preset.params),
          type: isPlayer ? 'プレイヤー' : preset.name,
          order: null,
          isPlayer,
          ai: {nextThink: 0}
        });
      }
    }
    return {time: 0, fleets, intel: {blue: {}, red: {}}, beams: [], outcome: null};
  }

  // ゲームを dt 秒進める
  function step(g, dt, rng){
    if(g.outcome) return;
    g.time += dt;
    const living = g.fleets.filter(alive);

    for(const team of TEAMS) updateIntel(g.intel[team], g.fleets, team);

    for(const f of living){
      if(f.isPlayer || g.time < f.ai.nextThink) continue;
      f.order = aiDecide(f, g.fleets, g.intel[f.team], rng);
      f.ai.nextThink = g.time + AI_THINK_INTERVAL;
    }

    for(const f of living) moveFleet(f, dt, g.intel[f.team]);
    for(const team of TEAMS) updateIntel(g.intel[team], g.fleets, team);

    // 射撃は全艦隊ぶんを先に計算してから同時に反映する
    const visible = {blue: visibleEnemies(g.fleets, 'blue'), red: visibleEnemies(g.fleets, 'red')};
    const damage = new Map();
    g.beams = [];
    for(const f of living){
      const t = chooseTarget(f, visible[f.team]);
      if(!t) continue;
      damage.set(t, (damage.get(t) || 0) + beamDps(f, t) * dt);
      g.beams.push({from: f.id, to: t.id, team: f.team});
    }
    for(const [t, d] of damage) t.ships = Math.max(0, t.ships - d);

    for(const team of TEAMS) updateIntel(g.intel[team], g.fleets, team);
    g.outcome = checkOutcome(g.fleets);
  }

  const api = {
    WORLD, INITIAL_SHIPS, PARAM_TOTAL, PARAM_MIN, SENSOR_RANGE, BEAM_RANGE, GHOST_CLEAR_RANGE, FIREPOWER_FLOOR,
    AI_PRESETS, validateParams, maxSpeed, mitigation, beamDps, visibleEnemies, updateIntel,
    chooseTarget, moveFleet, checkOutcome, aiDecide, createGame, step
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
