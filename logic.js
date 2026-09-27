// 描画や DOM に依存しないゲームロジック。
// ブラウザでは window.SagittariusLogic、Node では require('./logic.js') で使う。
(function(root){
  'use strict';

  const WORLD = {w: 2400, h: 4800}; // 原作のミニマップと同じ縦長 (横 1 : 縦 2)。青は下、赤は上に陣取る
  const INITIAL_SHIPS = 15000;   // 原作の画面に合わせた初期艦艇数
  const MAX_THROTTLE = 4;        // SPEED の段階の最大 (0〜4)
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
  const FLAGSHIP_PRIORITY = 20;  // AI が敵旗艦を狙うときにスコアから引く値
  const MISSILE_RANGE = 600;     // ミサイル射程
  const MISSILE_INTERVAL = 4;    // ミサイルの発射間隔 (秒)
  const MISSILE_SPEED = 220;     // ミサイルの速さ (px/秒)
  const MISSILE_LIFE = 6;        // ミサイルが燃え尽きるまでの時間 (秒)
  const MISSILE_HIT_RADIUS = 20; // この距離まで近づいたら命中
  const MISSILE_COEF = 0.002;    // ミサイル 1 発の火力係数
  const INTERCEPT_RANGE = 150;   // 迎撃範囲
  const INTERCEPT_INTERVAL = 0.5; // 迎撃を試みる間隔 (秒)
  const INTERCEPT_CHANCE = 0.35; // 迎撃の成功率
  const CHEAT_SEQUENCE = ['KeyY', 'KeyU', 'KeyK', 'KeyI']; // 隠しコマンド入力欄を開くキー列
  const CHEAT_WINDOW = 2;        // キー列を押し切るまでの制限時間 (秒)
  const COMMANDS = ['scan', 'warp'];
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
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

  function firepower(f){
    return Math.max(f.ships, INITIAL_SHIPS * FIREPOWER_FLOOR);
  }

  // attacker が target に与える毎秒ダメージ (艦艇数)
  function beamDps(attacker, target){
    return firepower(attacker) * ATTACK_COEF * attacker.params.attack * mitigation(target.params);
  }

  // ミサイル 1 発の威力 (防御による軽減前)
  function missilePower(attacker){
    return firepower(attacker) * MISSILE_COEF * attacker.params.attack;
  }

  // attacker のミサイル 1 発が target に与えるダメージ
  function missileDamage(attacker, target){
    return missilePower(attacker) * mitigation(target.params);
  }

  // team から見えている (味方のどれかの索敵範囲内の) 生存中の敵。reveal なら全部見える
  function visibleEnemies(fleets, team, reveal){
    const eyes = fleets.filter(f => f.team === team && alive(f));
    return fleets.filter(f => f.team !== team && alive(f) && (reveal || eyes.some(e => dist(e, f) <= SENSOR_RANGE)));
  }

  // 敵の位置情報 (intel: 敵 id → {x, y, visible}) を更新する。
  // 見失った敵は最終確認位置を残し、味方がその近くまで行って確かめたら消す
  function updateIntel(intel, fleets, team, reveal){
    const eyes = fleets.filter(f => f.team === team && alive(f));
    const seen = new Set(visibleEnemies(fleets, team, reveal).map(f => f.id));
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

  // 射程内の敵 (visible: 見えている敵の一覧) から攻撃対象を選ぶ。攻撃命令の相手を優先する。LASER オフなら撃たない
  function chooseTarget(f, visible){
    if(!f.weapons.laser) return null;
    const inRange = visible.filter(e => alive(e) && dist(f, e) <= BEAM_RANGE);
    if(f.order && f.order.type === 'attack'){
      const ordered = inRange.find(e => e.id === f.order.targetId);
      if(ordered) return ordered;
    }
    let best = null;
    for(const e of inRange) if(!best || dist(f, e) < dist(f, best)) best = e;
    return best;
  }

  // 命令に従って dt 秒ぶん移動する。移動した方向を向く。
  // 速さは最大速度 × SPEED の段階 / 4。段階 0 では動かない (命令は残す)
  function moveFleet(f, dt, intel){
    const o = f.order;
    if(!o || f.throttle === 0) return;
    const step = maxSpeed(f.params) * f.throttle / MAX_THROTTLE * dt;

    // WAY: 指定方向へ進み続け、マップの端に着いたら止まる
    if(o.type === 'course'){
      // 真北などで cos / sin に出る小さな誤差を 0 にそろえる
      const ux = Math.abs(Math.cos(o.angle)) < 1e-9 ? 0 : Math.cos(o.angle);
      const uy = Math.abs(Math.sin(o.angle)) < 1e-9 ? 0 : Math.sin(o.angle);
      const nx = f.x + ux * step, ny = f.y + uy * step;
      f.x = clamp(nx, 0, WORLD.w);
      f.y = clamp(ny, 0, WORLD.h);
      f.heading = o.angle;
      if(f.x !== nx || f.y !== ny) f.order = null;
      return;
    }

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
    if(d > stopAt) f.heading = Math.atan2(dest.y - f.y, dest.x - f.x);
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

  // 勝敗を返す (青チーム視点)。決着前は null。旗艦がいれば大将戦のルールで判定する
  function checkOutcome(fleets){
    const blueFlag = fleets.find(f => f.team === 'blue' && f.flagship);
    const redFlag = fleets.find(f => f.team === 'red' && f.flagship);
    const blueAlive = blueFlag ? alive(blueFlag) : fleets.some(f => f.team === 'blue' && alive(f));
    const redAlive = redFlag ? alive(redFlag) : fleets.some(f => f.team === 'red' && alive(f));
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

    // 見えている敵: 近くて弱いほど優先 (距離 100 と初期艦艇数の 1/6 を同じ重みで比べる)。敵旗艦は最優先
    const byId = new Map(fleets.map(e => [e.id, e]));
    let best = null, bestScore = Infinity;
    for(const [id, info] of Object.entries(intel)){
      const e = byId.get(id);
      if(!info.visible || !e || !alive(e)) continue;
      const score = dist(f, info) / 100 + e.ships / INITIAL_SHIPS * 6 -(e.flagship ? FLAGSHIP_PRIORITY : 0);
      if(score < bestScore){ best = id; bestScore = score; }
    }
    if(best) return {type: 'attack', targetId: best};

    // 見失った敵の最終確認位置 (旗艦は前に出ないので追わない)
    if(!f.flagship){
      let ghost = null;
      for(const info of Object.values(intel)){
        if(!info.visible && (!ghost || dist(f, info) < dist(f, ghost))) ghost = info;
      }
      if(ghost) return {type: 'move', x: ghost.x, y: ghost.y};
    }

    // 手がかりなし: 索敵中なら目的地に着くまで続け、なければ索敵に出る。
    // 通常は敵陣側の半分 (青は上、赤は下)、旗艦は自陣側の半分
    if(f.order && f.order.explore) return f.order;
    const half = WORLD.h / 2;
    const towardEnemy = !f.flagship;
    const upperHalf = (f.team === 'blue') === towardEnemy;
    const x = rng() * WORLD.w;
    const y = upperHalf ? rng() * half : half + rng() * half;
    return {type: 'move', x, y, explore: true};
  }

  // mode: 'annihilation' (全滅戦) / 'flagship' (大将戦)
  function createGame(playerParams, rng, mode){
    const fleets = [];
    for(const team of TEAMS){
      for(let i = 0; i < 5; i++){
        const isPlayer = team === 'blue' && i === 0;
        const preset = AI_PRESETS[Math.floor(rng() * AI_PRESETS.length) % AI_PRESETS.length];
        fleets.push({
          id: `${team}${i + 1}`,
          team,
          name: `${team === 'blue' ? '味方' : '敵'}第${i + 1}艦隊`,
          x: 400 + i * 400,
          y: team === 'blue' ? WORLD.h - 300 : 300,
          heading: team === 'blue' ? -Math.PI / 2 : Math.PI / 2,
          ships: INITIAL_SHIPS,
          params: Object.assign({}, isPlayer ? playerParams : preset.params),
          type: isPlayer ? 'プレイヤー' : preset.name,
          order: null,
          isPlayer,
          flagship: false,
          missileCooldown: 0,
          throttle: MAX_THROTTLE,
          weapons: {laser: true, torpid: true},
          interceptCooldown: 0,
          ai: {nextThink: 0}
        });
      }
    }
    if(mode === 'flagship'){
      fleets.find(f => f.isPlayer).flagship = true;
      const reds = fleets.filter(f => f.team === 'red');
      reds[Math.floor(rng() * reds.length) % reds.length].flagship = true;
    }
    return {
      time: 0, mode: mode || 'annihilation', fleets, intel: {blue: {}, red: {}}, beams: [],
      missiles: [], nextMissileId: 1, reveal: false, warpArmed: false, outcome: null
    };
  }

  // 青チームだけ隠しコマンドの索敵解除が効く
  const revealFor = (g, team) => team === 'blue' && g.reveal;

  // 発射間隔が空いた艦隊が、ミサイル射程内の見えている最も近い敵へ撃つ
  function launchMissiles(g, dt){
    const visible = {blue: visibleEnemies(g.fleets, 'blue', revealFor(g, 'blue')), red: visibleEnemies(g.fleets, 'red', false)};
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.missileCooldown = Math.max(0, f.missileCooldown - dt);
      if(f.missileCooldown > 0 || !f.weapons.torpid) continue;
      let target = null;
      for(const e of visible[f.team]){
        if(dist(f, e) <= MISSILE_RANGE && (!target || dist(f, e) < dist(f, target))) target = e;
      }
      if(!target) continue;
      g.missiles.push({
        id: g.nextMissileId++, team: f.team, from: f.id, targetId: target.id,
        x: f.x, y: f.y, life: MISSILE_LIFE, power: missilePower(f)
      });
      f.missileCooldown = MISSILE_INTERVAL;
    }
  }

  // 迎撃範囲内の最も近い敵ミサイルを撃ち落とそうとする。試したら成否にかかわらず待ち時間に入る
  function interceptMissiles(g, dt, rng){
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.interceptCooldown = Math.max(0, f.interceptCooldown - dt);
      if(f.interceptCooldown > 0) continue;
      let target = null;
      for(const m of g.missiles){
        if(m.team !== f.team && dist(f, m) <= INTERCEPT_RANGE && (!target || dist(f, m) < dist(f, target))) target = m;
      }
      if(!target) continue;
      f.interceptCooldown = INTERCEPT_INTERVAL;
      if(rng() < INTERCEPT_CHANCE) g.missiles.splice(g.missiles.indexOf(target), 1);
    }
  }

  // ミサイルを目標の現在位置へ進める。命中したダメージは damage (Map: 艦隊 → ダメージ) に足す
  function moveMissiles(g, dt, damage){
    const byId = new Map(g.fleets.map(f => [f.id, f]));
    g.missiles = g.missiles.filter(m => {
      const t = byId.get(m.targetId);
      if(!t || !alive(t)) return false;
      m.life -= dt;
      const d = dist(m, t);
      const step = MISSILE_SPEED * dt;
      if(d <= step + MISSILE_HIT_RADIUS){
        damage.set(t, (damage.get(t) || 0) + m.power * mitigation(t.params));
        return false;
      }
      if(m.life <= 0) return false;
      m.x += (t.x - m.x) / d * step;
      m.y += (t.y - m.y) / d * step;
      return true;
    });
  }

  // ---------- 隠しコマンド ----------
  function newCheatProgress(){
    return {index: 0, start: 0};
  }

  // キーを 1 つ押したときの進み具合。CHEAT_SEQUENCE を CHEAT_WINDOW 秒以内に押し切ったら triggered
  function cheatSequenceStep(progress, code, now){
    let {index, start} = progress;
    if(index > 0 && now - start > CHEAT_WINDOW) index = 0;
    if(code === CHEAT_SEQUENCE[index]){
      if(index === 0) start = now;
      index++;
    }else{
      index = code === CHEAT_SEQUENCE[0] ? 1 : 0;
      if(index === 1) start = now;
    }
    if(index === CHEAT_SEQUENCE.length) return {progress: newCheatProgress(), triggered: true};
    return {progress: {index, start}, triggered: false};
  }

  // 入力された文字列をコマンド名にする。該当しなければ null
  function parseCommand(text){
    const c = String(text).trim().toLowerCase();
    return COMMANDS.includes(c) ? c : null;
  }

  function applyCommand(g, command){
    if(command === 'scan') g.reveal = !g.reveal;
    if(command === 'warp') g.warpArmed = true;
  }

  // 艦隊を (x, y) へ瞬間移動する (マップ内に収める)
  function warpFleet(g, f, x, y){
    f.x = clamp(x, 0, WORLD.w);
    f.y = clamp(y, 0, WORLD.h);
    f.order = null;
    g.warpArmed = false;
  }

  // ゲームを dt 秒進める
  function step(g, dt, rng){
    if(g.outcome) return;
    g.time += dt;
    const living = g.fleets.filter(alive);
    const refreshIntel = () => { for(const team of TEAMS) updateIntel(g.intel[team], g.fleets, team, revealFor(g, team)); };

    refreshIntel();

    for(const f of living){
      if(f.isPlayer || g.time < f.ai.nextThink) continue;
      f.order = aiDecide(f, g.fleets, g.intel[f.team], rng);
      f.ai.nextThink = g.time + AI_THINK_INTERVAL;
    }

    for(const f of living) moveFleet(f, dt, g.intel[f.team]);
    refreshIntel();

    launchMissiles(g, dt);
    interceptMissiles(g, dt, rng);

    // ビームとミサイルのダメージは全艦隊ぶんを先に計算してから同時に反映する
    const visible = {blue: visibleEnemies(g.fleets, 'blue', revealFor(g, 'blue')), red: visibleEnemies(g.fleets, 'red', false)};
    const damage = new Map();
    g.beams = [];
    for(const f of living){
      const t = chooseTarget(f, visible[f.team]);
      if(!t) continue;
      damage.set(t, (damage.get(t) || 0) + beamDps(f, t) * dt);
      g.beams.push({from: f.id, to: t.id, team: f.team});
    }
    moveMissiles(g, dt, damage);
    for(const [t, d] of damage) t.ships = Math.max(0, t.ships - d);

    refreshIntel();
    g.outcome = checkOutcome(g.fleets);
  }

  const api = {
    WORLD, INITIAL_SHIPS, MAX_THROTTLE, PARAM_TOTAL, PARAM_MIN, SENSOR_RANGE, BEAM_RANGE, GHOST_CLEAR_RANGE, FIREPOWER_FLOOR,
    MISSILE_RANGE, MISSILE_INTERVAL, INTERCEPT_RANGE, INTERCEPT_INTERVAL,
    AI_PRESETS, validateParams, maxSpeed, mitigation, beamDps, missileDamage, visibleEnemies, updateIntel,
    chooseTarget, moveFleet, checkOutcome, aiDecide, createGame, step,
    launchMissiles, interceptMissiles, moveMissiles,
    newCheatProgress, cheatSequenceStep, parseCommand, applyCommand, warpFleet
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
