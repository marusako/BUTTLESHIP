const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');
const B = require('./brain.js');

// テスト用の艦隊を作る (最大 HP 50。「N / 300」は艦艇数 15000 の時代の値を HP 50 の基準に直したもの)
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', role: 'cruiser', x: 5000, y: 10000, hitRadius: 25,
    ships: 50, maxShips: 50, stats: Object.assign({}, L.SHIP_TYPES.cruiser.stats), charge: 0, boost: 0, lockId: null,
    order: null, isPlayer: false, ai: {nextThink: 0}, heading: 0, flagship: false,
    cooldown: 0, aaCooldown: 0, stealth: 0, weapons: {fire: true}
  }, over);
}

// 決まった値を順に返す乱数
function seq(...values){
  let i = 0;
  return () => values[i++ % values.length];
}

// 出力のバイアス (最後の OUTPUTS 個) だけを設定した重み。出力は常にその値になる
function biasOnly(outputs){
  const w = new Float64Array(B.paramCount());
  const base = B.paramCount() - B.OUTPUTS;
  for(const [k, v] of Object.entries(outputs)) w[base + B.OUT[k]] = v;
  return w;
}

// 位置と向きを鏡写し (マップの中心について 180 度回す) にした艦隊
const mirror = f => Object.assign({}, f, {x: L.WORLD.w - f.x, y: L.WORLD.h - f.y, team: f.team === 'blue' ? 'red' : 'blue'});
const mirrorInfo = i => Object.assign({}, i, {x: L.WORLD.w - i.x, y: L.WORLD.h - i.y});

test('脳の大きさ: 入力 → 中間層 → 出力の重みとバイアスの数', () => {
  assert.equal(B.paramCount(), B.HIDDEN * B.INPUTS + B.HIDDEN + B.OUTPUTS * B.HIDDEN + B.OUTPUTS);
  assert.equal(B.INPUTS, 48);
  assert.equal(B.OUTPUTS, 6);
  assert.deepEqual(B.ROLES, ['battleship', 'carrier', 'cruiser', 'destroyer']);
});

test('計算: 重みがすべて 0 なら出力は 0、出力のバイアスだけなら出力はその値', () => {
  const input = new Array(B.INPUTS).fill(0.5);
  assert.deepEqual([...B.forward(new Float64Array(B.paramCount()), input)], new Array(B.OUTPUTS).fill(0));
  assert.deepEqual([...B.forward(biasOnly({moveX: 0.3, attack1: -2}), input)], [0.3, 0, 0, 0, -2, 0]);
});

test('計算: 中間層は tanh。入力 → 中間層 1 つ → 出力 1 つの経路が決まった値になる', () => {
  const w = new Float64Array(B.paramCount());
  w[0] = 2;                                 // 入力 0 → 中間層 0
  const w2 = B.HIDDEN * B.INPUTS + B.HIDDEN; // 出力の重みの始まり
  w[w2 + B.OUT.moveY * B.HIDDEN] = 3;        // 中間層 0 → 出力 moveY
  const input = new Array(B.INPUTS).fill(0);
  input[0] = 0.25;
  const out = B.forward(w, input);
  assert.ok(Math.abs(out[B.OUT.moveY] - 3 * Math.tanh(0.5)) < 1e-12);
});

test('入力: 決まった長さで、どの値も有限で大きすぎない', () => {
  const me = fleet({id: 'me'});
  const flag = fleet({id: 'flag', role: 'battleship', flagship: true, x: 5000, y: 10500});
  const e = fleet({id: 'e', team: 'red', x: 5300, y: 9600, flagship: true});
  const intel = {e: {x: e.x, y: e.y, visible: true}, g: {x: 100, y: 50, visible: false}};
  const ghost = fleet({id: 'g', team: 'red', x: 9000, y: 9000});
  const obs = B.observe(me, [me, flag, e, ghost], intel);
  assert.equal(obs.length, B.INPUTS);
  for(const v of obs) assert.ok(Number.isFinite(v) && Math.abs(v) <= 3, String(v));
});

test('入力 (霧を守る): 見えていない敵の本当の位置は入力に入らない。ゴーストは最終確認位置を使う', () => {
  const me = fleet({id: 'me'});
  const hidden = fleet({id: 'h', team: 'red', x: 5100, y: 10100});
  const ghost = fleet({id: 'g', team: 'red', x: 7000, y: 3000});
  const intel = {g: {x: 6000, y: 8000, visible: false}};
  const a = B.observe(me, [me, hidden, ghost], intel);
  const b = B.observe(me, [me, Object.assign({}, hidden, {x: 300, y: 300, ships: 1}), Object.assign({}, ghost, {x: 1, y: 1, ships: 5})], intel);
  assert.deepEqual(a, b);
  const noEnemies = B.observe(me, [me], intel);
  assert.deepEqual(a, noEnemies, 'intel にない敵はいないのと同じ');
});

test('入力 (鏡写し): 赤から見た入力は、盤面を鏡写しにした青から見た入力と同じ', () => {
  const me = fleet({id: 'me', x: 3000, y: 12000, cooldown: 0.4});
  const flag = fleet({id: 'flag', role: 'battleship', flagship: true, x: 3500, y: 12600, ships: 9000 / 300});
  const ally = fleet({id: 'a', x: 2000, y: 13000, ships: 7000 / 300});
  const e = fleet({id: 'e', team: 'red', x: 3400, y: 11500, ships: 4000 / 300});
  const g = fleet({id: 'g', team: 'red', x: 100, y: 100, flagship: true});
  const intel = {e: {x: e.x, y: e.y, visible: true}, g: {x: 8000, y: 4000, visible: false}};
  const blueObs = B.observe(me, [me, flag, ally, e, g], intel);
  const m = [me, flag, ally, e, g].map(mirror);
  const mIntel = {e: mirrorInfo(intel.e), g: mirrorInfo(intel.g)};
  const redObs = B.observe(m[0], m, mIntel);
  assert.equal(blueObs.length, redObs.length);
  blueObs.forEach((v, i) => assert.ok(Math.abs(v - redObs[i]) < 1e-9, `入力 ${i}: ${v} と ${redObs[i]}`));
});

test('命令: 移動の出力から移動先を作る。チームから見た向き (赤は上下左右が逆) で、マップの内側に収める', () => {
  const right = biasOnly({moveX: 5, attackNone: 1});
  const blue = fleet({id: 'b', x: 5000, y: 10000});
  const ob = B.decide(right, blue, [blue], {});
  assert.equal(ob.type, 'move');
  assert.ok(ob.x > 5000 && Math.abs(ob.y - 10000) < 1e-9);
  const red = fleet({id: 'r', team: 'red', x: 5000, y: 10000});
  const or = B.decide(right, red, [red], {});
  assert.ok(or.x < 5000, '赤から見た右は、マップでは左');
  const edge = fleet({id: 'e', x: L.WORLD.w - 10, y: 10000});
  const oe = B.decide(right, edge, [edge], {});
  assert.ok(oe.x <= L.WORLD.w && oe.x >= 0 && oe.y >= 0 && oe.y <= L.WORLD.h);
});

test('命令: 移動の出力が小さければ止まる (命令なし)', () => {
  const me = fleet({id: 'me'});
  assert.equal(B.decide(biasOnly({moveX: 0.01, moveY: -0.01, attackNone: 1}), me, [me], {}), null);
});

test('命令: 攻撃の点数がいちばん高い相手を攻撃する。相手は見えている敵の近い順、見えている敵だけ', () => {
  const me = fleet({id: 'me'});
  const near = fleet({id: 'near', team: 'red', x: 5000, y: 9700});
  const far = fleet({id: 'far', team: 'red', x: 5000, y: 9400});
  const hidden = fleet({id: 'hid', team: 'red', x: 5000, y: 9900});
  const intel = {near: {x: near.x, y: near.y, visible: true}, far: {x: far.x, y: far.y, visible: true}, hid: {x: 5000, y: 9900, visible: false}};
  const fleets = [me, near, far, hidden];
  assert.deepEqual(B.decide(biasOnly({attack0: 3}), me, fleets, intel), {type: 'attack', targetId: 'near'});
  assert.deepEqual(B.decide(biasOnly({attack1: 3}), me, fleets, intel), {type: 'attack', targetId: 'far'});
  // 3 番目の相手はいないので選べない (次に点数の高い「攻撃しない」→ 移動)
  const o = B.decide(biasOnly({attack2: 3, attackNone: 1, moveY: -5}), me, fleets, intel);
  assert.equal(o.type, 'move');
});

test('AI (controller): 艦種ごとの脳で命令を決める (艦種が分からなければ戦艦の脳)', () => {
  const brains = {
    battleship: biasOnly({moveY: -5, attackNone: 1}), // 前 (青なら上) へ
    carrier: biasOnly({moveY: 5, attackNone: 1}),     // 後ろへ
    cruiser: biasOnly({moveX: 5, attackNone: 1}),
    destroyer: biasOnly({moveX: -5, attackNone: 1})
  };
  const c = B.controller(brains);
  const at = (role) => { const f = fleet({id: 'x', role}); return c(f, [f], {}, seq(0.5)); };
  assert.ok(at('battleship').y < 10000);
  assert.ok(at('carrier').y > 10000);
  assert.ok(at('cruiser').x > 5000);
  assert.ok(at('destroyer').x < 5000);
  assert.ok(at('unknown').y < 10000);
});

test('ランダムな脳: 決まった乱数なら同じ脳。4 つの役割それぞれに決まった数の重み', () => {
  const a = B.randomBrainSet(seq(0.1, 0.7, 0.4));
  const b = B.randomBrainSet(seq(0.1, 0.7, 0.4));
  assert.deepEqual(Object.keys(a), B.ROLES);
  for(const r of B.ROLES){
    assert.equal(a[r].length, B.paramCount());
    assert.deepEqual([...a[r]], [...b[r]]);
  }
});

test('保存: 脳の組を JSON にできる形にして、元に戻せる', () => {
  const a = B.randomBrainSet(seq(0.3, 0.9));
  const back = B.fromPlain(JSON.parse(JSON.stringify(B.toPlain(a))));
  for(const r of B.ROLES) assert.deepEqual([...back[r]], [...a[r]]);
});

test('ゲームで使える: 学習前のランダムな脳でも、試合を最後まで進められる', () => {
  const rng = seq(0.13, 0.62, 0.87, 0.35, 0.51);
  const g = L.createGame({controllers: {blue: B.controller(B.randomBrainSet(rng)), red: B.controller(B.randomBrainSet(rng))}});
  g.fleets.find(f => f.isPlayer).isPlayer = false;
  for(let i = 0; i < 600; i++) L.step(g, 1 / 30, rng);
  for(const f of g.fleets){
    assert.ok(f.x >= 0 && f.x <= L.WORLD.w && f.y >= 0 && f.y <= L.WORLD.h, f.id);
  }
});

test('入力: 自分にバフがかかっているかが入る', () => {
  const me = fleet({id: 'me', buffed: true});
  const off = fleet({id: 'me', buffed: false});
  const a = B.observe(me, [me], {}), c = B.observe(off, [off], {});
  const diff = a.map((v, i) => v !== c[i] ? i : -1).filter(i => i >= 0);
  assert.equal(diff.length, 1);
  assert.deepEqual([a[diff[0]], c[diff[0]]], [1, 0]);
});
