const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');

// テスト用の艦隊を作る
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', x: 0, y: 0,
    ships: L.INITIAL_SHIPS, params: {speed: 34, defense: 33, attack: 33},
    order: null, isPlayer: false, ai: {nextThink: 0},
    heading: 0, flagship: false, missileCooldown: 0, interceptCooldown: 0,
    throttle: 4, weapons: {laser: true, torpid: true}, missiles: L.MISSILE_AMMO, missileMode: 'guided'
  }, over);
}

// テスト用のゲーム状態を作る
function game(fleets){
  return {time: 0, fleets, intel: {blue: {}, red: {}}, beams: [], missiles: [], nextMissileId: 1,
    reveal: false, warpArmed: false, outcome: null};
}

// 決まった値を順に返す乱数
function seq(...values){
  let i = 0;
  return () => values[i++ % values.length];
}

test('パラメータ配分: 合計 100・各 0 以上・整数だけ有効 (原作どおり 0 から 1 ずつ。第 5 段階で各 10 以上の制限をなくした)', () => {
  assert.equal(L.PARAM_MIN, 0);
  assert.equal(L.validateParams({speed: 34, defense: 33, attack: 33}), true);
  assert.equal(L.validateParams({speed: 10, defense: 10, attack: 80}), true);
  assert.equal(L.validateParams({speed: 9, defense: 45, attack: 46}), true);
  assert.equal(L.validateParams({speed: 0, defense: 0, attack: 100}), true);
  assert.equal(L.validateParams({speed: 34, defense: 33, attack: 34}), false); // 合計 101
  assert.equal(L.validateParams({speed: -1, defense: 50, attack: 51}), false);  // 0 未満
  assert.equal(L.validateParams({speed: 33.5, defense: 33.5, attack: 33}), false); // 小数
});

test('パラメータ配分の極端な値: 速度 0 でも動け (最低の速さ 40)、攻撃 0 ならビームのダメージは 0、防御 0 なら軽減なし', () => {
  assert.equal(L.maxSpeed({speed: 0, defense: 50, attack: 50}), 40);
  const a = {ships: L.INITIAL_SHIPS, params: {speed: 50, defense: 50, attack: 0}};
  const t = {ships: L.INITIAL_SHIPS, params: {speed: 50, defense: 0, attack: 50}};
  assert.equal(L.beamDps(a, t), 0);
  assert.equal(L.mitigation(t.params), 1);
});

test('速度: 速度パラメータが高いほど速い', () => {
  assert.ok(L.maxSpeed({speed: 50, defense: 25, attack: 25}) > L.maxSpeed({speed: 20, defense: 40, attack: 40}));
  assert.ok(L.maxSpeed({speed: 10, defense: 10, attack: 80}) > 0);
});

test('ダメージ: 攻撃が高いほど、防御が低いほど大きい', () => {
  const a = fleet({params: {speed: 20, defense: 20, attack: 60}});
  const b = fleet({params: {speed: 60, defense: 20, attack: 20}});
  const hard = fleet({params: {speed: 20, defense: 60, attack: 20}});
  const soft = fleet({params: {speed: 60, defense: 20, attack: 20}});
  assert.ok(L.beamDps(a, soft) > L.beamDps(b, soft));
  assert.ok(L.beamDps(a, soft) > L.beamDps(a, hard));
});

test('ダメージ: 艦艇数が減ると火力も落ちるが、下限がある', () => {
  const target = fleet();
  const full = L.beamDps(fleet({ships: L.INITIAL_SHIPS}), target);
  const half = L.beamDps(fleet({ships: L.INITIAL_SHIPS / 2}), target);
  assert.ok(half < full);
  const floorShips = L.INITIAL_SHIPS * L.FIREPOWER_FLOOR;
  assert.equal(L.beamDps(fleet({ships: 10}), target), L.beamDps(fleet({ships: floorShips}), target));
});

test('索敵: 味方のどれかの索敵範囲に入った敵だけが見える (情報共有)', () => {
  const me = fleet({id: 'me', x: 0, y: 0});
  const ally = fleet({id: 'ally', x: 2000, y: 0});
  const nearAlly = fleet({id: 'e1', team: 'red', x: 2000 + L.SENSOR_RANGE - 1, y: 0});
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

test('攻撃対象: 射程内で見えている最も近い敵を選ぶ', () => {
  const me = fleet({id: 'me'});
  const near = fleet({id: 'near', team: 'red', x: 100, y: 0});
  const nearer = fleet({id: 'nearer', team: 'red', x: 50, y: 0});
  const out = fleet({id: 'out', team: 'red', x: L.BEAM_RANGE + 1, y: 0});
  assert.equal(L.chooseTarget(me, [near, nearer, out]).id, 'nearer');
  assert.equal(L.chooseTarget(me, [out]), null);
});

test('攻撃対象: 攻撃命令の相手が射程内ならそちらを優先', () => {
  const me = fleet({id: 'me', order: {type: 'attack', targetId: 'near'}});
  const near = fleet({id: 'near', team: 'red', x: 100, y: 0});
  const nearer = fleet({id: 'nearer', team: 'red', x: 50, y: 0});
  assert.equal(L.chooseTarget(me, [near, nearer]).id, 'near');
});

test('移動: 目的地へ最大速度で進み、着いたら命令が消える', () => {
  const f = fleet({order: {type: 'move', x: 1000, y: 0}});
  L.moveFleet(f, 1, {});
  assert.equal(Math.round(f.x), Math.round(L.maxSpeed(f.params)));
  f.x = 999;
  L.moveFleet(f, 1, {});
  assert.equal(f.x, 1000);
  assert.equal(f.order, null);
});

test('移動: 攻撃命令は見えている相手の射程内まで近づいて止まる', () => {
  const f = fleet({order: {type: 'attack', targetId: 'e'}});
  const intel = {e: {x: 2000, y: 0, visible: true}};
  for(let i = 0; i < 400; i++) L.moveFleet(f, 0.1, intel);
  assert.ok(f.x < 2000 - L.BEAM_RANGE * 0.5 && f.x > 2000 - L.BEAM_RANGE);
  assert.deepEqual(f.order, {type: 'attack', targetId: 'e'});
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

test('AI (護衛): 損害が大きいと隊長のすぐそばへ下がる', () => {
  const me = fleet({id: 'me', x: 2000, y: 1500, ships: L.INITIAL_SHIPS * 0.2});
  const leader = fleet({id: 'lead', x: 500, y: 1500, leader: true});
  const e = fleet({id: 'e', team: 'red', x: 2100, y: 1500});
  const order = L.aiDecide(me, [leader, me, e], {e: {x: 2100, y: 1500, visible: true}}, seq(0.5));
  assert.deepEqual(order, {type: 'move', x: 500, y: 1500});
});

test('AI (隊長): 損害が大きくても後退せず戦い続ける', () => {
  const me = fleet({id: 'me', x: 2000, y: 1500, ships: L.INITIAL_SHIPS * 0.2, leader: true});
  const escort = fleet({id: 'a', x: 400, y: 1500});
  const e = fleet({id: 'e', team: 'red', x: 2100, y: 1500});
  const order = L.aiDecide(me, [me, escort, e], {e: {x: 2100, y: 1500, visible: true}}, seq(0.5));
  assert.deepEqual(order, {type: 'attack', targetId: 'e'});
});

test('AI (隊長): 索敵中は目的地に着くまで目的地を変えない', () => {
  const me = fleet({id: 'me', x: 300, y: 1500, leader: true});
  const first = L.aiDecide(me, [me], {}, seq(0.5));
  me.order = first;
  assert.deepEqual(L.aiDecide(me, [me], {}, seq(0.9)), first);
});

test('AI (隊長): 見えている敵がいれば近くて弱い敵を狙う', () => {
  const me = fleet({id: 'me', x: 0, y: 0, leader: true});
  const strongNear = fleet({id: 'strong', team: 'red', x: 400, y: 0, ships: L.INITIAL_SHIPS});
  const weakNear = fleet({id: 'weak', team: 'red', x: 450, y: 0, ships: L.INITIAL_SHIPS / 6});
  const weakFar = fleet({id: 'far', team: 'red', x: 3000, y: 0, ships: L.INITIAL_SHIPS * 0.13});
  const fleets = [me, strongNear, weakNear, weakFar];
  const intel = {};
  L.updateIntel(intel, fleets, 'blue');
  intel.far = {x: 3000, y: 0, visible: true}; // 味方が見つけた扱い
  const order = L.aiDecide(me, fleets, intel, seq(0.5));
  assert.deepEqual(order, {type: 'attack', targetId: 'weak'});
});

test('AI (隊長): 敵が見えず最終確認位置があれば、最も近いそこへ向かう', () => {
  const me = fleet({id: 'me', x: 0, y: 0, leader: true});
  const intel = {a: {x: 1000, y: 0, visible: false}, b: {x: 500, y: 0, visible: false}};
  assert.deepEqual(L.aiDecide(me, [me], intel, seq(0.5)), {type: 'move', x: 500, y: 0});
});

test('AI (隊長): 手がかりがなければ敵陣の方向 (青は上・赤は下の半分) へ索敵に出る', () => {
  const blue = fleet({id: 'b', x: 1200, y: L.WORLD.h - 300, leader: true});
  const red = fleet({id: 'r', team: 'red', x: 1200, y: 300, leader: true});
  for(const v of [0, 0.5, 0.99]){
    const ob = L.aiDecide(blue, [blue], {}, seq(v));
    const or = L.aiDecide(red, [red], {}, seq(v));
    assert.equal(ob.type, 'move');
    assert.ok(ob.y <= L.WORLD.h / 2, 'blue y=' + ob.y);
    assert.ok(or.y >= L.WORLD.h / 2, 'red y=' + or.y);
    assert.ok(ob.x >= 0 && ob.x <= L.WORLD.w);
  }
});

test('マップ: 原作のミニマップと同じ縦長 (横 1 : 縦 2) の 2400 × 4800', () => {
  assert.deepEqual(L.WORLD, {w: 2400, h: 4800});
});

test('ゲーム作成: 青は下の端、赤は上の端から、横に並んで出撃する', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5));
  for(const f of g.fleets){
    if(f.team === 'blue') assert.ok(f.y > L.WORLD.h * 0.9, f.id);
    else assert.ok(f.y < L.WORLD.h * 0.1, f.id);
    assert.ok(f.x > 0 && f.x < L.WORLD.w, f.id);
  }
  const xs = g.fleets.filter(f => f.team === 'blue').map(f => f.x);
  assert.equal(new Set(xs).size, 5);
});

test('ゲーム作成: 5 vs 5、プレイヤーは青の 1 艦隊で、指定パラメータを持つ', () => {
  const g = L.createGame({speed: 20, defense: 30, attack: 50}, seq(0.1, 0.4, 0.7, 0.9));
  assert.equal(g.fleets.filter(f => f.team === 'blue').length, 5);
  assert.equal(g.fleets.filter(f => f.team === 'red').length, 5);
  const players = g.fleets.filter(f => f.isPlayer);
  assert.equal(players.length, 1);
  assert.equal(players[0].team, 'blue');
  assert.deepEqual(players[0].params, {speed: 20, defense: 30, attack: 50});
  for(const f of g.fleets) assert.ok(L.validateParams(f.params), f.id);
});

test('ゲーム進行: 射程内の敵同士は撃ち合って艦艇数が減る (同時に計算)', () => {
  const b = fleet({id: 'b', isPlayer: true});
  const r = fleet({id: 'r', team: 'red', x: 100, y: 0});
  const g = game([b, r]);
  L.step(g, 1, seq(0.5));
  assert.ok(b.ships < L.INITIAL_SHIPS && r.ships < L.INITIAL_SHIPS);
  assert.equal(b.ships, r.ships); // 同じ条件なら同じ損害
  assert.equal(g.beams.length, 2);
});

test('ゲーム進行: プレイヤー艦隊は AI に命令を上書きされない', () => {
  const b = fleet({id: 'b', isPlayer: true, x: 300, y: 1500});
  const r = fleet({id: 'r', team: 'red', x: 3700, y: 1500});
  const g = game([b, r]);
  L.step(g, 0.1, seq(0.5));
  assert.equal(b.order, null);
  assert.notEqual(r.order, null);
});

test('ゲーム進行: 艦艇数が 0 以下になると全滅し、勝敗が決まる', () => {
  const b = fleet({id: 'b', isPlayer: true, params: {speed: 10, defense: 10, attack: 80}});
  const r = fleet({id: 'r', team: 'red', x: 100, y: 0, ships: 1, params: {speed: 10, defense: 10, attack: 80}});
  const g = game([b, r]);
  L.step(g, 1, seq(0.5));
  assert.equal(r.ships, 0);
  assert.equal(g.outcome, 'win');
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
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5));
  assert.ok(g.fleets.filter(f => f.team === 'blue').every(f => f.heading === -Math.PI / 2));
  assert.ok(g.fleets.filter(f => f.team === 'red').every(f => f.heading === Math.PI / 2));
});

test('大将戦: 旗艦は各チーム 1 つで、味方の旗艦はプレイヤー艦隊', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.1, 0.5, 0.9), 'flagship');
  const flags = g.fleets.filter(f => f.flagship);
  assert.equal(flags.length, 2);
  assert.ok(flags.find(f => f.team === 'blue').isPlayer);
  assert.ok(flags.find(f => f.team === 'red'));
});

test('全滅戦: 旗艦はいない', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5));
  assert.equal(g.fleets.filter(f => f.flagship).length, 0);
});

test('大将戦の勝敗: 敵旗艦を倒せば勝ち、味方旗艦が倒されたら負け、同時なら引き分け', () => {
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
  rf.ships = 0;
  assert.equal(L.checkOutcome(fleets), 'draw');
});

test('AI (大将戦): 見えている敵旗艦を、近くて弱い敵より優先して狙う', () => {
  const me = fleet({id: 'me', x: 0, y: 0, leader: true});
  const weakNear = fleet({id: 'weak', team: 'red', x: 300, y: 0, ships: L.INITIAL_SHIPS / 6});
  const flag = fleet({id: 'flag', team: 'red', x: 900, y: 0, flagship: true});
  const intel = {weak: {x: 300, y: 0, visible: true}, flag: {x: 900, y: 0, visible: true}};
  assert.deepEqual(L.aiDecide(me, [me, weakNear, flag], intel, seq(0.5)), {type: 'attack', targetId: 'flag'});
});

test('AI (大将戦): AI の旗艦も隊長として、最終確認位置や敵陣へ攻撃に向かう', () => {
  const flag = fleet({id: 'rf', team: 'red', x: 1200, y: 300, flagship: true, leader: true});
  const intel = {b: {x: 1200, y: 3500, visible: false}};
  assert.deepEqual(L.aiDecide(flag, [flag], intel, seq(0.5)), {type: 'move', x: 1200, y: 3500});
  for(const r of [0, 0.5, 0.99]){
    const o = L.aiDecide(flag, [flag], {}, seq(r));
    assert.ok(o.y >= L.WORLD.h / 2, 'y=' + o.y);
  }
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

test('ミサイル発射: 射程内の見えている敵へ撃ち、間隔が空くまで次を撃たない', () => {
  const b = fleet({id: 'b', x: 0, y: 0});
  const eye = fleet({id: 'eye', x: 400, y: 0});
  const r = fleet({id: 'r', team: 'red', x: L.MISSILE_RANGE - 1, y: 0});
  const g = game([b, eye, r]);
  const fromB = () => g.missiles.filter(m => m.from === 'b');
  L.launchMissiles(g, 0.1);
  assert.equal(fromB().length, 1);
  assert.equal(fromB()[0].targetId, 'r');
  L.launchMissiles(g, L.MISSILE_INTERVAL - 0.5);
  assert.equal(fromB().length, 1);
  L.launchMissiles(g, 0.5);
  assert.equal(fromB().length, 2);
});

test('ミサイル発射: 射程外や見えていない敵には撃たない', () => {
  const b = fleet({id: 'b', x: 0, y: 0});
  const far = fleet({id: 'far', team: 'red', x: L.MISSILE_RANGE + 1, y: 0});
  const g = game([b, far]);
  g.reveal = true; // 見えていても射程外なら撃たない
  L.launchMissiles(g, 0.1);
  assert.equal(g.missiles.filter(m => m.from === 'b').length, 0);
  const hidden = fleet({id: 'hidden', team: 'red', x: L.SENSOR_RANGE + 50, y: 0});
  const g2 = game([fleet({id: 'b2'}), hidden]);
  L.launchMissiles(g2, 0.1);
  assert.equal(g2.missiles.filter(m => m.from === 'b2').length, 0);
});

test('ミサイル: 目標の現在位置へ追尾し、命中するとダメージを与えて消える', () => {
  const b = fleet({id: 'b', x: 0, y: 0});
  const r = fleet({id: 'r', team: 'red', x: 400, y: 0});
  const g = game([b, r]);
  L.launchMissiles(g, 0.1);
  const m = g.missiles.find(x => x.from === 'b');
  r.y = 300; // 目標が動く
  const dmg = new Map();
  L.moveMissiles(g, 0.5, dmg);
  assert.ok(m.y > 0, '目標の方へ曲がる');
  for(let i = 0; i < 20 && g.missiles.includes(m); i++) L.moveMissiles(g, 0.2, dmg);
  assert.ok(!g.missiles.includes(m));
  assert.ok(Math.abs(dmg.get(r) - L.missileDamage(b, r)) < 1e-9);
});

test('ミサイル: 燃え尽きる時間を過ぎたら消え、目標が全滅したら消える', () => {
  const b = fleet({id: 'b', x: 0, y: 0});
  const r = fleet({id: 'r', team: 'red', x: 500, y: 0});
  const g = game([b, r]);
  g.missiles.push({id: 1, team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, life: 0.1, power: 1});
  L.moveMissiles(g, 0.2, new Map());
  assert.equal(g.missiles.length, 0);
  g.missiles.push({id: 2, team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, life: 5, power: 1});
  r.ships = 0;
  L.moveMissiles(g, 0.1, new Map());
  assert.equal(g.missiles.length, 0);
});

test('迎撃: 迎撃範囲内の最も近い敵ミサイルを確率で撃ち落とし、試したら一定時間は次を撃てない', () => {
  const r = fleet({id: 'r', team: 'red', x: 0, y: 0});
  const g = game([r]);
  const incoming = (id, x) => ({id, team: 'blue', from: 'b', targetId: 'r', x, y: 0, life: 5, power: 1});
  g.missiles.push(incoming(1, L.INTERCEPT_RANGE - 1), incoming(2, L.INTERCEPT_RANGE - 2));
  g.missiles.push({id: 3, team: 'red', from: 'r', targetId: 'b', x: 10, y: 0, life: 5, power: 1}); // 味方のミサイルは撃たない
  const ids = () => g.missiles.map(m => m.id).sort();
  L.interceptMissiles(g, 0.1, seq(0)); // 成功
  assert.deepEqual(ids(), [1, 3]);
  L.interceptMissiles(g, 0.1, seq(0)); // 待ち時間中
  assert.deepEqual(ids(), [1, 3]);
  L.interceptMissiles(g, L.INTERCEPT_INTERVAL, seq(0.99)); // 失敗
  assert.deepEqual(ids(), [1, 3]);
  L.interceptMissiles(g, 0.01, seq(0)); // 失敗後も待ち時間がある
  assert.deepEqual(ids(), [1, 3]);
});

// ---------- 第 5 段階 ②: ミサイルの弾数と誘導 / 直進 ----------

test('ミサイルの弾数: 1 艦隊 30 発で出撃し、撃つたびに 1 減り、0 になったら撃たない', () => {
  assert.equal(L.MISSILE_AMMO, 30);
  const g0 = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship');
  assert.ok(g0.fleets.every(f => f.missiles === 30 && f.missileMode === 'guided'), '全艦隊 30 発・誘導で出撃');
  const b = fleet({id: 'b', missiles: 2});
  const r = fleet({id: 'r', team: 'red', x: 400, y: 0});
  const g = game([b, r]);
  L.launchMissiles(g, 0.1);
  assert.equal(b.missiles, 1);
  L.launchMissiles(g, L.MISSILE_INTERVAL);
  assert.equal(b.missiles, 0);
  L.launchMissiles(g, L.MISSILE_INTERVAL);
  assert.equal(g.missiles.filter(m => m.from === 'b').length, 2, '弾がなければ撃たない');
});

test('ミサイル (直進): 撃った時の目標の位置へまっすぐ速く飛ぶ (MISSILE_STRAIGHT_SPEED)。目標がよければ外れて燃え尽きる', () => {
  assert.equal(L.MISSILE_STRAIGHT_SPEED, L.MISSILE_SPEED * 1.5);
  const b = fleet({id: 'b', x: 0, y: 0, missileMode: 'straight'});
  const r = fleet({id: 'r', team: 'red', x: 400, y: 0});
  const g = game([b, r]);
  L.launchMissiles(g, 0.1);
  const m = g.missiles.find(x => x.from === 'b');
  assert.equal(m.guided, false);
  r.y = 300; // 目標がよける
  const dmg = new Map();
  L.moveMissiles(g, 0.5, dmg);
  assert.ok(Math.abs(m.y) < 1e-9 && Math.abs(m.x - L.MISSILE_STRAIGHT_SPEED * 0.5) < 1e-9, '曲がらずにまっすぐ');
  for(let i = 0; i < 100 && g.missiles.includes(m); i++) L.moveMissiles(g, 0.1, dmg);
  assert.ok(!g.missiles.includes(m), '燃え尽きる');
  assert.equal(dmg.get(r), undefined, '当たらない');
});

test('ミサイル (直進): 飛ぶ道の上 (命中の距離の中) に来た敵艦隊に当たる。狙った目標でなくても当たる', () => {
  const b = fleet({id: 'b', x: 0, y: 0, missileMode: 'straight'});
  const r = fleet({id: 'r', team: 'red', x: 400, y: 0});
  const other = fleet({id: 'o', team: 'red', x: 200, y: 5});
  const g = game([b, r, other]);
  g.missiles.push({id: 9, team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, life: 5, power: 1000, guided: false, heading: 0});
  const dmg = new Map();
  for(let i = 0; i < 30 && g.missiles.length; i++) L.moveMissiles(g, 1 / 30, dmg);
  assert.equal(g.missiles.length, 0);
  assert.ok(Math.abs(dmg.get(other) - 1000 * L.mitigation(other.params)) < 1e-9, '途中の敵に当たる');
  assert.equal(dmg.get(r), undefined);
});

test('迎撃: 誘導のミサイルだけを撃ち落とす (直進のミサイルは迎撃しない。よけるもの)', () => {
  const r = fleet({id: 'r', team: 'red', x: 0, y: 0});
  const g = game([r]);
  g.missiles.push({id: 1, team: 'blue', from: 'b', targetId: 'r', x: 50, y: 0, life: 5, power: 1, guided: false, heading: Math.PI});
  L.interceptMissiles(g, 0.1, seq(0));
  assert.equal(g.missiles.length, 1, '直進は撃たない');
  g.missiles.push({id: 2, team: 'blue', from: 'b', targetId: 'r', x: 60, y: 0, life: 5, power: 1});
  L.interceptMissiles(g, L.INTERCEPT_INTERVAL, seq(0));
  assert.deepEqual(g.missiles.map(m => m.id), [1], '誘導は撃ち落とす');
});

// 直進ミサイルの場面: 赤のミサイルが (0, 0) から東 (向き 0) へ飛ぶ
const straight = over => Object.assign({id: 1, team: 'red', from: 'r', targetId: 'b', x: 0, y: 0, life: 5, power: 1, guided: false, heading: 0}, over);

test('よける (AI): 敵の直進ミサイルが DODGE_LOOKAHEAD 秒以内に当たる距離を通るなら、ミサイルの道から離れる向きへ横にずれる', () => {
  assert.equal(L.DODGE_LOOKAHEAD, 2);
  const b = fleet({id: 'b', x: 300, y: 10}); // ミサイルの道の少し南 (y が大きい側)
  const o = L.dodgeOrder(b, [straight()]);
  assert.equal(o.type, 'course');
  assert.ok(Math.abs(o.angle - Math.PI / 2) < 1e-9, '南へ (道から離れる向き)');
  const n = fleet({id: 'n', x: 300, y: -10});
  assert.ok(Math.abs(L.dodgeOrder(n, [straight()]).angle + Math.PI / 2) < 1e-9, '北側にいれば北へ');
});

test('よける (AI): 誘導・味方・遠ざかる・遠く (索敵の外や DODGE_LOOKAHEAD より先)・道から離れたミサイルはよけない', () => {
  const b = fleet({id: 'b', x: 300, y: 0});
  assert.equal(L.dodgeOrder(b, [straight({guided: undefined})]), null, '誘導');
  assert.equal(L.dodgeOrder(b, [straight({team: 'blue'})]), null, '味方');
  assert.equal(L.dodgeOrder(b, [straight({heading: Math.PI})]), null, '遠ざかる');
  assert.equal(L.dodgeOrder(fleet({id: 'b', x: L.MISSILE_STRAIGHT_SPEED * 2.5, y: 0}), [straight()]), null, '2 秒より先');
  assert.equal(L.dodgeOrder(fleet({id: 'b', x: 300, y: 200}), [straight()]), null, '道から離れている');
  assert.equal(L.dodgeOrder(fleet({id: 'b', x: 300, y: 0}), [straight({x: -L.SENSOR_RANGE - 10})]), null, '索敵の外');
});

test('よける (AI): 試合の中で、AI の艦隊は直進ミサイルをよける (プレイヤーの艦隊は自動ではよけない)', () => {
  const run = isPlayer => {
    const b = fleet({id: 'b', x: 300, y: 0, isPlayer, order: null, ai: {nextThink: 99}});
    const r = fleet({id: 'r', team: 'red', x: 0, y: -2000, weapons: {laser: false, torpid: false}, ai: {nextThink: 99}});
    const g = Object.assign(game([b, r]), {mode: 'annihilation'});
    g.missiles.push(straight({power: 1000}));
    for(let i = 0; i < 60; i++) L.step(g, 1 / 30, seq(0.5));
    return b.ships;
  };
  assert.equal(run(false), L.INITIAL_SHIPS, 'AI はよけて無傷');
  assert.ok(run(true) < L.INITIAL_SHIPS, 'プレイヤーは当たる');
});

test('迎撃: 迎撃範囲の外のミサイルは撃たない', () => {
  const r = fleet({id: 'r', team: 'red', x: 0, y: 0});
  const g = game([r]);
  g.missiles.push({id: 1, team: 'blue', from: 'b', targetId: 'r', x: L.INTERCEPT_RANGE + 1, y: 0, life: 5, power: 1});
  L.interceptMissiles(g, 0.1, seq(0));
  assert.equal(g.missiles.length, 1);
});

// ---------- 第 2.5 段階 ----------

test('艦艇数: 初期艦艇数は原作どおり 15000', () => {
  assert.equal(L.INITIAL_SHIPS, 15000);
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5));
  assert.ok(g.fleets.every(f => f.ships === 15000));
});

test('AI: 弱さは艦艇数の割合で評価する (初期艦艇数を変えても判断が変わらない)', () => {
  const me = fleet({id: 'me', x: 0, y: 0, leader: true});
  const fullNear = fleet({id: 'full', team: 'red', x: 400, y: 0, ships: L.INITIAL_SHIPS});
  const halfFar = fleet({id: 'half', team: 'red', x: 1500, y: 0, ships: L.INITIAL_SHIPS / 2});
  const intel = {full: {x: 400, y: 0, visible: true}, half: {x: 1500, y: 0, visible: true}};
  // 距離 4 + 割合 1×6 = 10 < 距離 15 + 割合 0.5×6 = 18
  assert.deepEqual(L.aiDecide(me, [me, fullNear, halfFar], intel, seq(0.5)), {type: 'attack', targetId: 'full'});
});

test('ゲーム作成: どの艦隊も SPEED 4・LASER と TORPID オンで始まる', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5));
  for(const f of g.fleets){
    assert.equal(f.throttle, 4);
    assert.deepEqual(f.weapons, {laser: true, torpid: true});
  }
});

test('SPEED: 段階に比例した速さで進み、0 では止まるが命令は残る', () => {
  const full = L.maxSpeed({speed: 34, defense: 33, attack: 33});
  const f = fleet({throttle: 2, order: {type: 'move', x: 5000, y: 0}});
  L.moveFleet(f, 1, {});
  assert.ok(Math.abs(f.x - full / 2) < 1e-9);
  f.throttle = 0;
  L.moveFleet(f, 1, {});
  assert.ok(Math.abs(f.x - full / 2) < 1e-9);
  assert.deepEqual(f.order, {type: 'move', x: 5000, y: 0});
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

test('LASER オフ: ビームの攻撃対象を選ばない', () => {
  const me = fleet({id: 'me', weapons: {laser: false, torpid: true}});
  const e = fleet({id: 'e', team: 'red', x: 50, y: 0});
  assert.equal(L.chooseTarget(me, [e]), null);
});

test('TORPID オフ: ミサイルは撃たないが、迎撃はする', () => {
  const b = fleet({id: 'b', x: 0, y: 0, weapons: {laser: true, torpid: false}});
  const r = fleet({id: 'r', team: 'red', x: 300, y: 0});
  const g = game([b, r]);
  L.launchMissiles(g, 0.1);
  assert.equal(g.missiles.filter(m => m.from === 'b').length, 0);
  g.missiles = [{id: 9, team: 'red', from: 'r', targetId: 'b', x: 50, y: 0, life: 5, power: 1}];
  L.interceptMissiles(g, 0.1, seq(0));
  assert.equal(g.missiles.length, 0);
});

// ---------- 第 2.6 段階 ----------

test('AI (隊長): すでに敵陣側にいて手がかりがなければ、マップ全体から索敵先を選ぶ (すれ違い対策)', () => {
  const blue = fleet({id: 'b', x: 1200, y: 500, leader: true}); // 青にとって敵陣側 (上半分)
  const o = L.aiDecide(blue, [blue], {}, seq(0.5, 0.9));
  assert.equal(o.type, 'move');
  assert.ok(o.y > L.WORLD.h / 2, '自陣側に戻ることもある y=' + o.y);
  const red = fleet({id: 'r', team: 'red', x: 1200, y: 4300, leader: true}); // 赤にとって敵陣側 (下半分)
  const or = L.aiDecide(red, [red], {}, seq(0.5, 0.1));
  assert.ok(or.y < L.WORLD.h / 2, 'y=' + or.y);
});

test('クラシック: ジョブはなく、AI のステータスは v1.2 と同じ 4 つの型 (合計 100)', () => {
  assert.equal(L.JOBS, undefined);
  assert.deepEqual(L.AI_PRESETS.map(p => p.name), ['高速型', '重装型', '攻撃型', '均等型']);
  for(const p of L.AI_PRESETS) assert.ok(L.validateParams(p.params), p.name);
});

test('クラシック: プレイヤーはスライダーで配分したステータス、AI は 4 つの型のどれか', () => {
  const mine = {speed: 45, defense: 15, attack: 40};
  const g = L.createGame(mine, seq(0.1, 0.4, 0.7, 0.95));
  const me = g.fleets.find(f => f.isPlayer);
  assert.deepEqual(me.params, mine);
  assert.equal(me.type, 'プレイヤー');
  const presetParams = L.AI_PRESETS.map(p => JSON.stringify(p.params));
  const names = L.AI_PRESETS.map(p => p.name);
  for(const f of g.fleets.filter(f => !f.isPlayer)){
    assert.ok(presetParams.includes(JSON.stringify(f.params)), f.id);
    assert.ok(names.includes(f.type), f.id);
  }
});

test('隊長: 各チーム 1 つ。青はプレイヤー、どちらも横一列の真ん中から出撃', () => {
  for(const mode of ['annihilation', 'flagship']){
    const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.1, 0.5, 0.9, 0.3), mode);
    for(const team of ['blue', 'red']){
      const leaders = g.fleets.filter(f => f.team === team && f.leader);
      assert.equal(leaders.length, 1, mode + ' ' + team);
      assert.equal(leaders[0].x, L.WORLD.w / 2, mode + ' ' + team);
      if(mode === 'flagship') assert.ok(leaders[0].flagship);
      else assert.ok(!leaders[0].flagship);
    }
    assert.ok(g.fleets.find(f => f.team === 'blue' && f.leader).isPlayer);
    const xs = g.fleets.filter(f => f.team === 'red').map(f => f.x);
    assert.equal(new Set(xs).size, 5);
  }
});

test('出撃位置は点対称: 赤の n 番目の護衛は、青の n 番目の護衛をマップの中心について 180° 回した位置 (隊列の左右が両チームで同じになる。第 5 段階)', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.1, 0.5, 0.9, 0.3), 'flagship');
  const escorts = team => g.fleets.filter(f => f.team === team && !f.leader);
  const blue = escorts('blue'), red = escorts('red');
  blue.forEach((b, k) => {
    assert.equal(red[k].x, L.WORLD.w - b.x, '左右が逆');
    assert.equal(red[k].y, L.WORLD.h - b.y, '上下が逆');
  });
});

test('隊長 (全滅戦): 隊長が全滅したら、生き残りで艦艇数が最も多い艦隊が引き継ぐ', () => {
  const lead = fleet({id: 'l', leader: true, ships: 0});
  const a = fleet({id: 'a', ships: 5000});
  const b = fleet({id: 'b', ships: 9000});
  const r = fleet({id: 'r', team: 'red', leader: true});
  L.updateLeaders([lead, a, b, r]);
  assert.deepEqual([lead.leader, a.leader, b.leader, r.leader], [false, false, true, true]);
});

test('隊長: 隊長のいないチームでは、艦艇数が最も多い艦隊が隊長になる', () => {
  const a = fleet({id: 'a', ships: 5000});
  const b = fleet({id: 'b', ships: 5000});
  L.updateLeaders([a, b]);
  assert.deepEqual([a.leader, b.leader], [true, false]); // 同じなら先の艦隊
});

test('AI (護衛): 隊長から 600 以内に見えている敵がいれば迎え撃つ', () => {
  const leader = fleet({id: 'lead', x: 1000, y: 3000, leader: true});
  const me = fleet({id: 'me', x: 800, y: 3100});
  const near = fleet({id: 'near', team: 'red', x: 1000, y: 2500});
  const intel = {near: {x: 1000, y: 2500, visible: true}};
  assert.deepEqual(L.aiDecide(me, [leader, me, near], intel, seq(0.5)), {type: 'attack', targetId: 'near'});
});

test('AI (護衛): 隊長から遠い敵は追わず、隊長の周りの決まった位置へ付いていく', () => {
  const leader = fleet({id: 'lead', x: 1200, y: 3000, leader: true, heading: -Math.PI / 2}); // 北向き
  const escorts = [0, 1, 2, 3].map(i => fleet({id: 'e' + i, x: 1200, y: 4000}));
  const far = fleet({id: 'far', team: 'red', x: 1200, y: 1000});
  const intel = {far: {x: 1200, y: 1000, visible: true}};
  const fleets = [leader, ...escorts, far];
  const orders = escorts.map(e => L.aiDecide(e, fleets, intel, seq(0.5)));
  for(const o of orders) assert.equal(o.type, 'move');
  const pos = orders.map(o => [Math.round(o.x), Math.round(o.y)]);
  // 北向きの隊長に対して: 左前・右前・左・右 (護衛が隊長より前に出て、敵とぶつかる。第 5 段階)
  assert.ok(pos[0][0] < 1200 && pos[1][0] > 1200, '前の左右');
  assert.ok(pos[2][0] < 1200 && pos[3][0] > 1200, '横の左右');
  assert.ok(pos[0][1] < 3000 && pos[1][1] < 3000, '前の 2 つは隊長より北 (前)');
  assert.ok(pos[2][1] > pos[0][1] && pos[3][1] > pos[1][1], '横の 2 つは前の 2 つより南');
  assert.equal(new Set(pos.map(p => p.join(','))).size, 4, '位置は重ならない');
});

test('隊形の速さ (AI の隊長): 一番遅い生きている護衛の最大の速さ × FORMATION_SPEED_RATIO より速く進まない (隊形が伸びないように)。プレイヤーと護衛は制限なし', () => {
  assert.equal(L.FORMATION_SPEED_RATIO, 0.85);
  const leader = fleet({id: 'lead', leader: true, params: {speed: 100, defense: 0, attack: 0}});
  const slow = fleet({id: 's', params: {speed: 0, defense: 50, attack: 50}});
  const fast = fleet({id: 'f2', params: {speed: 50, defense: 25, attack: 25}});
  const dead = fleet({id: 'd', params: {speed: 0, defense: 50, attack: 50}, ships: 0});
  const fleets = [leader, slow, fast, dead, fleet({id: 'r', team: 'red', params: {speed: 0, defense: 50, attack: 50}})];
  assert.equal(L.formationSpeedCap(leader, fleets), L.maxSpeed(slow.params) * 0.85, '全滅した艦隊と敵は数えない');
  assert.equal(L.formationSpeedCap(slow, fleets), null, '護衛は制限なし');
  assert.equal(L.formationSpeedCap(Object.assign({}, leader, {isPlayer: true}), fleets), null, 'プレイヤーは制限なし');
  assert.equal(L.formationSpeedCap(leader, [leader]), null, '護衛がいなければ制限なし');
  const g = Object.assign(game([Object.assign(leader, {order: {type: 'move', x: 2000, y: 0}}), slow, fast]), {mode: 'annihilation'});
  for(const f of g.fleets) f.ai.nextThink = 99;
  L.step(g, 1, seq(0.5));
  assert.ok(Math.abs(leader.x - L.maxSpeed(slow.params) * 0.85) < 1e-6, '1 秒で進んだ距離が制限の速さ');
});

test('AI (護衛): 隊列の位置もマップの内側に収める', () => {
  const leader = fleet({id: 'lead', x: 0, y: 3000, leader: true, heading: -Math.PI / 2});
  const me = fleet({id: 'me', x: 500, y: 3000});
  const o = L.aiDecide(me, [leader, me], {}, seq(0.5));
  assert.ok(o.x >= 0 && o.x <= L.WORLD.w && o.y >= 0 && o.y <= L.WORLD.h);
});

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

// ---------- 第 5 段階 ③: 敵のズル (原作のコンピ研役) ----------

test('敵のズル: createGame の options.enemyCheat で有効 (初めはなし)。有効なら敵 (赤) は最初から全部見える (索敵モードのオフ)', () => {
  const off = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship');
  assert.equal(off.enemyCheat, false);
  const on = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship', {enemyCheat: true});
  assert.equal(on.enemyCheat, true);
  L.step(on, 1 / 30, seq(0.5));
  assert.ok(on.fleets.filter(f => f.team === 'blue').every(f => on.intel.red[f.id] && on.intel.red[f.id].visible), '赤は青を全部見える');
  L.step(off, 1 / 30, seq(0.5));
  assert.ok(!off.fleets.filter(f => f.team === 'blue').every(f => off.intel.red[f.id] && off.intel.red[f.id].visible), 'ズルなしなら見えない');
  assert.ok(!on.fleets.filter(f => f.team === 'red').every(f => on.intel.blue[f.id] && on.intel.blue[f.id].visible), '青には効かない');
});

test('敵のワープ (奇襲): ズルが有効なら CHEAT_WARP_INTERVAL (30) 秒ごとに、赤の一番艦艇の多い護衛が、青の隊長の後ろ CHEAT_WARP_DISTANCE へワープして隊長を攻撃する', () => {
  assert.deepEqual([L.CHEAT_WARP_INTERVAL, L.CHEAT_WARP_DISTANCE], [30, 200]);
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship', {enemyCheat: true});
  const leader = g.fleets.find(f => f.team === 'blue' && f.leader);
  const reds = g.fleets.filter(f => f.team === 'red' && !f.leader);
  reds[2].ships = L.INITIAL_SHIPS + 1; // 一番多い護衛
  for(const f of g.fleets) f.ai.nextThink = 999;
  g.time = L.CHEAT_WARP_INTERVAL - 0.01;
  L.step(g, 1 / 30, seq(0.5));
  const w = reds[2];
  const behind = {x: leader.x - Math.cos(leader.heading) * 200, y: leader.y - Math.sin(leader.heading) * 200};
  assert.ok(Math.hypot(w.x - behind.x, w.y - behind.y) < 20, '隊長の後ろへ');
  assert.deepEqual(w.order, {type: 'attack', targetId: leader.id});
  assert.equal(g.enemyWarps.length, 1);
  assert.equal(g.enemyWarps[0].id, w.id);
  L.step(g, 1, seq(0.5));
  assert.equal(g.enemyWarps.length, 1, '次は 30 秒あける');
});

test('敵のワープ: ズルがなければワープしない', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship');
  for(const f of g.fleets) f.ai.nextThink = 999;
  g.time = L.CHEAT_WARP_INTERVAL - 0.01;
  L.step(g, 1 / 30, seq(0.5));
  assert.equal((g.enemyWarps || []).length, 0);
});

// ---------- 第 5 段階 ④: 分艦隊 (プレイヤー) ----------

// プレイヤーの艦隊 (旗艦) と AI の味方・敵がいる試合
function splitGame(){
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship');
  for(const f of g.fleets) f.ai.nextThink = 999;
  return {g, me: g.fleets.find(f => f.isPlayer)};
}

test('分艦隊: splitFleet で隻数を指定して切り出す。同じ場所に出て、ミサイルは隻数の割合で分ける。旗艦は元の艦隊に残る', () => {
  assert.equal(L.SUBFLEET_MAX, 20);
  const {g, me} = splitGame();
  const sub = L.splitFleet(g, me, 3000);
  assert.ok(sub);
  assert.equal(me.ships, L.INITIAL_SHIPS - 3000);
  assert.equal(sub.ships, 3000);
  assert.equal(sub.missiles, Math.floor(L.MISSILE_AMMO * 3000 / L.INITIAL_SHIPS));
  assert.equal(me.missiles + sub.missiles, L.MISSILE_AMMO, '弾の合計は変わらない');
  assert.ok(Math.hypot(sub.x - me.x, sub.y - me.y) <= 60, 'そばに出る');
  assert.deepEqual([sub.team, sub.isPlayer, sub.flagship, sub.leader], ['blue', true, false, false]);
  assert.deepEqual(sub.params, me.params);
  assert.ok(me.flagship, '旗艦は元の艦隊');
  assert.ok(g.fleets.includes(sub));
  assert.notEqual(sub.id, me.id);
  assert.ok(sub.name.includes('分艦隊'));
});

test('分艦隊: 1 隻以上残さないといけない (0 隻・全部・小数は切り出せない)。自分の艦隊は合計 SUBFLEET_MAX まで。敵や AI の艦隊は分けられない', () => {
  const {g, me} = splitGame();
  assert.equal(L.splitFleet(g, me, 0), null);
  assert.equal(L.splitFleet(g, me, L.INITIAL_SHIPS), null);
  assert.equal(L.splitFleet(g, me, 10.5), null);
  assert.equal(L.splitFleet(g, g.fleets.find(f => f.team === 'blue' && !f.isPlayer), 100), null, 'AI の味方');
  for(let i = 0; i < 19; i++) assert.ok(L.splitFleet(g, me, 10), String(i));
  assert.equal(g.fleets.filter(f => f.isPlayer && f.ships > 0).length, 20);
  assert.equal(L.splitFleet(g, me, 10), null, '21 個目は作れない');
});

test('合流: merge 命令で合流先へ近づき、MERGE_RANGE 以内で 1 つになる (隻数と弾を足す)。旗艦が絡むときは旗艦の側に残る', () => {
  assert.equal(L.MERGE_RANGE, 40);
  const {g, me} = splitGame();
  const sub = L.splitFleet(g, me, 3000);
  sub.x += 500;
  sub.order = {type: 'merge', targetId: me.id};
  for(let i = 0; i < 30 * 10 && sub.ships > 0; i++) L.step(g, 1 / 30, seq(0.5));
  assert.equal(sub.ships, 0);
  assert.ok(sub.merged);
  assert.equal(me.ships, L.INITIAL_SHIPS);
  assert.equal(me.missiles, L.MISSILE_AMMO);
  // 旗艦の側から分艦隊へ合流しても、旗艦が残る
  const sub2 = L.splitFleet(g, me, 2000);
  L.mergeFleets(g, me, sub2);
  assert.ok(me.flagship && me.ships === L.INITIAL_SHIPS && sub2.merged);
});

test('合流: 合流先が全滅・合流済みなら merge 命令は消える', () => {
  const {g, me} = splitGame();
  const a = L.splitFleet(g, me, 3000), b = L.splitFleet(g, me, 3000);
  b.x += 800;
  b.order = {type: 'merge', targetId: a.id};
  a.ships = 0;
  L.step(g, 1 / 30, seq(0.5));
  assert.equal(b.order, null);
});

test('分艦隊: AI の味方の護衛は、プレイヤーの分艦隊を数えずに隊列の位置を決める', () => {
  const {g, me} = splitGame();
  const escort = g.fleets.find(f => f.team === 'blue' && !f.isPlayer);
  const before = L.aiDecide(escort, g.fleets, g.intel.blue, seq(0.5));
  L.splitFleet(g, me, 3000);
  const after = L.aiDecide(escort, g.fleets, g.intel.blue, seq(0.5));
  assert.deepEqual(after, before);
});

// ---------- 第 5 段階 ⑤: AI の偵察用の分艦隊 ----------

test('偵察 (AI): 出撃してすぐ、各チームの AI の護衛のうち左右の端の 2 艦隊が SCOUT_SHIPS (500) 隻ずつ偵察の分艦隊を切り出す。プレイヤーの艦隊からは出さない。沈んでも出し直さない', () => {
  assert.deepEqual([L.SCOUT_COUNT, L.SCOUT_SHIPS], [2, 500]);
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship');
  L.step(g, 1 / 30, seq(0.5));
  for(const team of ['blue', 'red']){
    const scouts = g.fleets.filter(f => f.team === team && f.scout);
    assert.equal(scouts.length, 2, team);
    assert.ok(scouts.every(f => f.ships === 500 && !f.isPlayer && !f.leader && !f.flagship), team);
    const parents = scouts.map(sc => g.fleets.find(f => f.id === sc.root));
    assert.ok(parents.every(p => !p.isPlayer && !p.leader && p.ships === L.INITIAL_SHIPS - 500), team + ' 親は AI の護衛');
    const xs = g.fleets.filter(f => f.team === team && !f.scout && !f.leader).map(f => f.x);
    assert.deepEqual(parents.map(p => p.x).sort((a, b) => a - b), [Math.min(...xs), Math.max(...xs)], team + ' 左右の端');
    assert.deepEqual(scouts.map(sc => sc.scoutSide).sort(), [-1, 1]);
  }
  for(const f of g.fleets.filter(f => f.scout)) f.ships = 0;
  L.step(g, 1 / 30, seq(0.5));
  assert.equal(g.fleets.filter(f => f.scout).length, 4, '出し直さない');
});

// 偵察の分艦隊 1 つ (青、左側担当) と、必要なら敵
function scoutScene(extra){
  const sc = fleet({id: 'sc', x: 600, y: 3000, scout: true, scoutSide: -1, ships: 500});
  const lead = fleet({id: 'lead', x: 1200, y: 4500, leader: true});
  return [sc, lead, ...(extra || [])];
}

test('偵察 (AI): 敵の手がかりがなければ、敵陣側の自分の担当 (左右の半分) の中を探して回る', () => {
  const fleets = scoutScene();
  const o = L.aiDecide(fleets[0], fleets, {}, seq(0.3));
  assert.equal(o.type, 'move');
  assert.ok(o.explore);
  assert.ok(o.x <= L.WORLD.w / 2, '左側の担当');
  assert.ok(o.y < L.WORLD.h / 2, '敵陣側 (青は上)');
});

test('偵察 (AI): 敵が見えていれば SCOUT_WATCH_DISTANCE を保って見張る (敵旗艦を優先)。自分からは攻撃に行かない', () => {
  const e = fleet({id: 'e', team: 'red', x: 600, y: 2400});
  const rf = fleet({id: 'rf', team: 'red', x: 900, y: 2300, flagship: true});
  const fleets = scoutScene([e, rf]);
  const intel = {e: {x: e.x, y: e.y, visible: true}, rf: {x: rf.x, y: rf.y, visible: true}};
  const o = L.aiDecide(fleets[0], fleets, intel, seq(0.3));
  assert.equal(o.type, 'move');
  assert.ok(Math.abs(Math.hypot(o.x - rf.x, o.y - rf.y) - L.SCOUT_WATCH_DISTANCE) < 1e-6, '敵旗艦から見張る距離');
  delete intel.rf;
  const o2 = L.aiDecide(fleets[0], fleets.filter(f => f.id !== 'rf'), intel, seq(0.3));
  assert.ok(Math.abs(Math.hypot(o2.x - e.x, o2.y - e.y) - L.SCOUT_WATCH_DISTANCE) < 1e-6, '旗艦が見えなければ近い敵');
});

test('偵察 (AI): 敵が SCOUT_SAFE_DISTANCE より近ければ、その敵から離れる', () => {
  assert.ok(L.SCOUT_SAFE_DISTANCE > L.BEAM_RANGE, 'ビームの射程の外');
  const e = fleet({id: 'e', team: 'red', x: 600, y: 3000 - L.SCOUT_SAFE_DISTANCE + 50});
  const fleets = scoutScene([e]);
  const o = L.aiDecide(fleets[0], fleets, {e: {x: e.x, y: e.y, visible: true}}, seq(0.3));
  assert.equal(o.type, 'move');
  assert.ok(o.y > 3000, '敵 (北) と反対の南へ');
});

test('偵察 (AI): 護衛の隊列と隊形の速さには偵察の分艦隊を数えない', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship');
  for(const f of g.fleets) f.ai.nextThink = 999;
  const escort = g.fleets.find(f => f.team === 'red' && !f.leader && f.x > 1000 && f.x < 1400) || g.fleets.find(f => f.team === 'red' && !f.leader);
  const leader = g.fleets.find(f => f.team === 'red' && f.leader);
  const before = [L.aiDecide(escort, g.fleets, g.intel.red, seq(0.5)), L.formationSpeedCap(leader, g.fleets)];
  g.fleets.push(Object.assign({}, escort, {id: 'red-scout', scout: true, ships: 500, params: {speed: 0, defense: 50, attack: 50}}));
  const after = [L.aiDecide(escort, g.fleets, g.intel.red, seq(0.5)), L.formationSpeedCap(leader, g.fleets)];
  assert.deepEqual(after, before);
});

// ---------- 第 6 段階: AI を差し替える (学習型 AI のため) ----------

test('controllers: createGame の options.controllers のチームの AI の艦隊は、その関数で命令を決める (偵察の分艦隊は今のルールのまま)。渡さないチームは今の AI', () => {
  const calls = [];
  const red = (f, fleets, intel, rng) => { calls.push([f.id, fleets.length > 0, typeof intel, typeof rng]); return {type: 'move', x: 1200, y: 2400}; };
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, seq(0.5), 'flagship', {controllers: {red}});
  L.step(g, 1 / 30, seq(0.5));
  L.step(g, 1 / 30, seq(0.5)); // 偵察は最初の step の終わりに出るので、命令は次の step から
  const reds = g.fleets.filter(f => f.team === 'red' && !f.scout);
  assert.deepEqual(calls.map(c => c[0]).sort(), reds.map(f => f.id).sort(), '赤の偵察以外の艦隊ごとに呼ぶ');
  assert.ok(calls.every(c => c[1] && c[2] === 'object' && c[3] === 'function'), '(f, fleets, intel, rng) を渡す');
  assert.ok(reds.every(f => f.order && f.order.x === 1200 && f.order.y === 2400));
  assert.ok(g.fleets.filter(f => f.team === 'red' && f.scout).every(f => f.order && f.order.explore), '偵察は今のルール');
  assert.ok(g.fleets.filter(f => f.team === 'blue' && !f.isPlayer && !f.scout).every(f => !(f.order && f.order.x === 1200 && f.order.y === 2400)), '青は今の AI');
});
