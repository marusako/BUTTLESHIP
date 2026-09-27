// 描画や DOM に依存しないゲームロジック。
// ブラウザでは window.SagittariusLogic、Node では require('./logic.js') で使う。
(function(root){
  'use strict';

  const DEFAULT_WORLD = {w: 10000, h: 20000}; // 原作のミニマップと同じ縦長 (横 1 : 縦 2)。青は下、赤は上に陣取る
  const WORLD = Object.assign({}, DEFAULT_WORLD); // 今のマップの広さ (学習では setWorld で狭くする。ゲームは常に本番の広さ)
  const INITIAL_SHIPS = 15000;   // 原作の画面に合わせた初期艦艇数
  const SENSOR_RANGE = 750;      // 索敵半径 (どの艦種も同じ)
  const GHOST_CLEAR_RANGE = 150; // 最終確認位置にこの距離まで近づいて敵がいなければ記録を消す
  const ATTACK_STOP_RATIO = 0.8; // 攻撃命令では自分の射程のこの割合まで近づいて止まる
  const ATTACK_COEF = 0.002;     // 砲撃の、1 隻・火力 1 あたりの毎秒ダメージ (艦艇数)
  const DEFENSE_HALF = 50;       // 防御がこの値のとき受けるダメージが半分になる
  const FIREPOWER_FLOOR = 0.3;   // 火力計算に使う艦艇数の下限 (初期艦艇数に対する割合)
  const AI_THINK_INTERVAL = 1;   // AI が命令を考え直す間隔 (秒)
  const SHOT_SPEED = 600;        // 砲弾の速さ (px/秒)。どの艦より速い
  const SHOT_HIT_RADIUS = 12;    // 追いかけている砲弾がこの距離まで近づいたら命中
  const SHOT_LIFE = 3;           // 砲弾が消えるまでの時間 (秒)。射程の外に出てまっすぐ飛ぶ弾が外れたときに消える
  const BOMBER_SPEED = 250;      // 爆撃機の速さ (px/秒)
  const BOMBER_TURN_RATE = 2.5;  // 爆撃機が 1 秒に曲がれる角度 (ラジアン)。よけられることがある
  const BOMBER_LIFE = 8;         // 爆撃機が目標に届かずに消えるまでの時間 (秒)
  const BOMB_COEF = 0.018;       // 爆撃 1 回の火力係数
  const RECON_SPEED = 300;       // 偵察機の速さ (px/秒)。どの艦より速い
  const RECON_LIFE = 40;         // 偵察機が消えるまでの時間 (秒)
  const RECON_SENSOR = SENSOR_RANGE / 2; // 偵察機の索敵半径 (艦の半分)
  const RECON_FIRST = 3;         // 最初に射出する偵察機の数
  const RECON_EVERY = 60;        // その後、偵察機を射出する間隔 (秒)
  const RECON_COUNT = 2;         // その後、1 回に射出する偵察機の数
  const RECON_CONE = Math.PI / 12; // 偵察機を射出する向きの幅 (進行方向の左右 15°)
  const AA_RANGE = 400;          // 対空射撃の範囲
  const AA_INTERVAL = 0.5;       // 対空射撃の間隔 (秒)
  const AA_CHANCE = 0.4;         // 対空射撃で艦載機を撃ち落とす確率
  const CARRIER_CRIT_CHANCE = 0.15; // 空母が攻撃を受けたとき、ダメージが増える確率 (空母の弱点)
  const CARRIER_CRIT_MULTIPLIER = 2;
  const BUFF_RANGE = 1000;       // バフ: この距離以内に組む相手 (戦艦 ⇔ 空母・巡洋艦) がいると強化される
  const BUFF_ATTACK = 1.2;       // バフ中の与えるダメージの倍率
  const BUFF_DEFENSE = 1.2;      // バフ中の受けるダメージの割る数
  const EPS = 1e-9;              // 小数の誤差を吸収する (待ち時間の判定など)
  const CHEAT_SEQUENCE = ['KeyY', 'KeyU', 'KeyK', 'KeyI']; // 隠しコマンド入力欄を開くキー列
  const CHEAT_WINDOW = 2;        // キー列を押し切るまでの制限時間 (秒)
  const COMMANDS = ['scan', 'warp', 'repair', 'stealth'];
  const BEACON_INTERVAL = 60;    // 旗艦の位置が相手にばれる間隔 (秒)。隅に隠れ続ける作戦を防ぐ
  const BEACON_DURATION = 5;     // 旗艦の位置がばれている時間 (秒)
  const STEALTH_DURATION = 15;   // 隠しコマンド stealth (透明化) の効果時間 (秒)
  const TEAMS = ['blue', 'red'];

  // 艦種 (敏捷 = speed / 耐久 = defense / 火力 = attack)。武器は艦種ごとに 1 種類。大きさは当たり判定の半径と見た目に効く
  //   weapon.kind: 'gun' (砲撃。射程内のみ必中の弾) / 'bomber' (爆撃機を出す)。antiAir: 対空射撃ができる
  const SHIP_TYPES = {
    battleship: {name: '戦艦', params: {speed: 15, defense: 50, attack: 35}, size: 'large', hitRadius: 40,
      weapon: {kind: 'gun', range: 650, interval: 3}, description: '旗艦。高火力・高耐久だが遅い。長い射程から重い一撃を撃つ'},
    carrier: {name: '空母', params: {speed: 30, defense: 30, attack: 20}, size: 'large', hitRadius: 40, antiAir: true,
      weapon: {kind: 'bomber', range: 1100, interval: 9}, description: '偵察機で敵を探し、遠くの敵に爆撃機を送る。攻撃を受けると大きな被害が出ることがある'},
    cruiser: {name: '巡洋艦', params: {speed: 45, defense: 30, attack: 25}, size: 'medium', hitRadius: 25,
      weapon: {kind: 'gun', range: 450, interval: 1}, description: '主力。速さと攻守のバランスがよく、連射がきく'},
    destroyer: {name: '駆逐艦', params: {speed: 60, defense: 15, attack: 15}, size: 'small', hitRadius: 15, antiAir: true,
      weapon: {kind: 'gun', range: 300, interval: 0.7}, description: '最速の偵察役。打たれ弱いので交戦は避ける。対空射撃で艦載機を落とす'}
  };

  // 連合艦隊の編成 (第 1〜第 5 艦隊の艦種)。第 1 艦隊 (戦艦) が旗艦。敵味方とも同じ
  const FORMATION = ['battleship', 'carrier', 'cruiser', 'destroyer', 'destroyer'];
  const SPAWN_SPACING = 800;      // 出撃位置の間隔 (中央に寄せる。間隔を広げると隣の索敵範囲とすき間ができる)。狭いマップでは幅 ÷ 6 まで詰める
  const SPAWN_ORDER = [4, 3, 1, 2, 5]; // 横一列に (各チームから見て) 左から第 4 (駆逐)・第 3 (巡洋)・第 1 (戦艦・旗艦)・第 2 (空母)・第 5 (駆逐)

  const alive = f => f.ships > 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

  const weaponOf = f => SHIP_TYPES[f.role].weapon;

  // 狙いを定められる範囲: 索敵範囲と射程の長いほう (空母は味方が見つけた敵なら 1100 まで)
  function lockRange(f){
    return Math.max(SENSOR_RANGE, weaponOf(f).range);
  }

  // バフ: 空母・巡洋艦は味方の戦艦が、戦艦は味方の空母か巡洋艦が BUFF_RANGE 以内にいると強化される (駆逐艦にはかからない)
  const BUFF_PARTNERS = {battleship: ['carrier', 'cruiser'], carrier: ['battleship'], cruiser: ['battleship']};
  function isBuffed(f, fleets){
    const partners = BUFF_PARTNERS[f.role];
    return !!partners && alive(f) && fleets.some(a => a !== f && a.team === f.team && alive(a) && partners.includes(a.role) && dist(a, f) <= BUFF_RANGE);
  }

  // 全艦隊のバフを付け直す (1 ステップごと)
  function updateBuffs(g){
    for(const f of g.fleets) f.buffed = isBuffed(f, g.fleets);
  }

  const attackBuff = f => (f.buffed ? BUFF_ATTACK : 1);

  // 砲弾 1 発の威力 (耐久による軽減前)。毎秒ダメージ × 発射間隔。バフ中は × BUFF_ATTACK
  function shotPower(f){
    return firepower(f) * ATTACK_COEF * f.params.attack * weaponOf(f).interval * attackBuff(f);
  }

  // 爆撃 1 回の威力 (耐久による軽減前)。バフ中は × BUFF_ATTACK
  function bombPower(f){
    return firepower(f) * BOMB_COEF * f.params.attack * attackBuff(f);
  }

  // team から見えている (味方のどれかの索敵範囲内の) 生存中の敵。reveal なら全部見える
  // 旗艦の位置がばれている時間か (開始から BEACON_INTERVAL 秒ごとに BEACON_DURATION 秒間)
  function beaconActive(time){
    return time >= BEACON_INTERVAL && time % BEACON_INTERVAL < BEACON_DURATION;
  }

  // マップの広さを変える (学習用)。引数なしなら本番の広さに戻す
  function setWorld(w, h){
    WORLD.w = w || DEFAULT_WORLD.w;
    WORLD.h = h || DEFAULT_WORLD.h;
  }

  // 出撃位置の x (各チームから見て左から SPAWN_ORDER の順。赤は南 (敵陣) を向くので東から並ぶ)
  function spawnX(team, no){
    const offset = (SPAWN_ORDER.indexOf(no) - 2) * Math.min(SPAWN_SPACING, WORLD.w / 6);
    return WORLD.w / 2 + (team === 'blue' ? offset : -offset);
  }

  // team から見えている生存中の敵。味方の艦の索敵範囲 (SENSOR_RANGE) か、味方の偵察機の索敵範囲 (RECON_SENSOR) の中。reveal なら全部見える
  // 透明化中 (stealth) の艦隊は敵から見えない。beacon: 旗艦の位置がばれている時間なら、敵の旗艦は索敵範囲の外でも見える
  function visibleEnemies(fleets, team, reveal, beacon, aircraft){
    const eyes = fleets.filter(f => f.team === team && alive(f));
    const planes = (aircraft || []).filter(a => a.team === team && a.kind === 'recon');
    return fleets.filter(f => f.team !== team && alive(f) && !(f.stealth > 0) && (reveal || (beacon && f.flagship) ||
      eyes.some(e => dist(e, f) <= SENSOR_RANGE) || planes.some(p => dist(p, f) <= RECON_SENSOR)));
  }

  // 敵の位置情報 (intel: 敵 id → {x, y, visible}) を更新する。
  // 見失った敵は最終確認位置を残し、味方がその近くまで行って確かめたら消す
  function updateIntel(intel, fleets, team, reveal, beacon, aircraft){
    const eyes = fleets.filter(f => f.team === team && alive(f));
    const seen = new Set(visibleEnemies(fleets, team, reveal, beacon, aircraft).map(f => f.id));
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

  // 狙いを定められる範囲 (lockRange) 内の敵 (visible: 見えている敵の一覧) から狙いを選ぶ。攻撃命令の相手を優先する
  function lockTarget(f, visible){
    const inRange = visible.filter(e => alive(e) && dist(f, e) <= lockRange(f));
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
      stopAt = info.visible ? weaponOf(f).range * ATTACK_STOP_RATIO : 0;
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
    // 両方の旗艦が同時に沈んだら、残っている戦力 (艦艇の合計) が多いほうの勝ち (判定勝ち)。同じなら引き分け
    const total = team => fleets.filter(f => f.team === team).reduce((sum, f) => sum + Math.max(0, f.ships), 0);
    const diff = total('blue') - total('red');
    return diff > 0 ? 'win' : diff < 0 ? 'lose' : 'draw';
  }

  // ゲームを作る。ルールはモダン (旗艦を倒したら勝ち)。編成は FORMATION で固定 (番号で艦種が決まる)。
  // options.playerSlot: プレイヤーが指揮する青の艦隊の番号 (1〜5。省略・おかしな値なら 1 = 戦艦・旗艦)
  // options.controllers: チームごとの AI ({blue, red})。(艦隊, 全艦隊, そのチームの位置情報, 乱数) → 命令 を返す関数。
  //   渡さないチームの AI 艦隊は何もしない (プレイヤー艦隊には使わない)
  // options.playerName: 自艦隊の名前 (省略・空なら「味方第N艦隊」)
  function createGame(options){
    const opts = options || {};
    const controllers = Object.assign({blue: null, red: null}, opts.controllers);
    const playerSlot = Number.isInteger(opts.playerSlot) && opts.playerSlot >= 1 && opts.playerSlot <= FORMATION.length ? opts.playerSlot : 1;
    const fleets = [];
    for(const team of TEAMS){
      FORMATION.forEach((role, i) => {
        const no = i + 1;
        const isPlayer = team === 'blue' && no === playerSlot;
        const ship = SHIP_TYPES[role];
        fleets.push({
          id: `${team}${no}`,
          team,
          name: isPlayer && opts.playerName ? opts.playerName : `${team === 'blue' ? '味方' : '敵'}第${no}艦隊`,
          role,
          x: spawnX(team, no),
          y: team === 'blue' ? WORLD.h - 300 : 300,
          heading: team === 'blue' ? -Math.PI / 2 : Math.PI / 2,
          ships: INITIAL_SHIPS,
          params: Object.assign({}, ship.params),
          type: ship.name,
          hitRadius: ship.hitRadius,
          order: null,
          isPlayer,
          flagship: no === 1,
          cooldown: 0,   // 武器の次の発射までの秒数
          aaCooldown: 0, // 対空射撃の次の発射までの秒数
          weapons: {fire: true},
          stealth: 0, // 透明化の残り秒数 (隠しコマンド stealth)
          buffed: false, // バフ中か (1 ステップごとに付け直す)
          ai: {nextThink: 0}
        });
        if(role === 'carrier') fleets[fleets.length - 1].recon = {launched: 0, next: 0}; // 偵察機: 射出した数と、次に射出する時刻
      });
    }
    return {
      time: 0, mode: 'modern', controllers, fleets, intel: {blue: {}, red: {}}, locks: [],
      projectiles: [], aircraft: [], nextProjectileId: 1, events: [], reveal: false, warpArmed: false, outcome: null
    };
  }

  // 青チームだけ隠しコマンドの索敵解除が効く
  const revealFor = (g, team) => team === 'blue' && g.reveal;

  // そのステップで起きたこと (発砲・命中・迎撃・全滅) を g.events に記録する。画面側が音を鳴らすのに使う
  function record(g, event){
    (g.events || (g.events = [])).push(event);
  }

  const visibleByTeam = g => {
    const beacon = beaconActive(g.time);
    return {blue: visibleEnemies(g.fleets, 'blue', revealFor(g, 'blue'), beacon, g.aircraft), red: visibleEnemies(g.fleets, 'red', false, beacon, g.aircraft)};
  };

  // 各艦隊が狙いを定め (g.locks)、射程の中にいれば、発射間隔が空いていれば撃つ (砲撃は砲弾、空母は爆撃機)。
  // visible: チームごとの見えている敵 (省略時はその場で計算)
  function fireWeapons(g, dt, visible){
    const vis = visible || visibleByTeam(g);
    g.locks = [];
    if(!g.aircraft) g.aircraft = [];
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.cooldown = Math.max(0, (f.cooldown || 0) - dt);
      const t = lockTarget(f, vis[f.team]);
      if(!t) continue;
      const w = weaponOf(f);
      const firing = dist(f, t) <= w.range;
      g.locks.push({from: f.id, to: t.id, team: f.team, firing});
      if(!firing || !f.weapons.fire || f.cooldown > EPS) continue;
      const base = {id: g.nextProjectileId++, team: f.team, from: f.id, targetId: t.id, x: f.x, y: f.y, heading: Math.atan2(t.y - f.y, t.x - f.x)};
      if(w.kind === 'bomber'){
        g.aircraft.push(Object.assign({kind: 'bomber', life: BOMBER_LIFE, power: bombPower(f)}, base));
      }else{
        g.projectiles.push(Object.assign({kind: 'shot', range: w.range, homing: true, life: SHOT_LIFE, power: shotPower(f)}, base));
      }
      f.cooldown = w.interval;
      record(g, {type: 'fire', kind: w.kind, size: SHIP_TYPES[f.role].size, team: f.team, from: f.id, x: f.x, y: f.y});
    }
  }

  // 空母: 最初に RECON_FIRST 機、その後 RECON_EVERY 秒ごとに RECON_COUNT 機の偵察機を、進行方向の左右 RECON_CONE の範囲へ射出する
  function launchRecon(g, rng){
    for(const f of g.fleets){
      if(!alive(f) || !f.recon || g.time < f.recon.next) continue;
      const count = f.recon.launched === 0 ? RECON_FIRST : RECON_COUNT;
      for(let i = 0; i < count; i++){
        const heading = f.heading + (rng() * 2 - 1) * RECON_CONE;
        g.aircraft.push({id: g.nextProjectileId++, kind: 'recon', team: f.team, from: f.id, x: f.x, y: f.y, heading, life: RECON_LIFE});
        record(g, {type: 'launch', kind: 'recon', team: f.team, x: f.x, y: f.y});
      }
      f.recon.launched += count;
      f.recon.next += RECON_EVERY;
    }
  }

  // 対空射撃: 対空射撃ができる艦 (駆逐艦・空母) が、AA_RANGE 以内の最も近い敵の艦載機を撃つ。撃ったら成否にかかわらず待ち時間に入る
  function antiAir(g, dt, rng){
    for(const f of g.fleets){
      if(!alive(f) || !SHIP_TYPES[f.role].antiAir) continue;
      f.aaCooldown = Math.max(0, (f.aaCooldown || 0) - dt);
      if(f.aaCooldown > EPS) continue;
      let target = null;
      for(const a of g.aircraft){
        if(a.team !== f.team && dist(f, a) <= AA_RANGE && (!target || dist(f, a) < dist(f, target))) target = a;
      }
      if(!target) continue;
      f.aaCooldown = AA_INTERVAL;
      if(rng() < AA_CHANCE){
        g.aircraft.splice(g.aircraft.indexOf(target), 1);
        record(g, {type: 'intercept', team: f.team, x: target.x, y: target.y});
      }
    }
  }

  // 点 c と線分 a→b の最短距離 (1 ステップで進む間に目標をかすめたかの判定に使う)
  function segmentDistance(a, b, c){
    const vx = b.x - a.x, vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const k = len2 > 0 ? clamp(((c.x - a.x) * vx + (c.y - a.y) * vy) / len2, 0, 1) : 0;
    return Math.hypot(a.x + vx * k - c.x, a.y + vy * k - c.y);
  }

  // 命中: ダメージを damage (Map: 艦隊 → ダメージ) に足す。空母は確率でダメージが増える (弱点)。バフ中の目標は ÷ BUFF_DEFENSE
  function applyHit(g, damage, p, t, kind, rng){
    const crit = t.role === 'carrier' && rng() < CARRIER_CRIT_CHANCE;
    const amount = p.power * mitigation(t.params) * (crit ? CARRIER_CRIT_MULTIPLIER : 1) / (t.buffed ? BUFF_DEFENSE : 1);
    damage.set(t, (damage.get(t) || 0) + amount);
    record(g, {type: 'hit', kind, team: p.team, from: p.from, targetId: t.id, critical: crit, damage: amount, x: t.x, y: t.y});
  }

  // 砲弾を進める。目標が撃った艦の射程の中にいる間は追いかけて必ず当たる (射程内のみ必中)。
  // 一度でも射程の外に出たら (撃った艦が全滅しても) 追いかけるのをやめてまっすぐ飛び、目標の当たり判定に触れれば当たる。SHOT_LIFE 秒で消える
  function moveProjectiles(g, dt, damage, rng){
    const byId = new Map(g.fleets.map(f => [f.id, f]));
    g.projectiles = g.projectiles.filter(p => {
      const t = byId.get(p.targetId);
      if(!t || !alive(t)) return false;
      const shooter = byId.get(p.from);
      if(p.homing && !(shooter && alive(shooter) && dist(shooter, t) <= p.range)) p.homing = false;
      const step = SHOT_SPEED * dt;
      if(p.homing){
        const d = dist(p, t);
        if(d <= step + SHOT_HIT_RADIUS){ applyHit(g, damage, p, t, 'shot', rng); return false; }
        p.heading = Math.atan2(t.y - p.y, t.x - p.x);
        p.x += (t.x - p.x) / d * step;
        p.y += (t.y - p.y) / d * step;
      }else{
        const from = {x: p.x, y: p.y};
        p.x += Math.cos(p.heading) * step;
        p.y += Math.sin(p.heading) * step;
        if(segmentDistance(from, p, t) <= t.hitRadius){ applyHit(g, damage, p, t, 'shot', rng); return false; }
      }
      p.life -= dt;
      return p.life > 0;
    });
  }

  // 艦載機を進める。偵察機はまっすぐ飛び、RECON_LIFE 秒かマップの外で消える。
  // 爆撃機は目標へ向かい (1 ステップで BOMBER_TURN_RATE × dt まで向きを変える)、目標の当たり判定に触れたら爆撃して消える。BOMBER_LIFE 秒で消える
  function moveAircraft(g, dt, damage, rng){
    const byId = new Map(g.fleets.map(f => [f.id, f]));
    g.aircraft = g.aircraft.filter(a => {
      if(a.kind === 'recon'){
        a.x += Math.cos(a.heading) * RECON_SPEED * dt;
        a.y += Math.sin(a.heading) * RECON_SPEED * dt;
        a.life -= dt;
        return a.life > 0 && a.x >= 0 && a.x <= WORLD.w && a.y >= 0 && a.y <= WORLD.h;
      }
      const t = byId.get(a.targetId);
      if(!t || !alive(t)) return false;
      const want = Math.atan2(t.y - a.y, t.x - a.x);
      let diff = want - a.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // -π〜π にそろえる
      a.heading += clamp(diff, -BOMBER_TURN_RATE * dt, BOMBER_TURN_RATE * dt);
      const from = {x: a.x, y: a.y};
      a.x += Math.cos(a.heading) * BOMBER_SPEED * dt;
      a.y += Math.sin(a.heading) * BOMBER_SPEED * dt;
      if(segmentDistance(from, a, t) <= t.hitRadius){ applyHit(g, damage, a, t, 'bomb', rng); return false; }
      a.life -= dt;
      return a.life > 0;
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
    const me = g.fleets.find(f => f.isPlayer && alive(f));
    if(command === 'scan') g.reveal = !g.reveal;
    if(command === 'warp') g.warpArmed = true;
    if(command === 'repair' && me) me.ships = INITIAL_SHIPS;           // 艦艇数を初期値に (全滅した艦隊は戻らない)
    if(command === 'stealth' && me) me.stealth = STEALTH_DURATION;     // 効果中にもう一度使うと残り時間が戻る
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
    for(const f of g.fleets){
      if(f.stealth > 0) f.stealth = f.stealth - dt > EPS ? f.stealth - dt : 0;
    }
    const living = g.fleets.filter(alive);
    if(!g.aircraft) g.aircraft = [];
    const refreshIntel = () => { for(const team of TEAMS) updateIntel(g.intel[team], g.fleets, team, revealFor(g, team), beaconActive(g.time), g.aircraft); };

    refreshIntel();

    for(const f of living){
      const decide = g.controllers && g.controllers[f.team];
      if(f.isPlayer || !decide || g.time < f.ai.nextThink) continue;
      f.order = decide(f, g.fleets, g.intel[f.team], rng);
      f.ai.nextThink = g.time + AI_THINK_INTERVAL;
    }

    for(const f of living) moveFleet(f, dt, g.intel[f.team]);
    updateBuffs(g);
    launchRecon(g, rng);
    refreshIntel();

    fireWeapons(g, dt);
    antiAir(g, dt, rng);

    // 弾と爆撃のダメージは全艦隊ぶんを先に計算してから同時に反映する
    const damage = new Map();
    moveProjectiles(g, dt, damage, rng);
    moveAircraft(g, dt, damage, rng);
    for(const [t, d] of damage) t.ships = Math.max(0, t.ships - d);
    for(const f of living){
      if(!alive(f)) record(g, {type: 'destroyed', team: f.team, id: f.id, flagship: !!f.flagship, x: f.x, y: f.y});
    }

    refreshIntel();
    g.outcome = checkOutcome(g.fleets);
  }

  const api = {
    WORLD, DEFAULT_WORLD, setWorld, BEACON_INTERVAL, BEACON_DURATION, beaconActive, INITIAL_SHIPS, SENSOR_RANGE, GHOST_CLEAR_RANGE, FIREPOWER_FLOOR,
    STEALTH_DURATION, SHOT_LIFE, BOMBER_LIFE, BOMBER_TURN_RATE, RECON_SPEED, RECON_LIFE, RECON_SENSOR, AA_RANGE,
    BUFF_RANGE, isBuffed, updateBuffs, SHIP_TYPES, FORMATION, AI_THINK_INTERVAL, maxSpeed, mitigation, lockRange, visibleEnemies, updateIntel,
    lockTarget, moveFleet, checkOutcome, createGame, step,
    fireWeapons, launchRecon, antiAir, moveProjectiles, moveAircraft, keyCourse, battleStats,
    newCheatProgress, cheatSequenceStep, parseCommand, applyCommand, warpFleet
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
