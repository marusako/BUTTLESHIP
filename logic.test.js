const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');

// テスト用の艦隊を作る
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', x: 0, y: 0,
    ships: L.INITIAL_SHIPS, params: {speed: 34, defense: 33, attack: 33},
    order: null, isPlayer: false, ai: {nextThink: 0, waypoint: null}
  }, over);
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
  const full = L.beamDps(fleet({ships: 3000}), target);
  const half = L.beamDps(fleet({ships: 1500}), target);
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
  const strongNear = fleet({id: 'strong', team: 'red', x: 400, y: 0, ships: 3000});
  const weakNear = fleet({id: 'weak', team: 'red', x: 450, y: 0, ships: 500});
  const weakFar = fleet({id: 'far', team: 'red', x: 3000, y: 0, ships: 400});
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

test('AI: 手がかりがなければ敵陣の方向へ索敵に出る', () => {
  const blue = fleet({id: 'b', x: 300, y: 1500});
  const red = fleet({id: 'r', team: 'red', x: 3700, y: 1500});
  const ob = L.aiDecide(blue, [blue], {}, seq(0.5, 0.5));
  const or = L.aiDecide(red, [red], {}, seq(0.5, 0.5));
  assert.equal(ob.type, 'move');
  assert.ok(ob.x > L.WORLD.w / 2);
  assert.ok(or.x < L.WORLD.w / 2);
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
  const g = {time: 0, fleets: [b, r], intel: {blue: {}, red: {}}, beams: [], outcome: null};
  L.step(g, 1, seq(0.5));
  assert.ok(b.ships < L.INITIAL_SHIPS && r.ships < L.INITIAL_SHIPS);
  assert.equal(b.ships, r.ships); // 同じ条件なら同じ損害
  assert.equal(g.beams.length, 2);
});

test('ゲーム進行: プレイヤー艦隊は AI に命令を上書きされない', () => {
  const b = fleet({id: 'b', isPlayer: true, x: 300, y: 1500});
  const r = fleet({id: 'r', team: 'red', x: 3700, y: 1500});
  const g = {time: 0, fleets: [b, r], intel: {blue: {}, red: {}}, beams: [], outcome: null};
  L.step(g, 0.1, seq(0.5));
  assert.equal(b.order, null);
  assert.notEqual(r.order, null);
});

test('ゲーム進行: 艦艇数が 0 以下になると全滅し、勝敗が決まる', () => {
  const b = fleet({id: 'b', isPlayer: true, params: {speed: 10, defense: 10, attack: 80}});
  const r = fleet({id: 'r', team: 'red', x: 100, y: 0, ships: 1, params: {speed: 10, defense: 10, attack: 80}});
  const g = {time: 0, fleets: [b, r], intel: {blue: {}, red: {}}, beams: [], outcome: null};
  L.step(g, 1, seq(0.5));
  assert.equal(r.ships, 0);
  assert.equal(g.outcome, 'win');
});
