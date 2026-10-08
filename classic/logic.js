// クラシック: 描画や DOM に依存しないゲームロジック。
// v1.3 からジョブを取り除き、ステータスは v1.2 と同じスライダー配分 (AI は 4 つの型からランダム) にしたもの。v3.0 から主流の開発対象 (原作ゲームの再現)。
// ブラウザでは window.SagittariusLogic、Node では require('./logic.js') で使う。
(function(root){
  'use strict';

  const WORLD = {w: 4800, h: 9600}; // 原作のミニマップと同じ縦長 (横 1 : 縦 2)。青は下、赤は上に陣取る (第 7 段階で 2 倍に。索敵・射程・速さはそのまま)
  const INITIAL_SHIPS = 15000;   // 原作の画面に合わせた初期艦艇数
  const MAX_THROTTLE = 4;        // SPEED の段階の最大 (0〜4)
  const PARAM_TOTAL = 100;
  const PARAM_MIN = 0;          // 各パラメータの最低 (原作どおり 0 から。第 5 段階で 10 → 0)
  const SENSOR_RANGE = 450;      // 索敵半径
  const BEAM_RANGE = 260;        // ビーム射程 (索敵半径より短い)
  const GHOST_CLEAR_RANGE = 150; // 最終確認位置にこの距離まで近づいて敵がいなければ記録を消す
  const ATTACK_STOP_RATIO = 0.8; // 攻撃命令では射程のこの割合まで近づいて止まる
  const BEAM_OPTIMAL_RATIO = 0.6; // 最適距離 (第 7 段階): ビームは射程のこの割合より遠ければ倍率 1。近いほど弱まる (全艦が 1 か所に集まって削り合わないように)
  const BEAM_CLOSE_FACTOR = 0.3; // 距離 0 のときのビームの倍率
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
  const MISSILE_AMMO = 30;       // 1 艦隊が出撃時に持つミサイルの数 (原作どおり弾数に限りがある。第 5 段階)
  const MISSILE_STRAIGHT_SPEED = MISSILE_SPEED * 1.5; // 直進モードのミサイルの速さ (誘導しないぶん速い。よけられる)
  const DODGE_LOOKAHEAD = 2;     // AI は、この秒数以内に当たる距離を通る敵の直進ミサイルをよける
  const DODGE_MARGIN = 30;       // 命中の距離にこれを足した距離より道に近ければ「当たる」とみなす
  const DODGE_TIME = 0.5;        // よけ始めたら、この秒数は横へ進んでから考え直す
  const INTERCEPT_RANGE = 150;   // 迎撃範囲
  const INTERCEPT_INTERVAL = 0.5; // 迎撃を試みる間隔 (秒)
  const INTERCEPT_CHANCE = 0.35; // 迎撃の成功率
  const CHEAT_SEQUENCE = ['KeyY', 'KeyU', 'KeyK', 'KeyI']; // 隠しコマンド入力欄を開くキー列
  const CHEAT_WINDOW = 2;        // キー列を押し切るまでの制限時間 (秒)
  const COMMANDS = ['scan', 'warp'];
  const CHEAT_WARP_INTERVAL = 30; // 敵のズル (原作のコンピ研役。第 5 段階): 赤の護衛 1 つがこの秒数ごとに青の隊長のそばへワープする
  const SUBFLEET_MAX = 20;       // 分艦隊 (第 5 段階 ④。原作どおり): プレイヤーの艦隊は、元の艦隊と分艦隊を合わせてこの数まで
  const FLEET_RADIUS = 30;       // 重なれない (第 7 段階): 艦隊の大きさ。2 つの艦隊はこの 2 倍より近づけず、押し合って離れる
  const MERGE_RANGE = 40;        // 合流: merge 命令の艦隊が合流先からこの距離以内に来たら 1 つになる
  const SUBFLEET_OFFSET = 40;    // 切り出した分艦隊は、元の艦隊の右へこの距離ずらして出す
  const SCOUT_COUNT = 2;         // 偵察 (AI。第 5 段階 ⑤): 出撃してすぐ、各チームの AI の護衛のうち左右の端のこの数が分艦隊を出す
  const SCOUT_SHIPS = 500;       // 偵察の分艦隊の隻数
  const SCOUT_WATCH_DISTANCE = 400; // 偵察の分艦隊は、見つけた敵からこの距離を保って見張る (索敵 450 の内側、ビーム 260 の外)
  const SCOUT_SAFE_DISTANCE = 360;  // これより近くに敵が来たら離れる
  const CHEAT_WARP_DISTANCE = 200; // ワープ先: 青の隊長の後ろ (進む向きの反対) のこの距離
  const TEAMS = ['blue', 'red'];

  // AI 艦隊のパラメータの型 (v1.2 と同じ。出撃時にランダム)
  const AI_PRESETS = [
    {name: '高速型', params: {speed: 50, defense: 20, attack: 30}},
    {name: '重装型', params: {speed: 20, defense: 50, attack: 30}},
    {name: '攻撃型', params: {speed: 25, defense: 20, attack: 55}},
    {name: '均等型', params: {speed: 34, defense: 33, attack: 33}}
  ];

  // 隊列: 護衛が付く位置 (隊長から見て [前方, 右方向] の距離)。左前・右前・左・右 (第 5 段階: 護衛を隊長より前に出し、
  // 攻めるときに隊長が先頭で敵の全艦隊に囲まれないようにした。前は左・右・左後ろ・右後ろ)
  const ESCORT_SLOTS = [[200, -170], [200, 170], [20, -280], [20, 280]];
  const FORMATION_SPEED_RATIO = 0.85; // AI の隊長は、一番遅い護衛の最大の速さのこの割合より速く進まない (隊形が伸びないように。第 5 段階)
  const DEFEND_RADIUS = 600;     // 護衛は隊長からこの距離以内の敵を迎え撃つ
  const SPAWN_XS = [-2, -1, 0, 1, 2].map(k => WORLD.w / 2 + k * 400); // 横一列の出撃位置 (400 おき)。真ん中 (マップの中央) は隊長

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

  // 距離 d でのビームの倍率 (最適距離。第 7 段階): 射程の BEAM_OPTIMAL_RATIO 以上で 1、それより近いと直線で下がり、0 で BEAM_CLOSE_FACTOR
  function beamRangeFactor(d){
    const near = BEAM_RANGE * BEAM_OPTIMAL_RATIO;
    return d >= near ? 1 : BEAM_CLOSE_FACTOR + (1 - BEAM_CLOSE_FACTOR) * d / near;
  }

  // attacker が target に与える毎秒ダメージ (艦艇数)。近すぎると弱まる
  function beamDps(attacker, target){
    return firepower(attacker) * ATTACK_COEF * attacker.params.attack * mitigation(target.params) * beamRangeFactor(dist(attacker, target));
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
    const speed = f.speedCap === null || f.speedCap === undefined ? maxSpeed(f.params) : Math.min(maxSpeed(f.params), f.speedCap);
    const step = speed * f.throttle / MAX_THROTTLE * dt;

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
    if(o.type === 'move' || o.type === 'merge'){
      dest = o;
      stopAt = 0;
    }else{
      const info = intel[o.targetId];
      if(!info){ f.order = null; return; }
      dest = info;
      stopAt = info.visible ? BEAM_RANGE * ATTACK_STOP_RATIO : 0;
    }
    // 行き先はマップの内側に収める (外なら最も近い端へ向かう)
    dest = {x: clamp(dest.x, 0, WORLD.w), y: clamp(dest.y, 0, WORLD.h)};
    const d = dist(f, dest);
    // 攻撃命令の相手が見えているとき、見えている敵 (相手でなくても) のどれかに近すぎれば (最適距離より近い)、
    // いちばん近いその敵を向いたまま、止まる距離まで下がる (第 7 段階)
    if(o.type === 'attack' && stopAt > 0){
      let near = null, nd = BEAM_RANGE * BEAM_OPTIMAL_RATIO;
      for(const info of Object.values(intel)){
        if(!info.visible) continue;
        const di = dist(f, info);
        if(di < nd){ near = info; nd = di; }
      }
      if(near){
        const back = Math.min(step, stopAt - nd);
        const ux = nd > 0 ? (f.x - near.x) / nd : -Math.cos(f.heading), uy = nd > 0 ? (f.y - near.y) / nd : -Math.sin(f.heading);
        if(nd > 0) f.heading = Math.atan2(near.y - f.y, near.x - f.x);
        f.x = clamp(f.x + ux * back, 0, WORLD.w);
        f.y = clamp(f.y + uy * back, 0, WORLD.h);
        return;
      }
    }
    if(d > stopAt) f.heading = Math.atan2(dest.y - f.y, dest.x - f.x);
    if(d - stopAt <= step){
      if(d > stopAt){
        const k = (d - stopAt) / d;
        f.x += (dest.x - f.x) * k;
        f.y += (dest.y - f.y) * k;
      }
      // 移動先に着いた / 見失った相手の最終確認位置に着いた
      if(o.type === 'move' || (o.type === 'attack' && !intel[o.targetId].visible)) f.order = null;
      return;
    }
    f.x = clamp(f.x + (dest.x - f.x) / d * step, 0, WORLD.w);
    f.y = clamp(f.y + (dest.y - f.y) / d * step, 0, WORLD.h);
  }

  // 重なれない (第 7 段階): 生きている艦隊どうし (敵味方とも) が FLEET_RADIUS × 2 より近ければ、真ん中を保って半分ずつ押し合う。
  // 同じ位置なら x の向きに離す。押し合うのは戦っている・待っている艦隊 (攻撃命令か命令なし) だけで、
  // 移動中 (move / merge / course) の艦隊は通り抜ける (押し合うと行き先や合流先の手前で詰まるため)
  function separateFleets(fleets){
    const min = FLEET_RADIUS * 2;
    const list = fleets.filter(f => alive(f) && !f.merged && (!f.order || f.order.type === 'attack'));
    for(let i = 0; i < list.length; i++){
      for(let j = i + 1; j < list.length; j++){
        const a = list[i], b = list[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if(d >= min) continue;
        if(d === 0){ dx = 1; dy = 0; d = 1; b.x = a.x + 1; }
        const push = (min - d) / 2, ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        // マップの端では、はみ出した分を相手に回す
        for(const [p, q, s] of [[a, b, 1], [b, a, -1]]){
          const cx = clamp(p.x, 0, WORLD.w), cy = clamp(p.y, 0, WORLD.h);
          q.x = clamp(q.x + (cx - p.x), 0, WORLD.w); q.y = clamp(q.y + (cy - p.y), 0, WORLD.h);
          p.x = cx; p.y = cy;
        }
      }
    }
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

  // 各チームの隊長を決める。隊長が全滅していたら、生き残りで艦艇数が最も多い艦隊 (同じなら先の艦隊) が引き継ぐ
  function updateLeaders(fleets){
    for(const team of TEAMS){
      const members = fleets.filter(f => f.team === team);
      if(members.some(f => f.leader && alive(f))) continue;
      for(const f of members) f.leader = false;
      let next = null;
      for(const f of members) if(alive(f) && (!next || f.ships > next.ships)) next = f;
      if(next) next.leader = true;
    }
  }

  // 隊長の AI: 後退せず、敵を攻撃しに行く
  function leaderDecide(f, fleets, intel, rng){
    const target = bestVisibleTarget(f, fleets, intel);
    if(target) return {type: 'attack', targetId: target};

    // 見失った敵の最終確認位置
    let ghost = null;
    for(const info of Object.values(intel)){
      if(!info.visible && (!ghost || dist(f, info) < dist(f, ghost))) ghost = info;
    }
    if(ghost) return {type: 'move', x: ghost.x, y: ghost.y};

    // 手がかりなし: 索敵中なら目的地に着くまで続け、なければ索敵に出る。
    // 自陣側にいるうちは敵陣側の半分 (青は上、赤は下) へ。すでに敵陣側にいればマップ全体から選ぶ
    // (敵陣側だけを探すと、すれ違った両軍が互いの空の陣地を探し続けて出会わないため)
    if(f.order && f.order.explore) return f.order;
    const half = WORLD.h / 2;
    const inEnemyHalf = f.team === 'blue' ? f.y < half : f.y > half;
    const x = rng() * WORLD.w;
    const y = inEnemyHalf ? rng() * WORLD.h : f.team === 'blue' ? rng() * half : half + rng() * half;
    return {type: 'move', x, y, explore: true};
  }

  // 分艦隊 (第 5 段階 ④): プレイヤーの艦隊 f から ships 隻 (1 隻以上、f に 1 隻以上残る整数) を切り出し、新しい分艦隊を返す。
  // そばに出し、性能・向き・速さの段階・武器の設定は同じ。ミサイルは隻数の割合で分ける (切り捨て)。旗艦・隊長は元の艦隊に残る。
  // プレイヤーの艦隊が SUBFLEET_MAX あるとき・切り出せないときは null
  function splitFleet(g, f, ships){
    if(!f || !f.isPlayer || !alive(f) || !Number.isInteger(ships) || ships < 1 || ships >= f.ships) return null;
    if(g.fleets.filter(a => a.team === f.team && a.isPlayer && alive(a)).length >= SUBFLEET_MAX) return null;
    return cutFleet(g, f, ships, '分艦隊');
  }

  // f から ships 隻を切り出した新しい艦隊を g.fleets に足して返す (確かめは呼ぶ側。名前は「元の名前・<label>N」)
  function cutFleet(g, f, ships, label){
    const root = f.root || f.id;
    const rootFleet = g.fleets.find(a => a.id === root) || f;
    g.nextSubId = (g.nextSubId || 0) + 1;
    const missiles = Math.floor((f.missiles || 0) * ships / f.ships);
    const c = Math.cos(f.heading), s = Math.sin(f.heading);
    const sub = Object.assign({}, f, {
      id: root + '-s' + g.nextSubId, root, name: rootFleet.name.replace(/・(分艦隊|偵察)\d+$/, '') + '・' + label + g.nextSubId,
      x: clamp(f.x - s * SUBFLEET_OFFSET, 0, WORLD.w), y: clamp(f.y + c * SUBFLEET_OFFSET, 0, WORLD.h),
      ships, missiles, flagship: false, leader: false, order: null, merged: false,
      params: Object.assign({}, f.params), weapons: Object.assign({}, f.weapons), ai: {nextThink: 0}, interceptCooldown: 0
    });
    f.ships -= ships;
    f.missiles = (f.missiles || 0) - missiles;
    g.fleets.push(sub);
    return sub;
  }

  // 偵察 (AI。第 5 段階 ⑤): 各チームの AI の護衛 (プレイヤー・隊長・偵察でない) のうち、左右の端の艦隊が SCOUT_SHIPS 隻ずつ切り出す。
  // 担当 scoutSide は左 (-1) / 右 (1)。試合の始めに 1 回だけ (沈んでも出し直さない)
  function launchScouts(g){
    for(const team of TEAMS){
      const escorts = g.fleets.filter(f => f.team === team && alive(f) && !f.isPlayer && !f.leader && !f.scout);
      if(!escorts.length) continue;
      const byX = [...escorts].sort((a, b) => a.x - b.x);
      const picks = SCOUT_COUNT >= 2 && byX.length >= 2 ? [byX[0], byX[byX.length - 1]] : [byX[0]];
      for(const parent of picks){
        if(parent.ships <= SCOUT_SHIPS) continue;
        const sc = cutFleet(g, parent, SCOUT_SHIPS, '偵察');
        sc.scout = true;
        sc.scoutSide = parent.x < WORLD.w / 2 ? -1 : 1;
      }
    }
  }

  // 偵察の分艦隊の命令: 近すぎる敵から離れる → 見えている敵 (敵旗艦を優先) を SCOUT_WATCH_DISTANCE で見張る →
  // 見失った敵の最終確認位置へ → 手がかりがなければ敵陣側の自分の担当 (左右の半分) を探して回る。自分からは攻撃に行かない
  function scoutDecide(f, fleets, intel, rng){
    const byId = new Map(fleets.map(e => [e.id, e]));
    const seen = Object.entries(intel).filter(([id, i]) => i.visible && byId.get(id) && alive(byId.get(id)));
    let near = null;
    for(const [, i] of seen) if(dist(f, i) < SCOUT_SAFE_DISTANCE && (!near || dist(f, i) < dist(f, near))) near = i;
    if(near){
      const d = dist(f, near) || 1;
      return {type: 'move', x: clamp(f.x + (f.x - near.x) / d * 300, 0, WORLD.w), y: clamp(f.y + (f.y - near.y) / d * 300, 0, WORLD.h)};
    }
    let watch = null;
    for(const [id, i] of seen){
      const flag = byId.get(id).flagship;
      if(!watch || (flag && !watch.flag) || (flag === watch.flag && dist(f, i) < dist(f, watch.i))) watch = {i, flag};
    }
    if(!watch){
      let ghost = null;
      for(const i of Object.values(intel)) if(!i.visible && (!ghost || dist(f, i) < dist(f, ghost))) ghost = i;
      if(ghost) watch = {i: ghost};
    }
    if(watch){
      const i = watch.i, d = dist(f, i) || 1;
      return {type: 'move', x: clamp(i.x + (f.x - i.x) / d * SCOUT_WATCH_DISTANCE, 0, WORLD.w), y: clamp(i.y + (f.y - i.y) / d * SCOUT_WATCH_DISTANCE, 0, WORLD.h)};
    }
    if(f.order && f.order.explore) return f.order;
    const half = WORLD.h / 2, halfW = WORLD.w / 2;
    const x = f.scoutSide < 0 ? rng() * halfW : halfW + rng() * halfW;
    const y = f.team === 'blue' ? rng() * half : half + rng() * half;
    return {type: 'move', x, y, explore: true};
  }

  // 合流: a と b を 1 つにする (隻数とミサイルを足す)。旗艦・隊長がいればその側に残し、もう片方は合流済み (ships 0・merged) になる。残った艦隊を返す
  function mergeFleets(g, a, b){
    const keep = a.flagship || (a.leader && !b.flagship) ? a : b;
    const gone = keep === a ? b : a;
    keep.ships += gone.ships;
    keep.missiles = (keep.missiles || 0) + (gone.missiles || 0);
    if(gone.leader){ keep.leader = true; gone.leader = false; }
    gone.ships = 0;
    gone.missiles = 0;
    gone.merged = true;
    gone.order = null;
    if(g.controlId === gone.id) g.controlId = keep.id;
    return keep;
  }

  // 隊形の速さ: AI の隊長が進める最大の速さ (一番遅い生きている護衛の最大の速さ × FORMATION_SPEED_RATIO)。
  // 隊長でない・プレイヤー・護衛がいないときは null (制限なし)
  function formationSpeedCap(f, fleets){
    if(f.isPlayer || !f.leader) return null;
    const escorts = fleets.filter(e => e.team === f.team && e !== f && alive(e) && !e.isPlayer && !e.scout);
    if(!escorts.length) return null;
    return FORMATION_SPEED_RATIO * Math.min(...escorts.map(e => maxSpeed(e.params)));
  }

  // 護衛の位置: 隊長の向きを基準に ESCORT_SLOTS の位置 (マップ内に収める)
  function escortSlot(leader, index){
    const [fwd, right] = ESCORT_SLOTS[index % ESCORT_SLOTS.length];
    const c = Math.cos(leader.heading), s = Math.sin(leader.heading);
    return {
      x: clamp(leader.x + fwd * c - right * s, 0, WORLD.w),
      y: clamp(leader.y + fwd * s + right * c, 0, WORLD.h)
    };
  }

  // AI の命令を決める。隊長は攻撃に向かい、護衛は隊長を守って付いていく
  function aiDecide(f, fleets, intel, rng){
    if(f.scout) return scoutDecide(f, fleets, intel, rng);
    const leader = fleets.find(a => a.team === f.team && a.leader && alive(a));
    if(!leader || leader === f) return leaderDecide(f, fleets, intel, rng);

    // 損害が大きければ隊長のすぐそばへ下がる
    if(f.ships < INITIAL_SHIPS * RETREAT_RATIO) return {type: 'move', x: leader.x, y: leader.y};

    // 隊長に近づいた敵を迎え撃つ
    const threat = bestVisibleTarget(f, fleets, intel, info => dist(leader, info) <= DEFEND_RADIUS);
    if(threat) return {type: 'attack', targetId: threat};

    // 隊長の周りの決まった位置へ付いていく
    const escorts = fleets.filter(a => a.team === f.team && alive(a) && a !== leader && !a.isPlayer && !a.scout); // プレイヤーの分艦隊と偵察は数えない
    const slot = escortSlot(leader, escorts.indexOf(f));
    return {type: 'move', x: slot.x, y: slot.y};
  }

  // よける (AI の反射。第 5 段階): 索敵範囲の中の敵の直進ミサイルが DODGE_LOOKAHEAD 秒以内に当たる距離を通るなら、
  // ミサイルの道から離れる向き (真横) へ進む命令を返す。いちばん早く来るものをよける。なければ null
  function dodgeOrder(f, missiles){
    let best = null;
    for(const m of missiles){
      if(m.guided !== false || m.team === f.team || dist(f, m) > SENSOR_RANGE) continue;
      const ux = Math.cos(m.heading), uy = Math.sin(m.heading);
      const dx = f.x - m.x, dy = f.y - m.y;
      const along = dx * ux + dy * uy;
      const time = along / MISSILE_STRAIGHT_SPEED;
      if(along <= 0 || time > DODGE_LOOKAHEAD) continue;
      const cross = ux * dy - uy * dx; // 道からの横のずれ (正なら道の右側)
      if(Math.abs(cross) > MISSILE_HIT_RADIUS + DODGE_MARGIN) continue;
      if(!best || time < best.time) best = {time, angle: m.heading + (cross >= 0 ? 1 : -1) * Math.PI / 2};
    }
    return best ? {type: 'course', angle: best.angle, dodge: true} : null;
  }

  // mode: 'annihilation' (全滅戦) / 'flagship' (大将戦)。options.enemyCheat: 敵がズルをする (索敵モードのオフとワープ。原作のコンピ研役)。
  // options.controllers: {blue, red} チームごとの AI (艦隊ごとに (f, fleets, intel, rng) → 命令。学習型 AI など。第 6 段階)。渡さないチームは今の AI (旧型 AI)
  function createGame(playerParams, rng, mode, options){
    const fleets = [];
    for(const team of TEAMS){
      for(let i = 0; i < 5; i++){
        const isPlayer = team === 'blue' && i === 0;
        const preset = AI_PRESETS[Math.floor(rng() * AI_PRESETS.length) % AI_PRESETS.length];
        fleets.push({
          id: `${team}${i + 1}`,
          team,
          name: `${team === 'blue' ? '味方' : '敵'}第${i + 1}艦隊`,
          x: 0, // 隊長を決めてから並べる
          y: team === 'blue' ? WORLD.h - 300 : 300,
          heading: team === 'blue' ? -Math.PI / 2 : Math.PI / 2,
          ships: INITIAL_SHIPS,
          params: Object.assign({}, isPlayer ? playerParams : preset.params),
          type: isPlayer ? 'プレイヤー' : preset.name,
          order: null,
          isPlayer,
          flagship: false,
          leader: false,
          missileCooldown: 0,
          missiles: MISSILE_AMMO,  // 残りのミサイル
          missileMode: 'guided',   // 'guided' (誘導: 追尾し、相手は迎撃が必要) / 'straight' (直進: 速いがよけられる)
          throttle: MAX_THROTTLE,
          weapons: {laser: true, torpid: true},
          interceptCooldown: 0,
          ai: {nextThink: 0}
        });
      }
    }
    // 隊長: 青はプレイヤー、赤はランダム。大将戦では隊長が旗艦
    fleets.find(f => f.isPlayer).leader = true;
    const reds = fleets.filter(f => f.team === 'red');
    reds[Math.floor(rng() * reds.length) % reds.length].leader = true;
    if(mode === 'flagship') for(const f of fleets) f.flagship = f.leader;
    // 出撃位置: 隊長は横一列の真ん中、残りは左から順に
    for(const team of TEAMS){
      const members = fleets.filter(f => f.team === team);
      const ordered = members.filter(f => !f.leader);
      ordered.splice(2, 0, members.find(f => f.leader));
      ordered.forEach((f, k) => { f.x = team === 'blue' ? SPAWN_XS[k] : WORLD.w - SPAWN_XS[k]; }); // 赤は点対称 (隊列の左右を両チームでそろえる。第 5 段階)
    }
    return {
      time: 0, mode: mode || 'annihilation', fleets, intel: {blue: {}, red: {}}, beams: [],
      missiles: [], nextMissileId: 1, reveal: false, warpArmed: false, outcome: null,
      enemyCheat: !!(options && options.enemyCheat), nextEnemyWarp: CHEAT_WARP_INTERVAL, enemyWarps: [],
      controllers: (options && options.controllers) || null
    };
  }

  // 霧なしで全部見えるか: 青は隠しコマンド scan、赤は敵のズル (索敵モードのオフ)
  const revealFor = (g, team) => team === 'blue' ? g.reveal : !!g.enemyCheat;

  // 敵のワープ (奇襲): ズルが有効なら CHEAT_WARP_INTERVAL 秒ごとに、赤の一番艦艇の多い護衛を青の隊長の後ろ CHEAT_WARP_DISTANCE へ
  // ワープさせ、隊長を攻撃させる (しばらくは考え直さない)。g.enemyWarps に記録する (画面のログ用)
  function enemyCheatWarp(g){
    if(!g.enemyCheat || g.time < g.nextEnemyWarp) return;
    g.nextEnemyWarp += CHEAT_WARP_INTERVAL;
    const target = g.fleets.find(f => f.team === 'blue' && f.leader && alive(f)) || g.fleets.find(f => f.team === 'blue' && alive(f));
    let raider = null;
    for(const f of g.fleets) if(f.team === 'red' && !f.leader && alive(f) && (!raider || f.ships > raider.ships)) raider = f;
    if(!target || !raider) return;
    raider.x = clamp(target.x - Math.cos(target.heading) * CHEAT_WARP_DISTANCE, 0, WORLD.w);
    raider.y = clamp(target.y - Math.sin(target.heading) * CHEAT_WARP_DISTANCE, 0, WORLD.h);
    raider.order = {type: 'attack', targetId: target.id};
    raider.ai.nextThink = g.time + CHEAT_WARP_INTERVAL / 2;
    (g.enemyWarps || (g.enemyWarps = [])).push({time: g.time, id: raider.id, x: raider.x, y: raider.y});
  }

  // 発射間隔が空いた艦隊が、ミサイル射程内の見えている最も近い敵へ撃つ
  function launchMissiles(g, dt){
    const visible = {blue: visibleEnemies(g.fleets, 'blue', revealFor(g, 'blue')), red: visibleEnemies(g.fleets, 'red', revealFor(g, 'red'))};
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.missileCooldown = Math.max(0, f.missileCooldown - dt);
      if(f.missileCooldown > 0 || !f.weapons.torpid || !(f.missiles > 0)) continue;
      let target = null;
      for(const e of visible[f.team]){
        if(dist(f, e) <= MISSILE_RANGE && (!target || dist(f, e) < dist(f, target))) target = e;
      }
      if(!target) continue;
      const guided = f.missileMode !== 'straight';
      g.missiles.push({
        id: g.nextMissileId++, team: f.team, from: f.id, targetId: target.id,
        x: f.x, y: f.y, life: MISSILE_LIFE, power: missilePower(f),
        guided, heading: Math.atan2(target.y - f.y, target.x - f.x) // 直進は撃った時の目標の位置へ
      });
      f.missiles--;
      f.missileCooldown = MISSILE_INTERVAL;
    }
  }

  // 迎撃範囲内の最も近い敵の誘導ミサイルを撃ち落とそうとする (直進のミサイルは迎撃しない。よけるもの)。試したら成否にかかわらず待ち時間に入る
  function interceptMissiles(g, dt, rng){
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.interceptCooldown = Math.max(0, f.interceptCooldown - dt);
      if(f.interceptCooldown > 0) continue;
      let target = null;
      for(const m of g.missiles){
        if(m.guided === false) continue;
        if(m.team !== f.team && dist(f, m) <= INTERCEPT_RANGE && (!target || dist(f, m) < dist(f, target))) target = m;
      }
      if(!target) continue;
      f.interceptCooldown = INTERCEPT_INTERVAL;
      if(rng() < INTERCEPT_CHANCE) g.missiles.splice(g.missiles.indexOf(target), 1);
    }
  }

  // 点 c と線分 a→b の最短距離 (1 ステップで進む間に艦隊をかすめたかの判定に使う)
  function segmentDistance(a, b, c){
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const k = len2 > 0 ? clamp(((c.x - a.x) * vx + (c.y - a.y) * vy) / len2, 0, 1) : 0;
    return Math.hypot(a.x + vx * k - c.x, a.y + vy * k - c.y);
  }

  // ミサイルを進める。誘導は目標の現在位置へ追尾し、直進は撃った向きにまっすぐ飛んで、道の上に来た敵艦隊 (最も手前) に当たる。
  // 命中したダメージは damage (Map: 艦隊 → ダメージ) に足す
  function moveMissiles(g, dt, damage){
    const byId = new Map(g.fleets.map(f => [f.id, f]));
    g.missiles = g.missiles.filter(m => {
      if(m.guided === false){
        const from = {x: m.x, y: m.y};
        const step = MISSILE_STRAIGHT_SPEED * dt;
        const to = {x: m.x + Math.cos(m.heading) * step, y: m.y + Math.sin(m.heading) * step};
        let hit = null;
        for(const e of g.fleets){
          if(e.team === m.team || !alive(e) || segmentDistance(from, to, e) > MISSILE_HIT_RADIUS) continue;
          if(!hit || dist(from, e) < dist(from, hit)) hit = e;
        }
        if(hit){
          damage.set(hit, (damage.get(hit) || 0) + m.power * mitigation(hit.params));
          return false;
        }
        m.x = to.x;
        m.y = to.y;
        m.life -= dt;
        return m.life > 0;
      }
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
    updateLeaders(g.fleets);

    for(const f of living){
      if(f.isPlayer || g.time < f.ai.nextThink) continue;
      const ctl = g.controllers && g.controllers[f.team];
      f.order = ctl && !f.scout ? ctl(f, g.fleets, g.intel[f.team], rng) : aiDecide(f, g.fleets, g.intel[f.team], rng); // 偵察の分艦隊は今のルールのまま
      f.ai.nextThink = g.time + AI_THINK_INTERVAL;
    }
    // AI は直進ミサイルを毎ステップ見て、当たりそうならよける (プレイヤーは自分でよける)
    for(const f of living){
      if(f.isPlayer) continue;
      const d = dodgeOrder(f, g.missiles);
      if(!d) continue;
      f.order = d;
      f.ai.nextThink = g.time + DODGE_TIME;
    }

    if(!g.scoutsLaunched){ g.scoutsLaunched = true; launchScouts(g); }
    enemyCheatWarp(g);
    const byIdNow = new Map(g.fleets.map(f => [f.id, f]));
    for(const f of living){
      if(!f.order || f.order.type !== 'merge') continue;
      const t = byIdNow.get(f.order.targetId);
      if(!t || !alive(t) || t === f){ f.order = null; continue; }
      f.order.x = t.x;
      f.order.y = t.y;
    }
    for(const f of living) f.speedCap = formationSpeedCap(f, g.fleets);
    for(const f of living) moveFleet(f, dt, g.intel[f.team]);
    separateFleets(g.fleets);
    for(const f of living){
      if(!f.order || f.order.type !== 'merge' || !alive(f)) continue;
      const t = byIdNow.get(f.order.targetId);
      if(t && alive(t) && dist(f, t) <= MERGE_RANGE) mergeFleets(g, f, t);
    }
    refreshIntel();

    launchMissiles(g, dt);
    interceptMissiles(g, dt, rng);

    // ビームとミサイルのダメージは全艦隊ぶんを先に計算してから同時に反映する
    const visible = {blue: visibleEnemies(g.fleets, 'blue', revealFor(g, 'blue')), red: visibleEnemies(g.fleets, 'red', revealFor(g, 'red'))};
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

  // 視点の中心 (cx, cy) を、画面 (viewW × viewH ピクセル、拡大 zoom、回転 angle) にマップの外が写らない範囲に寄せる。
  // 回した画面を囲む長方形がマップに収まるようにする。画面のほうが広い向きは、マップの真ん中にする
  function clampCameraCenter(cx, cy, viewW, viewH, zoom, angle){
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const hw = (c * viewW + s * viewH) / 2 / zoom, hh = (s * viewW + c * viewH) / 2 / zoom;
    const fit = (v, half, size) => (half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, v)));
    return {cx: fit(cx, hw, WORLD.w), cy: fit(cy, hh, WORLD.h)};
  }

  const api = {clampCameraCenter, FLEET_RADIUS, separateFleets, SPAWN_XS, BEAM_OPTIMAL_RATIO, BEAM_CLOSE_FACTOR, beamRangeFactor, 
    WORLD, INITIAL_SHIPS, MAX_THROTTLE, PARAM_TOTAL, PARAM_MIN, MISSILE_AMMO, MISSILE_STRAIGHT_SPEED, segmentDistance, DODGE_LOOKAHEAD, DODGE_MARGIN, DODGE_TIME, dodgeOrder, FORMATION_SPEED_RATIO, formationSpeedCap, CHEAT_WARP_INTERVAL, CHEAT_WARP_DISTANCE, enemyCheatWarp, SUBFLEET_MAX, MERGE_RANGE, splitFleet, mergeFleets, SCOUT_COUNT, SCOUT_SHIPS, SCOUT_WATCH_DISTANCE, SCOUT_SAFE_DISTANCE, launchScouts, SENSOR_RANGE, BEAM_RANGE, GHOST_CLEAR_RANGE, FIREPOWER_FLOOR,
    MISSILE_RANGE, MISSILE_INTERVAL, MISSILE_SPEED, MISSILE_LIFE, MISSILE_HIT_RADIUS, INTERCEPT_RANGE, INTERCEPT_INTERVAL,
    AI_PRESETS, validateParams, updateLeaders, maxSpeed, mitigation, beamDps, missileDamage, visibleEnemies, updateIntel,
    chooseTarget, moveFleet, checkOutcome, aiDecide, createGame, step,
    launchMissiles, interceptMissiles, moveMissiles,
    newCheatProgress, cheatSequenceStep, parseCommand, applyCommand, warpFleet
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
