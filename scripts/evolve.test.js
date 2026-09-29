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
  // チームの最大 HP の合計は 2800 (戦艦 1000 + 空母 700 + 巡洋艦 500 + 駆逐艦 300 × 2。第 4.0 段階で耐久の 10 倍)
  const ships = {blue: 1800, red: 900};
  // 与えたダメージ = 合計 2800 − 相手の残り (青は 2800 − 900 = 1900、赤は 2800 − 1800 = 1000)
  // 青: 勝ち 1 + 差 0.1 × 900/2800 + 与えたダメージ 0.2 × 1900/2800
  near(E.matchScore({outcome: 'win', ships, spotted: {blue: false, red: false}}, 'blue'), 1 + 0.1 * 900 / 2800 + 0.2 * 1900 / 2800);
  // 赤: 負け 0 - 差 + 与えたダメージ 0.2 × 1000/2800 + 敵旗艦の発見 0.1
  near(E.matchScore({outcome: 'win', ships, spotted: {blue: false, red: true}}, 'red'), 0 - 0.1 * 900 / 2800 + 0.2 * 1000 / 2800 + 0.1);
  const timeout = E.matchScore({outcome: 'timeout', ships: {blue: 2800, red: 2800}, spotted: {blue: true, red: true}}, 'blue');
  assert.ok(timeout < E.matchScore({outcome: 'lose', ships: {blue: 0, red: 2800}, spotted: {blue: false, red: false}}, 'blue'), '逃げ回って時間切れにするより負けたほうがまし');
  near(E.matchScore({outcome: 'draw', ships: {blue: 2800, red: 2800}}, 'red'), E.TIMEOUT_SCORE);
});

test('1 試合: 敵旗艦を見つけたかを記録する (衛星スキャンでも見つかる)', () => {
  const r = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 70});
  assert.deepEqual(r.spotted, {blue: true, red: true}, '60 秒の衛星スキャンで見つかる');
  const early = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 30});
  assert.deepEqual(early.spotted, {blue: false, red: false});
});

test('1 試合: マップの広さを指定でき、終わったら本番の広さに戻る', () => {
  const L = require('../logic.js');
  const r = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 5, world: {w: 2500, h: 5000}});
  assert.equal(r.outcome, 'timeout');
  assert.deepEqual(L.WORLD, {w: 16000, h: 32000});
});

test('小さいマップから始める: 同じ広さで最低 20 世代。時間切れ 30% 未満かつ端 50% 未満が 5 世代続いたら次の広さへ。最後の広さで止まる', () => {
  assert.deepEqual(E.WORLD_STAGES, [{w: 4000, h: 8000}, {w: 8000, h: 16000}, {w: 16000, h: 32000}], '最後が本番の広さ (その 1/4・1/2 から)');
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
  const base = {outcome: 'win', ships: {blue: 280, red: 280}, spotted: {blue: false, red: false}};
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

test('対戦表: 各個体が決まった数だけ戦う。担当 (青 / 赤) と処理順 (青が先 / 赤が先) を入れ替える', () => {
  const s = E.schedule(6, 4, 2, E.mulberry32(9), 0.75);
  assert.equal(s.length, 6 * 4);
  for(let i = 0; i < 6; i++){
    const mine = s.filter(m => m.subject === i);
    assert.equal(mine.length, 4);
    assert.deepEqual(mine.map(m => m.side), ['blue', 'red', 'blue', 'red']);
    assert.deepEqual(mine.map(m => m.redFirst), [false, false, true, true]);
    for(const m of mine){
      if(m.opponent.kind === 'hall') assert.ok(m.opponent.index >= 0 && m.opponent.index < 2);
      else assert.equal(m.opponent.kind, 'rule');
      assert.ok(Number.isInteger(m.seed));
    }
  }
});

test('対戦表: 相手は旧型 AI が ruleProb、残りは殿堂入り (いなければ集団の自分以外)。集団どうしは殿堂入りがいないときだけ', () => {
  const s = E.schedule(48, 6, 5, E.mulberry32(3), 0.75);
  const rule = s.filter(m => m.opponent.kind === 'rule').length / s.length;
  assert.ok(rule > 0.68 && rule < 0.82, `旧型 AI の割合 ${rule}`);
  assert.equal(s.filter(m => m.opponent.kind === 'pop').length, 0, '殿堂入りがいれば集団どうしは戦わない');
  const noHall = E.schedule(6, 40, 0, E.mulberry32(9), 0.75);
  assert.ok(noHall.every(m => m.opponent.kind === 'rule' || (m.opponent.kind === 'pop' && m.opponent.index !== m.subject)), '殿堂入りがいなければ残りは集団の自分以外');
  assert.ok(noHall.some(m => m.opponent.kind === 'pop'));
  assert.ok(E.schedule(6, 4, 3, E.mulberry32(9), 1).every(m => m.opponent.kind === 'rule'), 'ruleProb 1 なら全部旧型 AI');
});

test('1 試合: 決まった種なら同じ結果。動かないチーム同士は時間切れになる', () => {
  const opts = {seed: 11, dt: 1 / 10, maxTime: 20};
  const a = E.playMatch(B.controller(stay()), B.controller(stay()), opts);
  const b = E.playMatch(B.controller(stay()), B.controller(stay()), opts);
  assert.deepEqual(a, b);
  assert.equal(a.outcome, 'timeout');
  assert.equal(a.time >= 20, true);
  assert.deepEqual(a.ships, {blue: 2800, red: 2800});
  assert.ok(a.metrics.edgeRatio >= 0 && a.metrics.edgeRatio <= 1);
});

test('1 試合: 旧型 AI どうしなら決着がつき、青と赤の処理順を入れ替えられる', () => {
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

test('学習の進み具合 (progressRecord): 始めた時刻・終わる予定 (始め + 分)・世代・終わったか。観戦画面が残り時間を出すのに使う', () => {
  const start = Date.UTC(2026, 8, 28, 0, 0, 0);
  const p = E.progressRecord({startedAt: start, minutes: 240, generation: 12, finished: false});
  assert.deepEqual(p, {startedAt: new Date(start).toISOString(), deadline: new Date(start + 240 * 60000).toISOString(), minutes: 240, generation: 12, finished: false});
  assert.equal(E.progressRecord({startedAt: start, minutes: 1, generation: 0}).finished, false, '省略時は終わっていない');
});

test('学習型 AI の脳のファイル (learnedBrainSource): ブラウザでは window.SagittariusLearnedBrain、Node では require() で読める', () => {
  const vm = require('node:vm');
  const best = {generation: 7, fitness: 1.2, brains: B.toPlain(B.randomBrainSet(E.mulberry32(3)))};
  const src = E.learnedBrainSource(best);
  const win = {};
  vm.runInNewContext(src, {window: win});
  assert.equal(win.SagittariusLearnedBrain.generation, 7);
  assert.equal(JSON.stringify(win.SagittariusLearnedBrain.brains), JSON.stringify(best.brains), '別の実行環境 (vm) の値なので JSON で比べる');
  const mod = {exports: {}};
  vm.runInNewContext(src, {module: mod});
  assert.equal(mod.exports.generation, 7);
});

test('今の学習型 AI (learned-brain.js) と旧型 AI の試合が最後まで進む', () => {
  const learned = require('../learned-brain.js');
  assert.ok(learned.generation > 0);
  const r = E.playMatch(B.controller(B.fromPlain(learned.brains)), R.controller(), {seed: 5, dt: 1 / 10, maxTime: 900, map: 'fixed'}); // ゲームと学習と同じ固定の地図 (第 4 段階)
  assert.ok(['win', 'lose', 'draw'].includes(r.outcome), r.outcome);
});

test('1 試合: opts.map で地図 (島) を指定できる (学習は固定の地図。第 4 段階)', () => {
  const stay = () => B.fromPlain(B.toPlain(B.randomBrainSet(() => 0.5)));
  const fixed = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 1, map: 'fixed'});
  assert.ok(fixed.islands > 0);
  const none = E.playMatch(B.controller(stay()), B.controller(stay()), {seed: 2, dt: 1 / 10, maxTime: 1});
  assert.equal(none.islands, 0);
});
