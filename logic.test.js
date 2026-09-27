const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');

// テスト用の艦隊を作る
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', x: 0, y: 0,
    ships: L.INITIAL_SHIPS, params: {speed: 34, defense: 33, attack: 33},
    order: null, isPlayer: false, ai: {nextThink: 0},
    heading: 0, flagship: false, shellCooldown: 0, torpedoCooldown: 0, interceptCooldown: 0,
    throttle: 4, weapons: {shell: true, torpid: true}
  }, over);
}

// テスト用のゲーム状態を作る
function game(fleets){
  return {time: 0, fleets, intel: {blue: {}, red: {}}, locks: [], projectiles: [], nextProjectileId: 1, events: [],
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
  assert.ok(L.shellDps(a, soft) > L.shellDps(b, soft));
  assert.ok(L.shellDps(a, soft) > L.shellDps(a, hard));
});

test('ダメージ: 艦艇数が減ると火力も落ちるが、下限がある', () => {
  const target = fleet();
  const full = L.shellDps(fleet({ships: L.INITIAL_SHIPS}), target);
  const half = L.shellDps(fleet({ships: L.INITIAL_SHIPS / 2}), target);
  assert.ok(half < full);
  const floorShips = L.INITIAL_SHIPS * L.FIREPOWER_FLOOR;
  assert.equal(L.shellDps(fleet({ships: 10}), target), L.shellDps(fleet({ships: floorShips}), target));
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

test('狙い: 狙いを定める範囲 (LOCK_RANGE) 内で見えている最も近い敵を選ぶ', () => {
  const me = fleet({id: 'me'});
  const near = fleet({id: 'near', team: 'red', x: 100, y: 0});
  const nearer = fleet({id: 'nearer', team: 'red', x: 50, y: 0});
  const out = fleet({id: 'out', team: 'red', x: L.LOCK_RANGE + 1, y: 0});
  assert.equal(L.lockTarget(me, [near, nearer, out]).id, 'nearer');
  assert.equal(L.lockTarget(me, [out]), null);
});

test('狙い: 攻撃命令の相手が狙える範囲内ならそちらを優先', () => {
  const me = fleet({id: 'me', order: {type: 'attack', targetId: 'near'}});
  const near = fleet({id: 'near', team: 'red', x: 100, y: 0});
  const nearer = fleet({id: 'nearer', team: 'red', x: 50, y: 0});
  assert.equal(L.lockTarget(me, [near, nearer]).id, 'near');
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

test('移動: 攻撃命令は見えている相手に、撃てる範囲 (FIRE_RANGE) の内側まで近づいて止まる', () => {
  const f = fleet({order: {type: 'attack', targetId: 'e'}});
  const intel = {e: {x: 2000, y: 0, visible: true}};
  for(let i = 0; i < 400; i++) L.moveFleet(f, 0.1, intel);
  assert.ok(f.x < 2000 - L.FIRE_RANGE * 0.5 && f.x > 2000 - L.FIRE_RANGE);
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

test('AI (旗艦): 索敵中は目的地に着くまで目的地を変えない', () => {
  const me = fleet({id: 'me', x: 300, y: 1500, role: 'flagship'});
  const first = L.aiDecide(me, [me], {}, seq(0.5));
  me.order = first;
  assert.deepEqual(L.aiDecide(me, [me], {}, seq(0.9)), first);
});

test('AI (旗艦): 見えている敵がいれば近くて弱い敵を狙う', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'flagship'});
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

test('AI (旗艦): 敵が見えず最終確認位置があれば、最も近いそこへ向かう', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'flagship'});
  const intel = {a: {x: 1000, y: 0, visible: false}, b: {x: 500, y: 0, visible: false}};
  assert.deepEqual(L.aiDecide(me, [me], intel, seq(0.5)), {type: 'move', x: 500, y: 0});
});

test('AI (旗艦): 手がかりがなければ敵陣の方向 (青は上・赤は下の半分) へ索敵に出る', () => {
  const blue = fleet({id: 'b', x: 1200, y: L.WORLD.h - 300, role: 'flagship'});
  const red = fleet({id: 'r', team: 'red', x: 1200, y: 300, role: 'flagship'});
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
  const g = L.createGame({speed: 34, defense: 33, attack: 33});
  for(const f of g.fleets){
    if(f.team === 'blue') assert.ok(f.y > L.WORLD.h * 0.9, f.id);
    else assert.ok(f.y < L.WORLD.h * 0.1, f.id);
    assert.ok(f.x > 0 && f.x < L.WORLD.w, f.id);
  }
  const xs = g.fleets.filter(f => f.team === 'blue').map(f => f.x);
  assert.equal(new Set(xs).size, 5);
});

test('ゲーム作成: 5 vs 5、プレイヤーは青の 1 艦隊で、指定パラメータを持つ', () => {
  const g = L.createGame({speed: 20, defense: 30, attack: 50});
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
  assert.equal(g.locks.length, 2);
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
  const g = L.createGame({speed: 34, defense: 33, attack: 33});
  assert.ok(g.fleets.filter(f => f.team === 'blue').every(f => f.heading === -Math.PI / 2));
  assert.ok(g.fleets.filter(f => f.team === 'red').every(f => f.heading === Math.PI / 2));
});

test('勝敗 (モダン): 敵旗艦を倒せば勝ち、味方旗艦が倒されたら負け、同時なら引き分け', () => {
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

test('AI (旗艦): 見えている敵旗艦を、近くて弱い敵より優先して狙う', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'flagship'});
  const weakNear = fleet({id: 'weak', team: 'red', x: 300, y: 0, ships: L.INITIAL_SHIPS / 6});
  const flag = fleet({id: 'flag', team: 'red', x: 900, y: 0, flagship: true});
  const intel = {weak: {x: 300, y: 0, visible: true}, flag: {x: 900, y: 0, visible: true}};
  assert.deepEqual(L.aiDecide(me, [me, weakNear, flag], intel, seq(0.5)), {type: 'attack', targetId: 'flag'});
});

test('AI (旗艦): 最終確認位置や敵陣へ攻撃に向かう', () => {
  const flag = fleet({id: 'rf', team: 'red', x: 1200, y: 300, flagship: true, role: 'flagship'});
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

// ---------- 第 2.1 段階 ----------

test('艦艇数: 初期艦艇数は原作どおり 15000', () => {
  assert.equal(L.INITIAL_SHIPS, 15000);
  const g = L.createGame({speed: 34, defense: 33, attack: 33});
  assert.ok(g.fleets.every(f => f.ships === 15000));
});

test('AI: 弱さは艦艇数の割合で評価する (初期艦艇数を変えても判断が変わらない)', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'flagship'});
  const fullNear = fleet({id: 'full', team: 'red', x: 400, y: 0, ships: L.INITIAL_SHIPS});
  const halfFar = fleet({id: 'half', team: 'red', x: 1500, y: 0, ships: L.INITIAL_SHIPS / 2});
  const intel = {full: {x: 400, y: 0, visible: true}, half: {x: 1500, y: 0, visible: true}};
  // 距離 4 + 割合 1×6 = 10 < 距離 15 + 割合 0.5×6 = 18
  assert.deepEqual(L.aiDecide(me, [me, fullNear, halfFar], intel, seq(0.5)), {type: 'attack', targetId: 'full'});
});

test('ゲーム作成: どの艦隊も SPEED 4・SHELL と TORPID オンで始まる', () => {
  const g = L.createGame({speed: 34, defense: 33, attack: 33});
  for(const f of g.fleets){
    assert.equal(f.throttle, 4);
    assert.deepEqual(f.weapons, {shell: true, torpid: true});
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

// ---------- 第 2.2 段階 ----------

test('AI (旗艦): すでに敵陣側にいて手がかりがなければ、マップ全体から索敵先を選ぶ (すれ違い対策)', () => {
  const blue = fleet({id: 'b', x: 1200, y: 500, role: 'flagship'}); // 青にとって敵陣側 (上半分)
  const o = L.aiDecide(blue, [blue], {}, seq(0.5, 0.9));
  assert.equal(o.type, 'move');
  assert.ok(o.y > L.WORLD.h / 2, '自陣側に戻ることもある y=' + o.y);
  const red = fleet({id: 'r', team: 'red', x: 1200, y: 4300, role: 'flagship'}); // 赤にとって敵陣側 (下半分)
  const or = L.aiDecide(red, [red], {}, seq(0.5, 0.1));
  assert.ok(or.y < L.WORLD.h / 2, 'y=' + or.y);
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

// ---------- 第 2.3 段階 ----------

const JOB = L.JOBS;

test('ルール: モダンだけ。各チームの旗艦は第 1 艦隊で、青の旗艦はプレイヤー', () => {
  const g = L.createGame(JOB.balancer.params);
  assert.equal(g.mode, 'modern');
  for(const team of ['blue', 'red']){
    const flags = g.fleets.filter(f => f.team === team && f.flagship);
    assert.deepEqual(flags.map(f => f.id), [team + '1']);
  }
  assert.ok(g.fleets.find(f => f.id === 'blue1').isPlayer);
});

test('ジョブ: バランサー (旗艦専用)・アタッカー・スピーダー・タンク。数値は合計 100', () => {
  assert.deepEqual(Object.keys(JOB), ['balancer', 'attacker', 'speeder', 'tank']);
  assert.deepEqual(JOB.balancer.params, {speed: 30, defense: 40, attack: 30});
  assert.deepEqual(JOB.attacker.params, {speed: 25, defense: 25, attack: 50});
  assert.deepEqual(JOB.speeder.params, {speed: 60, defense: 20, attack: 20});
  assert.deepEqual(JOB.tank.params, {speed: 30, defense: 50, attack: 20});
  assert.equal(JOB.balancer.flagshipOnly, true);
  for(const job of Object.values(JOB)){
    assert.ok(L.validateParams(job.params), job.name);
    assert.ok(job.name && job.description);
  }
});

test('編成: 第 1 旗艦 (バランサー)・第 2 副艦 (タンク)・第 3 と第 4 アタッカー・第 5 スピーダー', () => {
  const g = L.createGame(JOB.speeder.params);
  for(const team of ['blue', 'red']){
    const byNo = n => g.fleets.find(f => f.id === team + n);
    assert.deepEqual([1, 2, 3, 4, 5].map(n => byNo(n).role), ['flagship', 'vice', 'attacker', 'attacker', 'speeder']);
    assert.deepEqual([2, 3, 4, 5].map(n => byNo(n).type), ['タンク', 'アタッカー', 'アタッカー', 'スピーダー']);
  }
  assert.equal(g.fleets.find(f => f.id === 'red1').type, 'バランサー');
  const me = g.fleets.find(f => f.isPlayer);
  assert.deepEqual(me.params, JOB.speeder.params); // プレイヤーは旗艦でも好きなジョブを選べる
  assert.equal(me.type, 'スピーダー');
});

test('出撃位置: 各チームから見て左から第 3・第 2・第 1・第 4・第 5 (旗艦が真ん中。赤は南向きなので東から)', () => {
  const g = L.createGame(JOB.balancer.params);
  const xs = team => [3, 2, 1, 4, 5].map(n => g.fleets.find(f => f.id === team + n).x);
  assert.deepEqual(xs('blue'), [400, 800, 1200, 1600, 2000]);
  assert.deepEqual(xs('red'), [2000, 1600, 1200, 800, 400]);
});

test('出撃位置: アタッカーは自分の隊列位置 (旗艦の左右) と同じ側から出撃する', () => {
  const g = L.createGame(JOB.balancer.params);
  for(const team of ['blue', 'red']){
    const flag = g.fleets.find(f => f.id === team + '1');
    for(const a of g.fleets.filter(f => f.team === team && f.role === 'attacker')){
      const o = L.aiDecide(a, g.fleets, {}, seq(0.5), L.AI_PROFILES.standard);
      assert.equal(Math.sign(o.x - flag.x), Math.sign(a.x - flag.x), a.id);
    }
  }
});

test('局地的な戦力比: 半径内の見えている敵の艦艇数 ÷ 味方の艦艇数', () => {
  const me = fleet({id: 'me', x: 0, y: 0, ships: 6000});
  const ally = fleet({id: 'a', x: 300, y: 0, ships: 4000});
  const farAlly = fleet({id: 'fa', x: 2000, y: 0, ships: 9000});
  const e1 = fleet({id: 'e1', team: 'red', x: 400, y: 0, ships: 12000});
  const e2 = fleet({id: 'e2', team: 'red', x: 500, y: 0, ships: 3000}); // 見えていない
  const intel = {e1: {x: 400, y: 0, visible: true}, e2: {x: 500, y: 0, visible: false}};
  assert.equal(L.localForceRatio(me, 'blue', [me, ally, farAlly, e1, e2], intel, 700), 12000 / 10000);
  assert.equal(L.localForceRatio(me, 'blue', [me], {}, 700), 0);
});

const P = L.AI_PROFILES.standard;

test('AI (旗艦): 周りの戦力比が不利なら、味方の中心へ下がる', () => {
  const me = fleet({id: 'me', x: 1200, y: 2400, role: 'flagship', flagship: true, ships: 5000});
  const a = fleet({id: 'a', x: 1000, y: 4000, role: 'attacker'});
  const b = fleet({id: 'b', x: 1400, y: 4000, role: 'attacker'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2100, ships: 15000});
  const intel = {e: {x: 1200, y: 2100, visible: true}};
  assert.ok(L.localForceRatio(me, 'blue', [me, a, b, e], intel, P.localRadius) > P.flagshipRetreatRatio);
  assert.deepEqual(L.aiDecide(me, [me, a, b, e], intel, seq(0.5), P), {type: 'move', x: 1200, y: 4000});
});

test('AI (旗艦): 不利でなければ進軍して攻撃する', () => {
  const me = fleet({id: 'me', x: 1200, y: 2400, role: 'flagship', flagship: true});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2100, ships: 8000});
  const intel = {e: {x: 1200, y: 2100, visible: true}};
  assert.deepEqual(L.aiDecide(me, [me, e], intel, seq(0.5), P), {type: 'attack', targetId: 'e'});
});

test('AI (旗艦): 見失った敵は、近い敵より敵旗艦の最終確認位置を優先して追う', () => {
  const me = fleet({id: 'me', x: 1200, y: 4000, role: 'flagship', flagship: true});
  const near = fleet({id: 'near', team: 'red', x: 1200, y: 3000});
  const flag = fleet({id: 'rf', team: 'red', x: 1200, y: 800, flagship: true});
  const intel = {near: {x: 1200, y: 3000, visible: false}, rf: {x: 1200, y: 800, visible: false}};
  assert.deepEqual(L.aiDecide(me, [me, near, flag], intel, seq(0.5), P), {type: 'move', x: 1200, y: 800});
});

test('AI (副艦): 旗艦から tankDefendRadius 以内の敵を迎え撃つ', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'flagship', flagship: true});
  const me = fleet({id: 'v', x: 1200, y: 3200, role: 'vice'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.tankDefendRadius + 10});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  assert.deepEqual(L.aiDecide(me, [flag, me, e], intel, seq(0.5), P), {type: 'attack', targetId: 'e'});
});

test('AI (副艦): 遠くに敵が見えていれば、旗艦とその敵の間 (旗艦から tankDistance) に入る', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'flagship', flagship: true});
  const me = fleet({id: 'v', x: 1000, y: 3300, role: 'vice'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 1500});
  const intel = {e: {x: 1200, y: 1500, visible: true}};
  const o = L.aiDecide(me, [flag, me, e], intel, seq(0.5), P);
  assert.equal(o.type, 'move');
  assert.equal(Math.round(o.x), 1200);
  assert.equal(Math.round(o.y), 3000 - P.tankDistance);
});

test('AI (副艦): 敵が見えなければ、旗艦の前方 tankDistance につく', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'flagship', flagship: true, heading: -Math.PI / 2});
  const me = fleet({id: 'v', x: 1000, y: 3300, role: 'vice'});
  const o = L.aiDecide(me, [flag, me], {}, seq(0.5), P);
  assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, 3000 - P.tankDistance]);
});

test('AI (アタッカー): 旗艦から attackerLeash 以内の敵を積極的に攻撃する (自分から遠くても)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'flagship', flagship: true});
  const me = fleet({id: 'a', x: 1200, y: 3200, role: 'attacker'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.attackerLeash + 20, ships: 5000});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  assert.deepEqual(L.aiDecide(me, [flag, me, e], intel, seq(0.5), P), {type: 'attack', targetId: 'e'});
});

test('AI (アタッカー): 旗艦から attackerLeash より遠い敵は追わず、旗艦の左右の隊列へ', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'flagship', flagship: true, heading: -Math.PI / 2});
  const a1 = fleet({id: 'a1', x: 1200, y: 3200, role: 'attacker'});
  const a2 = fleet({id: 'a2', x: 1200, y: 3200, role: 'attacker'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.attackerLeash - 50});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  const fleets = [flag, a1, a2, e];
  const o1 = L.aiDecide(a1, fleets, intel, seq(0.5), P);
  const o2 = L.aiDecide(a2, fleets, intel, seq(0.5), P);
  assert.equal(o1.type, 'move');
  assert.ok(o1.x < 1200 && o2.x > 1200, '左と右');
  assert.equal(Math.round(o1.y), 3000, '旗艦の真横 (北向きの旗艦と同じ高さ)');
  assert.equal(Math.round(o2.y), 3000);
});

test('AI (アタッカー): 攻撃対象がいなければ、旗艦から attackerDistance (標準 500) の左右につく', () => {
  assert.equal(P.attackerDistance, 500);
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'flagship', flagship: true, heading: -Math.PI / 2});
  const a1 = fleet({id: 'a1', x: 1200, y: 3500, role: 'attacker'});
  const a2 = fleet({id: 'a2', x: 1200, y: 3500, role: 'attacker'});
  for(const a of [a1, a2]){
    const o = L.aiDecide(a, [flag, a1, a2], {}, seq(0.5), P);
    assert.equal(Math.round(Math.hypot(o.x - flag.x, o.y - flag.y)), P.attackerDistance, a.id);
  }
  const wide = Object.assign({}, P, {attackerDistance: 700});
  const o = L.aiDecide(a1, [flag, a1, a2], {}, seq(0.5), wide);
  assert.equal(Math.round(Math.hypot(o.x - flag.x, o.y - flag.y)), 700);
});

test('AI (アタッカー): 周りの戦力比が不利なら、旗艦のもとへ下がって合流する', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4000, role: 'flagship', flagship: true});
  const me = fleet({id: 'a', x: 1200, y: 3200, role: 'attacker', ships: 4000});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2900, ships: 15000});
  const intel = {e: {x: 1200, y: 2900, visible: true}};
  assert.deepEqual(L.aiDecide(me, [flag, me, e], intel, seq(0.5), P), {type: 'move', x: 1200, y: 4000});
});

test('AI (スピーダー): 見えている敵が speederSafeDistance より近ければ、まず離れる (戦わない > 見張る)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4000, role: 'flagship', flagship: true});
  const me = fleet({id: 's', x: 1200, y: 2000, role: 'speeder'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2000 - P.speederSafeDistance + 50, flagship: true});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  const o = L.aiDecide(me, [flag, me, e], intel, seq(0.5), P);
  assert.equal(o.type, 'move');
  assert.ok(o.y > 2000, '敵と反対側へ');
});

test('AI (スピーダー): 敵旗艦の位置が分かれば、speederMarkDistance を保って見張る', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4000, role: 'flagship', flagship: true});
  const me = fleet({id: 's', x: 1200, y: 3000, role: 'speeder'});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 1500, flagship: true});
  const intel = {rf: {x: 1200, y: 1500, visible: false}};
  const o = L.aiDecide(me, [flag, me, rf], intel, seq(0.5), P);
  assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, 1500 + P.speederMarkDistance]);
});

test('AI (スピーダー): 敵旗艦の位置が分からなければ、敵陣側へ索敵に出る', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4500, role: 'flagship', flagship: true});
  const me = fleet({id: 's', x: 2000, y: 4500, role: 'speeder'});
  const o = L.aiDecide(me, [flag, me], {}, seq(0.3), P);
  assert.equal(o.type, 'move');
  assert.ok(o.y < L.WORLD.h / 2);
});

test('AI プロファイル: つまみを変えると判断が変わる (学習で調整できる)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'flagship', flagship: true, heading: -Math.PI / 2});
  const me = fleet({id: 'a', x: 1200, y: 3200, role: 'attacker'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.attackerLeash - 50, ships: 5000});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  assert.equal(L.aiDecide(me, [flag, me, e], intel, seq(0.5), P).type, 'move');
  const wide = Object.assign({}, P, {attackerLeash: P.attackerLeash + 200});
  assert.deepEqual(L.aiDecide(me, [flag, me, e], intel, seq(0.5), wide), {type: 'attack', targetId: 'e'});
});

test('ゲーム作成: チームごとに AI プロファイルを指定でき、指定しなければ標準', () => {
  const custom = Object.assign({}, P, {attackerLeash: 1234});
  const g = L.createGame(JOB.balancer.params, {profiles: {red: custom}});
  assert.equal(g.profiles.blue, P);
  assert.equal(g.profiles.red, custom);
});

// ---------- 第 2.4 段階 (2.4a) ----------

// 弾をテスト用に作る
function projectile(over){
  return Object.assign({id: 1, kind: 'shell', team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, heading: 0, life: 99, power: 1}, over);
}

test('範囲: 狙いを定める範囲は索敵半径と同じ、撃てる範囲はその半分', () => {
  assert.equal(L.LOCK_RANGE, L.SENSOR_RANGE);
  assert.equal(L.FIRE_RANGE, L.LOCK_RANGE / 2);
});

test('発射: 狙える範囲にいても、撃てる範囲の外なら撃たない (狙いの線だけ出る)', () => {
  const b = fleet({id: 'b'});
  const r = fleet({id: 'r', team: 'red', x: L.FIRE_RANGE + 50, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0.1);
  assert.equal(g.projectiles.filter(p => p.from === 'b').length, 0);
  assert.deepEqual(g.locks.find(l => l.from === 'b'), {from: 'b', to: 'r', team: 'blue', firing: false});
});

test('発射: 撃てる範囲に入ったら通常弾と爆発弾を撃ち、それぞれの間隔が空くまで次を撃たない', () => {
  const b = fleet({id: 'b'});
  const r = fleet({id: 'r', team: 'red', x: L.FIRE_RANGE - 10, y: 0});
  const g = game([b, r]);
  const count = kind => g.projectiles.filter(p => p.from === 'b' && p.kind === kind).length;
  L.fireWeapons(g, 0.01);
  assert.deepEqual([count('shell'), count('torpedo')], [1, 1]);
  assert.equal(g.locks.find(l => l.from === 'b').firing, true);
  L.fireWeapons(g, L.SHELL_INTERVAL - 0.02);
  assert.deepEqual([count('shell'), count('torpedo')], [1, 1]);
  L.fireWeapons(g, 0.02);
  assert.deepEqual([count('shell'), count('torpedo')], [2, 1]);
  L.fireWeapons(g, L.TORPEDO_RELOAD);
  assert.equal(count('torpedo'), 2);
  assert.ok(L.TORPEDO_RELOAD > L.SHELL_INTERVAL * 4, '爆発弾は再装填に時間がかかる');
});

test('発射: 見えていない敵には狙いを定めない', () => {
  const b = fleet({id: 'b'});
  const r = fleet({id: 'r', team: 'red', x: 100, y: 0});
  const g = game([b, r]);
  L.fireWeapons(g, 0.1, {blue: [], red: []});
  assert.equal(g.projectiles.filter(p => p.from === 'b').length, 0);
});

test('SHELL オフ: 通常弾は撃たないが爆発弾は撃つ / TORPID オフ: その逆', () => {
  const r = fleet({id: 'r', team: 'red', x: 100, y: 0, weapons: {shell: false, torpid: false}});
  const noShell = fleet({id: 'a', weapons: {shell: false, torpid: true}});
  const g = game([noShell, r]);
  L.fireWeapons(g, 0.01);
  assert.deepEqual(g.projectiles.map(p => p.kind), ['torpedo']);
  const noTorp = fleet({id: 'c', weapons: {shell: true, torpid: false}});
  const g2 = game([noTorp, r]);
  L.fireWeapons(g2, 0.01);
  assert.deepEqual(g2.projectiles.map(p => p.kind), ['shell']);
});

test('通常弾: 必中。全速で逃げる相手にも当たり、ダメージを与えて消える', () => {
  const b = fleet({id: 'b', x: 0, y: 0});
  const r = fleet({id: 'r', team: 'red', x: 200, y: 0, params: L.JOBS.speeder.params});
  const g = game([b, r]);
  L.fireWeapons(g, 0.01);
  g.projectiles = g.projectiles.filter(p => p.kind === 'shell');
  const dmg = new Map();
  const runSpeed = L.maxSpeed(r.params);
  for(let i = 0; i < 120 && g.projectiles.length; i++){
    r.x += runSpeed / 60;
    L.moveProjectiles(g, 1 / 60, dmg);
  }
  assert.equal(g.projectiles.length, 0);
  assert.ok(Math.abs(dmg.get(r) - L.shellDamage(b, r)) < 1e-9);
  assert.ok(Math.abs(L.shellDamage(b, r) - L.shellDps(b, r) * L.SHELL_INTERVAL) < 1e-9, '毎秒ダメージ × 間隔');
});

test('爆発弾: 止まっている相手には当たり、大きなダメージを与える', () => {
  const b = fleet({id: 'b', x: 0, y: 0});
  const r = fleet({id: 'r', team: 'red', x: 200, y: 0});
  const g = game([b, r]);
  g.projectiles.push(projectile({kind: 'torpedo', life: L.TORPEDO_LIFE, power: 1000}));
  const dmg = new Map();
  for(let i = 0; i < 300 && g.projectiles.length; i++) L.moveProjectiles(g, 1 / 60, dmg);
  assert.ok(Math.abs(dmg.get(r) - 1000 * L.mitigation(r.params)) < 1e-9);
  assert.ok(L.torpedoDamage(b, r) > L.shellDamage(b, r) * 4, '1 発が大きい');
});

test('爆発弾: 追尾は曲がる速さに限りがある', () => {
  const r = fleet({id: 'r', team: 'red', x: 0, y: -300}); // 真北
  const g = game([fleet({id: 'b'}), r]);
  g.projectiles.push(projectile({kind: 'torpedo', heading: 0, life: 5})); // 東向き
  L.moveProjectiles(g, 0.1, new Map());
  const turned = Math.abs(g.projectiles[0].heading);
  assert.ok(turned <= L.TORPEDO_TURN_RATE * 0.1 + 1e-9 && turned > 0);
});

test('爆発弾: 速い艦隊が全速で逃げればよけられ、燃え尽きて消える', () => {
  assert.ok(L.TORPEDO_SPEED < L.maxSpeed(L.JOBS.speeder.params), 'スピーダーより遅い');
  const r = fleet({id: 'r', team: 'red', x: 200, y: 0, params: L.JOBS.speeder.params});
  const g = game([fleet({id: 'b'}), r]);
  g.projectiles.push(projectile({kind: 'torpedo', life: L.TORPEDO_LIFE, power: 1000}));
  const dmg = new Map();
  for(let i = 0; i < 60 * 10 && g.projectiles.length; i++){
    r.x += L.maxSpeed(r.params) / 60;
    L.moveProjectiles(g, 1 / 60, dmg);
  }
  assert.equal(g.projectiles.length, 0);
  assert.equal(dmg.get(r), undefined);
});

test('弾: 目標が全滅したら消える', () => {
  const r = fleet({id: 'r', team: 'red', x: 400, y: 0, ships: 0});
  const g = game([fleet({id: 'b'}), r]);
  g.projectiles.push(projectile({kind: 'shell'}), projectile({id: 2, kind: 'torpedo'}));
  L.moveProjectiles(g, 0.01, new Map());
  assert.equal(g.projectiles.length, 0);
});

test('迎撃: 迎撃範囲内の最も近い敵の爆発弾を確率で撃ち落とす。通常弾と味方の弾は撃たない', () => {
  const r = fleet({id: 'r', team: 'red', x: 0, y: 0});
  const g = game([r]);
  g.projectiles.push(
    projectile({id: 1, kind: 'torpedo', x: L.INTERCEPT_RANGE - 1}),
    projectile({id: 2, kind: 'torpedo', x: L.INTERCEPT_RANGE - 2}),
    projectile({id: 3, kind: 'shell', x: 5}),
    projectile({id: 4, kind: 'torpedo', team: 'red', from: 'r', targetId: 'b', x: 10})
  );
  const ids = () => g.projectiles.map(p => p.id).sort();
  L.interceptTorpedoes(g, 0.1, seq(0)); // 成功
  assert.deepEqual(ids(), [1, 3, 4]);
  L.interceptTorpedoes(g, 0.1, seq(0)); // 待ち時間中
  assert.deepEqual(ids(), [1, 3, 4]);
  L.interceptTorpedoes(g, L.INTERCEPT_INTERVAL, seq(0.99)); // 失敗
  assert.deepEqual(ids(), [1, 3, 4]);
  L.interceptTorpedoes(g, 0.01, seq(0)); // 失敗後も待ち時間がある
  assert.deepEqual(ids(), [1, 3, 4]);
});

test('迎撃: TORPID がオフでも迎撃はする。迎撃範囲の外は撃たない', () => {
  const r = fleet({id: 'r', team: 'red', x: 0, y: 0, weapons: {shell: true, torpid: false}});
  const g = game([r]);
  g.projectiles.push(projectile({id: 1, kind: 'torpedo', x: L.INTERCEPT_RANGE + 1}), projectile({id: 2, kind: 'torpedo', x: 50}));
  L.interceptTorpedoes(g, 0.1, seq(0));
  assert.deepEqual(g.projectiles.map(p => p.id), [1]);
});

// ---------- 第 2.4 段階 (2.4b) ----------

test('ゲーム作成: 自艦隊の名前を指定でき、指定しなければ「味方第1艦隊」', () => {
  const named = L.createGame(L.JOBS.balancer.params, {playerName: 'ヤマト'});
  assert.equal(named.fleets.find(f => f.isPlayer).name, 'ヤマト');
  assert.equal(named.fleets.find(f => f.id === 'blue2').name, '味方第2艦隊');
  assert.equal(L.createGame(L.JOBS.balancer.params).fleets.find(f => f.isPlayer).name, '味方第1艦隊');
  assert.equal(L.createGame(L.JOBS.balancer.params, {playerName: ''}).fleets.find(f => f.isPlayer).name, '味方第1艦隊');
});

// ---------- 第 2.4 段階 (2.4c) ----------

test('出来事: 発砲すると fire (弾の種類・チーム・位置) が記録される', () => {
  const b = fleet({id: 'b', x: 10, y: 20});
  const r = fleet({id: 'r', team: 'red', x: 110, y: 20});
  const g = game([b, r]);
  L.fireWeapons(g, 0.01);
  const fires = g.events.filter(e => e.type === 'fire');
  assert.deepEqual(fires.filter(e => e.from === 'b').map(e => [e.kind, e.team, e.x, e.y]), [['shell', 'blue', 10, 20], ['torpedo', 'blue', 10, 20]]);
  assert.equal(fires.filter(e => e.team === 'red').length, 2);
});

test('出来事: 弾が当たると hit (弾の種類・撃ったチーム・当たった位置) が記録される', () => {
  const r = fleet({id: 'r', team: 'red', x: 30, y: 0});
  const g = game([fleet({id: 'b'}), r]);
  g.projectiles.push({id: 1, kind: 'shell', team: 'blue', from: 'b', targetId: 'r', x: 0, y: 0, heading: 0, life: Infinity, power: 1});
  L.moveProjectiles(g, 0.1, new Map());
  assert.deepEqual(g.events, [{type: 'hit', kind: 'shell', team: 'blue', targetId: 'r', x: 30, y: 0}]);
});

test('出来事: 爆発弾を撃ち落とすと intercept (撃ち落としたチーム・位置) が記録される', () => {
  const r = fleet({id: 'r', team: 'red', x: 0, y: 0});
  const g = game([r]);
  g.projectiles.push({id: 1, kind: 'torpedo', team: 'blue', from: 'b', targetId: 'r', x: 50, y: 0, heading: 0, life: 5, power: 1});
  L.interceptTorpedoes(g, 0.1, seq(0));
  assert.deepEqual(g.events, [{type: 'intercept', team: 'red', x: 50, y: 0}]);
});

test('出来事: 艦艇数が 0 になったステップで destroyed (チーム・旗艦か・位置) が 1 回だけ記録される', () => {
  const b = fleet({id: 'b', isPlayer: true, params: {speed: 10, defense: 10, attack: 80}});
  const r = fleet({id: 'r', team: 'red', x: 100, y: 0, ships: 1, flagship: true});
  const g = game([b, r]);
  L.step(g, 1, seq(0.5));
  // 位置は倒されたときの艦隊の位置 (AI なのでこの 1 秒のうちに動いている)
  assert.deepEqual(g.events.filter(e => e.type === 'destroyed'), [{type: 'destroyed', team: 'red', id: 'r', flagship: true, x: r.x, y: r.y}]);
});

test('出来事: ステップごとに新しく記録し直す (前のステップの出来事は残らない)', () => {
  const b = fleet({id: 'b', isPlayer: true});
  const r = fleet({id: 'r', team: 'red', x: 3000, y: 3000});
  const g = game([b, r]);
  g.events.push({type: 'fire', kind: 'shell', team: 'blue', from: 'b', x: 0, y: 0});
  L.step(g, 0.01, seq(0.5));
  assert.deepEqual(g.events, []);
});

test('ゲーム作成: 出来事の一覧は空で始まる', () => {
  assert.deepEqual(L.createGame(L.JOBS.balancer.params).events, []);
});
