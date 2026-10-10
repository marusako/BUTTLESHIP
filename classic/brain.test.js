const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');
const B = require('./brain.js');

function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', x: 1200, y: 3000, ships: L.INITIAL_SHIPS, params: {speed: 34, defense: 33, attack: 33},
    order: null, isPlayer: false, ai: {nextThink: 0}, heading: 0, flagship: false, leader: false,
    missiles: L.MISSILE_AMMO, missileMode: 'guided', throttle: 4, weapons: {laser: true, torpid: true}
  }, over);
}
// 決まった値を順に返す乱数
function seq(...values){
  let i = 0;
  return () => values[i++ % values.length];
}
// 重みがすべて 0 で、出力の偏り (最後の OUTPUTS 個) だけを指定した脳
function biasBrain(bias){
  const w = new Float64Array(B.paramCount());
  bias.forEach((v, i) => { w[w.length - B.OUTPUTS + i] = v; });
  return w;
}

test('脳の形: 入力 50・中間 24・出力 7 (移動 x・y、攻撃しない、近い敵 3 つ、ミサイルの直進)。隊長用と護衛用の 2 つ', () => {
  assert.deepEqual([B.INPUTS, B.HIDDEN, B.OUTPUTS], [50, 24, 7]);
  assert.deepEqual(B.ROLES, ['leader', 'escort']);
  assert.equal(B.paramCount(), 24 * 50 + 24 + 7 * 24 + 7);
  const f = fleet();
  assert.equal(B.observe(f, [f], {}).length, B.INPUTS);
});

test('入力: 赤は盤面を 180° 回して青と同じ見え方 (点対称の位置なら同じ入力)', () => {
  const b = fleet({id: 'b', x: 500, y: 4000, leader: true});
  const be = fleet({id: 'be', team: 'red', x: 700, y: 3600});
  const r = fleet({id: 'r', team: 'red', x: L.WORLD.w - 500, y: L.WORLD.h - 4000, leader: true});
  const re = fleet({id: 're', team: 'blue', x: L.WORLD.w - 700, y: L.WORLD.h - 3600});
  const inB = B.observe(b, [b, be], {be: {x: be.x, y: be.y, visible: true}});
  const inR = B.observe(r, [r, re], {re: {x: re.x, y: re.y, visible: true}});
  inB.forEach((v, i) => assert.ok(Math.abs(v - inR[i]) < 1e-9, String(i)));
});

test('入力: 見えている敵は近い順で、攻撃の相手の候補と同じ並び。見えていない敵の本当の位置は使わない', () => {
  const f = fleet();
  const far = fleet({id: 'far', team: 'red', x: 1200, y: 2000});
  const near = fleet({id: 'near', team: 'red', x: 1200, y: 2800});
  const hidden = fleet({id: 'hid', team: 'red', x: 1210, y: 2990});
  const intel = {far: {x: far.x, y: far.y, visible: true}, near: {x: near.x, y: near.y, visible: true}};
  assert.deepEqual(B.visibleTargets(f, intel).map(t => t.id), ['near', 'far']);
  const a = B.observe(f, [f, far, near, hidden], intel);
  const b = B.observe(f, [f, far, near], intel);
  assert.deepEqual(a, b, '見えていない敵は入力に入らない');
});

test('命令: 攻撃の点数がいちばん高い近い敵を攻撃する。攻撃しないなら移動 (チームから見た向き)。小さすぎる移動は止まる', () => {
  const f = fleet();
  const e0 = fleet({id: 'e0', team: 'red', x: 1200, y: 2800});
  const e1 = fleet({id: 'e1', team: 'red', x: 1200, y: 2600});
  const intel = {e0: {x: e0.x, y: e0.y, visible: true}, e1: {x: e1.x, y: e1.y, visible: true}};
  assert.deepEqual(B.decide(biasBrain([0, 0, 0, 0, 1, 0, 0]), f, [f, e0, e1], intel), {type: 'attack', targetId: 'e1'});
  const up = B.decide(biasBrain([0, -3, 1, 0, 0, 0, 0]), f, [f], {});
  assert.equal(up.type, 'move');
  assert.ok(up.y < f.y && Math.abs(up.x - f.x) < 1e-9, '青の上 (北) へ');
  const r = fleet({team: 'red', x: 1200, y: 1800});
  const down = B.decide(biasBrain([0, -3, 1, 0, 0, 0, 0]), r, [r], {});
  assert.ok(down.y > r.y, '赤は盤面を回すので下 (南) へ');
  assert.equal(B.decide(biasBrain([0, 0, 1, 0, 0, 0, 0]), f, [f], {}), null);
});

test('命令: ミサイルの出力が正なら直進、0 以下なら誘導にする', () => {
  const f = fleet();
  B.decide(biasBrain([0, 0, 1, 0, 0, 0, 1]), f, [f], {});
  assert.equal(f.missileMode, 'straight');
  B.decide(biasBrain([0, 0, 1, 0, 0, 0, -1]), f, [f], {});
  assert.equal(f.missileMode, 'guided');
});

test('controller: 隊長は隊長用の脳、ほかは護衛用の脳で考える', () => {
  const set = {leader: biasBrain([0, -3, 1, 0, 0, 0, 0]), escort: biasBrain([0, 3, 1, 0, 0, 0, 0])};
  const ctl = B.controller(set);
  const lead = fleet({id: 'l', leader: true}), esc = fleet({id: 'e'});
  const intel = {r1: {x: 0, y: 0, visible: false}}; // 手がかりがあるとき (ないときは旧型 AI で探す)
  assert.ok(ctl(lead, [lead, esc], intel, seq(0.5)).y < lead.y);
  assert.ok(ctl(esc, [lead, esc], intel, seq(0.5)).y > esc.y);
});

test('controller: 見えている敵も最終確認位置もないときは、旧型 AI の動き (索敵) で探す。手がかりがあれば脳で考える', () => {
  const set = {leader: biasBrain([0, -3, 1, 0, 0, 0, 0]), escort: biasBrain([0, 3, 1, 0, 0, 0, 0])};
  const ctl = B.controller(set);
  const lead = fleet({id: 'l', leader: true, x: 2400, y: 9000}), esc = fleet({id: 'e', x: 2000, y: 9000});
  const fleets = [lead, esc];
  assert.deepEqual(ctl(lead, fleets, {}, seq(0.5, 0.3)), L.aiDecide(lead, fleets, {}, seq(0.5, 0.3)), '隊長は旧型 AI の索敵');
  assert.deepEqual(ctl(esc, fleets, {}, seq(0.5)), L.aiDecide(esc, fleets, {}, seq(0.5)), '護衛は旧型 AI の隊列');
  const ghost = {r1: {x: 2400, y: 1000, visible: false}};
  assert.notDeepEqual(ctl(lead, fleets, ghost, seq(0.5, 0.3)), L.aiDecide(lead, fleets, ghost, seq(0.5, 0.3)), '最終確認位置があれば脳');
});

test('保存: toPlain と fromPlain で元に戻る。形が違えばエラー。ランダムな脳は -scale〜scale', () => {
  const set = B.randomBrainSet(seq(0.1, 0.9, 0.5), 0.5);
  assert.ok(set.leader.every(v => v >= -0.5 && v <= 0.5));
  const back = B.fromPlain(JSON.parse(JSON.stringify(B.toPlain(set))));
  assert.deepEqual(Array.from(back.escort), Array.from(set.escort));
  assert.throws(() => B.fromPlain({leader: [1, 2], escort: []}));
});

test('試合に入れても最後まで進む (学習型 AI 対 旧型 AI)', () => {
  const rng = seq(0.13, 0.57, 0.91, 0.29, 0.73);
  const g = L.createGame({speed: 34, defense: 33, attack: 33}, rng, 'flagship', {controllers: {red: B.controller(B.randomBrainSet(rng, 0.5))}});
  for(const f of g.fleets) f.isPlayer = false;
  for(let i = 0; i < 30 * 300 && !g.outcome; i++) L.step(g, 1 / 30, rng);
  assert.ok(g.time > 0);
});
