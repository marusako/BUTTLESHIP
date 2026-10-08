const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../classic/logic.js');
const B = require('../classic/brain.js');
const E = require('./classic-evolve.js');

test('クラシックの 1 試合: 同じ種なら同じ結果。旧型 AI どうし (null) でも、脳を入れても最後まで進む', () => {
  const opts = {seed: 12345, dt: 1 / 30, maxTime: 300};
  const a = E.playClassicMatch(null, null, opts);
  const b = E.playClassicMatch(null, null, opts);
  assert.deepEqual(a, b);
  assert.ok(['win', 'lose', 'draw', 'timeout'].includes(a.outcome));
  const brain = B.controller(B.randomBrainSet(E.mulberry32(3), 0.5));
  const c = E.playClassicMatch(brain, null, Object.assign({}, opts, {redFirst: true}));
  assert.ok(c.time > 0 && c.ships.blue >= 0 && c.ships.red >= 0);
});

test('成績: 勝ちは 1 + ごほうび、負けは 0 + ごほうび、時間切れは負けより悪い', () => {
  const full = 5 * L.INITIAL_SHIPS;
  const r = {outcome: 'win', ships: {blue: full, red: 0}, spotted: {blue: true, red: false}};
  assert.ok(Math.abs(E.matchScore(r, 'blue') - (1 + 0.1 + 0.2 + 0.1)) < 1e-9);
  assert.ok(Math.abs(E.matchScore(r, 'red') - (0 - 0.1 + 0 + 0)) < 1e-9);
  const t = {outcome: 'timeout', ships: {blue: full, red: full}, spotted: {blue: false, red: false}};
  assert.ok(E.matchScore(t, 'blue') < E.matchScore({outcome: 'lose', ships: {blue: full, red: full}, spotted: {}}, 'blue'));
});

test('突然変異と次の世代: 役割 (leader / escort) ごとに重みをずらす。上位はそのまま残る。元は変えない', () => {
  const rng = E.mulberry32(7);
  const set = B.randomBrainSet(rng, 0.5);
  const before = Array.from(set.leader);
  const m = E.mutate(set, rng, {rate: 1, sigma: 0.1});
  assert.deepEqual(Object.keys(m).sort(), ['escort', 'leader']);
  assert.deepEqual(Array.from(set.leader), before, '元は変えない');
  assert.ok(m.leader.some((v, i) => v !== before[i]));
  const pop = [set, B.randomBrainSet(rng, 0.5), B.randomBrainSet(rng, 0.5)];
  const next = E.nextGeneration(pop, [0.1, 0.9, 0.5], rng, {elite: 1, tournament: 2, rate: 0.1, sigma: 0.05});
  assert.equal(next.length, 3);
  assert.equal(next[0], pop[1], '一番よいものはそのまま');
  const seeded = E.seedPopulation(set, 4, rng, {rate: 0.1, sigma: 0.05});
  assert.equal(seeded[0], set);
  assert.equal(seeded.length, 4);
});

test('学習型 AI の脳のファイル: 書き出したものを読み込むと、世代と脳が戻る', () => {
  const plain = B.toPlain(B.randomBrainSet(E.mulberry32(9), 0.5));
  const src = E.learnedBrainSource({generation: 42, brains: plain, fitness: 1});
  const mod = {exports: {}};
  new Function('module', 'globalThis', 'window', src)(mod, {}, undefined);
  assert.equal(mod.exports.generation, 42);
  assert.deepEqual(mod.exports.brains, plain);
  assert.ok(B.fromPlain(mod.exports.brains));
});
