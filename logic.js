// 描画や DOM に依存しないゲームロジック。
// ブラウザでは window.SagittariusLogic、Node では require('./logic.js') で使う。
(function(root){
  'use strict';

  const WORLD = {w: 2400, h: 4800}; // 原作のミニマップと同じ縦長 (横 1 : 縦 2)。青は下、赤は上に陣取る
  const INITIAL_SHIPS = 15000;   // 原作の画面に合わせた初期艦艇数
  const PARAM_TOTAL = 100;
  const PARAM_MIN = 10;
  const SENSOR_RANGE = 450;      // 索敵半径
  const LOCK_RANGE = SENSOR_RANGE;   // 狙いを定める範囲 (射程) = 索敵半径
  const FIRE_RANGE = LOCK_RANGE / 2; // 実際に撃てる範囲 = 射程の半分
  const GHOST_CLEAR_RANGE = 150; // 最終確認位置にこの距離まで近づいて敵がいなければ記録を消す
  const ATTACK_STOP_RATIO = 0.8; // 攻撃命令では撃てる範囲のこの割合まで近づいて止まる
  const ATTACK_COEF = 0.002;     // 通常弾の、1 隻・火力 1 あたりの毎秒ダメージ (艦艇数)
  const DEFENSE_HALF = 50;       // 防御がこの値のとき受けるダメージが半分になる
  const FIREPOWER_FLOOR = 0.3;   // 火力計算に使う艦艇数の下限 (初期艦艇数に対する割合)
  const AI_THINK_INTERVAL = 1;   // AI が命令を考え直す間隔 (秒)
  const FLAGSHIP_PRIORITY = 20;  // AI が敵旗艦を狙うときにスコアから引く値
  const SHELL_INTERVAL = 0.5;    // 通常弾 (必中の追尾弾) の発射間隔 (秒)
  const SHELL_SPEED = 600;       // 通常弾の速さ (px/秒)。どの艦隊より速いので必ず追いつく
  const SHELL_HIT_RADIUS = 12;   // 通常弾がこの距離まで近づいたら命中
  const TORPEDO_RELOAD = 6;      // 爆発弾 (回避できる追尾弾) の再装填時間 (秒)
  const TORPEDO_SPEED = 170;     // 爆発弾の速さ (px/秒)。スピーダー (184) より遅い
  const TORPEDO_TURN_RATE = 2;   // 爆発弾が 1 秒に曲がれる角度 (ラジアン)
  const TORPEDO_LIFE = 4;        // 爆発弾が燃え尽きるまでの時間 (秒)
  const TORPEDO_HIT_RADIUS = 25; // 爆発弾がこの距離まで近づいたら命中
  const TORPEDO_COEF = 0.006;    // 爆発弾 1 発の火力係数 (通常弾 1 発の 6 倍)
  const INTERCEPT_RANGE = 150;   // 迎撃範囲
  const INTERCEPT_INTERVAL = 0.5; // 迎撃を試みる間隔 (秒)
  const INTERCEPT_CHANCE = 0.35; // 迎撃の成功率 (爆発弾だけが対象)
  const EPS = 1e-9;              // 小数の誤差を吸収する (待ち時間の判定など)
  const CHEAT_SEQUENCE = ['KeyY', 'KeyU', 'KeyK', 'KeyI']; // 隠しコマンド入力欄を開くキー列
  const CHEAT_WINDOW = 2;        // キー列を押し切るまでの制限時間 (秒)
  const COMMANDS = ['scan', 'warp'];
  const TEAMS = ['blue', 'red'];

  // ジョブ (敏捷 = speed / 耐久 = defense / 火力 = attack)。バランサーは旗艦専用
  const JOBS = {
    balancer: {name: 'バランサー', params: {speed: 30, defense: 40, attack: 30}, flagshipOnly: true, description: '旗艦専用。攻守のバランスがよく、どんな場面にも対応できる'},
    attacker: {name: 'アタッカー', params: {speed: 25, defense: 25, attack: 50}, description: '火力重視。撃ち合いに強いが、守りは薄い'},
    speeder: {name: 'スピーダー', params: {speed: 60, defense: 20, attack: 20}, description: '最速。索敵や見張り、逃げるのが得意。撃ち合いは苦手'},
    tank: {name: 'タンク', params: {speed: 30, defense: 50, attack: 20}, description: '最も頑丈。受けるダメージが半分になる'}
  };
  const JOB_LIST = Object.values(JOBS);

  // 連合艦隊の編成 (第 1〜第 5 艦隊の役割とジョブ)。敵味方とも同じ
  const FORMATION = [
    {role: 'flagship', job: 'balancer'},
    {role: 'vice', job: 'tank'},
    {role: 'attacker', job: 'attacker'},
    {role: 'attacker', job: 'attacker'},
    {role: 'speeder', job: 'speeder'}
  ];
  const SPAWN_XS = [400, 800, 1200, 1600, 2000];
  const SPAWN_ORDER = [3, 2, 1, 4, 5]; // 横一列に (各チームから見て) 左から第 3・第 2・第 1 (旗艦)・第 4・第 5 艦隊

  // AI プロファイル: 役割別 AI の判断に使うつまみ。第 2.7 段階 (AI 学習) でこの値を調整する
  const AI_PROFILES = {
    standard: {
      localRadius: 700,          // 局地的な戦力比を数える半径
      flagshipRetreatRatio: 1.5, // 旗艦はこの戦力比を超えたら味方の中心へ下がる
      tankDistance: 150,         // 副艦が旗艦から離れる距離
      tankDefendRadius: 500,     // 副艦は旗艦からこの距離以内の敵を迎え撃つ
      attackerDistance: 500,     // アタッカーが普段保つ旗艦との距離 (左右)
      attackerLeash: 900,        // アタッカーは旗艦からこの距離以内の敵を攻撃する
      attackerRetreatRatio: 1.3, // アタッカーはこの戦力比を超えたら旗艦のもとへ下がる
      speederMarkDistance: 420,  // スピーダーが敵旗艦を見張る距離 (索敵半径 450 より内側)
      speederSafeDistance: 350   // スピーダーはこれより近い敵から離れる (撃てる範囲 225 より外)
    }
  };
  // アタッカーの隊列位置の方向 (旗艦から見て [前方, 右方向] の単位ベクトル)。左・右 (副艦の前と合わせて旗艦を囲む)。
  // 旗艦からの距離は AI プロファイルの attackerDistance
  const ATTACKER_SLOTS = [[0, -1], [0, 1]];

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

  // attacker の通常弾が target に与える毎秒ダメージ (艦艇数)
  function shellDps(attacker, target){
    return firepower(attacker) * ATTACK_COEF * attacker.params.attack * mitigation(target.params);
  }

  // 通常弾 1 発の威力 (耐久による軽減前)。毎秒ダメージ × 発射間隔
  function shellPower(attacker){
    return firepower(attacker) * ATTACK_COEF * attacker.params.attack * SHELL_INTERVAL;
  }

  function shellDamage(attacker, target){
    return shellPower(attacker) * mitigation(target.params);
  }

  // 爆発弾 1 発の威力 (耐久による軽減前)
  function torpedoPower(attacker){
    return firepower(attacker) * TORPEDO_COEF * attacker.params.attack;
  }

  function torpedoDamage(attacker, target){
    return torpedoPower(attacker) * mitigation(target.params);
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

  // 狙いを定める範囲 (LOCK_RANGE) 内の敵 (visible: 見えている敵の一覧) から狙いを選ぶ。攻撃命令の相手を優先する
  function lockTarget(f, visible){
    const inRange = visible.filter(e => alive(e) && dist(f, e) <= LOCK_RANGE);
    if(f.order && f.order.type === 'attack'){
      const ordered = inRange.find(e => e.id === f.order.targetId);
      if(ordered) return ordered;
    }
    let best = null;
    for(const e of inRange) if(!best || dist(f, e) < dist(f, best)) best = e;
    return best;
  }

  // 命令に従って dt 秒ぶん、最大速度で移動する。移動した方向を向く
  function moveFleet(f, dt, intel){
    const o = f.order;
    if(!o) return;
    const step = maxSpeed(f.params) * dt;

    // 進路 (移動キー): 指定方向へ進み続け、マップの端に着いたら止まる
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
      stopAt = info.visible ? FIRE_RANGE * ATTACK_STOP_RATIO : 0;
    }
    // 行き先はマップの内側に収める (外なら最も近い端へ向かう)
    dest = {x: clamp(dest.x, 0, WORLD.w), y: clamp(dest.y, 0, WORLD.h)};
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
    f.x = clamp(f.x + (dest.x - f.x) / d * step, 0, WORLD.w);
    f.y = clamp(f.y + (dest.y - f.y) / d * step, 0, WORLD.h);
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

  const sameParams = (a, b) => a.speed === b.speed && a.defense === b.defense && a.attack === b.attack;

  // ゲームを作る。ルールはモダン (旗艦を倒したら勝ち)。編成は FORMATION で固定、プレイヤーは青の旗艦で好きなジョブを選べる。
  // options.profiles: チームごとの AI プロファイル ({blue, red}。省略時は標準)
  // options.playerName: 自艦隊の名前 (省略・空なら「味方第1艦隊」)
  function createGame(playerParams, options){
    const opts = options || {};
    const profiles = Object.assign({blue: AI_PROFILES.standard, red: AI_PROFILES.standard}, opts.profiles);
    const fleets = [];
    for(const team of TEAMS){
      FORMATION.forEach((slot, i) => {
        const no = i + 1;
        const isPlayer = team === 'blue' && no === 1;
        const job = JOBS[slot.job];
        const playerJob = JOB_LIST.find(j => sameParams(j.params, playerParams));
        fleets.push({
          id: `${team}${no}`,
          team,
          name: isPlayer && opts.playerName ? opts.playerName : `${team === 'blue' ? '味方' : '敵'}第${no}艦隊`,
          role: slot.role,
          // 各チームから見て左から SPAWN_ORDER の順。赤は南 (敵陣) を向くので東から並ぶ
          x: team === 'blue' ? SPAWN_XS[SPAWN_ORDER.indexOf(no)] : WORLD.w - SPAWN_XS[SPAWN_ORDER.indexOf(no)],
          y: team === 'blue' ? WORLD.h - 300 : 300,
          heading: team === 'blue' ? -Math.PI / 2 : Math.PI / 2,
          ships: INITIAL_SHIPS,
          params: Object.assign({}, isPlayer ? playerParams : job.params),
          type: isPlayer ? (playerJob ? playerJob.name : 'カスタム') : job.name,
          order: null,
          isPlayer,
          flagship: slot.role === 'flagship',
          shellCooldown: 0,
          torpedoCooldown: 0,
          weapons: {shell: true, torpid: true},
          interceptCooldown: 0,
          ai: {nextThink: 0}
        });
      });
    }
    return {
      time: 0, mode: 'modern', profiles, fleets, intel: {blue: {}, red: {}}, locks: [],
      projectiles: [], nextProjectileId: 1, events: [], reveal: false, warpArmed: false, outcome: null
    };
  }

  // 青チームだけ隠しコマンドの索敵解除が効く
  const revealFor = (g, team) => team === 'blue' && g.reveal;

  // そのステップで起きたこと (発砲・命中・迎撃・全滅) を g.events に記録する。画面側が音を鳴らすのに使う
  function record(g, event){
    (g.events || (g.events = [])).push(event);
  }

  const visibleByTeam = g => ({blue: visibleEnemies(g.fleets, 'blue', revealFor(g, 'blue')), red: visibleEnemies(g.fleets, 'red', false)});

  // 各艦隊が狙いを定め (g.locks)、撃てる範囲にいれば、待ち時間の空いた弾を撃つ。
  // visible: チームごとの見えている敵 (省略時はその場で計算)
  function fireWeapons(g, dt, visible){
    const vis = visible || visibleByTeam(g);
    g.locks = [];
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.shellCooldown = Math.max(0, f.shellCooldown - dt);
      f.torpedoCooldown = Math.max(0, f.torpedoCooldown - dt);
      const t = lockTarget(f, vis[f.team]);
      if(!t) continue;
      const firing = dist(f, t) <= FIRE_RANGE;
      g.locks.push({from: f.id, to: t.id, team: f.team, firing});
      if(!firing) continue;
      const base = {team: f.team, from: f.id, targetId: t.id, x: f.x, y: f.y, heading: Math.atan2(t.y - f.y, t.x - f.x)};
      if(f.weapons.shell && f.shellCooldown <= EPS){
        g.projectiles.push(Object.assign({id: g.nextProjectileId++, kind: 'shell', life: Infinity, power: shellPower(f)}, base));
        f.shellCooldown = SHELL_INTERVAL;
        record(g, {type: 'fire', kind: 'shell', team: f.team, from: f.id, x: f.x, y: f.y});
      }
      if(f.weapons.torpid && f.torpedoCooldown <= EPS){
        g.projectiles.push(Object.assign({id: g.nextProjectileId++, kind: 'torpedo', life: TORPEDO_LIFE, power: torpedoPower(f)}, base));
        f.torpedoCooldown = TORPEDO_RELOAD;
        record(g, {type: 'fire', kind: 'torpedo', team: f.team, from: f.id, x: f.x, y: f.y});
      }
    }
  }

  // 迎撃範囲内の最も近い敵の爆発弾を撃ち落とそうとする (通常弾は撃ち落とせない)。試したら成否にかかわらず待ち時間に入る
  function interceptTorpedoes(g, dt, rng){
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.interceptCooldown = Math.max(0, f.interceptCooldown - dt);
      if(f.interceptCooldown > EPS) continue;
      let target = null;
      for(const p of g.projectiles){
        if(p.kind === 'torpedo' && p.team !== f.team && dist(f, p) <= INTERCEPT_RANGE && (!target || dist(f, p) < dist(f, target))) target = p;
      }
      if(!target) continue;
      f.interceptCooldown = INTERCEPT_INTERVAL;
      if(rng() < INTERCEPT_CHANCE){
        g.projectiles.splice(g.projectiles.indexOf(target), 1);
        record(g, {type: 'intercept', team: f.team, x: target.x, y: target.y});
      }
    }
  }

  // 点 c と線分 a→b の最短距離 (弾が 1 ステップで進む間に目標をかすめたかの判定に使う)
  function segmentDistance(a, b, c){
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const k = len2 > 0 ? clamp(((c.x - a.x) * vx + (c.y - a.y) * vy) / len2, 0, 1) : 0;
    return Math.hypot(a.x + vx * k - c.x, a.y + vy * k - c.y);
  }

  // 弾を進める。命中したダメージは damage (Map: 艦隊 → ダメージ) に足す。
  // 通常弾は目標の現在位置へまっすぐ向かい必ず当たる。爆発弾は曲がる速さに限りがあり、燃え尽きたら消える
  function moveProjectiles(g, dt, damage){
    const byId = new Map(g.fleets.map(f => [f.id, f]));
    const hit = (p, t) => {
      damage.set(t, (damage.get(t) || 0) + p.power * mitigation(t.params));
      record(g, {type: 'hit', kind: p.kind, team: p.team, targetId: t.id, x: t.x, y: t.y});
      return false;
    };
    g.projectiles = g.projectiles.filter(p => {
      const t = byId.get(p.targetId);
      if(!t || !alive(t)) return false;
      if(p.kind === 'shell'){
        const d = dist(p, t);
        const step = SHELL_SPEED * dt;
        if(d <= step + SHELL_HIT_RADIUS) return hit(p, t);
        p.x += (t.x - p.x) / d * step;
        p.y += (t.y - p.y) / d * step;
        p.heading = Math.atan2(t.y - p.y, t.x - p.x);
        return true;
      }
      // 爆発弾: 目標の方向へ、1 ステップで TORPEDO_TURN_RATE × dt まで向きを変えて進む
      const want = Math.atan2(t.y - p.y, t.x - p.x);
      let diff = want - p.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // -π〜π にそろえる
      const maxTurn = TORPEDO_TURN_RATE * dt;
      p.heading += clamp(diff, -maxTurn, maxTurn);
      const from = {x: p.x, y: p.y};
      p.x += Math.cos(p.heading) * TORPEDO_SPEED * dt;
      p.y += Math.sin(p.heading) * TORPEDO_SPEED * dt;
      if(segmentDistance(from, p, t) <= TORPEDO_HIT_RADIUS) return hit(p, t);
      p.life -= dt;
      return p.life > 0;
    });
  }

  // 移動キーの押し具合 {up, down, left, right} から進む角度 (画面の上が北)。進まないときは null
  function keyCourse(keys){
    const vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    return vx === 0 && vy === 0 ? null : Math.atan2(vy, vx);
  }

  // 結果画面の戦績: 戦闘時間 (秒)、チームごとの残存艦隊数と残存戦力 (艦艇の合計)
  function battleStats(g){
    const fleets = {blue: 0, red: 0}, ships = {blue: 0, red: 0};
    for(const f of g.fleets){
      if(!alive(f)) continue;
      fleets[f.team]++;
      ships[f.team] += f.ships;
    }
    return {time: g.time, fleets, ships};
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
    g.events = [];
    const living = g.fleets.filter(alive);
    const refreshIntel = () => { for(const team of TEAMS) updateIntel(g.intel[team], g.fleets, team, revealFor(g, team)); };

    refreshIntel();

    for(const f of living){
      if(f.isPlayer || g.time < f.ai.nextThink) continue;
      f.order = aiDecide(f, g.fleets, g.intel[f.team], rng, g.profiles && g.profiles[f.team]);
      f.ai.nextThink = g.time + AI_THINK_INTERVAL;
    }

    for(const f of living) moveFleet(f, dt, g.intel[f.team]);
    refreshIntel();

    fireWeapons(g, dt);
    interceptTorpedoes(g, dt, rng);

    // 弾のダメージは全艦隊ぶんを先に計算してから同時に反映する
    const damage = new Map();
    moveProjectiles(g, dt, damage);
    for(const [t, d] of damage) t.ships = Math.max(0, t.ships - d);
    for(const f of living){
      if(!alive(f)) record(g, {type: 'destroyed', team: f.team, id: f.id, flagship: !!f.flagship, x: f.x, y: f.y});
    }

    refreshIntel();
    g.outcome = checkOutcome(g.fleets);
  }

  const api = {
    WORLD, INITIAL_SHIPS, PARAM_TOTAL, PARAM_MIN, SENSOR_RANGE, LOCK_RANGE, FIRE_RANGE, GHOST_CLEAR_RANGE, FIREPOWER_FLOOR,
    SHELL_INTERVAL, TORPEDO_RELOAD, TORPEDO_SPEED, TORPEDO_TURN_RATE, TORPEDO_LIFE, INTERCEPT_RANGE, INTERCEPT_INTERVAL,
    JOBS, FORMATION, AI_PROFILES, validateParams, localForceRatio, maxSpeed, mitigation,
    shellDps, shellDamage, torpedoDamage, visibleEnemies, updateIntel,
    lockTarget, moveFleet, checkOutcome, aiDecide, createGame, step,
    fireWeapons, interceptTorpedoes, moveProjectiles, keyCourse, battleStats,
    newCheatProgress, cheatSequenceStep, parseCommand, applyCommand, warpFleet
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
