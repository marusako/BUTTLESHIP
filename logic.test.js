const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');

// テスト用の艦隊を作る
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', x: 0, y: 0,
    role: 'cruiser', ships: 50, maxShips: 50, stats: Object.assign({}, L.SHIP_TYPES.cruiser.stats), hitRadius: 25, charge: 0, boost: 0, lockId: null,
    order: null, isPlayer: false, ai: {nextThink: 0},
    heading: 0, flagship: false, cooldown: 0, aaCooldown: 0, stealth: 0,
    weapons: {fire: true}
  }, over);
}

// テスト用のゲーム状態を作る
// テスト用の試合。特殊攻撃のロック (第 3.9 段階) を外した最終戦の状態から始める
function game(fleets){
  return {time: 0, fleets, intel: {blue: {}, red: {}}, locks: [], projectiles: [], aircraft: [], nextProjectileId: 1, events: [],
    reveal: false, warpArmed: false, outcome: null, finalBattle: true};
}

// 決まった値を順に返す乱数
function seq(...values){
  let i = 0;
  return () => values[i++ % values.length];
}

test('速度: 速力 (低速 55 / 高速 89 / 高速+ 140。第 4.1 段階で全艦 0.85 倍にして試合を長く。高速+ は強化中の巡洋艦 (133.5) より速い) で決まる', () => {
  assert.deepEqual(['slow', 'fast', 'fastPlus'].map(speed => L.maxSpeed({speed})), [55, 89, 140]);
  assert.ok(L.maxSpeed({speed: 'fastPlus'}) > L.maxSpeed({speed: 'fast'}) * L.BOOST_MULTIPLIER, '駆逐艦は強化中の巡洋艦から逃げきれる (第 3.8 段階)');
});

test('索敵: 味方のどれかの索敵範囲に入った敵だけが見える (情報共有)', () => {
  const me = fleet({id: 'me', x: 0, y: 0});
  const ally = fleet({id: 'ally', x: 2000, y: 0});
  const nearAlly = fleet({id: 'e1', team: 'red', x: 2000 + L.sensorRange(fleet()) - 1, y: 0});
  const far = fleet({id: 'e2', team: 'red', x: 1000, y: 0});
  const fleets = [me, ally, nearAlly, far];
  assert.deepEqual(L.visibleEnemies(fleets, 'blue').map(f => f.id), ['e1']);
});

test('索敵: 全滅した味方の索敵範囲は使えない', () => {
  const me = fleet({id: 'me', x: 0, y: 0, ships: 0});
  const e = fleet({id: 'e', team: 'red', x: 10, y: 0});
  assert.deepEqual(L.visibleEnemies([me, e], 'blue'), []);
});

test('索敵: 見失った敵は最終確認位置が残り、再発見で更新、撃沈で消える', () => {
  const me = fleet({id: 'me'});
  const e = fleet({id: 'e', team: 'red', x: 100, y: 0});
  const fleets = [me, e];
  const intel = {};
  L.updateIntel(intel, fleets, 'blue');
  assert.deepEqual(intel.e, {x: 100, y: 0, visible: true});

  e.x = 5000;
  L.updateIntel(intel, fleets, 'blue');
  assert.deepEqual(intel.e, {x: 100, y: 0, visible: false});

  e.x = 200;
  L.updateIntel(intel, fleets, 'blue');
  assert.deepEqual(intel.e, {x: 200, y: 0, visible: true});

  e.ships = 0;
  L.updateIntel(intel, fleets, 'blue');
  assert.equal(intel.e, undefined);
});

test('索敵: 最終確認位置の近くまで味方が行って敵がいなければ、その記録は消える', () => {
  const me = fleet({id: 'me', x: 3000 - L.GHOST_CLEAR_RANGE - 1, y: 0});
  const e = fleet({id: 'e', team: 'red', x: 5000, y: 0});
  const intel = {e: {x: 3000, y: 0, visible: false}};
  L.updateIntel(intel, [me, e], 'blue');
  assert.deepEqual(intel.e, {x: 3000, y: 0, visible: false}); // まだ確かめていない
  me.x = 3000 - L.GHOST_CLEAR_RANGE + 1;
  L.updateIntel(intel, [me, e], 'blue');
  assert.equal(intel.e, undefined);
});

test('移動: 目的地へ最大速度で進み、着いたら命令が消える', () => {
  const f = fleet({order: {type: 'move', x: 1000, y: 0}});
  L.moveFleet(f, 1, {});
  assert.equal(Math.round(f.x), Math.round(L.maxSpeed(f.stats)));
  f.x = 999;
  L.moveFleet(f, 1, {});
  assert.equal(f.x, 1000);
  assert.equal(f.order, null);
});

test('移動: 攻撃相手を見失ったら最終確認位置へ向かい、着いても見えなければ命令が消える', () => {
  const f = fleet({x: 0, order: {type: 'attack', targetId: 'e'}});
  const intel = {e: {x: 100, y: 0, visible: false}};
  L.moveFleet(f, 10, intel);
  assert.equal(f.x, 100);
  assert.equal(f.order, null);
  const g = fleet({order: {type: 'attack', targetId: 'gone'}});
  L.moveFleet(g, 1, {});
  assert.equal(g.order, null);
});

test('勝敗: 敵全滅で勝ち、味方全滅で負け、同時なら引き分け', () => {
  const b = fleet({id: 'b'});
  const r = fleet({id: 'r', team: 'red'});
  assert.equal(L.checkOutcome([b, r]), null);
  r.ships = 0;
  assert.equal(L.checkOutcome([b, r]), 'win');
  r.ships = 10; b.ships = 0;
  assert.equal(L.checkOutcome([b, r]), 'lose');
  r.ships = 0;
  assert.equal(L.checkOutcome([b, r]), 'draw');
});

test('マップ: 原作のミニマップと同じ縦長 (横 1 : 縦 2) の 16000 × 32000 (第 3.4 段階で 13000 × 26000、第 4.1 段階で試合を長くするため広げた)', () => {
  assert.deepEqual(L.WORLD, {w: 16000, h: 32000});
});

test('ゲーム作成: 青は下の端、赤は上の端から、横に並んで出撃する', () => {
  const g = L.createGame();
  for(const f of g.fleets){
    if(f.team === 'blue') assert.ok(f.y > L.WORLD.h * 0.9, f.id);
    else assert.ok(f.y < L.WORLD.h * 0.1, f.id);
    assert.ok(f.x > 0 && f.x < L.WORLD.w, f.id);
  }
  const xs = g.fleets.filter(f => f.team === 'blue').map(f => f.x);
  assert.equal(new Set(xs).size, 5);
});

// どの艦隊にも同じ移動命令を返す AI (テスト用)
const goNorth = f => ({type: 'move', x: f.x, y: 0});

test('ゲーム進行: AI (controllers) の命令で動き、プレイヤー艦隊には命令が入らない', () => {
  const b = fleet({id: 'b', isPlayer: true, x: 300, y: 1500});
  const b2 = fleet({id: 'b2', x: 600, y: 1500});
  const r = fleet({id: 'r', team: 'red', x: 3700, y: 1500});
  const g = game([b, b2, r]);
  g.controllers = {blue: goNorth, red: goNorth};
  L.step(g, 0.1, seq(0.5));
  assert.equal(b.order, null);
  assert.deepEqual(b2.order, {type: 'move', x: 600, y: 0});
  assert.deepEqual(r.order, {type: 'move', x: 3700, y: 0});
  assert.ok(r.y < 1500, '命令どおりに動く');
});

test('ゲーム進行: AI を渡さないチームの艦隊は何もしない', () => {
  const r = fleet({id: 'r', team: 'red', x: 3700, y: 1500});
  const b2 = fleet({id: 'b2', x: 600, y: 1500});
  const g = game([b2, r]);
  g.controllers = {blue: goNorth, red: null};
  L.step(g, 0.1, seq(0.5));
  assert.equal(r.order, null);
  assert.deepEqual([r.x, r.y], [3700, 1500]);
  assert.notEqual(b2.order, null);
  const none = game([fleet({id: 'x', x: 100, y: 100})]);
  L.step(none, 0.1, seq(0.5));
  assert.equal(none.fleets[0].order, null, 'controllers がなくても落ちない');
});

test('ゲーム作成: controllers をチームごとに渡せる (省略すると AI なし)', () => {
  const g = L.createGame({controllers: {red: goNorth}});
  assert.equal(g.controllers.red, goNorth);
  assert.equal(g.controllers.blue, null);
  assert.deepEqual(L.createGame().controllers, {blue: null, red: null});
});

// ---------- 第 2 段階 ----------

test('向き: 移動した方向を向き、止まっている間は向きを保つ', () => {
  const f = fleet({y: 2000, order: {type: 'move', x: 1000, y: 2000}});
  L.moveFleet(f, 1, {});
  assert.equal(f.heading, 0);
  f.order = {type: 'move', x: f.x, y: 1000};
  L.moveFleet(f, 1, {});
  assert.equal(f.heading, -Math.PI / 2);
  f.order = null;
  L.moveFleet(f, 1, {});
  assert.equal(f.heading, -Math.PI / 2);
});

test('ゲーム作成: 初期の向きは青が北 (上)・赤が南 (下)', () => {
  const g = L.createGame();
  assert.ok(g.fleets.filter(f => f.team === 'blue').every(f => f.heading === -Math.PI / 2));
  assert.ok(g.fleets.filter(f => f.team === 'red').every(f => f.heading === Math.PI / 2));
});

test('勝敗 (モダン): 敵旗艦を倒せば勝ち、味方旗艦が倒されたら負け', () => {
  const bf = fleet({id: 'bf', flagship: true});
  const b2 = fleet({id: 'b2'});
  const rf = fleet({id: 'rf', team: 'red', flagship: true});
  const r2 = fleet({id: 'r2', team: 'red'});
  const fleets = [bf, b2, rf, r2];
  assert.equal(L.checkOutcome(fleets), null);
  rf.ships = 0;
  assert.equal(L.checkOutcome(fleets), 'win');
  rf.ships = 10; bf.ships = 0;
  assert.equal(L.checkOutcome(fleets), 'lose');
});

test('勝敗 (モダン): 両方の旗艦が同時に沈んだら、残っている戦力 (艦艇の合計) が多いほうの勝ち。同じなら引き分け', () => {
  const bf = fleet({id: 'bf', flagship: true, ships: 0});
  const b2 = fleet({id: 'b2', ships: 5000});
  const rf = fleet({id: 'rf', team: 'red', flagship: true, ships: 0});
  const r2 = fleet({id: 'r2', team: 'red', ships: 4999});
  assert.equal(L.checkOutcome([bf, b2, rf, r2]), 'win');
  r2.ships = 5001;
  assert.equal(L.checkOutcome([bf, b2, rf, r2]), 'lose');
  r2.ships = 5000;
  assert.equal(L.checkOutcome([bf, b2, rf, r2]), 'draw');
});

test('隠しコマンド: Y U K I を 2 秒以内に順に押すとポップアップが開く', () => {
  const press = (codes, times) => {
    let p = L.newCheatProgress(), hit = false;
    codes.forEach((c, i) => { const r = L.cheatSequenceStep(p, c, times[i]); p = r.progress; hit = hit || r.triggered; });
    return hit;
  };
  assert.equal(press(['KeyY', 'KeyU', 'KeyK', 'KeyI'], [0, 0.3, 0.6, 0.9]), true);
  assert.equal(press(['KeyY', 'KeyU', 'KeyK', 'KeyI'], [0, 0.8, 1.6, 2.4]), false); // 遅すぎる
  assert.equal(press(['KeyY', 'KeyU', 'KeyW', 'KeyK', 'KeyI'], [0, 0.1, 0.2, 0.3, 0.4]), false); // 途中で別のキー
  assert.equal(press(['KeyY', 'KeyY', 'KeyU', 'KeyK', 'KeyI'], [0, 0.1, 0.2, 0.3, 0.4]), true); // Y からやり直し
  assert.equal(press(['KeyY', 'KeyU', 'KeyK', 'KeyI', 'KeyY', 'KeyU', 'KeyK', 'KeyI'], [0, 0.1, 0.2, 0.3, 5, 5.1, 5.2, 5.3]), true);
});

test('隠しコマンド: 入力の判定は大文字小文字と前後の空白を区別しない', () => {
  assert.equal(L.parseCommand(' SCAN '), 'scan');
  assert.equal(L.parseCommand('Warp'), 'warp');
  assert.equal(L.parseCommand('scanx'), null);
  assert.equal(L.parseCommand('sc an'), null);
  assert.equal(L.parseCommand(''), null);
});

test('隠しコマンド scan: 索敵解除中は青チームから全ての敵が見え、もう一度で元に戻る', () => {
  const b = fleet({id: 'b', isPlayer: true, x: 0, y: 0});
  const r = fleet({id: 'r', team: 'red', x: 3000, y: 0});
  const g = game([b, r]);
  L.applyCommand(g, 'scan');
  assert.equal(g.reveal, true);
  assert.deepEqual(L.visibleEnemies(g.fleets, 'blue', g.reveal).map(f => f.id), ['r']);
  L.step(g, 0.01, seq(0.5));
  assert.equal(g.intel.blue.r.visible, true);
  assert.equal(g.intel.red.b, undefined); // 敵には効かない
  L.applyCommand(g, 'scan');
  assert.equal(g.reveal, false);
  L.step(g, 0.01, seq(0.5));
  assert.equal(g.intel.blue.r.visible, false);
});

test('隠しコマンド warp: 次のクリック地点へ瞬間移動し、マップの外には出ない', () => {
  const b = fleet({id: 'b', isPlayer: true, x: 100, y: 100, order: {type: 'move', x: 500, y: 500}});
  const g = game([b]);
  L.applyCommand(g, 'warp');
  assert.equal(g.warpArmed, true);
  L.warpFleet(g, b, 2000, 1500);
  assert.deepEqual([b.x, b.y, b.order, g.warpArmed], [2000, 1500, null, false]);
  L.applyCommand(g, 'warp');
  L.warpFleet(g, b, -50, L.WORLD.h + 99);
  assert.deepEqual([b.x, b.y], [0, L.WORLD.h]);
});

// ---------- 第 2.1 段階 ----------

test('耐久: ゲーム開始時は、どの艦隊も艦種の耐久 (最大 HP) で満タン', () => {
  const g = L.createGame();
  for(const f of g.fleets){
    assert.equal(f.maxShips, L.SHIP_TYPES[f.role].stats.hp * L.HP_SCALE);
    assert.equal(f.ships, f.maxShips);
  }
});

test('移動: いつも最大速度で進む (スピードの段階はない)', () => {
  const f = fleet({order: {type: 'move', x: 5000, y: 0}});
  const full = L.maxSpeed(f.stats);
  L.moveFleet(f, 1, {});
  assert.ok(Math.abs(f.x - full) < 1e-9);
});

test('WAY: 指定した方向へ進み続け、マップの端で止まって命令が消える', () => {
  const f = fleet({x: 1000, y: 1000, order: {type: 'course', angle: -Math.PI / 2}}); // 北へ
  L.moveFleet(f, 1, {});
  assert.equal(f.x, 1000);
  assert.ok(f.y < 1000);
  assert.equal(f.heading, -Math.PI / 2);
  assert.equal(f.order.type, 'course');
  for(let i = 0; i < 100 && f.order; i++) L.moveFleet(f, 1, {});
  assert.equal(f.y, 0);
  assert.equal(f.order, null);
});

test('WAY: マップの端に沿う向きなら、端に着くまで進む', () => {
  const f = fleet({x: 100, y: 0, order: {type: 'course', angle: 0}}); // 上の端に沿って東へ
  L.moveFleet(f, 1, {});
  assert.ok(f.x > 100);
  assert.equal(f.y, 0);
  assert.equal(f.order.type, 'course');
});

// ---------- 第 2.2 段階 ----------

test('マップ外: 移動命令の行き先がマップの外なら、最も近い端まで進んで止まる', () => {
  const f = fleet({x: 100, y: 100, order: {type: 'move', x: -500, y: 100}});
  for(let i = 0; i < 20 && f.order; i++) L.moveFleet(f, 1, {});
  assert.deepEqual([f.x, f.y, f.order], [0, 100, null]);
});

test('マップ外: どの命令でも移動後の位置はマップの内側', () => {
  const f = fleet({x: 10, y: 10, order: {type: 'attack', targetId: 'e'}});
  const intel = {e: {x: -3000, y: -3000, visible: false}};
  for(let i = 0; i < 50 && f.order; i++) L.moveFleet(f, 1, intel);
  assert.ok(f.x >= 0 && f.y >= 0);
});

// ---------- 第 2.3 段階 ----------


test('ルール: モダンだけ。各チームの旗艦は第 1 艦隊で、青の旗艦はプレイヤー', () => {
  const g = L.createGame();
  assert.equal(g.mode, 'modern');
  for(const team of ['blue', 'red']){
    const flags = g.fleets.filter(f => f.team === team && f.flagship);
    assert.deepEqual(flags.map(f => f.id), [team + '1']);
  }
  assert.ok(g.fleets.find(f => f.id === 'blue1').isPlayer);
});

// ---------- 第 2.4 段階 (2.4a) ----------

// 弾をテスト用に作る
function projectile(over){
  return Object.assign({id: 1, kind: 'shell', team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, heading: 0, life: 99, power: 1}, over);
}

// ---------- 第 2.4 段階 (2.4b) ----------

test('ゲーム作成: 自艦隊の名前を指定でき、指定しなければ「味方」+ 艦種の名前', () => {
  const named = L.createGame({playerName: 'ヤマト'});
  assert.equal(named.fleets.find(f => f.isPlayer).name, 'ヤマト');
  assert.equal(named.fleets.find(f => f.id === 'blue2').name, '味方空母');
  assert.equal(L.createGame().fleets.find(f => f.isPlayer).name, '味方戦艦');
  assert.equal(L.createGame({playerName: ''}).fleets.find(f => f.isPlayer).name, '味方戦艦');
});

// ---------- 第 2.4 段階 (2.4c) ----------

test('出来事: ステップごとに新しく記録し直す (前のステップの出来事は残らない)', () => {
  const b = fleet({id: 'b', isPlayer: true});
  const r = fleet({id: 'r', team: 'red', x: 3000, y: 3000});
  const g = game([b, r]);
  g.events.push({type: 'fire', kind: 'shell', team: 'blue', from: 'b', x: 0, y: 0});
  L.step(g, 0.01, seq(0.5));
  assert.deepEqual(g.events, []);
});

test('ゲーム作成: 出来事の一覧は空で始まる', () => {
  assert.deepEqual(L.createGame().events, []);
});

// ---------- 第 2.5 段階 (2.5a) ----------

test('移動キー: 押している向きから進む角度を出す (画面の上が北)', () => {
  const none = {up: false, down: false, left: false, right: false};
  const k = o => L.keyCourse(Object.assign({}, none, o));
  const near = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
  assert.ok(near(k({up: true}), -Math.PI / 2));
  assert.ok(near(k({down: true}), Math.PI / 2));
  assert.ok(near(k({left: true}), Math.PI));
  assert.ok(near(k({right: true}), 0));
  assert.ok(near(k({up: true, right: true}), -Math.PI / 4), '2 つ同時なら斜め');
  assert.ok(near(k({down: true, left: true}), Math.PI * 3 / 4));
  assert.ok(near(k({up: true, left: true, right: true}), -Math.PI / 2), '左右は打ち消し合う');
});

test('移動キー: 何も押していない・反対向きを同時に押しているときは null (止まる)', () => {
  assert.equal(L.keyCourse({up: false, down: false, left: false, right: false}), null);
  assert.equal(L.keyCourse({up: true, down: true, left: false, right: false}), null);
  assert.equal(L.keyCourse({up: true, down: true, left: true, right: true}), null);
});

test('戦績: 戦闘時間・残存艦隊数・残存戦力 (艦艇の合計) をチームごとに数える', () => {
  const g = game([
    fleet({id: 'b1', team: 'blue', ships: 12000}),
    fleet({id: 'b2', team: 'blue', ships: 0}),
    fleet({id: 'b3', team: 'blue', ships: 300.4}),
    fleet({id: 'r1', team: 'red', ships: 0}),
    fleet({id: 'r2', team: 'red', ships: 5000})
  ]);
  g.time = 83.5;
  const s = L.battleStats(g);
  assert.equal(s.time, 83.5);
  assert.deepEqual(s.fleets, {blue: 2, red: 1});
  assert.ok(Math.abs(s.ships.blue - 12300.4) < 1e-9);
  assert.equal(s.ships.red, 5000);
});

// ---------- 第 2.5 段階 (2.5b) ----------

test('自機の選択: おかしな番号なら第 1 艦隊', () => {
  for(const no of [0, 6, 2.5, '3', null]){
    assert.equal(L.createGame({playerSlot: no}).fleets.find(f => f.isPlayer).id, 'blue1', String(no));
  }
});

test('観戦: 旗艦以外の自機が全滅しても、味方の旗艦が残っていれば試合は続く', () => {
  const g = L.createGame({playerSlot: 5});
  g.fleets.find(f => f.isPlayer).ships = 0;
  L.step(g, 1 / 60, seq(0.5));
  assert.equal(g.outcome, null);
  g.fleets.find(f => f.id === 'blue1').ships = 0;
  L.step(g, 1 / 60, seq(0.5));
  assert.equal(g.outcome, 'lose');
});

test('AI (旗艦以外を選んだとき): 味方の AI 旗艦は AI の命令で動く', () => {
  const g = L.createGame({playerSlot: 2, controllers: {blue: goNorth, red: goNorth}});
  L.step(g, 1 / 60, seq(0.5));
  assert.ok(g.fleets.find(f => f.id === 'blue1').order, '旗艦に命令が入る');
  assert.equal(g.fleets.find(f => f.isPlayer).order, null, '自機には AI の命令が入らない');
});

// ---------- 第 3.3 段階 (3.3c) ----------

test('視点の制限 (clampView): 画面の端がマップの外に出ないように中心を止める。画面のほうが大きければマップの真ん中', () => {
  const world = {w: 1000, h: 800};
  assert.deepEqual(L.clampView(50, 10, 400, 300, world), {cx: 200, cy: 150});
  assert.deepEqual(L.clampView(990, 790, 400, 300, world), {cx: 800, cy: 650});
  assert.deepEqual(L.clampView(500, 400, 400, 300, world), {cx: 500, cy: 400}, '中なら動かさない');
  assert.deepEqual(L.clampView(100, 100, 1200, 300, world), {cx: 500, cy: 150}, '横が入りきらなければ横は真ん中');
  assert.deepEqual(L.clampView(100, 100, 400, 800, world), {cx: 200, cy: 400}, 'ちょうど同じ大きさでも真ん中');
});

test('艦の形 (SHIP_SHAPES): 艦種ごとの長さと幅。大きい艦ほど長い', () => {
  const S = L.SHIP_SHAPES;
  assert.deepEqual(Object.keys(S), Object.keys(L.SHIP_TYPES));
  assert.ok(S.battleship.length > S.cruiser.length && S.cruiser.length > S.destroyer.length);
  for(const k of Object.keys(S)) assert.ok(S[k].beam < S[k].length / 2.5, k + ' は細長い');
});

test('撃沈エフェクト (createWreck): 船体を長さの方向に割った破片。大きい艦ほど多い (大 5 / 中 4 / 小 3)。破片をつなぐと船体の長さになる', () => {
  const rng = seq(0.3, 0.7, 0.5, 0.9, 0.1);
  const bb = L.createWreck(ship('battleship', {x: 100, y: 200, heading: 0}), rng);
  assert.deepEqual([bb.x, bb.y, bb.role, bb.team, bb.heading], [100, 200, 'battleship', 'blue', 0]);
  assert.deepEqual([bb.pieces.length, L.createWreck(ship('cruiser'), rng).pieces.length, L.createWreck(ship('destroyer'), rng).pieces.length], [5, 4, 3]);
  const half = L.SHIP_SHAPES.battleship.length / 2;
  assert.equal(bb.pieces[0].from, -half);
  assert.equal(bb.pieces[bb.pieces.length - 1].to, half);
  for(let i = 1; i < bb.pieces.length; i++) assert.equal(bb.pieces[i].from, bb.pieces[i - 1].to, 'すき間なく並ぶ');
});

test('撃沈エフェクト (wreckState): 始めは船体の形のまま、時間とともに破片が離れて回り、薄く小さくなって WRECK_DURATION で消える', () => {
  const w = L.createWreck(ship('cruiser', {x: 0, y: 0, heading: Math.PI / 2}), seq(0.5));
  const s0 = L.wreckState(w, 0);
  assert.deepEqual([s0.alpha, s0.scale, s0.done], [1, 1, false]);
  w.pieces.forEach((p, i) => {
    const c = (p.from + p.to) / 2;
    assert.ok(Math.abs(s0.pieces[i].x) < 1e-9 && Math.abs(s0.pieces[i].y - c) < 1e-9, '向き (南) に沿って並ぶ');
    assert.equal(s0.pieces[i].angle, Math.PI / 2);
  });
  const s1 = L.wreckState(w, L.WRECK_DURATION / 2);
  assert.ok(s1.alpha < 1 && s1.alpha > 0 && s1.scale < 1);
  s1.pieces.forEach((p, i) => assert.ok(Math.hypot(p.x, p.y) > Math.hypot(s0.pieces[i].x, s0.pieces[i].y), '中心から離れる'));
  assert.ok(s1.pieces.some((p, i) => p.angle !== s0.pieces[i].angle), '回る');
  const end = L.wreckState(w, L.WRECK_DURATION);
  assert.deepEqual([end.alpha, end.done], [0, true]);
});

// ---------- 第 3.7 段階 (②) ----------

test('中立の観戦 (fullIntel): 両軍の生きている艦がすべて見える位置情報 (透明化中も)。沈んだ艦は入れない', () => {
  const fleets = [fleet({id: 'b', x: 10, y: 20}), fleet({id: 'r', team: 'red', x: 30, y: 40, stealth: 5}), fleet({id: 'd', team: 'red', ships: 0})];
  assert.deepEqual(L.fullIntel(fleets), {b: {x: 10, y: 20, visible: true}, r: {x: 30, y: 40, visible: true}});
});

// ---------- 第 3.4 段階 (3.4b) ----------

test('TARGET パネル (targetInfo): ロックオンしている敵の HP・損傷・距離・命中率・1 発の期待ダメージ・射程の中か。狙いがなければ null', () => {
  const me = ship('cruiser', {id: 'me', x: 0, y: 0});
  const e = ship('carrier', {id: 'e', team: 'red', x: 300, y: 400, ships: 300});
  assert.equal(L.targetInfo(me), null, 'ロックオンなし');
  me.lockId = 'e'; me.lockRef = e;
  const t = L.targetInfo(me);
  assert.deepEqual([t.id, t.ships, t.maxShips, t.state, t.distance, t.inRange], ['e', 300, 700, 'moderate', 500, false]);
  assert.ok(Math.abs(t.hitChance - 0.6) < 1e-9);
  assert.equal(t.expected, L.expectedDamage(me, e));
  e.x = 0; e.y = 400;
  assert.equal(L.targetInfo(me).inRange, true, '射程 450 の中');
  const cv = ship('carrier', {id: 'cv', lockId: 'e', lockRef: e});
  assert.equal(L.targetInfo(cv).hitChance, 1, '爆撃機は回避できない');
  e.ships = 0;
  assert.equal(L.targetInfo(me), null, '沈んだ敵は狙いにしない');
});

// ---------- 第 3.3 段階 (3.3b) ----------

test('観戦 (spectate): プレイヤーの艦はなく、10 隻すべてを AI が動かす。自艦の名前は使わない', () => {
  const g = L.createGame({spectate: true, playerName: 'ヤマト', controllers: {blue: goNorth, red: goNorth}});
  assert.equal(g.fleets.some(f => f.isPlayer), false);
  assert.equal(g.fleets.some(f => f.name === 'ヤマト'), false);
  L.step(g, 1 / 60, seq(0.5));
  assert.ok(g.fleets.every(f => f.order), '全艦に AI の命令が入る');
  assert.equal(L.createGame({spectate: false}).fleets.filter(f => f.isPlayer).length, 1, 'false ならいつもどおり');
});

test('戦績: 各艦の HP の残り (units。チームごとに第 1〜第 5 の順、沈んだ艦は 0)', () => {
  const g = L.createGame();
  g.fleets.find(f => f.id === 'blue1').ships = 800.4;
  g.fleets.find(f => f.id === 'red4').ships = -3;
  const u = L.battleStats(g).units;
  assert.deepEqual(u.blue.map(x => x.type), L.FLEET_CLASSES.map(c => c.name));
  assert.deepEqual(u.blue[0], {id: 'blue1', type: '戦艦', ships: 801, maxShips: 1000}, 'HP は切り上げ');
  assert.deepEqual(u.red[3], {id: 'red4', type: '駆逐艦Ⅰ型', ships: 0, maxShips: 300}, '沈んだ艦は 0');
});

// ---------- 第 2.5 段階 (2.5c) ----------

test('隠しコマンド: repair と stealth を読み取る (大文字・前後の空白は無視)', () => {
  assert.equal(L.parseCommand(' REPAIR '), 'repair');
  assert.equal(L.parseCommand('Stealth'), 'stealth');
  assert.equal(L.parseCommand('repairs'), null);
});

test('隠しコマンド repair: 自艦隊の艦艇数が初期値に戻る (全滅した艦隊は戻らない)', () => {
  const me = fleet({id: 'me', isPlayer: true, ships: 1234});
  const ally = fleet({id: 'a', ships: 500});
  const g = game([me, ally]);
  L.applyCommand(g, 'repair');
  assert.equal(me.ships, me.maxShips, '最大 HP まで');
  assert.equal(ally.ships, 500, '味方の AI 艦隊は変わらない');
  me.ships = 0;
  L.applyCommand(g, 'repair');
  assert.equal(me.ships, 0);
});

test('隠しコマンド stealth: 見られていた場合は最終確認位置だけが残り、15 秒で元に戻る。もう一度で 15 秒に戻る', () => {
  const me = fleet({id: 'me', isPlayer: true, x: 1000, y: 1000, weapons: {fire: false}});
  const e = fleet({id: 'e', team: 'red', x: 1000 + L.sensorRange(fleet()) - 10, y: 1000, weapons: {fire: false}});
  const g = game([me, e]);
  L.step(g, 0.1, seq(0.9));
  assert.equal(g.intel.red.me.visible, true);
  L.applyCommand(g, 'stealth');
  L.step(g, 0.1, seq(0.9));
  assert.equal(g.intel.red.me.visible, false);
  for(let i = 0; i < 100; i++) L.step(g, 0.1, seq(0.9)); // 約 10 秒
  L.applyCommand(g, 'stealth');
  assert.equal(me.stealth, L.STEALTH_DURATION);
  for(let i = 0; i < 149; i++) L.step(g, 0.1, seq(0.9));
  assert.ok(me.stealth > 0);
  for(let i = 0; i < 3; i++) L.step(g, 0.1, seq(0.9));
  assert.equal(me.stealth, 0);
  Object.assign(e, {x: me.x + 100, y: me.y}); // 敵 AI はこの間に動くので、すぐ近くに置き直して確かめる
  assert.ok(L.visibleEnemies(g.fleets, 'red', false).some(f => f.id === 'me'), '効果が切れたら見える');
});

test('ゲーム作成: どの艦隊も透明化していない状態で始まる', () => {
  for(const f of L.createGame().fleets) assert.equal(f.stealth, 0);
});

// ---------- 第 2.7 段階 (旗艦の位置がばれる・マップの広さ) ----------

test('衛星スキャンの時間: 開始から 60 秒ごとに 5 秒間 (開始直後はない。第 4.1 段階で旗艦の位置がばれるルールを置き換えた)', () => {
  assert.equal(L.SCAN_INTERVAL, 60);
  assert.equal(L.SCAN_DURATION, 5);
  assert.equal(L.beaconActive, undefined, '旗艦の位置がばれるルールはない');
  for(const t of [0, 3, 59.9, 65, 100, 125.01]) assert.equal(L.scanActive(t), false, String(t));
  for(const t of [60, 62.5, 64.99, 120, 180.1]) assert.equal(L.scanActive(t), true, String(t));
});

test('衛星スキャン: その間は索敵範囲の外でも相手の全艦が見える。透明化中の艦は見えない', () => {
  const me = fleet({id: 'me', x: 100, y: 100});
  const flag = fleet({id: 'rf', team: 'red', x: 9000, y: 9000, flagship: true});
  const other = fleet({id: 'r2', team: 'red', x: 9100, y: 9000});
  const fleets = [me, flag, other];
  assert.deepEqual(L.visibleEnemies(fleets, 'blue', false, false).map(f => f.id), []);
  assert.deepEqual(L.visibleEnemies(fleets, 'blue', false, true).map(f => f.id), ['rf', 'r2']);
  flag.stealth = 3;
  assert.deepEqual(L.visibleEnemies(fleets, 'blue', false, true).map(f => f.id), ['r2'], '透明化が優先');
});

test('衛星スキャン (試合の中): 60 秒でお互いの全艦が見え、5 秒後はゴーストとして残る。出来事 scan', () => {
  const bf = fleet({id: 'bf', x: 100, y: 100, flagship: true, isPlayer: true, weapons: {fire: false}});
  const rf = fleet({id: 'rf', team: 'red', x: 9000, y: 9000, flagship: true, weapons: {fire: false}});
  const r2 = fleet({id: 'r2', team: 'red', x: 9500, y: 9000, weapons: {fire: false}});
  const g = game([bf, rf, r2]);
  g.time = 59.95;
  L.step(g, 0.1, seq(0.5));
  assert.equal(g.intel.blue.rf.visible, true);
  assert.equal(g.intel.blue.r2.visible, true, '旗艦以外も見える');
  assert.equal(g.intel.red.bf.visible, true, 'お互いに見える');
  assert.equal(g.events.filter(e => e.type === 'scan').length, 1, 'スキャンの始まりに出来事 scan');
  L.step(g, 0.1, seq(0.5));
  assert.equal(g.events.filter(e => e.type === 'scan').length, 0, '始まりだけ');
  for(let i = 0; i < 60; i++) L.step(g, 0.1, seq(0.5));
  assert.equal(g.intel.blue.rf.visible, false);
  assert.deepEqual([g.intel.blue.r2.x, g.intel.blue.r2.y], [9500, 9000], '最終確認位置が残る');
});

// ---------- 第 3.1 段階: 艦種・ステータス・攻撃パターン (3.0 の艦種・艦載機・バフを含む) ----------

// 艦種のデータを持ったテスト用の艦隊。special を渡すと特殊攻撃を変えられる (駆逐艦は既定でⅠ型)。HP は試合と同じく耐久の 10 倍 (第 4.0 段階)
function ship(type, over){
  const t = L.SHIP_TYPES[type];
  const cls = L.FLEET_CLASSES.find(c => c.role === type);
  const extra = type === 'carrier' ? {recon: {next: 0}} : {};
  return fleet(Object.assign({role: type, type: cls.name, special: cls.special, stats: Object.assign({}, t.stats), hitRadius: t.hitRadius,
    ships: t.stats.hp * L.HP_SCALE, maxShips: t.stats.hp * L.HP_SCALE, charge: 0, boost: 0, lockId: null}, extra, over));
}
// テスト用の弾 (火力 fp、攻撃力の倍率 mult、会心率 crit、命中率 hitChance (null なら相手の回避で決まる))
function shot(over){
  return Object.assign({id: 1, kind: 'shot', team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, heading: 0, range: 450, life: L.SHOT_LIFE,
    fp: 100, mult: 1, crit: 0.05, hitChance: null, evasionCut: 0}, over);
}

test('艦種: ステータス (耐久・火力・装甲・回避・対空・索敵・射程・速力)・武器・再装填・大きさ', () => {
  const T = L.SHIP_TYPES;
  assert.deepEqual(Object.keys(T), ['battleship', 'carrier', 'cruiser', 'destroyer']);
  assert.deepEqual(Object.values(T).map(t => t.stats), [
    {hp: 100, firepower: 120, armor: 85, evasion: 15, antiAir: 40, sensor: 500, range: 'long', speed: 'slow'},
    {hp: 70, firepower: 50, armor: 40, evasion: 40, antiAir: 60, sensor: 800, range: 'veryLong', speed: 'fast'},
    {hp: 50, firepower: 55, armor: 50, evasion: 60, antiAir: 40, sensor: 600, range: 'medium', speed: 'fast'},
    {hp: 30, firepower: 20, armor: 20, evasion: 85, antiAir: 50, sensor: 900, range: 'short', speed: 'fastPlus'}
  ]);
  assert.deepEqual(L.RANGES, {short: 300, medium: 450, long: 650, veryLong: 1200});
  assert.deepEqual(Object.values(T).map(t => [t.weapon.kind, t.weapon.interval]), [['gun', 4], ['bomber', 5], ['gun', 2], ['gun', 1.5]]);
  assert.deepEqual(Object.values(T).map(t => [t.size, t.hitRadius]), [['large', 28], ['large', 28], ['medium', 18], ['small', 10]]);
  for(const t of Object.values(T)) assert.ok(t.name && t.description);
});

test('編成: 戦艦 (旗艦)・空母・巡洋艦・駆逐艦Ⅰ型・駆逐艦Ⅱ型。艦隊の名前は艦種の名前。敵味方とも同じ', () => {
  assert.deepEqual(L.FORMATION, ['battleship', 'carrier', 'cruiser', 'destroyer', 'destroyer']);
  assert.deepEqual(L.FLEET_CLASSES.map(c => [c.role, c.name, c.special]), [
    ['battleship', '戦艦', 'salvo'], ['carrier', '空母', null], ['cruiser', '巡洋艦', 'boost'], ['destroyer', '駆逐艦Ⅰ型', 'precision'], ['destroyer', '駆逐艦Ⅱ型', 'torpedo']
  ]);
  const g = L.createGame();
  for(const team of ['blue', 'red']){
    const by = n => g.fleets.find(f => f.id === team + n);
    const side = team === 'blue' ? '味方' : '敵';
    assert.deepEqual([1, 2, 3, 4, 5].map(n => by(n).name), ['戦艦', '空母', '巡洋艦', '駆逐艦Ⅰ型', '駆逐艦Ⅱ型'].map(s => side + s));
    assert.deepEqual([1, 2, 3, 4, 5].map(n => by(n).type), ['戦艦', '空母', '巡洋艦', '駆逐艦Ⅰ型', '駆逐艦Ⅱ型']);
    assert.deepEqual([1, 2, 3, 4, 5].map(n => by(n).flagship), [true, false, false, false, false]);
    for(const n of [1, 2, 3, 4, 5]){
      const t = L.SHIP_TYPES[by(n).role];
      assert.deepEqual(by(n).stats, t.stats);
      assert.notEqual(by(n).stats, t.stats, '艦隊ごとの写し');
      assert.deepEqual([by(n).ships, by(n).maxShips, by(n).charge, by(n).boost, by(n).lockId], [t.stats.hp * L.HP_SCALE, t.stats.hp * L.HP_SCALE, 0, 0, null]);
      assert.equal(by(n).hitRadius, t.hitRadius);
      assert.deepEqual(by(n).weapons, {fire: true});
    }
  }
});

test('出撃位置: 各チームから見て左から第 4 (駆逐Ⅰ)・第 3 (巡洋)・第 1 (戦艦)・第 2 (空母)・第 5 (駆逐Ⅱ)', () => {
  const g = L.createGame();
  const xs = team => [4, 3, 1, 2, 5].map(n => g.fleets.find(f => f.id === team + n).x);
  assert.deepEqual(xs('blue'), [6400, 7200, 8000, 8800, 9600]);
  assert.deepEqual(xs('red'), [9600, 8800, 8000, 7200, 6400]);
});

test('自機の選択: 番号で艦種が決まる (省略時は第 1 艦隊 = 戦艦)。名前を指定しなければ艦種の名前', () => {
  const me = g => g.fleets.find(f => f.isPlayer);
  assert.deepEqual([me(L.createGame()).id, me(L.createGame()).type, me(L.createGame()).name], ['blue1', '戦艦', '味方戦艦']);
  for(const [no, type] of [[2, '空母'], [3, '巡洋艦'], [4, '駆逐艦Ⅰ型'], [5, '駆逐艦Ⅱ型']]){
    const g = L.createGame({playerSlot: no});
    assert.deepEqual([me(g).id, me(g).type, me(g).name, me(g).flagship], ['blue' + no, type, '味方' + type, false]);
  }
  assert.equal(me(L.createGame({playerSlot: 3, playerName: 'ヤマト'})).name, 'ヤマト');
});

test('索敵: 索敵の値がそのまま索敵距離 (戦艦 500 / 空母 800 / 巡洋艦 600 / 駆逐艦 900)', () => {
  assert.deepEqual(Object.keys(L.SHIP_TYPES).map(type => L.sensorRange(ship(type))), [500, 800, 600, 900]);
  const dd = ship('destroyer', {id: 'd', x: 0, y: 0});
  const bb = ship('battleship', {id: 'b', x: 0, y: 5000});
  const e1 = ship('cruiser', {id: 'e1', team: 'red', x: 699, y: 0});
  const e2 = ship('cruiser', {id: 'e2', team: 'red', x: 501, y: 5000});
  assert.deepEqual(L.visibleEnemies([dd, bb, e1, e2], 'blue').map(f => f.id), ['e1'], '艦ごとの索敵範囲で見える');
});

test('ロックオン: 見えている敵に狙いを定め (攻撃命令の相手を優先)、索敵範囲と射程の長いほうの外に出るまで続ける', () => {
  const cr = ship('cruiser', {id: 'c'});
  const near = ship('destroyer', {id: 'n', team: 'red', x: 300, y: 0});
  const far = ship('destroyer', {id: 'f', team: 'red', x: 550, y: 0});
  const out = ship('destroyer', {id: 'o', team: 'red', x: 700, y: 0});
  assert.equal(L.lockRange(cr), 600);
  assert.equal(L.lockTarget(cr, [near, far, out]).id, 'n');
  assert.equal(cr.lockId, 'n');
  assert.equal(L.lockTarget(Object.assign(cr, {lockId: null, order: {type: 'attack', targetId: 'f'}}), [near, far, out]).id, 'f');
  assert.equal(L.lockTarget(ship('cruiser'), [out]), null);
  // 空母 (射程 1200 > 索敵 800): 一度ロックオンした敵は、見えなくなっても射程 1200 の外に出るまで狙い続ける
  const cv = ship('carrier', {id: 'v'});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 700, y: 0});
  assert.equal(L.lockTarget(cv, [e]).id, 'e');
  e.x = 1150;
  assert.equal(L.lockTarget(cv, []).id, 'e', '見えていなくても射程の中なら続ける');
  e.x = 1201;
  assert.equal(L.lockTarget(cv, []), null, '射程の外に出たら解除');
  assert.equal(cv.lockId, null);
  const hidden = ship('cruiser', {id: 'h', team: 'red', x: 700, y: 0});
  L.lockTarget(cv, [hidden]);
  hidden.stealth = 5;
  assert.equal(L.lockTarget(cv, []), null, '透明化したら解除');
});

test('通常攻撃 (砲): 射程に入ったら二段攻撃 (2 発目は 0.2 秒後)。再装填 (戦艦 4 秒 / 巡洋艦 2 秒 / 駆逐艦 1.5 秒) まで次は撃たない', () => {
  const b = ship('cruiser', {id: 'b'});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 500, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0.1, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 0);
  assert.deepEqual(g.locks, [{from: 'b', to: 'r', team: 'blue', firing: false}]);
  r.x = 400;
  L.fireWeapons(g, 0.1, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 1);
  const p = g.projectiles[0];
  assert.deepEqual([p.kind, p.from, p.targetId, p.range, p.fp, p.mult, p.crit, p.hitChance], ['shot', 'b', 'r', 450, 55, 1, 0.05, null]);
  L.fireWeapons(g, 0.1, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 1, '2 発目はまだ');
  L.fireWeapons(g, 0.1, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 2, '0.2 秒後に 2 発目');
  L.fireWeapons(g, 1.7, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 2, '再装填 2 秒がまだ (撃ってから 1.9 秒)');
  L.fireWeapons(g, 0.1, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 3);
});

test('通常攻撃: FIRE がオフなら撃たない (狙いは定める)', () => {
  const b = ship('cruiser', {id: 'b', weapons: {fire: false}});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 300, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0.1, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.locks.length, 1);
});

test('射程: 弾は目標を追いかけ、目標が撃った艦の射程の外に出たら、その地点で消える', () => {
  const b = ship('cruiser', {id: 'b', x: 0, y: 0});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 300, y: 200});
  const g = game([b, r]);
  g.projectiles.push(shot({x: 0, y: 0}));
  const damage = new Map();
  for(let i = 0; i < 120 && g.projectiles.length; i++){ r.y += 1; L.moveProjectiles(g, 1 / 60, damage, seq(0.01)); }
  assert.equal(g.projectiles.length, 0);
  assert.ok(damage.get(r) > 0, '射程の中なら追いかけて届く');
  const g2 = game([b, Object.assign(r, {x: 460, y: 0})]);
  g2.projectiles.push(shot({x: 0, y: 0}));
  L.moveProjectiles(g2, 1 / 60, new Map(), seq(0.01));
  assert.equal(g2.projectiles.length, 0, '射程 (450) の外なので消えた');
  assert.ok(g2.events.some(e => e.type === 'fizzle'));
});

test('命中率: 100% − 回避% (戦艦 85% / 空母 60% / 巡洋艦 40% / 駆逐艦 15%)。巡洋艦の強化中の弾は敵の回避 −40 (0 未満にはしない)', () => {
  assert.equal(L.resolveHit(shot({evasionCut: 40}), ship('destroyer'), seq(0.549)).hit, true, '回避 85 − 40 = 45 → 命中率 55%');
  assert.equal(L.resolveHit(shot({evasionCut: 40}), ship('destroyer'), seq(0.55)).hit, false);
  assert.equal(L.resolveHit(shot({evasionCut: 40}), ship('battleship'), seq(0.999)).hit, true, '回避 15 − 40 → 0 → 命中率 100%');
  assert.deepEqual(Object.keys(L.SHIP_TYPES).map(type => Math.round(L.hitChance(ship(type)) * 100) / 100), [0.85, 0.6, 0.4, 0.15]);
  const dd = ship('destroyer');
  assert.equal(L.resolveHit(shot(), dd, seq(0.149)).hit, true);
  assert.equal(L.resolveHit(shot(), dd, seq(0.15)).hit, false);
  assert.equal(L.resolveHit(shot({hitChance: 1}), dd, seq(0.99)).hit, true, '回避を無視する攻撃');
  assert.equal(L.resolveHit(shot({hitChance: 0.7}), dd, seq(0.69)).hit, true);
  assert.equal(L.resolveHit(shot({hitChance: 0.7}), dd, seq(0.7)).hit, false);
});

test('期待ダメージ (AI の狙いの判断用): 通常攻撃 1 発の 命中率 × ダメージ。0 以下ならかすり (今の HP の 10%、最低 1)。会心は数えない', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(L.expectedDamage(ship('battleship'), ship('battleship')), 0.85 * 65), '戦艦 → 戦艦: floor(125 − 59.5) = 65、命中 85%');
  assert.ok(near(L.expectedDamage(ship('cruiser'), ship('battleship')), 0.85 * 100), '巡洋艦 → 戦艦: floor(60 − 59.5) = 0 → かすり 1000 × 10%');
  assert.ok(near(L.expectedDamage(ship('cruiser'), ship('carrier')), 0.6 * 32), '巡洋艦 → 空母: floor(60 − 28) = 32、命中 60%');
  assert.ok(near(L.expectedDamage(ship('carrier'), ship('destroyer')), 41), '爆撃機は回避できない: floor(55 − 14) = 41');
  assert.ok(near(L.expectedDamage(ship('cruiser', {boost: 5}), ship('destroyer')), 0.55 * 73), '強化中: 火力 82.5、命中 +40%');
  assert.ok(near(L.expectedDamage(ship('battleship', {ships: 200}), ship('carrier')), 0.6 * 22), '大破 (× 0.4): floor(50 − 28) = 22');
  assert.ok(near(L.expectedDamage(ship('cruiser'), ship('battleship', {ships: 5})), 0.85 * 1), 'かすりは最低 1');
});

test('ダメージ: (火力 + 5) − 装甲 × 0.7 を切り捨て。会心 (5%) は 火力 × 1.5 + 5 − 装甲 × 0.7', () => {
  const t = ship('cruiser'); // 装甲 50 → 35
  // 乱数の順: 命中 → 会心 → (かすりなら HP) → 空母の弱点
  assert.equal(L.resolveHit(shot({fp: 55}), t, seq(0, 0.5)).damage, 55 + 5 - 35);
  const crit = L.resolveHit(shot({fp: 55}), t, seq(0, 0.04));
  assert.deepEqual([crit.critical, crit.damage], [true, Math.floor(55 * 1.5 + 5 - 35)]);
  assert.equal(L.resolveHit(shot({fp: 55}), t, seq(0, 0.05)).critical, false);
  assert.equal(L.resolveHit(shot({fp: 55, crit: 0.2}), t, seq(0, 0.19)).critical, true, '会心率は弾ごと (巡洋艦の強化中は 20%)');
  assert.equal(L.resolveHit(shot({fp: 55, mult: 0.7}), t, seq(0, 0.5)).damage, Math.floor(60 * 0.7 - 35), '中破・大破・バフの倍率は (火力 + 5) に掛ける');
});

test('ダメージ: 0 以下ならかすり (今の HP の 5〜15%、切り捨て。最低 1)', () => {
  const t = ship('battleship', {ships: 80}); // 装甲 85 → 59.5
  const r = L.resolveHit(shot({fp: 20}), t, seq(0, 0.5, 0.5));
  assert.equal(r.scratch, true);
  assert.equal(r.damage, Math.floor(80 * (0.05 + 0.5 * 0.1)));
  assert.equal(L.resolveHit(shot({fp: 20}), t, seq(0, 0.5, 0)).damage, 4);
  assert.equal(L.resolveHit(shot({fp: 20}), ship('battleship', {ships: 3}), seq(0, 0.5, 0)).damage, 1, '最低 1');
});

test('攻撃の倍率: 中破 (HP 5 割以下) で × 0.7、大破 (2.5 割以下) で × 0.4、バフで × 1.2。損傷の状態は 7.5 割未満で小破', () => {
  const m = over => L.attackMultiplier(ship('cruiser', Object.assign({maxShips: 100}, over)));
  assert.equal(m({ships: 100}), 1);
  assert.equal(m({ships: 51}), 1);
  assert.equal(m({ships: 50}), 0.7);
  assert.equal(m({ships: 25}), 0.4);
  assert.ok(Math.abs(m({ships: 100, buffed: true}) - 1.2) < 1e-9);
  assert.deepEqual([75, 74, 50, 25].map(hp => L.damageState(ship('cruiser', {ships: hp, maxShips: 100}))), ['none', 'minor', 'moderate', 'heavy']);
});

test('即死耐性: 1 回の攻撃で、HP 満タンから 0 にはならず 1 で耐える (満タンでなければ沈む)', () => {
  const run = ships => {
    const b = ship('battleship', {id: 'b', x: 0, y: 0});
    const r = ship('destroyer', {id: 'r', team: 'red', x: 300, y: 0, ships, maxShips: 30}); // 最大 HP 30 (1 発で沈む大きさ)
    const g = game([b, r]);
    g.projectiles.push(shot({x: 290, y: 0, fp: 120, range: 650}));
    const damage = new Map();
    L.moveProjectiles(g, 1 / 60, damage, seq(0.01, 0.5));
    return r.ships - damage.get(r);
  };
  assert.equal(run(30), 1);
  assert.ok(run(29) <= 0);
});

test('空母の弱点: 攻撃を受けたとき 15% の確率でダメージが 2 倍 (ほかの艦種はならない)', () => {
  const cv = ship('carrier', {id: 'v'});
  const normal = L.resolveHit(shot({fp: 100}), cv, seq(0, 0.5, 0.2));
  const weak = L.resolveHit(shot({fp: 100}), cv, seq(0, 0.5, 0.14));
  assert.equal(normal.weakness, false);
  assert.equal(weak.weakness, true);
  assert.equal(weak.damage, normal.damage * 2);
  assert.equal(L.resolveHit(shot({fp: 100}), ship('cruiser'), seq(0, 0.5, 0)).weakness, false);
});

test('爆撃機: 空母は射程 1200 以内のロックオンした敵に、5 秒ごとに爆撃機を 1 機出す', () => {
  const cv = ship('carrier', {id: 'v', x: 1000, y: 3000});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 1000, y: 2000}); // 距離 1000 (空母の索敵 800 の外。味方が見つけた敵)
  const g = game([cv, e]);
  L.fireWeapons(g, 0.1, {blue: [e], red: []});
  assert.equal(g.aircraft.length, 1);
  const a = g.aircraft[0];
  assert.deepEqual([a.kind, a.team, a.from, a.targetId, a.life, a.fp, a.range, a.hitChance], ['bomber', 'blue', 'v', 'e', L.BOMBER_LIFE, 50, 1200, 1]);
  assert.equal(g.projectiles.length, 0, '空母は弾を撃たない');
  L.fireWeapons(g, 4.8, {blue: [e], red: []});
  assert.equal(g.aircraft.length, 1, '二段攻撃ではない');
  L.fireWeapons(g, 0.2, {blue: [e], red: []});
  assert.equal(g.aircraft.length, 2);
});

test('爆撃機: 目標へ向かい、届いたら爆撃して (回避できない) 消える。曲がる速さに限りがあり、BOMBER_LIFE 秒で消える。目標が射程の外に出たら消える', () => {
  const cv = ship('carrier', {id: 'v'});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 300, y: 0});
  const g = game([cv, e]);
  g.aircraft.push({id: 5, kind: 'bomber', team: 'blue', from: 'v', targetId: 'e', x: 0, y: 0, heading: 0, life: L.BOMBER_LIFE, fp: 50, mult: 1, crit: 0.05, hitChance: null, range: 1200});
  const damage = new Map();
  for(let i = 0; i < 120 && g.aircraft.length; i++) L.moveAircraft(g, 1 / 60, damage, seq(0.01));
  assert.equal(g.aircraft.length, 0);
  assert.ok(damage.get(e) > 0);
  const back = game([cv, ship('cruiser', {id: 'e', team: 'red', x: -300, y: 0})]);
  back.aircraft.push({id: 6, kind: 'bomber', team: 'blue', from: 'v', targetId: 'e', x: 0, y: 0, heading: 0, life: L.BOMBER_LIFE, fp: 50, mult: 1, crit: 0.05, hitChance: null, range: 1200});
  L.moveAircraft(back, 0.1, new Map(), seq(0.9));
  assert.ok(Math.abs(back.aircraft[0].heading) <= L.BOMBER_TURN_RATE * 0.1 + 1e-9, '一度に曲がれる角度に限りがある');
  const gone = game([cv, ship('cruiser', {id: 'e', team: 'red', x: 1300, y: 0})]);
  gone.aircraft.push({id: 7, kind: 'bomber', team: 'blue', from: 'v', targetId: 'e', x: 0, y: 0, heading: 0, life: L.BOMBER_LIFE, fp: 50, mult: 1, crit: 0.05, hitChance: null, range: 1200});
  L.moveAircraft(gone, 0.1, new Map(), seq(0.9));
  assert.equal(gone.aircraft.length, 0, '射程の外');
});

test('偵察機: 空母は 20 秒ごとに 1 機を、進行方向の左右 15° の範囲へ自動で出す。まっすぐ飛び、40 秒かマップの外で消える', () => {
  const cv = ship('carrier', {id: 'v', x: 5000, y: 10000, heading: -Math.PI / 2});
  const g = game([cv, ship('cruiser', {id: 'far', team: 'red', x: 100, y: 100})]);
  L.step(g, 0.1, seq(0));
  const recon = () => g.aircraft.filter(a => a.kind === 'recon');
  assert.equal(recon().length, 1);
  assert.ok(Math.abs(recon()[0].heading + Math.PI / 2 + Math.PI / 12) < 1e-9);
  for(let i = 0; i < 199; i++) L.step(g, 0.1, seq(0.5));
  assert.equal(recon().length, 2, '20 秒で 2 機目');
  const plane = recon()[1];
  const y0 = plane.y;
  L.step(g, 0.1, seq(0.5));
  assert.ok(Math.abs(plane.y - (y0 - L.RECON_SPEED * 0.1)) < 1e-6);
  const edge = game([ship('cruiser', {id: 'e', team: 'red', x: 100, y: 50})]);
  edge.aircraft.push({id: 1, kind: 'recon', team: 'blue', from: 'v', x: 100, y: 100, heading: -Math.PI / 2, life: L.RECON_LIFE, sensor: 400});
  L.moveAircraft(edge, 1, new Map(), seq(0.9));
  assert.equal(edge.aircraft.length, 0, 'マップの外');
});

test('偵察機: 索敵範囲は空母の索敵の半分 (400)。見つけた敵は味方全員に共有される', () => {
  const g = game([ship('carrier', {id: 'v', x: 5000, y: 10000}), ship('cruiser', {id: 'far', team: 'red', x: 100, y: 100})]);
  L.step(g, 0.01, seq(0.5));
  assert.equal(g.aircraft[0].sensor, 400);
  const me = ship('cruiser', {id: 'me', x: 100, y: 100});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 5000, y: 5400});
  const plane = {id: 1, kind: 'recon', team: 'blue', x: 5000, y: 5000, heading: 0, life: 10, sensor: 400};
  assert.deepEqual(L.visibleEnemies([me, e], 'blue', false, false, [plane]).map(f => f.id), ['e']);
  e.y = 5401;
  assert.deepEqual(L.visibleEnemies([me, e], 'blue', false, false, [plane]).map(f => f.id), []);
  assert.deepEqual(L.visibleEnemies([me, e], 'red', false, false, [plane]).map(f => f.id), [], '相手の偵察機は自分の目にならない');
});

test('対空射撃: 全艦種が、400 以内の敵の艦載機を 0.5 秒ごとに撃ち、対空% で撃ち落とす。よけた機体は免疫がつき、もう撃たれない', () => {
  const plane = () => ({id: 1, kind: 'recon', team: 'blue', x: 300, y: 0, heading: 0, life: 10, sensor: 400});
  for(const type of Object.keys(L.SHIP_TYPES)){
    const chance = L.SHIP_TYPES[type].stats.antiAir / 100;
    assert.equal(L.antiAirChance(ship(type)), chance);
    const g = game([ship(type, {id: 'r', team: 'red'})]);
    g.aircraft.push(plane());
    L.antiAir(g, 0.1, seq(chance - 0.001));
    assert.equal(g.aircraft.length, 0, type);
  }
  const g = game([ship('destroyer', {id: 'r', team: 'red'}), ship('destroyer', {id: 'r2', team: 'red'})]);
  g.aircraft.push(plane());
  L.antiAir(g, 0.1, seq(0.99, 0));
  assert.equal(g.aircraft.length, 1, 'よけた');
  assert.equal(g.aircraft[0].immune, true);
  L.antiAir(g, 1, seq(0));
  assert.equal(g.aircraft.length, 1, '免疫がついた機体は撃ち落とせない');
  const far = game([ship('destroyer', {id: 'r', team: 'red'})]);
  far.aircraft.push(Object.assign(plane(), {x: 401}));
  L.antiAir(far, 0.1, seq(0));
  assert.equal(far.aircraft.length, 1, '400 より遠い');
  const own = game([ship('destroyer', {id: 'b'})]);
  own.aircraft.push(plane());
  L.antiAir(own, 0.1, seq(0));
  assert.equal(own.aircraft.length, 1, '味方の艦載機は撃たない');
});

test('NP (特殊攻撃のゲージ): たまる速さは艦種ごと (毎秒 戦艦 +0.23 / 巡洋艦 +2.6 / 駆逐艦 +3.7、与えたダメージ 1 につき 戦艦 0.02 / 巡洋艦 0.1 / 駆逐艦 0.2。第 4.1 段階: マップと速さに合わせて調整)。満タン 100。空母にはない', () => {
  assert.equal(L.CHARGE_MAX, 100);
  assert.deepEqual(Object.values(L.SHIP_TYPES).map(t => t.npPerDamage), [0.02, 0, 0.1, 0.2], '与えたダメージでたまる速さも艦種ごと');
  assert.deepEqual(Object.values(L.SHIP_TYPES).map(t => t.npPerSecond), [0.23, 0, 2.6, 3.7]);
  const b = ship('cruiser', {id: 'b', x: 0, y: 0});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 5000, y: 5000});
  const cv = ship('carrier', {id: 'v', x: 100, y: 0});
  const bb = ship('battleship', {id: 'bb', x: 0, y: 3000});
  const g = game([b, r, cv, bb]);
  L.step(g, 2, seq(0.5));
  assert.deepEqual([bb.charge, b.charge, r.charge, cv.charge], [0.46, 5.2, 7.4, 0]);
  b.charge = 98;
  L.step(g, 1, seq(0.5));
  assert.equal(b.charge, 100);
  const h = game([ship('cruiser', {id: 'b', x: 0, y: 0}), ship('destroyer', {id: 'r', team: 'red', x: 290, y: 0})]);
  h.projectiles.push(shot({x: 280, y: 0, fp: 55}));
  L.step(h, 0.01, seq(0.01, 0.5, 0.5));
  const dealt = h.events.find(e => e.type === 'hit').damage;
  assert.ok(Math.abs(h.fleets[0].charge - (0.026 + dealt * 0.1)) < 1e-9, '与えたダメージの分たまる (巡洋艦は 1 につき 0.1。時間の分は毎秒 +2.6)');
});

test('特殊攻撃: ゲージが満たないと使えない。使うと 0 に戻り、出来事 special を記録', () => {
  const b = ship('destroyer', {id: 'b', x: 0, y: 0, charge: 99});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 200, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0, {blue: [r], red: []});
  assert.equal(L.useSpecial(g, b), false);
  b.charge = 100;
  assert.equal(L.useSpecial(g, b), true);
  assert.equal(b.charge, 0);
  assert.ok(g.events.some(e => e.type === 'special' && e.kind === 'precision' && e.from === 'b'));
  assert.equal(L.useSpecial(g, ship('carrier', {charge: 100})), false, '空母には特殊攻撃がない');
});

test('特殊攻撃 (駆逐艦Ⅰ型) 精密射撃: 火力 100 の単発弾。回避を無視して必ず当たる。狙いが特殊攻撃の射程の外なら使えない', () => {
  const b = ship('destroyer', {id: 'b', x: 0, y: 0, charge: 100});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 500, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0, {blue: [r], red: []});
  assert.equal(L.useSpecial(g, b), false, '特殊攻撃の射程 450 の外');
  r.x = 200;
  L.fireWeapons(g, 0, {blue: [r], red: []});
  const before = g.projectiles.length;
  assert.equal(L.useSpecial(g, b), true);
  const p = g.projectiles.slice(before);
  assert.deepEqual(p.map(x => [x.kind, x.fp, x.hitChance]), [['shot', 100, 1]]);
});

test('特殊攻撃 (駆逐艦Ⅱ型) 魚雷: 火力 100 の二連攻撃 (2 発目は 0.2 秒後)。回避を無視し、命中率 70%', () => {
  const b = ship('destroyer', {id: 'b', x: 0, y: 0, charge: 100, special: 'torpedo'});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 200, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0, {blue: [r], red: []});
  const before = g.projectiles.length;
  assert.equal(L.useSpecial(g, b), true);
  L.fireWeapons(g, 0.2, {blue: [r], red: []});
  const torps = g.projectiles.filter(x => x.kind === 'torpedo');
  assert.deepEqual(torps.map(x => [x.fp, x.hitChance]), [[100, 0.7], [100, 0.7]]);
  assert.ok(g.projectiles.length >= before + 2);
});

test('特殊行動 (巡洋艦) 強化: 15 秒間、火力・装甲・速力が 1.5 倍、会心率 20%、命中率 +40% (敵の回避 −40)', () => {
  assert.deepEqual(Object.values(L.SPECIALS).map(s => s.category), ['attack', 'action', 'attack', 'attack']);
  const c = ship('cruiser', {id: 'c', charge: 100});
  const g = game([c]);
  assert.equal(L.useSpecial(g, c), true);
  assert.equal(c.boost, L.BOOST_DURATION);
  assert.equal(L.BOOST_DURATION, 15);
  assert.equal(L.firepowerOf(c), 55 * 1.5);
  assert.equal(L.armorOf(c), 50 * 1.5);
  assert.equal(L.speedOf(c), L.maxSpeed(c.stats) * 1.5);
  assert.equal(L.critChanceOf(c), 0.2);
  const r = ship('cruiser', {id: 'r', team: 'red', x: 300, y: 0});
  const g2 = game([c, r]);
  L.fireWeapons(g2, 0, {blue: [r], red: []});
  assert.deepEqual([g2.projectiles[0].fp, g2.projectiles[0].crit, g2.projectiles[0].evasionCut], [55 * 1.5, 0.2, 40]);
  L.step(g2, 15, seq(0.99));
  assert.equal(c.boost, 0);
  assert.deepEqual([L.firepowerOf(c), L.armorOf(c), L.critChanceOf(c), L.evasionCutOf(c)], [55, 50, 0.05, 0]);
});

test('特殊攻撃 (戦艦) 全艦一斉射撃: 射程の中の敵を狙っている味方の全艦が、火力 100 の攻撃を 5 回ずつ (0.2 秒おき)。空母は爆撃機', () => {
  const bb = ship('battleship', {id: 'bb', x: 0, y: 0, charge: 100});
  const cr = ship('cruiser', {id: 'cr', x: 2000, y: 0});
  const cv = ship('carrier', {id: 'cv', x: 0, y: 3000});
  const idle = ship('destroyer', {id: 'dd', x: 9000, y: 9000});
  const e1 = ship('cruiser', {id: 'e1', team: 'red', x: 500, y: 0});
  const e2 = ship('cruiser', {id: 'e2', team: 'red', x: 2300, y: 0});
  const e3 = ship('cruiser', {id: 'e3', team: 'red', x: 0, y: 2000});
  const g = game([bb, cr, cv, idle, e1, e2, e3]);
  L.fireWeapons(g, 0, {blue: [e1, e2, e3], red: []});
  g.projectiles = []; g.aircraft = []; g.pending = [];
  assert.equal(L.useSpecial(g, bb), true);
  for(let i = 0; i < 5; i++) L.fireWeapons(g, i === 0 ? 0 : 0.2, {blue: [e1, e2, e3], red: []});
  const hi = g.projectiles.filter(p => p.fp === 100);
  assert.equal(hi.filter(p => p.from === 'bb').length, 5);
  assert.equal(hi.filter(p => p.from === 'cr').length, 5);
  assert.equal(g.aircraft.filter(a => a.fp === 100 && a.from === 'cv' && a.hitChance === 1).length, 5, '爆撃機は回避できない');
  assert.equal(hi.filter(p => p.from === 'dd').length, 0, '狙いのない艦は撃たない');
  assert.equal(L.useSpecial(game([ship('battleship', {charge: 100})]), g.fleets[0]), false, '誰も狙っていなければ使えない');
});

test('特殊行動 (AI): 巡洋艦の強化は、NP 満タンで何かにロックオンしていれば使う (射程の外でも)', () => {
  const c = ship('cruiser', {id: 'c', x: 0, y: 0, charge: 100});
  const r = ship('battleship', {id: 'r', team: 'red', x: 550, y: 0, flagship: true});
  const g = game([c, r]);
  g.controllers = {blue: () => null, red: null};
  L.step(g, 0.01, seq(0.99));
  assert.ok(c.boost > 0, '射程 450 の外、索敵 600 の中');
  const alone = ship('cruiser', {id: 'c2', x: 0, y: 0, charge: 100});
  const g2 = game([alone, ship('battleship', {id: 'r', team: 'red', x: 5000, y: 0, flagship: true})]);
  g2.controllers = {blue: () => null, red: null};
  L.step(g2, 0.01, seq(0.99));
  assert.equal(alone.boost, 0, 'ロックオンしていなければ使わない');
});

test('特殊攻撃 (AI): 満タンで使える相手がいれば、AI の艦隊は自動で使う。プレイヤー艦隊は自動では使わない', () => {
  const ai = ship('destroyer', {id: 'a', x: 0, y: 0, charge: 100});
  const me = ship('destroyer', {id: 'm', x: 0, y: 100, charge: 100, isPlayer: true});
  const r = ship('battleship', {id: 'r', team: 'red', x: 200, y: 0, flagship: true});
  const g = game([ai, me, r]);
  g.controllers = {blue: () => null, red: null};
  L.step(g, 0.01, seq(0.99));
  assert.equal(ai.charge < 1, true, 'AI は使った');
  assert.ok(me.charge >= 100, 'プレイヤーは使わない');
});

test('特殊攻撃の自動使用 (プレイヤー): autoSpecial がオンなら、AI と同じ条件で自動で使う (第 3.3 段階)', () => {
  const me = ship('destroyer', {id: 'm', x: 0, y: 100, charge: 100, isPlayer: true, autoSpecial: true});
  const r = ship('battleship', {id: 'r', team: 'red', x: 200, y: 0, flagship: true});
  const g = game([me, r]);
  L.step(g, 0.01, seq(0.99));
  assert.ok(me.charge < 1, 'オンなら使う (controllers がなくても)');
  const cr = ship('cruiser', {id: 'c', x: 0, y: 0, charge: 100, isPlayer: true, autoSpecial: true});
  const g2 = game([cr, ship('destroyer', {id: 'far', team: 'red', x: 5000, y: 5000})]);
  L.step(g2, 0.01, seq(0.99));
  assert.equal(cr.boost, 0, '巡洋艦の強化は、何かにロックオンしているときだけ (AI と同じ)');
  assert.equal(L.createGame().fleets.find(f => f.isPlayer).autoSpecial, false, '初めはオフ');
});

test('出来事: 砲撃・爆撃機・偵察機の射出、命中、撃墜、全滅が記録される', () => {
  const b = ship('battleship', {id: 'b', flagship: true, isPlayer: true});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 200, y: 0, ships: 1, flagship: true});
  const g = game([b, r]);
  L.step(g, 1 / 60, seq(0.01));
  const fire = g.events.find(e => e.type === 'fire');
  assert.deepEqual([fire.kind, fire.team, fire.size], ['gun', 'blue', 'large']);
  for(let i = 0; i < 60 && !g.outcome; i++) L.step(g, 1 / 60, seq(0.01));
  assert.equal(g.outcome, 'win');
  const cv = ship('carrier', {id: 'v', x: 5000, y: 10000});
  const g2 = game([cv, ship('cruiser', {id: 'far', team: 'red', x: 100, y: 100})]);
  L.step(g2, 0.1, seq(0.5));
  assert.equal(g2.events.filter(e => e.type === 'launch').length, 1);
  const g3 = game([ship('carrier', {id: 'v', x: 5000, y: 10000, recon: {next: 999}}), ship('destroyer', {id: 'd', team: 'red', x: 5000, y: 9800})]);
  g3.aircraft.push({id: 9, kind: 'recon', team: 'blue', from: 'v', x: 5000, y: 9900, heading: 0, life: 10, sensor: 400});
  L.step(g3, 0.01, seq(0));
  assert.ok(g3.events.some(e => e.type === 'intercept' && e.team === 'red'));
});

test('出来事: 命中 (hit) には撃った艦 (from) と与えたダメージ (damage) が入る', () => {
  const b = ship('cruiser', {id: 'b'});
  const t = ship('cruiser', {id: 'r', team: 'red', x: 10, y: 0});
  const g = game([b, t]);
  g.projectiles.push(shot({x: 0, y: 0, from: 'b', fp: 60}));
  const damage = new Map();
  L.moveProjectiles(g, 1 / 60, damage, seq(0.01, 0.5));
  const hit = g.events.find(e => e.type === 'hit');
  assert.equal(hit.from, 'b');
  assert.equal(hit.damage, damage.get(t));
  assert.equal(hit.damage, 65 - 35);
});

test('ゲーム作成: 艦載機は空で始まり、空母には偵察機の射出の予定がある', () => {
  const g = L.createGame();
  assert.deepEqual(g.aircraft, []);
  assert.deepEqual(g.pending, []);
  assert.deepEqual(g.fleets.find(f => f.id === 'blue2').recon, {next: 0});
  assert.equal(g.fleets.find(f => f.id === 'blue1').recon, undefined);
});

test('隠しコマンド stealth: 効果中は自艦隊が敵から見えず、狙われない。自艦隊からは撃てる', () => {
  const me = ship('cruiser', {id: 'me', isPlayer: true, x: 1000, y: 1000});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 1400, y: 1000});
  const g = game([me, e]);
  L.applyCommand(g, 'stealth');
  assert.equal(me.stealth, L.STEALTH_DURATION);
  assert.deepEqual(L.visibleEnemies(g.fleets, 'red', false), []);
  L.step(g, 0.1, seq(0.9));
  assert.equal(g.intel.red.me, undefined, '一度も見ていなければ記録もない');
  assert.ok(!g.locks.some(l => l.from === 'e'), '敵は狙いを定めない');
  assert.ok(g.locks.some(l => l.from === 'me' && l.firing), '自艦隊は撃てる');
});

test('マップの広さ (学習用): setWorld で変えると出撃位置と移動の範囲が変わり、引数なしで本番の広さに戻る', () => {
  try{
    L.setWorld(2500, 5000);
    assert.deepEqual(L.WORLD, {w: 2500, h: 5000});
    const g = L.createGame();
    const xs = [4, 3, 1, 2, 5].map(n => g.fleets.find(f => f.id === 'blue' + n).x);
    const step = 2500 / 6; // 狭いマップでは間隔を詰める (800 と 幅 ÷ 6 の小さいほう)
    xs.forEach((x, i) => assert.ok(Math.abs(x - (1250 + (i - 2) * step)) < 1e-9, String(x)));
    assert.equal(g.fleets.find(f => f.id === 'red1').y, 300);
    assert.equal(g.fleets.find(f => f.id === 'blue1').y, 5000 - 300);
    const f = fleet({x: 2400, y: 100, order: {type: 'move', x: 9999, y: 100}});
    L.moveFleet(f, 10, {});
    assert.equal(f.x, 2500, '広さの端で止まる');
  }finally{
    L.setWorld();
  }
  assert.deepEqual(L.WORLD, {w: 16000, h: 32000});
});

test('移動: 攻撃命令は見えている相手に、自分の射程の内側 (8 割) まで近づいて止まる', () => {
  const f = ship('cruiser', {id: 'c', order: {type: 'attack', targetId: 'e'}});
  const intel = {e: {x: 2000, y: 0, visible: true}};
  for(let i = 0; i < 100; i++) L.moveFleet(f, 0.5, intel);
  assert.ok(Math.abs(f.x - (2000 - 450 * 0.8)) < 1e-6, String(f.x));
});

// ---------- バフ ----------

test('バフ: 空母と巡洋艦は、味方の戦艦から 1000 以内で強化される', () => {
  assert.equal(L.BUFF_RANGE, 1000);
  const bb = ship('battleship', {id: 'bb', x: 0, y: 0, flagship: true});
  const cv = ship('carrier', {id: 'cv', x: 1000, y: 0});
  const cr = ship('cruiser', {id: 'cr', x: 0, y: 1001});
  const dd = ship('destroyer', {id: 'dd', x: 10, y: 0});
  const fleets = [bb, cv, cr, dd];
  assert.equal(L.isBuffed(cv, fleets), true, 'ちょうど 1000 はかかる');
  assert.equal(L.isBuffed(cr, fleets), false, '1000 を超えるとかからない');
  assert.equal(L.isBuffed(dd, fleets), false, '駆逐艦はかからない');
  bb.ships = 0;
  assert.equal(L.isBuffed(cv, fleets), false, '戦艦が全滅したらかからない');
  const enemyBb = ship('battleship', {id: 'e', team: 'red', x: 0, y: 0});
  assert.equal(L.isBuffed(cv, [cv, enemyBb]), false, '敵の戦艦ではかからない');
});

test('バフ: 戦艦は、味方の空母か巡洋艦が 1000 以内にいると強化される (駆逐艦ではかからない)', () => {
  const bb = ship('battleship', {id: 'bb', x: 0, y: 0});
  assert.equal(L.isBuffed(bb, [bb, ship('destroyer', {id: 'dd', x: 10, y: 0})]), false);
  assert.equal(L.isBuffed(bb, [bb, ship('cruiser', {id: 'cr', x: 900, y: 0})]), true);
  assert.equal(L.isBuffed(bb, [bb, ship('carrier', {id: 'cv', x: 0, y: 999})]), true);
  assert.equal(L.isBuffed(bb, [bb, ship('carrier', {id: 'cv', x: 0, y: 999, ships: 0})]), false);
});

test('バフ: 強化中は受けるダメージ ÷ 1.2 (切り捨て)', () => {
  const t = ship('cruiser', {id: 'r', team: 'red'});
  const plain = L.resolveHit(shot({fp: 100}), t, seq(0, 0.5));
  t.buffed = true;
  const buffed = L.resolveHit(shot({fp: 100}), t, seq(0, 0.5));
  assert.equal(buffed.damage, Math.floor(plain.damage / 1.2));
});

test('バフ: 1 ステップごとに付け直す (離れたら外れる)', () => {
  const bb = ship('battleship', {id: 'bb', x: 5000, y: 10000, flagship: true});
  const cr = ship('cruiser', {id: 'cr', x: 5500, y: 10000});
  const far = ship('cruiser', {id: 'far', team: 'red', x: 100, y: 100, flagship: true});
  const g = game([bb, cr, far]);
  L.step(g, 0.01, seq(0.5));
  assert.deepEqual([bb.buffed, cr.buffed, far.buffed], [true, true, false]);
  cr.x = 7000;
  L.step(g, 0.01, seq(0.5));
  assert.deepEqual([bb.buffed, cr.buffed], [false, false]);
});

// ---------- 第 3.8 段階: 戦艦ばかりが狙われる問題 (特殊装甲・射程) ----------

test('特殊装甲: 戦艦だけが持ち、減らす割合 = 50% × 味方の空母・巡洋艦の残り HP の合計 ÷ 最大 HP の合計', () => {
  assert.equal(L.FLAG_ARMOR_MAX, 0.5);
  const bb = ship('battleship', {id: 'bb'});
  const cv = ship('carrier', {id: 'cv'}), cr = ship('cruiser', {id: 'cr'});
  const dd = ship('destroyer', {id: 'dd'});
  const enemyCv = ship('carrier', {id: 'ecv', team: 'red'});
  assert.equal(L.flagArmorOf(bb, [bb, cv, cr, dd]), 0.5, '護衛が満タン');
  cv.ships = 0; cr.ships = 250; // 残り 250 / (700 + 500)
  assert.ok(Math.abs(L.flagArmorOf(bb, [bb, cv, cr, dd]) - 0.5 * 250 / 1200) < 1e-9, '沈んだ護衛は 0 として数える');
  cr.ships = 0;
  assert.equal(L.flagArmorOf(bb, [bb, cv, cr, dd, enemyCv]), 0, '護衛が 2 隻とも沈むと壊れる (敵の空母は数えない)');
  assert.equal(L.flagArmorOf(bb, [bb, dd]), 0, '護衛がいない');
  for(const t of [cv, dd]) assert.equal(L.flagArmorOf(Object.assign(t, {ships: 30}), [bb, cv, cr, dd]), 0, t.role + ' には付かない');
});

test('特殊装甲: 受けるダメージに (1 − 割合) を掛けて切り捨て (かすりも。最低 1)', () => {
  const t = ship('battleship', {id: 'r', team: 'red'});
  const plain = L.resolveHit(shot({fp: 150}), t, seq(0, 0.5));
  t.flagArmor = 0.5;
  assert.equal(L.resolveHit(shot({fp: 150}), t, seq(0, 0.5)).damage, Math.floor(plain.damage * 0.5));
  t.ships = 3; t.flagArmor = 0.9;
  const scratch = L.resolveHit(shot({fp: 10}), t, seq(0, 0.5, 0.5));
  assert.equal(scratch.scratch, true);
  assert.equal(scratch.damage, 1, 'かすりでも最低 1');
});

test('特殊装甲: 1 ステップごとに付け直す。期待ダメージにも入る', () => {
  const bb = ship('battleship', {id: 'bb', x: 5000, y: 10000, flagship: true});
  const cr = ship('cruiser', {id: 'cr', x: 5500, y: 10000});
  const far = ship('cruiser', {id: 'far', team: 'red', x: 100, y: 100, flagship: true});
  const g = game([bb, cr, far]);
  L.step(g, 0.01, seq(0.5));
  assert.equal(bb.flagArmor, 0.5);
  assert.equal(far.flagArmor, 0, '戦艦でなければ 0');
  cr.ships = 250;
  L.step(g, 0.01, seq(0.5));
  assert.equal(bb.flagArmor, 0.25);
  const shooter = ship('cruiser', {id: 's', team: 'red'});
  const bare = L.expectedDamage(shooter, Object.assign({}, bb, {flagArmor: 0}));
  assert.ok(Math.abs(L.expectedDamage(shooter, bb) - bare * 0.75) < 1e-9);
});

test('射程: 駆逐艦の特殊攻撃 (精密射撃・魚雷) の射程は 450。通常攻撃は 300 のまま。ほかの艦種は通常攻撃と同じ', () => {
  assert.equal(L.specialRange(ship('destroyer')), 450);
  assert.equal(L.weaponRange(ship('destroyer')), 300);
  assert.equal(L.specialRange(ship('battleship')), L.weaponRange(ship('battleship')));
});

test('特殊攻撃 (駆逐艦Ⅱ型) 魚雷: 通常攻撃の射程の外でも特殊攻撃の射程の中なら撃て、魚雷は 450 まで消えない', () => {
  const b = ship('destroyer', {id: 'b', x: 0, y: 0, charge: 100, special: 'torpedo'});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 400, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0, {blue: [r], red: []});
  assert.equal(L.useSpecial(g, b), true);
  L.fireWeapons(g, 0.2, {blue: [r], red: []});
  const torps = g.projectiles.filter(x => x.kind === 'torpedo');
  assert.equal(torps.length, 2, '2 発目も出る');
  assert.ok(torps.every(x => x.range === 450));
});

test('射程: 巡洋艦の強化中は射程も 1.5 倍 (中 450 → 675)', () => {
  const cr = ship('cruiser');
  assert.equal(L.weaponRange(cr), 450);
  cr.boost = 5;
  assert.equal(L.weaponRange(cr), 675);
});

test('攻撃命令: 駆逐艦は特殊攻撃が撃てる (NP 満タン) とき、特殊攻撃の射程の 0.8 倍で止まる', () => {
  const b = ship('destroyer', {id: 'b', x: 1000, y: 1000, charge: 100, order: {type: 'attack', targetId: 'r'}});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 1000, y: 1000 - 450 * 0.8 - 5});
  const g = game([b, r]);
  L.moveFleet(b, 1, {r: {x: r.x, y: r.y, visible: true}});
  assert.ok(Math.abs(b.y - (1000 - 5)) < 1e-6, '360 まで近づいて止まる');
});

// ---------- 第 3.9 段階: 特殊攻撃の最終戦ロック ----------

// 最終戦の場面: 青と赤の旗艦 (戦艦) が gap 離れていて、巡洋艦・駆逐艦がいる
function finalGame(gap){
  const bb = ship('battleship', {id: 'bb', x: 5000, y: 10000, flagship: true});
  const cr = ship('cruiser', {id: 'cr', x: 5200, y: 10000});
  const dd = ship('destroyer', {id: 'dd', x: 4800, y: 10000});
  const rb = ship('battleship', {id: 'rb', team: 'red', x: 5000, y: 10000 - gap, flagship: true});
  const g = Object.assign(game([bb, cr, dd, rb]), {finalBattle: false});
  return {g, bb, cr, dd, rb};
}

test('最終戦: 両チームの旗艦どうしが FINAL_BATTLE_DISTANCE (3000) 以内になったら始まり、離れても続く。出来事 finalBattle は 1 回だけ', () => {
  assert.equal(L.FINAL_BATTLE_DISTANCE, 3000);
  const s = finalGame(3100);
  L.step(s.g, 0.01, seq(0.5));
  assert.equal(s.g.finalBattle, false);
  s.rb.y = 10000 - 2990;
  L.step(s.g, 0.01, seq(0.5));
  assert.equal(s.g.finalBattle, true);
  assert.equal(s.g.events.filter(e => e.type === 'finalBattle').length, 1);
  s.rb.y = 10000 - 5000;
  L.step(s.g, 0.01, seq(0.5));
  assert.equal(s.g.finalBattle, true, '離れても続く');
  assert.equal(s.g.events.filter(e => e.type === 'finalBattle').length, 0, '出来事は始まったときだけ');
});

test('最終戦の前: 巡洋艦・駆逐艦は NP がたまらず (時間・与えたダメージとも) 特殊攻撃を使えない。戦艦は今までどおり', () => {
  const s = finalGame(8000);
  L.step(s.g, 1, seq(0.5));
  assert.deepEqual([s.cr.charge, s.dd.charge], [0, 0], '時間でたまらない');
  assert.ok(s.bb.charge > 0, '戦艦はたまる');
  assert.equal(L.specialLocked(s.g, s.cr), true);
  assert.equal(L.specialLocked(s.g, s.dd), true);
  assert.equal(L.specialLocked(s.g, s.bb), false);
  s.cr.charge = 100; s.dd.charge = 100;
  s.cr.lockRef = s.rb; s.cr.lockId = 'rb';
  assert.equal(L.useSpecial(s.g, s.cr), false, 'NP が満タンでも使えない');
  assert.equal(s.cr.boost, 0);
  s.cr.charge = 0;
  const damage = new Map();
  L.applyHit(s.g, damage, {team: 'blue', from: 'cr', fp: 100, mult: 1, crit: 0, hitChance: 1, evasionCut: 0}, s.rb, 'shot', seq(0, 0.5));
  assert.ok(damage.get(s.rb) > 0);
  assert.equal(s.cr.charge, 0, '与えたダメージでもたまらない');
});

test('最終戦のあと: 巡洋艦・駆逐艦も NP がたまり、特殊攻撃を使える', () => {
  const s = finalGame(2000);
  L.step(s.g, 1, seq(0.5));
  assert.equal(s.g.finalBattle, true);
  assert.ok(s.cr.charge > 0 && s.dd.charge > 0);
  assert.equal(L.specialLocked(s.g, s.cr), false);
  s.cr.charge = 100;
  s.cr.lockRef = s.rb; s.cr.lockId = 'rb';
  assert.equal(L.useSpecial(s.g, s.cr), true);
  assert.ok(s.cr.boost > 0);
});

test('ゲーム作成: 最終戦の前から始まる', () => {
  assert.equal(L.createGame().finalBattle, false);
});

// ---------- 第 4.0 段階: 実際の HP は耐久の 10 倍 ----------

test('HP: 試合の中の HP は艦種の耐久 (出撃準備の画面の値) の HP_SCALE (10) 倍。耐久の値そのものは変わらない', () => {
  assert.equal(L.HP_SCALE, 10);
  assert.deepEqual(Object.values(L.SHIP_TYPES).map(t => t.stats.hp), [100, 70, 50, 30], '耐久 (表示) はそのまま');
  const g = L.createGame();
  const byRole = role => g.fleets.find(f => f.team === 'blue' && f.role === role);
  assert.deepEqual(['battleship', 'carrier', 'cruiser', 'destroyer'].map(r => [byRole(r).ships, byRole(r).maxShips]), [[1000, 1000], [700, 700], [500, 500], [300, 300]]);
  assert.equal(L.maxHpOf('carrier'), 700);
});

// ---------- 第 4.1 段階: 島 (移動と弾をさえぎる) と地図 ----------

// 点対称 (マップの中心について 180° 回すと同じ) か
function symmetric(islands){
  return islands.every(i => islands.some(j => Math.abs(j.x - (L.WORLD.w - i.x)) < 1e-6 && Math.abs(j.y - (L.WORLD.h - i.y)) < 1e-6 && Math.abs(j.r - i.r) < 1e-6));
}
function checkMap(islands){
  const g = L.createGame();
  for(const i of islands){
    assert.ok(i.x - i.r >= 0 && i.x + i.r <= L.WORLD.w && i.y - i.r >= 0 && i.y + i.r <= L.WORLD.h, 'マップの内側');
    for(const f of g.fleets) assert.ok(Math.hypot(f.x - i.x, f.y - i.y) >= i.r + L.ISLAND_SPAWN_CLEARANCE, '出撃位置のまわりに置かない');
    for(const j of islands) if(j !== i) assert.ok(Math.hypot(j.x - i.x, j.y - i.y) >= i.r + j.r + L.ISLAND_GAP, '島どうしは離す');
  }
  assert.ok(symmetric(islands), '点対称');
}

test('地図: 何も指定しなければ島はない。map: fixed は固定の地図 (点対称・出撃位置と重ならない)、map: random はランダムの地図', () => {
  assert.deepEqual(L.createGame().islands, []);
  const fixed = L.createGame({map: 'fixed'}).islands;
  assert.ok(fixed.length >= 6);
  checkMap(fixed);
  assert.deepEqual(L.createGame({map: 'fixed'}).islands, fixed, '固定の地図はいつも同じ');
  const random = L.createGame({map: 'random', mapSeed: 7}).islands;
  assert.ok(random.length >= 6 && random.length <= 12);
  checkMap(random);
  assert.deepEqual(L.createGame({map: 'random', mapSeed: 7}).islands, random, '同じ種なら同じ地図');
  assert.notDeepEqual(L.createGame({map: 'random', mapSeed: 8}).islands, random, '種が違えば違う地図');
});

test('地図 (ランダム): どの種でも点対称・出撃位置と重ならない・島どうしが重ならない・半径は 400〜1200', () => {
  for(let seed = 1; seed <= 30; seed++){
    const islands = L.randomIslands(seed);
    checkMap(islands);
    assert.ok(islands.every(i => i.r >= 400 && i.r <= 1200));
  }
});

test('島: 艦は島に入らず、ふちに沿って回り込んで移動先に着く (真正面からでも)', () => {
  const islands = [{x: 5000, y: 9000, r: 500}];
  for(const startX of [5000, 5100]){
    const f = ship('cruiser', {x: startX, y: 10000, order: {type: 'move', x: 5000, y: 8000}});
    let t = 0;
    while(f.order && t < 60){
      L.moveFleet(f, 0.1, {}, islands);
      assert.ok(Math.hypot(f.x - 5000, f.y - 9000) >= 500 - 1e-6, '島に入らない');
      t += 0.1;
    }
    assert.equal(f.order, null, '着いた');
    assert.ok(Math.hypot(f.x - 5000, f.y - 8000) < 1e-6);
  }
});

test('島: 移動キーの進路でも島に入らない', () => {
  const f = ship('cruiser', {x: 5000, y: 10000, order: {type: 'course', angle: -Math.PI / 2}});
  for(let i = 0; i < 100; i++){
    L.moveFleet(f, 0.1, {}, [{x: 5000, y: 9000, r: 500}]);
    assert.ok(Math.hypot(f.x - 5000, f.y - 9000) >= 500 - 1e-6);
  }
});

test('島: 2 点を結ぶ線が島を通るか (lineBlocked)', () => {
  const islands = [{x: 1000, y: 1000, r: 300}];
  assert.equal(L.lineBlocked(islands, {x: 1000, y: 0}, {x: 1000, y: 2000}), true);
  assert.equal(L.lineBlocked(islands, {x: 1400, y: 0}, {x: 1400, y: 2000}), false);
  assert.equal(L.lineBlocked([], {x: 0, y: 0}, {x: 1, y: 1}), false);
});

test('島: 砲弾は島に当たると消える (出来事 blocked)。爆撃機は島の上を飛べる', () => {
  const b = ship('cruiser', {id: 'b', x: 1000, y: 0});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 1000, y: 400});
  const g = Object.assign(game([b, r]), {islands: [{x: 1000, y: 200, r: 50}]});
  g.projectiles.push(shot({x: 1000, y: 100, targetId: 'r'}));
  const damage = new Map();
  for(let i = 0; i < 20; i++) L.moveProjectiles(g, 1 / 60, damage, seq(0.01, 0.5));
  assert.equal(g.projectiles.length, 0);
  assert.ok(g.events.some(e => e.type === 'blocked'));
  assert.equal(damage.get(r), undefined, '当たらない');
  g.aircraft.push({id: 9, kind: 'bomber', team: 'blue', from: 'b', targetId: 'r', x: 1000, y: 100, heading: Math.PI / 2, life: 8, range: 1200, fp: 50, mult: 1, crit: 0, hitChance: 1, evasionCut: 0});
  for(let i = 0; i < 120 && g.aircraft.length; i++) L.moveAircraft(g, 1 / 60, damage, seq(0.5));
  assert.ok(damage.get(r) > 0, '爆撃機は島を越えて届く');
});

test('島: 艦と狙いの間に島があれば通常攻撃・特殊攻撃を撃たない', () => {
  const b = ship('destroyer', {id: 'b', x: 1000, y: 0, charge: 100});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 1000, y: 280});
  const g = Object.assign(game([b, r]), {islands: [{x: 1000, y: 140, r: 50}]});
  L.fireWeapons(g, 0, {blue: [r], red: []});
  assert.equal(g.projectiles.filter(p => p.from === 'b').length, 0, '通常攻撃を撃たない');
  assert.equal(L.useSpecial(g, b), false, '特殊攻撃も撃たない');
  g.islands = [];
  L.fireWeapons(g, 0, {blue: [r], red: []});
  assert.ok(g.projectiles.some(p => p.from === 'b'), '島がなければ撃つ');
});

test('攻撃命令: 狙いとの間に島があれば、射程の中でも止まらずに近づく (回り込んで撃てる位置へ)', () => {
  const f = ship('cruiser', {x: 5000, y: 10000, order: {type: 'attack', targetId: 'e'}});
  const intel = {e: {x: 5000, y: 9700, visible: true}};
  L.moveFleet(f, 0.1, intel, [{x: 5000, y: 9850, r: 60}]);
  assert.ok(f.y < 10000, '射程 (450) の中でも動く');
});

// ---------- 第 4.1 段階 (追加): 撃沈報告 ----------

test('出来事 destroyed: 沈めた艦 (by = 最後にダメージを与えた艦) が入る', () => {
  const b = ship('battleship', {id: 'b', x: 0, y: 0});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 300, y: 0, ships: 5});
  const g = game([b, r]);
  g.projectiles.push(shot({x: 290, y: 0, fp: 120, range: 650, from: 'b'}));
  L.step(g, 1 / 60, seq(0.01, 0.5, 0.5));
  const ev = g.events.find(e => e.type === 'destroyed');
  assert.ok(ev, '沈んだ');
  assert.equal(ev.by, 'b');
});
