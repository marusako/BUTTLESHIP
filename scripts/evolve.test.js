const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../brain.js');
const R = require('../rule-ai.js');
const E = require('./evolve.js');

// 出力のバイアスだけを設定した脳の組 (どの役割も同じ)
function constantSet(outputs){
  const set = {};
  for(const r of B.ROLES){
    const w = new Float64Array(B.paramCount());
    for(const [k, v] of Object.entries(outputs)) w[B.paramCount() - B.OUTPUTS + B.OUT[k]] = v;
    set[r] = w;
  }
  return set;
}
const stay = () => constantSet({attackNone: 1}); // その場から動かない

test('乱数 mulberry32: 同じ種なら同じ列、0 以上 1 未満、近い種でも最初の値がばらける', () => {
  const a = E.mulberry32(1), b = E.mulberry32(1);
  const xs = Array.from({length: 5}, () => a());
  assert.deepEqual(xs, Array.from({length: 5}, () => b()));
  for(const x of xs) assert.ok(x >= 0 && x < 1);
  const firsts = [1, 2, 3, 4, 5].map(s => E.mulberry32(s)());
  assert.ok(Math.min(...firsts) > 0.1, '種 1〜5 の最初の値が 0 付近に固まらない (単純な乱数で起きた偏り)');
  assert.equal(new Set(firsts).size, 5, 'どれも違う値');
});

test('成績: 勝ち 1、負け 0、時間切れは負けより悪い。残存戦力の差、与えたダメージ、敵旗艦の発見を少しだけ足す', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} と ${b}`);
  const ships = {blue: 30000, red: 15000};
  // 青: 勝ち 1 + 差 0.1 × 15000/75000 + 与えたダメージ 0.2 × 60000/75000
  near(E.matchScore({outcome: 'win', ships, spotted: {blue: false, red: false}}, 'blue'), 1 + 0.1 * 15000 / 75000 + 0.2 * 60000 / 75000);
  // 赤: 負け 0 - 差 + 与えたダメージ 0.2 × 45000/75000 + 敵旗艦の発見 0.1
  near(E.matchScore({outcome: 'win', ships, spotted: {blue: false, red: true}}, 'red'), 0 - 0.1 * 15000 / 75000 + 0.2 * 45000 / 75000 + 0.1);
  const timeout = E.matchScore({outcome: 'timeout', ships: {blue: 75000, red: 75000}, spotted: {blue: true, red: true}}, 'blue');
  assert.ok(timeout < E.matchScore({outcome: 'lose', ships: {blue: 0, red: 75000}, spotted: {blue: false, red: false}}, 'blue'), '逃げ回って時間切れにするより負けたほうがまし');
  near(E.matchScore({outcome: 'draw', ships: {blue: 75000, red: 75000}}, 'red'), E.TIMEOUT_SCORE);
});

test('1 試合: 敵旗艦を見つけたかを記録する (旗艦の位置がばれる時間にも見つかる)', () => {
  const r = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 70});
  assert.deepEqual(r.spotted, {blue: true, red: true}, '60 秒で旗艦の位置がばれる');
  const early = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 30});
  assert.deepEqual(early.spotted, {blue: false, red: false});
});

test('1 試合: マップの広さを指定でき、終わったら本番の広さに戻る', () => {
  const L = require('../logic.js');
  const r = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 5, world: {w: 2500, h: 5000}});
  assert.equal(r.outcome, 'timeout');
  assert.deepEqual(L.WORLD, {w: 10000, h: 20000});
});

test('小さいマップから始める: 時間切れの割合が 5 世代続けて 30% 未満なら次の広さへ。最後の広さで止まる', () => {
  assert.deepEqual(E.WORLD_STAGES, [{w: 2500, h: 5000}, {w: 5000, h: 10000}, {w: 10000, h: 20000}]);
  let c = {stage: 0, streak: 0};
  for(const rate of [0.2, 0.1, 0.29, 0.2]) c = E.advanceCurriculum(c, rate);
  assert.deepEqual(c, {stage: 0, streak: 4});
  c = E.advanceCurriculum(c, 0.35);
  assert.deepEqual(c, {stage: 0, streak: 0}, '30% 以上で数え直し');
  for(let i = 0; i < 5; i++) c = E.advanceCurriculum(c, 0.1);
  assert.deepEqual(c, {stage: 1, streak: 0});
  c = {stage: 2, streak: 0};
  for(let i = 0; i < 6; i++) c = E.advanceCurriculum(c, 0);
  assert.equal(c.stage, 2);
});

test('突然変異: 決まった乱数なら決まった結果。元の脳は変えない。rate 0 なら同じ、rate 1 ならすべて変わる', () => {
  const base = B.randomBrainSet(E.mulberry32(7));
  const copy = B.toPlain(base);
  const a = E.mutate(base, E.mulberry32(3), {sigma: 0.1, rate: 0.5});
  const b = E.mutate(base, E.mulberry32(3), {sigma: 0.1, rate: 0.5});
  assert.deepEqual(B.toPlain(a), B.toPlain(b));
  assert.deepEqual(B.toPlain(base), copy, '元の脳は変わらない');
  assert.deepEqual(B.toPlain(E.mutate(base, E.mulberry32(3), {sigma: 0.1, rate: 0})), copy);
  const all = E.mutate(base, E.mulberry32(3), {sigma: 0.1, rate: 1});
  for(const r of B.ROLES) assert.ok(all[r].every((v, i) => v !== base[r][i]), r);
});

test('次の世代: 成績の上位 (elite) はそのまま残り、数は変わらない。残りは上位寄りの親から作る', () => {
  const pop = Array.from({length: 8}, (_, i) => B.randomBrainSet(E.mulberry32(100 + i)));
  const fitness = [0.1, 0.9, 0.3, 0.8, 0.2, 0.0, 0.5, 0.4];
  const next = E.nextGeneration(pop, fitness, E.mulberry32(5), {elite: 2, sigma: 0.05, rate: 0.2, tournament: 3});
  assert.equal(next.length, 8);
  assert.equal(next[0], pop[1], '1 位');
  assert.equal(next[1], pop[3], '2 位');
  for(const child of next.slice(2)) assert.ok(!pop.includes(child), '残りは新しく作った脳');
  const again = E.nextGeneration(pop, fitness, E.mulberry32(5), {elite: 2, sigma: 0.05, rate: 0.2, tournament: 3});
  assert.deepEqual(next.map(B.toPlain), again.map(B.toPlain), '決まった乱数なら決まった結果');
});

test('対戦表: 各個体が決まった数だけ戦い、相手は自分以外。青と赤を交互に受け持つ', () => {
  const s = E.schedule(6, 4, 2, E.mulberry32(9), 0.25);
  assert.equal(s.length, 6 * 4);
  for(let i = 0; i < 6; i++){
    const mine = s.filter(m => m.subject === i);
    assert.equal(mine.length, 4);
    assert.deepEqual(mine.map(m => m.side), ['blue', 'red', 'blue', 'red']);
    for(const m of mine){
      if(m.opponent.kind === 'pop') assert.ok(m.opponent.index !== i && m.opponent.index >= 0 && m.opponent.index < 6);
      else assert.ok(m.opponent.kind === 'hall' && m.opponent.index >= 0 && m.opponent.index < 2);
      assert.ok(Number.isInteger(m.seed));
    }
  }
  assert.ok(E.schedule(6, 4, 0, E.mulberry32(9), 0.9).every(m => m.opponent.kind === 'pop'), '殿堂入りがいなければ集団からだけ');
});

test('1 試合: 決まった種なら同じ結果。動かないチーム同士は時間切れになる', () => {
  const opts = {seed: 11, dt: 1 / 10, maxTime: 20};
  const a = E.playMatch(B.controller(stay()), B.controller(stay()), opts);
  const b = E.playMatch(B.controller(stay()), B.controller(stay()), opts);
  assert.deepEqual(a, b);
  assert.equal(a.outcome, 'timeout');
  assert.equal(a.time >= 20, true);
  assert.deepEqual(a.ships, {blue: 75000, red: 75000});
  assert.ok(a.metrics.edgeRatio >= 0 && a.metrics.edgeRatio <= 1);
});

test('1 試合: 旧ルール AI どうしなら決着がつき、青と赤の処理順を入れ替えられる', () => {
  const r = E.playMatch(R.controller(), R.controller(), {seed: 3, dt: 1 / 20, maxTime: 900});
  assert.ok(['win', 'lose', 'draw'].includes(r.outcome), r.outcome);
  const rf = E.playMatch(R.controller(), R.controller(), {seed: 3, dt: 1 / 20, maxTime: 900, redFirst: true});
  assert.ok(['win', 'lose', 'draw'].includes(rf.outcome), rf.outcome);
});

test('記録する数値: マップの端にいた割合は、端に張りついた艦隊なら大きい', () => {
  const toEdge = constantSet({moveX: -5, attackNone: 1}); // 青から見て左 (赤から見ても左 = マップの右) へ進み続ける
  const r = E.playMatch(B.controller(toEdge), B.controller(toEdge), {seed: 1, dt: 1 / 10, maxTime: 200});
  const still = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 1, dt: 1 / 10, maxTime: 200});
  assert.ok(r.metrics.edgeRatio > 0.5, String(r.metrics.edgeRatio));
  assert.ok(still.metrics.edgeRatio < r.metrics.edgeRatio);
});
