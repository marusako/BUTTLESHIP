// 描画や DOM に依存しないゲームロジック。
// ブラウザでは window.SagittariusLogic、Node では require('./logic.js') で使う。
(function(root){
  'use strict';

  const DEFAULT_WORLD = {w: 13000, h: 26000}; // 原作のミニマップと同じ縦長 (横 1 : 縦 2)。青は下、赤は上に陣取る (第 2.11 段階で 10000 × 20000 から広げた)
  const WORLD = Object.assign({}, DEFAULT_WORLD); // 今のマップの広さ (学習では setWorld で狭くする。ゲームは常に本番の広さ)
  // ステータスは艦種ごと (SHIP_TYPES)。耐久 = 最大 HP (艦隊の ships は今の HP)
  const RANGES = {short: 300, medium: 450, long: 650, veryLong: 1200}; // 射程 (短・中・長・超長)
  const SPEEDS = {slow: 65, fast: 105, fastPlus: 145};                 // 速力 (低速・高速・高速+) の速さ (px/秒)。試合時間が 3 分前後になるように調整
  const ATTACK_BONUS = 5;        // 攻撃の値 = 火力 + ATTACK_BONUS
  const ARMOR_FACTOR = 0.7;      // ダメージ = 攻撃の値 − 装甲 × ARMOR_FACTOR
  const SCRATCH_MIN = 0.05;      // かすり = 今の HP × (SCRATCH_MIN 〜 SCRATCH_MIN + SCRATCH_SPREAD)。最低 1
  const SCRATCH_SPREAD = 0.1;
  const CRIT_CHANCE = 0.05;      // 会心の確率と、火力の倍率
  const CRIT_MULTIPLIER = 1.5;
  const DAMAGE_STATES = [{maxRatio: 0.25, state: 'heavy', attack: 0.4}, {maxRatio: 0.5, state: 'moderate', attack: 0.7}, {maxRatio: 0.75 - 1e-9, state: 'minor', attack: 1}]; // 大破 (2.5 割以下)・中破 (5 割以下)・小破 (7.5 割未満)
  const DOUBLE_SHOT_DELAY = 0.2; // 二段攻撃の 2 発目・特殊攻撃の連続攻撃の間隔 (秒)
  const SPECIAL_FIREPOWER = 100; // 特殊攻撃 (高火力攻撃) の火力
  const CHARGE_MAX = 100;        // 特殊攻撃のゲージ (NP) の満タン。たまる速さは艦種ごと (SHIP_TYPES の npPerSecond・npPerDamage)
  const SALVO_SHOTS = 5;         // 戦艦の全艦一斉射撃の回数 (五段攻撃)
  const TORPEDO_SHOTS = 2;       // 駆逐艦Ⅱ型の魚雷の回数 (二連攻撃)
  const TORPEDO_HIT = 0.7;       // 魚雷の命中率 (回避を無視)
  const BOOST_DURATION = 15;     // 巡洋艦の強化の時間 (秒)
  const BOOST_MULTIPLIER = 1.5;  // 強化中の火力・装甲・速力の倍率
  const BOOST_CRIT = 0.2;        // 強化中の会心率
  const BOOST_EVASION_CUT = 40;  // 強化中の弾は、敵の回避をこれだけ引いて命中率を計算する (命中率 +40%)
  const GHOST_CLEAR_RANGE = 150; // 最終確認位置にこの距離まで近づいて敵がいなければ記録を消す
  const ATTACK_STOP_RATIO = 0.8; // 攻撃命令では自分の射程のこの割合まで近づいて止まる
  const AI_THINK_INTERVAL = 1;   // AI が命令を考え直す間隔 (秒)
  const SHOT_SPEED = 600;        // 砲弾・魚雷の速さ (px/秒)。どの艦より速い
  const SHOT_HIT_RADIUS = 12;    // 砲弾がこの距離まで近づいたら届く
  const SHOT_LIFE = 3;           // 砲弾が消えるまでの時間 (秒。念のための上限)
  const BOMBER_SPEED = 250;      // 爆撃機の速さ (px/秒)
  const BOMBER_TURN_RATE = 2.5;  // 爆撃機が 1 秒に曲がれる角度 (ラジアン)。よけられることがある
  const BOMBER_LIFE = 8;         // 爆撃機が目標に届かずに消えるまでの時間 (秒)
  const RECON_SPEED = 300;       // 偵察機の速さ (px/秒)。どの艦より速い
  const RECON_LIFE = 40;         // 偵察機が消えるまでの時間 (秒)
  const RECON_EVERY = 20;        // 空母が偵察機を 1 機ずつ出す間隔 (秒。最初は試合の始まり)
  const RECON_CONE = Math.PI / 12; // 偵察機を射出する向きの幅 (進行方向の左右 15°)
  const AA_RANGE = 400;          // 対空射撃の範囲
  const AA_INTERVAL = 0.5;       // 対空射撃の間隔 (秒)
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

  // 艦種。stats: 耐久 (hp = 最大 HP)・火力・装甲・回避 (%)・対空 (%)・索敵 (索敵距離)・射程 (RANGES のキー)・速力 (SPEEDS のキー)
  // npPerSecond / npPerDamage: 特殊攻撃のゲージ (NP) が時間でたまる速さ (毎秒) と、与えたダメージでたまる速さ (ダメージ 1 あたり)。通常攻撃は艦種ごとに 1 種類 (weapon.kind: 'gun' = 主砲の二段攻撃 / 'bomber' = 爆撃機)。interval は再装填 (秒)。大きさは当たり判定の半径と見た目に効く
  const SHIP_TYPES = {
    battleship: {name: '戦艦', stats: {hp: 300, firepower: 120, armor: 85, evasion: 15, antiAir: 40, sensor: 500, range: 'long', speed: 'slow'},
      size: 'large', hitRadius: 40, weapon: {kind: 'gun', interval: 4}, npPerSecond: 0.3, npPerDamage: 0.2, description: '旗艦。重装甲・高火力だが遅く、よけられない'},
    carrier: {name: '空母', stats: {hp: 70, firepower: 50, armor: 40, evasion: 40, antiAir: 60, sensor: 800, range: 'veryLong', speed: 'fast'},
      size: 'large', hitRadius: 40, weapon: {kind: 'bomber', interval: 5}, npPerSecond: 0, npPerDamage: 0, description: '制空タイプ。遠くの敵に爆撃機を送り、偵察機で敵を探す。攻撃を受けると大きな被害が出ることがある'},
    cruiser: {name: '巡洋艦', stats: {hp: 50, firepower: 55, armor: 50, evasion: 60, antiAir: 40, sensor: 600, range: 'medium', speed: 'fast'},
      size: 'medium', hitRadius: 25, weapon: {kind: 'gun', interval: 2}, npPerSecond: 5, npPerDamage: 3, description: '主砲タイプの主力。攻守のバランスがよい'},
    destroyer: {name: '駆逐艦', stats: {hp: 30, firepower: 20, armor: 20, evasion: 85, antiAir: 50, sensor: 700, range: 'short', speed: 'fastPlus'},
      size: 'small', hitRadius: 15, weapon: {kind: 'gun', interval: 1.5}, npPerSecond: 3, npPerDamage: 1, description: '最速。当たりにくいが打たれ弱い'}
  };

  // 特殊攻撃 (category: 'attack') と特殊行動 ('action')。NP (ゲージ) が満タンのときに使え、使うと 0 に戻る
  const SPECIALS = {
    salvo: {name: '全艦一斉射撃', category: 'attack', description: '射程の中の敵を狙っている味方の全艦が、火力 100 の攻撃を 5 回ずつ (空母は爆撃機)'},
    boost: {name: '強化', category: 'action', description: '15 秒間、火力・装甲・速力が 1.5 倍、会心率 20%、命中率 +40%'},
    precision: {name: '精密射撃', category: 'attack', description: '火力 100 の単発弾。回避を無視して必ず当たる'},
    torpedo: {name: '魚雷', category: 'attack', description: '火力 100 の二連攻撃。回避を無視し、命中率 70%'}
  };

  // 連合艦隊の編成 (第 1〜第 5 艦隊)。第 1 艦隊 (戦艦) が旗艦。敵味方とも同じ。艦隊の名前は艦種の名前
  // 空母は特殊攻撃のかわりに偵察機 (特殊行動) を自動で出す
  const FLEET_CLASSES = [
    {role: 'battleship', name: '戦艦', special: 'salvo'},
    {role: 'carrier', name: '空母', special: null},
    {role: 'cruiser', name: '巡洋艦', special: 'boost'},
    {role: 'destroyer', name: '駆逐艦Ⅰ型', special: 'precision'},
    {role: 'destroyer', name: '駆逐艦Ⅱ型', special: 'torpedo'}
  ];
  const FORMATION = FLEET_CLASSES.map(c => c.role);
  const SPAWN_SPACING = 800;      // 出撃位置の間隔 (中央に寄せる。間隔を広げると隣の索敵範囲とすき間ができる)。狭いマップでは幅 ÷ 6 まで詰める
  const SPAWN_ORDER = [4, 3, 1, 2, 5]; // 横一列に (各チームから見て) 左から第 4 (駆逐Ⅰ)・第 3 (巡洋)・第 1 (戦艦・旗艦)・第 2 (空母)・第 5 (駆逐Ⅱ)

  const alive = f => f.ships > 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const boosted = f => f.boost > 0;

  // 速力で決まる速さ (px/秒)
  function maxSpeed(stats){
    return SPEEDS[stats.speed];
  }

  // 今の速さ・火力・装甲・会心率 (巡洋艦の強化中は 1.5 倍・会心率 20%)
  function speedOf(f){
    return maxSpeed(f.stats) * (boosted(f) ? BOOST_MULTIPLIER : 1);
  }
  function firepowerOf(f){
    return f.stats.firepower * (boosted(f) ? BOOST_MULTIPLIER : 1);
  }
  function armorOf(f){
    return f.stats.armor * (boosted(f) ? BOOST_MULTIPLIER : 1);
  }
  function critChanceOf(f){
    return boosted(f) ? BOOST_CRIT : CRIT_CHANCE;
  }
  // 撃つ弾が敵の回避から引く値 (強化中は 40)
  function evasionCutOf(f){
    return boosted(f) ? BOOST_EVASION_CUT : 0;
  }

  // 索敵距離。索敵の値そのまま
  function sensorRange(f){
    return f.stats.sensor;
  }

  // 残り HP の割合 (満タンで 1)
  const hpRatio = f => f.ships / f.maxShips;

  const damageEntry = f => DAMAGE_STATES.find(s => hpRatio(f) <= s.maxRatio);

  // 損傷の状態: 'none' / 'minor' (小破) / 'moderate' (中破) / 'heavy' (大破)
  function damageState(f){
    const d = damageEntry(f);
    return d ? d.state : 'none';
  }

  // 攻撃の値 (火力 + 5) に掛ける倍率: 損傷の補正 (中破 0.7 / 大破 0.4) × バフ (1.2)
  function attackMultiplier(f){
    const d = damageEntry(f);
    return (d ? d.attack : 1) * (f.buffed ? BUFF_ATTACK : 1);
  }

  // 命中率 = 100% − 狙われた艦の回避% (cut: 撃った弾が回避から引く値。0 未満にはしない)
  function hitChance(t, cut){
    return (100 - Math.max(0, t.stats.evasion - (cut || 0))) / 100;
  }

  // 対空射撃で撃ち落とす確率 = 撃つ艦の対空%
  function antiAirChance(f){
    return f.stats.antiAir / 100;
  }

  const weaponOf = f => SHIP_TYPES[f.role].weapon;

  // 期待ダメージ (AI の狙いの判断用): f の通常攻撃 1 発が t に与えるダメージの見込み = 命中率 × ダメージ。
  // ダメージが 0 以下ならかすり (今の HP の 10% = かすりの幅の真ん中、最低 1)。会心・空母の弱点・バフの軽減は数えない
  function expectedDamage(f, t){
    const base = Math.floor((firepowerOf(f) + ATTACK_BONUS) * attackMultiplier(f) - armorOf(t) * ARMOR_FACTOR);
    const amount = base > 0 ? base : Math.max(1, t.ships * (SCRATCH_MIN + SCRATCH_SPREAD / 2));
    const hit = weaponOf(f).kind === 'bomber' ? 1 : hitChance(t, evasionCutOf(f));
    return hit * amount;
  }

  // 攻撃できる距離 (射程)
  function weaponRange(f){
    return RANGES[f.stats.range];
  }

  // ロックオンできる範囲: 索敵距離と射程の長いほう (空母は味方が見つけた敵なら射程 1200 まで)
  function lockRange(f){
    return Math.max(sensorRange(f), weaponRange(f));
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

  // team から見えている生存中の敵。味方の艦の索敵範囲 (sensorRange) か、味方の偵察機の索敵範囲 (sensor) の中。reveal なら全部見える
  // 透明化中 (stealth) の艦隊は敵から見えない。beacon: 旗艦の位置がばれている時間なら、敵の旗艦は索敵範囲の外でも見える
  function visibleEnemies(fleets, team, reveal, beacon, aircraft){
    const eyes = fleets.filter(f => f.team === team && alive(f));
    const planes = (aircraft || []).filter(a => a.team === team && a.kind === 'recon');
    return fleets.filter(f => f.team !== team && alive(f) && !(f.stealth > 0) && (reveal || (beacon && f.flagship) ||
      eyes.some(e => dist(e, f) <= sensorRange(e)) || planes.some(p => dist(p, f) <= p.sensor)));
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

  // ロックオン: 見えている敵 (visible) のうちロックオンできる範囲 (lockRange) の中から狙いを選び、f.lockId に覚える。
  // 攻撃命令の相手を優先し、次に今ロックオンしている敵 (見えなくなっても、範囲の外に出るか透明化するまで続ける)、なければ最も近い敵
  function lockTarget(f, visible){
    const range = lockRange(f);
    const ok = e => !!e && alive(e) && !(e.stealth > 0) && dist(f, e) <= range;
    const inRange = visible.filter(ok);
    let t = null;
    if(f.order && f.order.type === 'attack') t = inRange.find(e => e.id === f.order.targetId) || null;
    if(!t && f.lockRef && f.lockRef.id === f.lockId && ok(f.lockRef)) t = f.lockRef;
    if(!t) for(const e of inRange) if(!t || dist(f, e) < dist(f, t)) t = e;
    f.lockId = t ? t.id : null;
    f.lockRef = t;
    return t;
  }

  // 命令に従って dt 秒ぶん、今の速さで移動する。移動した方向を向く
  function moveFleet(f, dt, intel){
    const o = f.order;
    if(!o) return;
    const step = speedOf(f) * dt;

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
      stopAt = info.visible ? weaponRange(f) * ATTACK_STOP_RATIO : 0;
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
    // 両方の旗艦が同時に沈んだら、残っている戦力 (残り HP の割合の合計。艦種で最大 HP が違うため) が多いほうの勝ち (判定勝ち)。同じなら引き分け
    const total = team => fleets.filter(f => f.team === team).reduce((sum, f) => sum + Math.max(0, hpRatio(f)), 0);
    const diff = total('blue') - total('red');
    return diff > 0 ? 'win' : diff < 0 ? 'lose' : 'draw';
  }

  // ゲームを作る。ルールはモダン (旗艦を倒したら勝ち)。編成は FLEET_CLASSES で固定 (番号で艦種が決まる)。
  // options.playerSlot: プレイヤーが指揮する青の艦隊の番号 (1〜5。省略・おかしな値なら 1 = 戦艦・旗艦)
  // options.controllers: チームごとの AI ({blue, red})。(艦隊, 全艦隊, そのチームの位置情報, 乱数) → 命令 を返す関数。
  //   渡さないチームの AI 艦隊は何もしない (プレイヤー艦隊には使わない)
  // options.playerName: 自艦隊の名前 (省略・空なら「味方」+ 艦種の名前)
  // options.spectate: true なら観戦 (プレイヤーの艦はなく、10 隻すべてを AI が動かす)
  function createGame(options){
    const opts = options || {};
    const controllers = Object.assign({blue: null, red: null}, opts.controllers);
    const playerSlot = Number.isInteger(opts.playerSlot) && opts.playerSlot >= 1 && opts.playerSlot <= FORMATION.length ? opts.playerSlot : 1;
    const fleets = [];
    for(const team of TEAMS){
      FLEET_CLASSES.forEach((cls, i) => {
        const no = i + 1;
        const isPlayer = !opts.spectate && team === 'blue' && no === playerSlot;
        const ship = SHIP_TYPES[cls.role];
        fleets.push({
          id: `${team}${no}`,
          team,
          name: isPlayer && opts.playerName ? opts.playerName : `${team === 'blue' ? '味方' : '敵'}${cls.name}`,
          role: cls.role,
          type: cls.name,
          special: cls.special,
          x: spawnX(team, no),
          y: team === 'blue' ? WORLD.h - 300 : 300,
          heading: team === 'blue' ? -Math.PI / 2 : Math.PI / 2,
          ships: ship.stats.hp,    // 今の HP (耐久)
          maxShips: ship.stats.hp, // 最大 HP
          stats: Object.assign({}, ship.stats),
          hitRadius: ship.hitRadius,
          order: null,
          isPlayer,
          flagship: no === 1,
          cooldown: 0,   // 通常攻撃の再装填の残り秒数
          aaCooldown: 0, // 対空射撃の次の発射までの秒数
          charge: 0,     // 特殊攻撃のゲージ (0〜CHARGE_MAX)
          boost: 0,      // 巡洋艦の強化の残り秒数
          autoSpecial: false, // プレイヤーの艦: 特殊攻撃を自動で使うか (AUTO。AI の艦隊はいつも自動)
          lockId: null,  // ロックオンしている敵の id
          lockRef: null,
          weapons: {fire: true},
          stealth: 0, // 透明化の残り秒数 (隠しコマンド stealth)
          buffed: false, // バフ中か (1 ステップごとに付け直す)
          ai: {nextThink: 0}
        });
        if(cls.role === 'carrier') fleets[fleets.length - 1].recon = {next: 0}; // 偵察機: 次に射出する時刻
      });
    }
    return {
      time: 0, mode: 'modern', controllers, fleets, intel: {blue: {}, red: {}}, locks: [],
      projectiles: [], aircraft: [], pending: [], nextProjectileId: 1, events: [], reveal: false, warpArmed: false, outcome: null
    };
  }

  // 青チームだけ隠しコマンドの索敵解除が効く
  const revealFor = (g, team) => team === 'blue' && g.reveal;

  // そのステップで起きたこと (発砲・命中・迎撃・全滅など) を g.events に記録する。画面側が音を鳴らすのに使う
  function record(g, event){
    (g.events || (g.events = [])).push(event);
  }

  const visibleByTeam = g => {
    const beacon = beaconActive(g.time);
    return {blue: visibleEnemies(g.fleets, 'blue', revealFor(g, 'blue'), beacon, g.aircraft), red: visibleEnemies(g.fleets, 'red', false, beacon, g.aircraft)};
  };

  // 1 回の攻撃を出す。kind: 'shot' (主砲) / 'torpedo' (魚雷) / 'bomber' (爆撃機。回避できない)。fp は火力 (特殊攻撃は 100)、hitChance は命中率 (null なら相手の回避で決まる)
  // 攻撃の倍率 (損傷・バフ) と会心率は撃った瞬間の値
  function launchAttack(g, f, t, kind, fp, hitChance){
    const attack = {id: g.nextProjectileId++, kind, team: f.team, from: f.id, targetId: t.id, x: f.x, y: f.y, heading: Math.atan2(t.y - f.y, t.x - f.x),
      range: weaponRange(f), fp, mult: attackMultiplier(f), crit: critChanceOf(f), hitChance: kind === 'bomber' ? 1 : hitChance, evasionCut: evasionCutOf(f)};
    if(kind === 'bomber') g.aircraft.push(Object.assign(attack, {life: BOMBER_LIFE}));
    else g.projectiles.push(Object.assign(attack, {life: SHOT_LIFE}));
    record(g, {type: 'fire', kind: kind === 'shot' ? 'gun' : kind, size: SHIP_TYPES[f.role].size, team: f.team, from: f.id, x: f.x, y: f.y});
  }

  // あとで出す攻撃 (二段攻撃の 2 発目・連続攻撃) を予約する。delay 秒後に、撃つ艦と目標が生きていて目標が射程の中なら出す
  function schedule(g, f, t, kind, fp, hitChance, delay){
    g.pending.push({from: f.id, targetId: t.id, kind, fp, hitChance, delay});
  }

  // 予約した攻撃の待ち時間を進め、時間が来たものを出す
  function firePending(g, dt){
    const byId = new Map(g.fleets.map(f => [f.id, f]));
    const left = [];
    for(const p of g.pending){
      p.delay -= dt;
      if(p.delay > EPS){ left.push(p); continue; }
      const f = byId.get(p.from), t = byId.get(p.targetId);
      if(f && t && alive(f) && alive(t) && dist(f, t) <= weaponRange(f)) launchAttack(g, f, t, p.kind, p.fp, p.hitChance);
    }
    g.pending = left;
  }

  // 各艦隊がロックオンし (g.locks)、射程の中にいて、再装填が済んでいて FIRE がオンなら通常攻撃をする
  // (主砲は二段攻撃、空母は爆撃機 1 機)。予約した攻撃もここで出す。visible: チームごとの見えている敵 (省略時はその場で計算)
  function fireWeapons(g, dt, visible){
    const vis = visible || visibleByTeam(g);
    g.locks = [];
    if(!g.aircraft) g.aircraft = [];
    if(!g.pending) g.pending = [];
    firePending(g, dt);
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.cooldown = Math.max(0, (f.cooldown || 0) - dt);
      const t = lockTarget(f, vis[f.team]);
      if(!t) continue;
      const firing = dist(f, t) <= weaponRange(f);
      g.locks.push({from: f.id, to: t.id, team: f.team, firing});
      if(!firing || !f.weapons.fire || f.cooldown > EPS) continue;
      const w = weaponOf(f);
      if(w.kind === 'bomber'){
        launchAttack(g, f, t, 'bomber', firepowerOf(f), null);
      }else{
        launchAttack(g, f, t, 'shot', firepowerOf(f), null);
        schedule(g, f, t, 'shot', firepowerOf(f), null, DOUBLE_SHOT_DELAY);
      }
      f.cooldown = w.interval;
    }
  }

  // ロックオンしている敵が射程の中にいるか
  const targetInRange = f => !!f.lockRef && f.lockRef.id === f.lockId && alive(f.lockRef) && dist(f, f.lockRef) <= weaponRange(f);

  // 特殊攻撃を使う。ゲージが満タンで、使える状況なら使ってゲージを 0 に戻し true を返す
  function useSpecial(g, f){
    if(!f.special || !alive(f) || !(f.charge >= CHARGE_MAX - EPS)) return false;
    if(!g.pending) g.pending = [];
    if(f.special === 'boost'){
      f.boost = BOOST_DURATION;
    }else if(f.special === 'precision'){
      if(!targetInRange(f)) return false;
      launchAttack(g, f, f.lockRef, 'shot', SPECIAL_FIREPOWER, 1);
    }else if(f.special === 'torpedo'){
      if(!targetInRange(f)) return false;
      launchAttack(g, f, f.lockRef, 'torpedo', SPECIAL_FIREPOWER, TORPEDO_HIT);
      for(let k = 1; k < TORPEDO_SHOTS; k++) schedule(g, f, f.lockRef, 'torpedo', SPECIAL_FIREPOWER, TORPEDO_HIT, k * DOUBLE_SHOT_DELAY);
    }else if(f.special === 'salvo'){
      const shooters = g.fleets.filter(a => a.team === f.team && alive(a) && targetInRange(a));
      if(!shooters.length) return false;
      for(const a of shooters){
        const kind = weaponOf(a).kind === 'bomber' ? 'bomber' : 'shot';
        for(let k = 0; k < SALVO_SHOTS; k++) schedule(g, a, a.lockRef, kind, SPECIAL_FIREPOWER, null, k * DOUBLE_SHOT_DELAY);
      }
    }else{
      return false;
    }
    f.charge = 0;
    record(g, {type: 'special', kind: f.special, team: f.team, from: f.id, x: f.x, y: f.y});
    return true;
  }

  // 特殊攻撃の自動使用 (AI の艦隊と、AUTO がオンのプレイヤーの艦): NP が満タンで使える状況なら使う (巡洋艦の強化は、何かにロックオンしているとき)
  function autoSpecial(g, f){
    if(!f.special || !(f.charge >= CHARGE_MAX - EPS)) return;
    if(f.special === 'boost' && !(f.lockRef && f.lockRef.id === f.lockId && alive(f.lockRef))) return;
    useSpecial(g, f);
  }

  // 空母: 試合の始まりと、その後 RECON_EVERY 秒ごとに、偵察機を 1 機、進行方向の左右 RECON_CONE の範囲へ射出する。索敵範囲は空母の索敵の半分
  function launchRecon(g, rng){
    for(const f of g.fleets){
      if(!alive(f) || !f.recon || g.time + EPS < f.recon.next) continue;
      const heading = f.heading + (rng() * 2 - 1) * RECON_CONE;
      g.aircraft.push({id: g.nextProjectileId++, kind: 'recon', team: f.team, from: f.id, x: f.x, y: f.y, heading, life: RECON_LIFE, sensor: sensorRange(f) / 2});
      record(g, {type: 'launch', kind: 'recon', team: f.team, x: f.x, y: f.y});
      f.recon.next += RECON_EVERY;
    }
  }

  // 対空射撃: 全艦種が、AA_RANGE 以内の最も近い (免疫のない) 敵の艦載機を撃ち、対空% で撃ち落とす。
  // よけた機体には免疫がつき、それ以降は撃たれない。撃ったら成否にかかわらず待ち時間に入る
  function antiAir(g, dt, rng){
    for(const f of g.fleets){
      if(!alive(f)) continue;
      f.aaCooldown = Math.max(0, (f.aaCooldown || 0) - dt);
      if(f.aaCooldown > EPS) continue;
      let target = null;
      for(const a of g.aircraft){
        if(a.team !== f.team && !a.immune && dist(f, a) <= AA_RANGE && (!target || dist(f, a) < dist(f, target))) target = a;
      }
      if(!target) continue;
      f.aaCooldown = AA_INTERVAL;
      if(rng() < antiAirChance(f)){
        g.aircraft.splice(g.aircraft.indexOf(target), 1);
        record(g, {type: 'intercept', team: f.team, x: target.x, y: target.y});
      }else{
        target.immune = true;
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

  // 攻撃 p が目標 t に届いたときの結果。乱数は 命中 → 会心 → (かすりなら HP) → 空母の弱点 の順に使う
  //   命中: p.hitChance (null なら 100% − (回避 − p.evasionCut)%)。ダメージ = (火力 (会心なら × 1.5) + 5) × 倍率 − 装甲 × 0.7 を切り捨て
  //   0 以下ならかすり (今の HP の 5〜15%、最低 1)。空母は 15% で 2 倍 (弱点)、バフ中の目標は ÷ BUFF_DEFENSE (切り捨て)
  function resolveHit(p, t, rng){
    const chance = p.hitChance === null || p.hitChance === undefined ? hitChance(t, p.evasionCut) : p.hitChance;
    if(!(rng() < chance)) return {hit: false, damage: 0, critical: false, scratch: false, weakness: false};
    const critical = rng() < p.crit;
    let amount = Math.floor((p.fp * (critical ? CRIT_MULTIPLIER : 1) + ATTACK_BONUS) * p.mult - armorOf(t) * ARMOR_FACTOR);
    const scratch = amount <= 0;
    if(scratch) amount = Math.max(1, Math.floor(Math.ceil(t.ships) * (SCRATCH_MIN + rng() * SCRATCH_SPREAD)));
    const weakness = t.role === 'carrier' && rng() < CARRIER_CRIT_CHANCE;
    if(weakness) amount *= CARRIER_CRIT_MULTIPLIER;
    if(t.buffed) amount = Math.floor(amount / BUFF_DEFENSE);
    return {hit: true, damage: amount, critical, scratch, weakness};
  }

  // 攻撃が届いた: 抽選して、当たればダメージを damage (Map: 艦隊 → ダメージ) に足し、撃った艦のゲージをためる。外れたら記録だけ
  // 即死耐性: HP 満タンの艦を 1 回の攻撃で 0 にはせず、1 残す
  function applyHit(g, damage, p, t, kind, rng){
    const r = resolveHit(p, t, rng);
    if(!r.hit){
      record(g, {type: 'miss', kind, team: p.team, from: p.from, targetId: t.id, x: t.x, y: t.y});
      return;
    }
    const before = damage.get(t) || 0;
    let amount = r.damage;
    if(before === 0 && t.ships >= t.maxShips && amount >= t.ships) amount = t.ships - 1;
    damage.set(t, before + amount);
    const shooter = g.fleets.find(f => f.id === p.from);
    if(shooter && shooter.special) shooter.charge = Math.min(CHARGE_MAX, shooter.charge + amount * SHIP_TYPES[shooter.role].npPerDamage);
    record(g, {type: 'hit', kind, team: p.team, from: p.from, targetId: t.id, critical: r.critical, scratch: r.scratch, weakness: r.weakness, damage: amount, x: t.x, y: t.y});
  }

  // 目標が撃った艦の射程の外に出たか (撃った艦が全滅していたら出ていない扱い)
  function outOfRange(byId, p, t){
    const shooter = byId.get(p.from);
    return !!shooter && alive(shooter) && dist(shooter, t) > p.range;
  }

  // 砲弾・魚雷を進める。目標を追いかけ、届いたら抽選する。目標が撃った艦の射程の外に出たら、その地点で消える (出来事 fizzle)
  function moveProjectiles(g, dt, damage, rng){
    const byId = new Map(g.fleets.map(f => [f.id, f]));
    g.projectiles = g.projectiles.filter(p => {
      const t = byId.get(p.targetId);
      if(!t || !alive(t)) return false;
      if(outOfRange(byId, p, t)){ record(g, {type: 'fizzle', kind: p.kind, team: p.team, x: p.x, y: p.y}); return false; }
      const step = SHOT_SPEED * dt;
      const d = dist(p, t);
      if(d <= step + SHOT_HIT_RADIUS){ applyHit(g, damage, p, t, p.kind === 'torpedo' ? 'torpedo' : 'shot', rng); return false; }
      p.heading = Math.atan2(t.y - p.y, t.x - p.x);
      p.x += (t.x - p.x) / d * step;
      p.y += (t.y - p.y) / d * step;
      p.life -= dt;
      return p.life > 0;
    });
  }

  // 艦載機を進める。偵察機はまっすぐ飛び、RECON_LIFE 秒かマップの外で消える。
  // 爆撃機は目標へ向かい (1 ステップで BOMBER_TURN_RATE × dt まで向きを変える)、目標の当たり判定に触れたら爆撃して (回避で抽選) 消える。
  // 目標が空母の射程の外に出たら消える。BOMBER_LIFE 秒で消える
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
      if(outOfRange(byId, a, t)){ record(g, {type: 'fizzle', kind: 'bomber', team: a.team, x: a.x, y: a.y}); return false; }
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

  // 結果画面の戦績: 戦闘時間 (秒)、チームごとの残存艦隊数と残存戦力 (HP の合計)
  // units: チームごとの各艦の HP の残り (第 1〜第 5 の順。HP は切り上げ、沈んだ艦は 0)
  function battleStats(g){
    const fleets = {blue: 0, red: 0}, ships = {blue: 0, red: 0}, units = {blue: [], red: []};
    for(const f of g.fleets){
      units[f.team].push({id: f.id, type: f.type, ships: Math.max(0, Math.ceil(f.ships)), maxShips: f.maxShips});
      if(!alive(f)) continue;
      fleets[f.team]++;
      ships[f.team] += f.ships;
    }
    const no = u => Number(u.id.replace(/D/g, ''));
    for(const team of TEAMS) units[team].sort((a, b) => no(a) - no(b));
    return {time: g.time, fleets, ships, units};
  }

  // ---------- 表示のための計算 (描画はしない) ----------
  // 視点の中心 (cx, cy) を、画面 (ワールドの大きさで viewW × viewH) の端がマップの外に出ないように止める。
  // 画面のほうがマップより大きい (か同じ) 向きは、マップの真ん中に置く
  function clampView(cx, cy, viewW, viewH, world){
    const axis = (c, view, size) => (view >= size ? size / 2 : Math.min(size - view / 2, Math.max(view / 2, c)));
    return {cx: axis(cx, viewW, world.w), cy: axis(cy, viewH, world.h)};
  }

  // 上から見た艦の形の大きさ (ワールドの長さ)。length は船首から船尾、beam は幅
  const SHIP_SHAPES = {
    battleship: {length: 96, beam: 22},
    carrier: {length: 96, beam: 26},
    cruiser: {length: 64, beam: 15},
    destroyer: {length: 42, beam: 10}
  };

  // 撃沈エフェクト: 船体を長さの方向に割った破片が、離れながら回り、薄く小さくなって (沈んで) 消える
  const WRECK_DURATION = 1.6;                         // 消えるまでの秒数
  const WRECK_PIECES = {large: 5, medium: 4, small: 3}; // 艦の大きさごとの破片の数
  // 沈んだ艦 f から破片を作る。破片は艦の向きに沿った座標 (前が +) で、from〜to の長さの部分
  function createWreck(f, rng){
    const len = SHIP_SHAPES[f.role].length;
    const n = WRECK_PIECES[SHIP_TYPES[f.role].size];
    const pieces = [];
    for(let i = 0; i < n; i++){
      const from = -len / 2 + len * i / n, to = -len / 2 + len * (i + 1) / n;
      const side = i % 2 ? 1 : -1;
      pieces.push({
        from, to,
        vx: (from + to) / 2 * 0.8 + (rng() - 0.5) * 20, // 前後へ散る (中心から離れる向き)
        vy: side * 12 + (rng() - 0.5) * 20,              // 左右へ散る (隣どうしは逆向き)
        spin: side * (1 + rng() * 2)                     // 回る速さ (ラジアン/秒)
      });
    }
    return {x: f.x, y: f.y, heading: f.heading, role: f.role, team: f.team, pieces};
  }
  // 撃沈から t 秒後の破片の位置 (ワールド)・向き、全体の濃さ (alpha) と大きさ (scale)。done なら消えた
  function wreckState(w, t){
    const k = Math.min(1, Math.max(0, t / WRECK_DURATION));
    const travel = t * (1 - k / 2); // だんだん遅くなる
    const c = Math.cos(w.heading), s = Math.sin(w.heading);
    const pieces = w.pieces.map(p => {
      const lx = (p.from + p.to) / 2 + p.vx * travel, ly = p.vy * travel;
      return {x: w.x + lx * c - ly * s, y: w.y + lx * s + ly * c, angle: w.heading + p.spin * t};
    });
    return {pieces, alpha: 1 - k, scale: 1 - 0.3 * k, done: k >= 1};
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
    if(command === 'repair' && me) me.ships = me.maxShips;             // 最大 HP まで回復 (全滅した艦隊は戻らない)
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
      if(f.boost > 0) f.boost = f.boost - dt > EPS ? f.boost - dt : 0;
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

    // NP は時間でもたまる (艦種ごとの速さ。空母にはない)
    for(const f of living) if(f.special) f.charge = Math.min(CHARGE_MAX, (f.charge || 0) + SHIP_TYPES[f.role].npPerSecond * dt);

    fireWeapons(g, dt);
    for(const f of living){
      if(f.isPlayer ? f.autoSpecial : g.controllers && g.controllers[f.team]) autoSpecial(g, f);
    }
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
    WORLD, DEFAULT_WORLD, setWorld, BEACON_INTERVAL, BEACON_DURATION, beaconActive, RANGES, SPEEDS, weaponRange, sensorRange, hpRatio, damageState,
    attackMultiplier, hitChance, expectedDamage, antiAirChance, resolveHit, speedOf, firepowerOf, armorOf, critChanceOf, GHOST_CLEAR_RANGE,
    CHARGE_MAX, evasionCutOf, BOOST_DURATION, SPECIALS, FLEET_CLASSES, useSpecial,
    STEALTH_DURATION, SHOT_LIFE, BOMBER_LIFE, BOMBER_TURN_RATE, RECON_SPEED, RECON_LIFE, AA_RANGE,
    BUFF_RANGE, isBuffed, updateBuffs, SHIP_TYPES, FORMATION, AI_THINK_INTERVAL, maxSpeed, lockRange, visibleEnemies, updateIntel,
    lockTarget, moveFleet, checkOutcome, createGame, step,
    fireWeapons, launchRecon, antiAir, moveProjectiles, moveAircraft, keyCourse, battleStats,
    clampView, SHIP_SHAPES, WRECK_DURATION, createWreck, wreckState,
    newCheatProgress, cheatSequenceStep, parseCommand, applyCommand, warpFleet
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
