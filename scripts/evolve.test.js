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
  // チームの最大 HP の合計は 270 (戦艦 90 + 空母 70 + 巡洋艦 50 + 駆逐艦 30 × 2)
  const ships = {blue: 180, red: 90};
  // 青: 勝ち 1 + 差 0.1 × 90/270 + 与えたダメージ 0.2 × 180/270
  near(E.matchScore({outcome: 'win', ships, spotted: {blue: false, red: false}}, 'blue'), 1 + 0.1 * 90 / 270 + 0.2 * 180 / 270);
  // 赤: 負け 0 - 差 + 与えたダメージ 0.2 × 90/270 + 敵旗艦の発見 0.1
  near(E.matchScore({outcome: 'win', ships, spotted: {blue: false, red: true}}, 'red'), 0 - 0.1 * 90 / 270 + 0.2 * 90 / 270 + 0.1);
  const timeout = E.matchScore({outcome: 'timeout', ships: {blue: 270, red: 270}, spotted: {blue: true, red: true}}, 'blue');
  assert.ok(timeout < E.matchScore({outcome: 'lose', ships: {blue: 0, red: 270}, spotted: {blue: false, red: false}}, 'blue'), '逃げ回って時間切れにするより負けたほうがまし');
  near(E.matchScore({outcome: 'draw', ships: {blue: 270, red: 270}}, 'red'), E.TIMEOUT_SCORE);
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

test('小さいマップから始める: 同じ広さで最低 20 世代。時間切れ 30% 未満かつ端 50% 未満が 5 世代続いたら次の広さへ。最後の広さで止まる', () => {
  assert.deepEqual(E.WORLD_STAGES, [{w: 2500, h: 5000}, {w: 5000, h: 10000}, {w: 10000, h: 20000}]);
  let c = {stage: 0, streak: 0, gens: 0};
  for(let i = 0; i < 19; i++) c = E.advanceCurriculum(c, 0.1, 0.1);
  assert.deepEqual(c, {stage: 0, streak: 19, gens: 19}, '20 世代まではとどまる');
  c = E.advanceCurriculum(c, 0.1, 0.1);
  assert.deepEqual(c, {stage: 1, streak: 0, gens: 0});
  c = {stage: 1, streak: 4, gens: 30};
  assert.deepEqual(E.advanceCurriculum(c, 0.35, 0.1), {stage: 1, streak: 0, gens: 31}, '時間切れ 30% 以上で数え直し');
  assert.deepEqual(E.advanceCurriculum(c, 0.1, 0.5), {stage: 1, streak: 0, gens: 31}, '端 50% 以上で数え直し');
  assert.deepEqual(E.advanceCurriculum(c, 0.29, 0.49), {stage: 2, streak: 0, gens: 0});
  c = {stage: 2, streak: 0, gens: 0};
  for(let i = 0; i < 30; i++) c = E.advanceCurriculum(c, 0, 0);
  assert.equal(c.stage, 2);
  assert.deepEqual(E.advanceCurriculum({stage: 0, streak: 2}, 0.1, 0.1), {stage: 0, streak: 3, gens: 1}, '前の保存データ (gens なし) も読める');
});

test('成績: 端にいた割合 (チームごと) × 0.3 を引く', () => {
  const base = {outcome: 'win', ships: {blue: 270, red: 270}, spotted: {blue: false, red: false}};
  const a = E.matchScore(base, 'blue');
  const b = E.matchScore(Object.assign({}, base, {metrics: {edgeByTeam: {blue: 0.5, red: 0.1}}}), 'blue');
  const r = E.matchScore(Object.assign({}, base, {metrics: {edgeByTeam: {blue: 0.5, red: 0.1}}}), 'red');
  assert.ok(Math.abs((a - b) - 0.3 * 0.5) < 1e-12);
  assert.ok(Math.abs((E.matchScore(base, 'red') - r) - 0.3 * 0.1) < 1e-12);
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
  assert.deepEqual(a.ships, {blue: 270, red: 270});
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
  assert.ok(r.metrics.edgeByTeam.blue > 0.5 && r.metrics.edgeByTeam.red > 0.5, 'チームごとにも数える');
  const oneSide = E.playMatch(B.controller(toEdge), B.controller(stay()), {seed: 1, dt: 1 / 10, maxTime: 200});
  assert.ok(oneSide.metrics.edgeByTeam.blue > 0.5 && oneSide.metrics.edgeByTeam.red < 0.1, JSON.stringify(oneSide.metrics.edgeByTeam));
});

test('出発点の脳から集団を作る: 1 個体目はそのまま、残りは少し乱れを加えたもの (決まった乱数なら決まった結果)', () => {
  const seed = B.randomBrainSet(E.mulberry32(4));
  const pop = E.seedPopulation(seed, 5, E.mulberry32(8), {sigma: 0.05, rate: 0.2});
  assert.equal(pop.length, 5);
  assert.deepEqual(B.toPlain(pop[0]), B.toPlain(seed));
  for(const p of pop.slice(1)) assert.notDeepEqual(B.toPlain(p), B.toPlain(seed));
  const again = E.seedPopulation(seed, 5, E.mulberry32(8), {sigma: 0.05, rate: 0.2});
  assert.deepEqual(pop.map(B.toPlain), again.map(B.toPlain));
});
