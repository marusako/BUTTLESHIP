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
    throttle: 4, weapons: {laser: true, torpid: true}
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

test('パラメータ配分: 合計 100・各 10 以上・整数だけ有効', () => {
  assert.equal(L.validateParams({speed: 34, defense: 33, attack: 33}), true);
  assert.equal(L.validateParams({speed: 10, defense: 10, attack: 80}), true);
  assert.equal(L.validateParams({speed: 34, defense: 33, attack: 34}), false); // 合計 101
  assert.equal(L.validateParams({speed: 9, defense: 45, attack: 46}), false);  // 10 未満
  assert.equal(L.validateParams({speed: 33.5, defense: 33.5, attack: 33}), false); // 小数
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
  const intel = {e: {x: 3000, y: 0, visible: true}};
  for(let i = 0; i < 400; i++) L.moveFleet(f, 0.1, intel);
  assert.ok(f.x < 3000 - L.BEAM_RANGE * 0.5 && f.x > 3000 - L.BEAM_RANGE);
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

test('AI: 損害が大きいと味方の近くへ下がる', () => {
  const me = fleet({id: 'me', x: 2000, y: 1500, ships: L.INITIAL_SHIPS * 0.2});
  const a1 = fleet({id: 'a1', x: 400, y: 1000});
  const a2 = fleet({id: 'a2', x: 600, y: 2000});
  const e = fleet({id: 'e', team: 'red', x: 2100, y: 1500});
  const order = L.aiDecide(me, [me, a1, a2, e], {e: {x: 2100, y: 1500, visible: true}}, seq(0.5));
  assert.deepEqual(order, {type: 'move', x: 500, y: 1500});
});

test('AI: 損害が大きくても、味方が残っていなければ後退しない', () => {
  const me = fleet({id: 'me', x: 2000, y: 1500, ships: L.INITIAL_SHIPS * 0.2});
  const e = fleet({id: 'e', team: 'red', x: 2100, y: 1500});
  const order = L.aiDecide(me, [me, e], {e: {x: 2100, y: 1500, visible: true}}, seq(0.5));
  assert.deepEqual(order, {type: 'attack', targetId: 'e'});
});

test('AI: 索敵中は目的地に着くまで目的地を変えない', () => {
  const me = fleet({id: 'me', x: 300, y: 1500});
  const first = L.aiDecide(me, [me], {}, seq(0.5));
  me.order = first;
  assert.deepEqual(L.aiDecide(me, [me], {}, seq(0.9)), first);
});

test('AI: 見えている敵がいれば近くて弱い敵を狙う', () => {
  const me = fleet({id: 'me', x: 0, y: 0});
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

test('AI: 敵が見えず最終確認位置があれば、最も近いそこへ向かう', () => {
  const me = fleet({id: 'me', x: 0, y: 0});
  const intel = {a: {x: 1000, y: 0, visible: false}, b: {x: 500, y: 0, visible: false}};
  assert.deepEqual(L.aiDecide(me, [me], intel, seq(0.5)), {type: 'move', x: 500, y: 0});
});

test('AI: 手がかりがなければ敵陣の方向 (青は上・赤は下の半分) へ索敵に出る', () => {
  const blue = fleet({id: 'b', x: 1200, y: L.WORLD.h - 300});
  const red = fleet({id: 'r', team: 'red', x: 1200, y: 300});
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
  const f = fleet({order: {type: 'move', x: 1000, y: 0}});
  L.moveFleet(f, 1, {});
  assert.equal(f.heading, 0);
  f.order = {type: 'move', x: f.x, y: -1000};
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
  const me = fleet({id: 'me', x: 0, y: 0});
  const weakNear = fleet({id: 'weak', team: 'red', x: 300, y: 0, ships: L.INITIAL_SHIPS / 6});
  const flag = fleet({id: 'flag', team: 'red', x: 900, y: 0, flagship: true});
  const intel = {weak: {x: 300, y: 0, visible: true}, flag: {x: 900, y: 0, visible: true}};
  assert.deepEqual(L.aiDecide(me, [me, weakNear, flag], intel, seq(0.5)), {type: 'attack', targetId: 'flag'});
});

test('AI (大将戦): AI の旗艦は自陣側の半分だけを索敵し、最終確認位置も追わない', () => {
  const flag = fleet({id: 'rf', team: 'red', x: 1200, y: 300, flagship: true});
  const intel = {b: {x: 1200, y: 3500, visible: false}};
  for(const r of [0, 0.5, 0.99]){
    const o = L.aiDecide(flag, [flag], intel, seq(r));
    assert.equal(o.type, 'move');
    assert.ok(o.y <= L.WORLD.h / 2, 'y=' + o.y);
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
  const me = fleet({id: 'me', x: 0, y: 0});
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
