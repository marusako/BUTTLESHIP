const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');

// テスト用の艦隊を作る
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', x: 0, y: 0,
    role: 'cruiser', ships: 50, maxShips: 50, stats: Object.assign({}, L.SHIP_TYPES.cruiser.stats), hitRadius: 25,
    order: null, isPlayer: false, ai: {nextThink: 0},
    heading: 0, flagship: false, cooldown: 0, aaCooldown: 0, stealth: 0,
    weapons: {fire: true}
  }, over);
}

// テスト用のゲーム状態を作る
function game(fleets){
  return {time: 0, fleets, intel: {blue: {}, red: {}}, locks: [], projectiles: [], aircraft: [], nextProjectileId: 1, events: [],
    reveal: false, warpArmed: false, outcome: null};
}

// 決まった値を順に返す乱数
function seq(...values){
  let i = 0;
  return () => values[i++ % values.length];
}

test('速度: 速力 (低速 80 / 高速 130 / 高速+ 180) で決まる', () => {
  assert.deepEqual(['slow', 'fast', 'fastPlus'].map(speed => L.maxSpeed({speed})), [80, 130, 180]);
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

test('マップ: 原作のミニマップと同じ縦長 (横 1 : 縦 2) の 10000 × 20000', () => {
  assert.deepEqual(L.WORLD, {w: 10000, h: 20000});
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
    assert.equal(f.maxShips, L.SHIP_TYPES[f.role].stats.hp);
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

test('ゲーム作成: 自艦隊の名前を指定でき、指定しなければ「味方第1艦隊」', () => {
  const named = L.createGame({playerName: 'ヤマト'});
  assert.equal(named.fleets.find(f => f.isPlayer).name, 'ヤマト');
  assert.equal(named.fleets.find(f => f.id === 'blue2').name, '味方第2艦隊');
  assert.equal(L.createGame().fleets.find(f => f.isPlayer).name, '味方第1艦隊');
  assert.equal(L.createGame({playerName: ''}).fleets.find(f => f.isPlayer).name, '味方第1艦隊');
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

test('旗艦の位置がばれる時間: 開始から 60 秒ごとに 5 秒間 (開始直後はばれない)', () => {
  assert.equal(L.BEACON_INTERVAL, 60);
  assert.equal(L.BEACON_DURATION, 5);
  for(const t of [0, 3, 59.9, 65, 100, 125.01]) assert.equal(L.beaconActive(t), false, String(t));
  for(const t of [60, 62.5, 64.99, 120, 180.1]) assert.equal(L.beaconActive(t), true, String(t));
});

test('旗艦の位置がばれる: その間は索敵範囲の外でも相手の旗艦が見える。旗艦以外と透明化中の旗艦は見えない', () => {
  const me = fleet({id: 'me', x: 100, y: 100});
  const flag = fleet({id: 'rf', team: 'red', x: 9000, y: 9000, flagship: true});
  const other = fleet({id: 'r2', team: 'red', x: 9100, y: 9000});
  const fleets = [me, flag, other];
  assert.deepEqual(L.visibleEnemies(fleets, 'blue', false, false).map(f => f.id), []);
  assert.deepEqual(L.visibleEnemies(fleets, 'blue', false, true).map(f => f.id), ['rf']);
  flag.stealth = 3;
  assert.deepEqual(L.visibleEnemies(fleets, 'blue', false, true).map(f => f.id), [], '透明化が優先');
});

test('旗艦の位置がばれる (試合の中): 60 秒で相手の地図に旗艦が見え、5 秒後はゴーストとして残る', () => {
  const bf = fleet({id: 'bf', x: 100, y: 100, flagship: true, isPlayer: true, weapons: {fire: false}});
  const rf = fleet({id: 'rf', team: 'red', x: 9000, y: 9000, flagship: true, weapons: {fire: false}});
  const g = game([bf, rf]);
  g.time = 59.95;
  L.step(g, 0.1, seq(0.5));
  assert.equal(g.intel.blue.rf.visible, true);
  assert.equal(g.intel.red.bf.visible, true, 'お互いにばれる');
  for(let i = 0; i < 60; i++) L.step(g, 0.1, seq(0.5));
  assert.equal(g.intel.blue.rf.visible, false);
  assert.deepEqual([g.intel.blue.rf.x, g.intel.blue.rf.y], [9000, 9000], '最終確認位置が残る');
});

// ---------- 第 2.6 段階 (2.6a): 艦種・武器・艦載機 ----------

// 艦種のデータを持ったテスト用の艦隊
function ship(type, over){
  const t = L.SHIP_TYPES[type];
  const extra = type === 'carrier' ? {recon: {launched: 0, next: 0}} : {};
  return fleet(Object.assign({role: type, type: t.name, stats: Object.assign({}, t.stats), hitRadius: t.hitRadius, ships: t.stats.hp, maxShips: t.stats.hp}, extra, over));
}
// テスト用の弾 (射程内のみ必中)
function shot(over){
  return Object.assign({id: 1, kind: 'shot', team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, heading: 0, range: 450, homing: true, life: L.SHOT_LIFE, power: 100}, over);
}

test('艦種: ステータス (耐久・火力・装甲・回避・対空・索敵・射程・速力)・武器・発射間隔・大きさ', () => {
  const T = L.SHIP_TYPES;
  assert.deepEqual(Object.keys(T), ['battleship', 'carrier', 'cruiser', 'destroyer']);
  assert.deepEqual(Object.values(T).map(t => t.stats), [
    {hp: 90, firepower: 90, armor: 85, evasion: 30, antiAir: 40, los: 20, range: 'long', speed: 'slow'},
    {hp: 70, firepower: 50, armor: 60, evasion: 40, antiAir: 60, los: 60, range: null, speed: 'fast'},
    {hp: 50, firepower: 55, armor: 50, evasion: 60, antiAir: 40, los: 40, range: 'medium', speed: 'fast'},
    {hp: 30, firepower: 20, armor: 15, evasion: 80, antiAir: 50, los: 50, range: 'short', speed: 'fastPlus'}
  ]);
  assert.deepEqual(Object.values(T).map(t => [t.weapon.kind, t.weapon.range, t.weapon.interval]), [
    ['gun', 650, 3], ['bomber', 1100, 9], ['gun', 450, 1], ['gun', 300, 0.7]
  ]);
  assert.deepEqual(L.RANGES, {short: 300, medium: 450, long: 650, veryLong: 850});
  for(const t of Object.values(T)) if(t.weapon.kind === 'gun') assert.equal(t.weapon.range, L.RANGES[t.stats.range], '砲撃の射程は射程のステータスで決まる');
  assert.deepEqual(Object.values(T).map(t => [t.size, t.hitRadius]), [['large', 40], ['large', 40], ['medium', 25], ['small', 15]]);
  for(const t of Object.values(T)) assert.ok(t.name && t.description);
});

test('編成: 第 1 戦艦 (旗艦)・第 2 空母・第 3 巡洋艦・第 4 と第 5 駆逐艦。敵味方とも同じ', () => {
  assert.deepEqual(L.FORMATION, ['battleship', 'carrier', 'cruiser', 'destroyer', 'destroyer']);
  const g = L.createGame();
  for(const team of ['blue', 'red']){
    const by = n => g.fleets.find(f => f.id === team + n);
    assert.deepEqual([1, 2, 3, 4, 5].map(n => by(n).role), L.FORMATION);
    assert.deepEqual([1, 2, 3, 4, 5].map(n => by(n).type), ['戦艦', '空母', '巡洋艦', '駆逐艦', '駆逐艦']);
    assert.deepEqual([1, 2, 3, 4, 5].map(n => by(n).flagship), [true, false, false, false, false]);
    for(const n of [1, 2, 3, 4, 5]){
      const t = L.SHIP_TYPES[by(n).role];
      assert.deepEqual(by(n).stats, t.stats);
      assert.equal(by(n).hitRadius, t.hitRadius);
      assert.deepEqual(by(n).weapons, {fire: true});
    }
  }
});

test('出撃位置: 各チームから見て左から第 4 (駆逐)・第 3 (巡洋)・第 1 (戦艦)・第 2 (空母)・第 5 (駆逐)', () => {
  const g = L.createGame();
  const xs = team => [4, 3, 1, 2, 5].map(n => g.fleets.find(f => f.id === team + n).x);
  assert.deepEqual(xs('blue'), [3400, 4200, 5000, 5800, 6600]);
  assert.deepEqual(xs('red'), [6600, 5800, 5000, 4200, 3400]);
});

test('自機の選択: 番号で艦種が決まる (省略時は第 1 艦隊 = 戦艦)。名前の既定値は選んだ番号', () => {
  const me = g => g.fleets.find(f => f.isPlayer);
  assert.deepEqual([me(L.createGame()).id, me(L.createGame()).type], ['blue1', '戦艦']);
  for(const [no, type] of [[2, '空母'], [3, '巡洋艦'], [4, '駆逐艦'], [5, '駆逐艦']]){
    const g = L.createGame({playerSlot: no});
    assert.deepEqual([me(g).id, me(g).type, me(g).name, me(g).flagship], ['blue' + no, type, `味方第${no}艦隊`, false]);
    assert.equal(g.fleets.find(f => f.id === 'blue1').type, '戦艦', '味方の旗艦はいつも戦艦');
  }
  assert.equal(me(L.createGame({playerSlot: 3, playerName: 'ヤマト'})).name, 'ヤマト');
});

test('狙い: 狙える範囲は「索敵範囲」と「射程」の長いほう。攻撃命令の相手を優先', () => {
  const cr = ship('cruiser', {id: 'c'});
  const cv = ship('carrier', {id: 'v'});
  assert.equal(L.lockRange(cr), L.sensorRange(cr), '巡洋艦は索敵範囲 (690) が射程 (450) より長い');
  assert.equal(L.lockRange(cv), 1100);
  const near = ship('destroyer', {id: 'n', team: 'red', x: 300, y: 0});
  const far = ship('destroyer', {id: 'f', team: 'red', x: 650, y: 0});
  const out = ship('destroyer', {id: 'o', team: 'red', x: 900, y: 0});
  assert.equal(L.lockTarget(cr, [near, far, out]).id, 'n');
  assert.equal(L.lockTarget(Object.assign({}, cr, {order: {type: 'attack', targetId: 'f'}}), [near, far, out]).id, 'f');
  assert.equal(L.lockTarget(cr, [out]), null);
  assert.equal(L.lockTarget(cv, [out]).id, 'o', '空母は 1100 まで狙える');
});

test('発射 (砲): 射程の外なら撃たず狙いの線だけ。射程に入ったら撃ち、発射間隔が空くまで次は撃たない', () => {
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
  assert.deepEqual([p.kind, p.from, p.targetId, p.range, p.homing], ['shot', 'b', 'r', 450, true]);
  // 1 発の攻撃力 = 火力 + 5
  assert.equal(p.power, 55 + 5);
  L.fireWeapons(g, 0.5, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 1, '発射間隔 (1 秒) がまだ');
  L.fireWeapons(g, 0.5, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 2);
});

test('発射: FIRE がオフなら撃たない (狙いは定める)', () => {
  const b = ship('cruiser', {id: 'b', weapons: {fire: false}});
  const r = ship('cruiser', {id: 'r', team: 'red', x: 300, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0.1, {blue: [r], red: []});
  assert.equal(g.projectiles.length, 0);
  assert.equal(g.locks.length, 1);
});

test('射程内のみ必中: 目標が撃った艦の射程の中にいる間は追いかけて必ず当たる', () => {
  const b = ship('cruiser', {id: 'b', x: 0, y: 0});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 300, y: 200}); // 距離 約 360 (射程 450 の中)
  const g = game([b, r]);
  g.projectiles.push(shot({x: 0, y: 0}));
  const damage = new Map();
  // 目標は動き続ける (射程の中のまま) が、弾は追いかけて当たる
  for(let i = 0; i < 120 && g.projectiles.length; i++){ r.y += 1; L.moveProjectiles(g, 1 / 60, damage, seq(0.5)); }
  assert.equal(g.projectiles.length, 0);
  assert.ok(damage.get(r) > 0);
});

test('射程内のみ必中: 目標が射程の外に出たら追いかけるのをやめてまっすぐ飛び、当たり判定に触れれば当たる', () => {
  const b = ship('cruiser', {id: 'b', x: 0, y: 0});
  const small = ship('destroyer', {id: 'r', team: 'red', x: 1000, y: 30});  // 当たり判定 15 → まっすぐ (y = 0) では当たらない
  const g = game([b, small]);
  g.projectiles.push(shot({x: 500, y: 0, heading: 0}));
  const damage = new Map();
  L.moveProjectiles(g, 1 / 60, damage, seq(0.9));
  assert.equal(g.projectiles[0].homing, false, '射程の外なので追いかけない');
  assert.ok(Math.abs(g.projectiles[0].y) < 1e-9, 'まっすぐ飛ぶ');
  small.x = 300; // 射程の中に戻っても、もう追いかけない
  for(let i = 0; i < 60; i++) L.moveProjectiles(g, 1 / 60, damage, seq(0.9));
  assert.equal(g.projectiles.length > 0 ? g.projectiles[0].homing : false, false);
  assert.equal(damage.size, 0, '小さい艦には当たらない');

  const big = ship('battleship', {id: 'r', team: 'red', x: 1000, y: 30}); // 当たり判定 40 → 触れる
  const g2 = game([b, big]);
  g2.projectiles.push(shot({x: 500, y: 0, heading: 0}));
  const d2 = new Map();
  for(let i = 0; i < 90 && g2.projectiles.length; i++) L.moveProjectiles(g2, 1 / 60, d2, seq(0.5));
  assert.ok(d2.get(big) > 0, '大きい艦には当たる');
});

test('射程内のみ必中: 撃った艦が全滅したら追いかけない。外れた弾は SHOT_LIFE 秒で消える', () => {
  const b = ship('cruiser', {id: 'b', x: 0, y: 0, ships: 0});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 300, y: 200});
  const g = game([b, r]);
  g.projectiles.push(shot({x: 0, y: 0, heading: Math.PI})); // 反対向き
  const damage = new Map();
  L.moveProjectiles(g, 1 / 60, damage, seq(0.9));
  assert.equal(g.projectiles[0].homing, false);
  for(let t = 0; t < L.SHOT_LIFE + 0.1; t += 0.1) L.moveProjectiles(g, 0.1, damage, seq(0.9));
  assert.equal(g.projectiles.length, 0);
});

test('爆撃機: 空母は射程 1100 以内の見えている敵 (味方が見つけた敵も) に 9 秒ごとに爆撃機を出す', () => {
  const cv = ship('carrier', {id: 'v', x: 1000, y: 3000});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 1000, y: 2000}); // 距離 1000 (空母の索敵範囲 810 の外)
  const g = game([cv, e]);
  L.fireWeapons(g, 0.1, {blue: [e], red: []});
  assert.equal(g.aircraft.length, 1);
  const a = g.aircraft[0];
  assert.deepEqual([a.kind, a.team, a.from, a.targetId, a.life], ['bomber', 'blue', 'v', 'e', L.BOMBER_LIFE]);
  assert.equal(g.projectiles.length, 0, '空母は弾を撃たない');
  L.fireWeapons(g, 8, {blue: [e], red: []});
  assert.equal(g.aircraft.length, 1);
  L.fireWeapons(g, 1, {blue: [e], red: []});
  assert.equal(g.aircraft.length, 2);
  e.y = 1850; // 距離 1150
  L.fireWeapons(g, 9, {blue: [e], red: []});
  assert.equal(g.aircraft.length, 2, '射程の外には出さない');
});

test('爆撃機: 目標へ向かい、届いたら爆撃して消える。曲がる速さに限りがあり、BOMBER_LIFE 秒で消える', () => {
  const cv = ship('carrier', {id: 'v'});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 300, y: 0});
  const g = game([cv, e]);
  g.aircraft.push({id: 5, kind: 'bomber', team: 'blue', from: 'v', targetId: 'e', x: 0, y: 0, heading: 0, life: L.BOMBER_LIFE, power: 200});
  const damage = new Map();
  for(let i = 0; i < 120 && g.aircraft.length; i++) L.moveAircraft(g, 1 / 60, damage, seq(0.5));
  assert.equal(g.aircraft.length, 0);
  assert.ok(damage.get(e) > 0);

  const back = game([cv, ship('cruiser', {id: 'e', team: 'red', x: -300, y: 0})]);
  back.aircraft.push({id: 6, kind: 'bomber', team: 'blue', from: 'v', targetId: 'e', x: 0, y: 0, heading: 0, life: L.BOMBER_LIFE, power: 200});
  L.moveAircraft(back, 0.1, new Map(), seq(0.9));
  assert.ok(Math.abs(back.aircraft[0].heading) <= L.BOMBER_TURN_RATE * 0.1 + 1e-9, '一度に曲がれる角度に限りがある');

  const lost = game([cv, ship('cruiser', {id: 'e', team: 'red', x: 9000, y: 9000})]);
  lost.aircraft.push({id: 7, kind: 'bomber', team: 'blue', from: 'v', targetId: 'e', x: 0, y: 0, heading: Math.PI, life: L.BOMBER_LIFE, power: 200});
  for(let t = 0; t < L.BOMBER_LIFE + 0.2; t += 0.1) L.moveAircraft(lost, 0.1, new Map(), seq(0.9));
  assert.equal(lost.aircraft.length, 0);
});

test('偵察機: 空母は最初に 3 機、その後 60 秒ごとに 2 機を、進行方向の左右 15° の範囲へ自動で射出する', () => {
  const cv = ship('carrier', {id: 'v', x: 5000, y: 10000, heading: -Math.PI / 2});
  const g = game([cv, ship('cruiser', {id: 'far', team: 'red', x: 100, y: 100})]); // 敵がいないと勝敗が決まって止まる
  L.step(g, 0.1, seq(0, 0.5, 1));
  const recon = () => g.aircraft.filter(a => a.kind === 'recon');
  assert.equal(recon().length, 3);
  for(const a of recon()){
    assert.equal(a.team, 'blue');
    assert.ok(Math.abs(a.heading + Math.PI / 2) <= Math.PI / 12 + 1e-9, String(a.heading));
  }
  assert.ok(recon().some(a => Math.abs(a.heading + Math.PI / 2 + Math.PI / 12) < 1e-9) && recon().some(a => Math.abs(a.heading + Math.PI / 2) < 1e-9));
  for(let i = 0; i < 598; i++) L.step(g, 0.1, seq(0.5));
  assert.equal(recon().length, 0, '40 秒で消える');
  L.step(g, 0.2, seq(0.5));
  assert.equal(recon().length, 2, '60 秒で 2 機');
});

test('偵察機: まっすぐ速さ RECON_SPEED で飛び、マップの外に出たら消える。攻撃はしない', () => {
  const g = game([ship('cruiser', {id: 'e', team: 'red', x: 100, y: 50})]);
  g.aircraft.push({id: 1, kind: 'recon', team: 'blue', from: 'v', x: 100, y: 100, heading: -Math.PI / 2, life: L.RECON_LIFE});
  const damage = new Map();
  L.moveAircraft(g, 0.1, damage, seq(0.9));
  assert.ok(Math.abs(g.aircraft[0].y - (100 - L.RECON_SPEED * 0.1)) < 1e-9);
  assert.equal(damage.size, 0);
  L.moveAircraft(g, 1, damage, seq(0.9));
  assert.equal(g.aircraft.length, 0, 'マップの外');
});

test('偵察機: 索敵範囲 375 (艦の半分) で、見つけた敵は味方全員に共有される', () => {
  assert.equal(L.RECON_SENSOR, 375);
  const me = ship('cruiser', {id: 'me', x: 100, y: 100});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 5000, y: 5300});
  const plane = {id: 1, kind: 'recon', team: 'blue', x: 5000, y: 5000, heading: 0, life: 10};
  assert.deepEqual(L.visibleEnemies([me, e], 'blue', false, false, [plane]).map(f => f.id), ['e']);
  e.y = 5400;
  assert.deepEqual(L.visibleEnemies([me, e], 'blue', false, false, [plane]).map(f => f.id), []);
  assert.deepEqual(L.visibleEnemies([me, e], 'red', false, false, [plane]).map(f => f.id), [], '相手の偵察機は自分の目にならない');
});

test('対空射撃: 全艦種が、400 以内の敵の艦載機を 0.5 秒ごとに撃ち、対空 ÷ 150 の確率で撃ち落とす', () => {
  const plane = () => ({id: 1, kind: 'recon', team: 'blue', x: 300, y: 0, heading: 0, life: 10});
  for(const type of Object.keys(L.SHIP_TYPES)){
    const chance = L.SHIP_TYPES[type].stats.antiAir / 150;
    assert.equal(L.antiAirChance(ship(type)), chance);
    for(const [roll, left] of [[chance - 0.001, 0], [chance, 1]]){
      const g = game([ship(type, {id: 'r', team: 'red'})]);
      g.aircraft.push(plane());
      L.antiAir(g, 0.1, seq(roll));
      assert.equal(g.aircraft.length, left, type + ' ' + roll);
    }
  }
  const miss = game([ship('destroyer', {id: 'r', team: 'red'})]);
  miss.aircraft.push(plane());
  L.antiAir(miss, 0.1, seq(0.99));
  assert.equal(miss.aircraft.length, 1, '外した');
  L.antiAir(miss, 0.3, seq(0));
  assert.equal(miss.aircraft.length, 1, '0.5 秒たつまで次は撃たない');
  L.antiAir(miss, 0.2, seq(0));
  assert.equal(miss.aircraft.length, 0);
  const far = game([ship('destroyer', {id: 'r', team: 'red'})]);
  far.aircraft.push(Object.assign(plane(), {x: 401}));
  L.antiAir(far, 0.1, seq(0));
  assert.equal(far.aircraft.length, 1, '400 より遠い');
  const own = game([ship('destroyer', {id: 'b'})]);
  own.aircraft.push(plane());
  L.antiAir(own, 0.1, seq(0));
  assert.equal(own.aircraft.length, 1, '味方の艦載機は撃たない');
});

test('空母の弱点: 攻撃を受けたとき 15% の確率でダメージが 2 倍 (ほかの艦種はならない)', () => {
  // 乱数の順: 命中 → クリティカル → 装甲 → (かすりなら HP) → 空母の弱点
  const cv = ship('carrier', {id: 'v'});
  const normal = L.resolveHit(150, cv, seq(0.5, 0.5, 0.5, 0.2));
  const weak = L.resolveHit(150, cv, seq(0.5, 0.5, 0.5, 0.14));
  assert.equal(normal.weakness, false);
  assert.equal(weak.weakness, true);
  assert.equal(weak.damage, normal.damage * 2);
  const cr = L.resolveHit(150, ship('cruiser'), seq(0.5, 0.5, 0.5, 0));
  assert.equal(cr.weakness, false);
});

test('出来事: 砲撃・爆撃機・偵察機の射出、命中、撃墜、全滅が記録される', () => {
  const b = ship('battleship', {id: 'b', flagship: true, isPlayer: true});
  const r = ship('destroyer', {id: 'r', team: 'red', x: 200, y: 0, ships: 1, flagship: true});
  const g = game([b, r]);
  L.step(g, 1 / 60, seq(0.5));
  const fire = g.events.find(e => e.type === 'fire');
  assert.deepEqual([fire.kind, fire.team, fire.size], ['gun', 'blue', 'large']);
  for(let i = 0; i < 60 && !g.outcome; i++) L.step(g, 1 / 60, seq(0.5)); // 戦艦の弾は抽選 (残り 2 割以下なら 90%) なので当たる値で
  assert.equal(g.outcome, 'win');

  const cv = ship('carrier', {id: 'v', x: 5000, y: 10000});
  const g2 = game([cv, ship('cruiser', {id: 'far', team: 'red', x: 100, y: 100})]);
  L.step(g2, 0.1, seq(0.5));
  assert.equal(g2.events.filter(e => e.type === 'launch').length, 3);
  assert.deepEqual(Object.keys(g2.events.find(e => e.type === 'launch')).sort(), ['kind', 'team', 'type', 'x', 'y']);

  const d = ship('destroyer', {id: 'd', team: 'red', x: 5000, y: 9800});
  const g3 = game([ship('carrier', {id: 'v', x: 5000, y: 10000, recon: {launched: 3, next: 999}}), d]);
  g3.aircraft.push({id: 9, kind: 'recon', team: 'blue', from: 'v', x: 5000, y: 9900, heading: 0, life: 10});
  L.step(g3, 0.01, seq(0));
  assert.ok(g3.events.some(e => e.type === 'intercept' && e.team === 'red'));
});

test('ゲーム作成: 艦載機は空で始まり、空母には偵察機の射出の予定がある', () => {
  const g = L.createGame();
  assert.deepEqual(g.aircraft, []);
  assert.deepEqual(g.fleets.find(f => f.id === 'blue2').recon, {launched: 0, next: 0});
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
  assert.deepEqual(L.WORLD, {w: 10000, h: 20000});
});

test('移動: 攻撃命令は見えている相手に、自分の射程の内側 (8 割) まで近づいて止まる', () => {
  const f = ship('cruiser', {id: 'c', order: {type: 'attack', targetId: 'e'}});
  const intel = {e: {x: 2000, y: 0, visible: true}};
  for(let i = 0; i < 100; i++) L.moveFleet(f, 0.5, intel);
  assert.ok(Math.abs(f.x - (2000 - 450 * 0.8)) < 1e-6, String(f.x));
});

// ---------- 第 2.6 段階 (2.6b): バフ ----------

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

test('バフ: 強化中は与えるダメージ × 1.2 (砲弾と爆撃の威力)', () => {
  const run = buffedShooter => {
    const bb = ship('battleship', {id: 'bb', x: 0, y: 5000});
    const cr = ship('cruiser', {id: 'b', x: 0, y: buffedShooter ? 4500 : 3000});
    const r = ship('destroyer', {id: 'r', team: 'red', x: 0, y: cr.y - 300}); // いつも射程 (450) の中
    const g = game([bb, cr, r]);
    L.updateBuffs(g);
    L.fireWeapons(g, 0.1, {blue: [r], red: []});
    return g.projectiles.find(p => p.from === 'b').power;
  };
  assert.ok(Math.abs(run(true) / run(false) - 1.2) < 1e-9);
  const cv = ship('carrier', {id: 'v', x: 0, y: 0});
  const bb = ship('battleship', {id: 'bb', x: 500, y: 0});
  const e = ship('cruiser', {id: 'e', team: 'red', x: 0, y: 1000});
  const g = game([cv, bb, e]);
  L.updateBuffs(g);
  L.fireWeapons(g, 0.1, {blue: [e], red: []});
  const bomber = g.aircraft.find(a => a.kind === 'bomber');
  assert.ok(Math.abs(bomber.power - (50 + 5) * 1.2) < 1e-9);
});

test('バフ: 強化中は受けるダメージ ÷ 1.2 (切り捨て)', () => {
  const t = ship('cruiser', {id: 'r', team: 'red'});
  const plain = L.resolveHit(150, t, seq(0.5));
  t.buffed = true;
  const buffed = L.resolveHit(150, t, seq(0.5));
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

test('出来事: 命中 (hit) には撃った艦 (from) と与えたダメージ (damage) が入る', () => {
  const b = ship('cruiser', {id: 'b'});
  const t = ship('cruiser', {id: 'r', team: 'red', x: 10, y: 0});
  const g = game([b, t]);
  g.projectiles.push(shot({x: 0, y: 0, from: 'b', power: 80}));
  const damage = new Map();
  L.moveProjectiles(g, 1 / 60, damage, seq(0.5));
  const hit = g.events.find(e => e.type === 'hit');
  assert.equal(hit.from, 'b');
  assert.equal(hit.damage, damage.get(t));
  assert.ok(hit.damage > 0);
});

// ---------- 第 2.6 段階 (2.6d): 艦これ風のステータス ----------

test('索敵範囲: 450 + 索敵 × 6 (戦艦 570 / 空母 810 / 巡洋艦 690 / 駆逐艦 750)', () => {
  assert.deepEqual(Object.keys(L.SHIP_TYPES).map(type => L.sensorRange(ship(type))), [570, 810, 690, 750]);
  const dd = ship('destroyer', {id: 'd', x: 0, y: 0});
  const bb = ship('battleship', {id: 'b', x: 0, y: 5000});
  const e1 = ship('cruiser', {id: 'e1', team: 'red', x: 749, y: 0});
  const e2 = ship('cruiser', {id: 'e2', team: 'red', x: 571, y: 5000});
  assert.deepEqual(L.visibleEnemies([dd, bb, e1, e2], 'blue').map(f => f.id), ['e1'], '艦ごとの索敵範囲で見える');
});

test('命中率: 96% − 回避 × 0.5% (戦艦 81% / 空母 76% / 巡洋艦 66% / 駆逐艦 56%)', () => {
  assert.deepEqual(Object.keys(L.SHIP_TYPES).map(type => Math.round(L.hitChance(ship(type)) * 1000) / 1000), [0.81, 0.76, 0.66, 0.56]);
  const dd = ship('destroyer');
  assert.equal(L.resolveHit(100, dd, seq(0.559)).hit, true);
  assert.equal(L.resolveHit(100, dd, seq(0.56)).hit, false);
  assert.equal(L.resolveHit(100, dd, seq(0.56)).damage, 0);
});

test('ダメージ: 攻撃力 − 防御力 (装甲 × 0.7 + (0〜装甲−1 の整数の乱数) × 0.6) を切り捨て', () => {
  const t = ship('cruiser'); // 装甲 50
  // 命中 0 → クリティカル 0.5 (なし) → 装甲の乱数 0 (防御 35) / 0.999 (49 → 防御 35 + 29.4)
  assert.equal(L.resolveHit(100, t, seq(0, 0.5, 0)).damage, 65);
  assert.equal(L.resolveHit(100, t, seq(0, 0.5, 0.999)).damage, Math.floor(100 - 35 - 49 * 0.6));
});

test('ダメージ: クリティカル (10%) は攻撃力 × 1.5', () => {
  const t = ship('cruiser');
  const crit = L.resolveHit(100, t, seq(0, 0.09, 0));
  assert.deepEqual([crit.critical, crit.damage], [true, 150 - 35]);
  assert.equal(L.resolveHit(100, t, seq(0, 0.1, 0)).critical, false);
});

test('ダメージ: 攻撃力 − 防御力が 0 以下なら、かすり (今の HP × 0.06 + (0〜今の HP−1 の整数の乱数) × 0.08 を切り捨て)', () => {
  const t = ship('battleship', {ships: 80}); // 装甲 85 → 防御 59.5 以上
  const r = L.resolveHit(40, t, seq(0, 0.5, 0, 0.5));
  assert.equal(r.scratch, true);
  assert.equal(r.damage, Math.floor(80 * 0.06 + 40 * 0.08));
  assert.equal(L.resolveHit(40, t, seq(0, 0.5, 0, 0)).damage, Math.floor(80 * 0.06));
});

test('攻撃力: 火力 + 5。中破 (HP 5 割以下) で × 0.7、大破 (2.5 割以下) で × 0.4。バフ × 1.2。上限 150 (超えた分は √)', () => {
  const at = (type, over) => L.attackPower(ship(type, over));
  assert.equal(at('cruiser'), 60);
  assert.equal(at('cruiser', {ships: 26}), 60, '5 割を超えていれば補正なし');
  assert.ok(Math.abs(at('cruiser', {ships: 25}) - 60 * 0.7) < 1e-9);
  assert.ok(Math.abs(at('cruiser', {ships: 12.5}) - 60 * 0.4) < 1e-9);
  assert.ok(Math.abs(at('cruiser', {buffed: true}) - 72) < 1e-9);
  assert.ok(Math.abs(L.capAttack(150) - 150) < 1e-9);
  assert.ok(Math.abs(L.capAttack(166) - 154) < 1e-9);
  // 損傷の状態: 小破 = 7.5 割以下、中破 = 5 割以下、大破 = 2.5 割以下
  assert.deepEqual([38, 37, 25, 12].map(hp => L.damageState(ship('cruiser', {ships: hp}))), ['none', 'minor', 'moderate', 'heavy']);
});

test('命中: 弾が当たり判定に触れたとき回避で抽選し、外れたらダメージなしで消え、miss が記録される。爆撃も同じ', () => {
  const run = roll => {
    const b = ship('cruiser', {id: 'b', x: 0, y: 0});
    const r = ship('destroyer', {id: 'r', team: 'red', x: 300, y: 0});
    const g = game([b, r]);
    g.projectiles.push(shot({x: 290, y: 0}));
    const damage = new Map();
    L.moveProjectiles(g, 1 / 60, damage, seq(roll));
    return {hit: damage.has(r), left: g.projectiles.length, miss: g.events.some(e => e.type === 'miss' && e.from === 'b' && e.targetId === 'r')};
  };
  assert.deepEqual(run(0.5), {hit: true, left: 0, miss: false});
  assert.deepEqual(run(0.9), {hit: false, left: 0, miss: true});
  const cv = ship('carrier', {id: 'v'});
  const e = ship('destroyer', {id: 'e', team: 'red', x: 10, y: 0});
  const g = game([cv, e]);
  g.aircraft.push({id: 5, kind: 'bomber', team: 'blue', from: 'v', targetId: 'e', x: 0, y: 0, heading: 0, life: L.BOMBER_LIFE, power: 55});
  const damage = new Map();
  L.moveAircraft(g, 1 / 60, damage, seq(0.9));
  assert.equal(damage.size, 0);
  assert.ok(g.events.some(ev => ev.type === 'miss' && ev.from === 'v'));
});
