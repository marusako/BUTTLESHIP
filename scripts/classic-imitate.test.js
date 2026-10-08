const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../classic/logic.js');
const B = require('../classic/brain.js');
const E = require('./classic-evolve.js');
const I = require('./classic-imitate.js');

test('お手本: 攻撃は近い順の何番目か、移動はチームから見た向き (赤は逆)。見えていない相手への攻撃は最終確認位置への移動', () => {
  const f = {id: 'b', team: 'blue', x: 1200, y: 3000};
  const intel = {e: {x: 1200, y: 2800, visible: true}, g: {x: 1200, y: 1000, visible: false}};
  assert.deepEqual(I.toTarget({type: 'attack', targetId: 'e'}, f, [], intel), {move: null, attack: 1, choices: 2});
  const ghost = I.toTarget({type: 'attack', targetId: 'g'}, f, [], intel);
  assert.equal(ghost.attack, 0);
  assert.ok(ghost.move[1] < 0, '北へ');
  const red = I.toTarget({type: 'move', x: 1200, y: 3600}, Object.assign({}, f, {team: 'red'}), [], {});
  assert.ok(red.move[1] < 0, '赤は向きを逆にして見る (南へ動く = 赤から見て前)');
  assert.deepEqual(I.toTarget(null, f, [], {}).move, [0, 0]);
});

test('誤差逆伝播: 勾配は数値で求めた勾配と合う', () => {
  const rng = E.mulberry32(5);
  const w = I.initialWeights(rng);
  const sample = {input: Array.from({length: B.INPUTS}, () => rng() - 0.5), move: [0.3, -0.2], attack: 1, choices: 3};
  const {grad} = I.lossAndGrad(w, sample);
  for(const i of [0, 7, B.HIDDEN * B.INPUTS + 3, w.length - 1, w.length - 3]){
    const h = 1e-6, wp = Float64Array.from(w), wm = Float64Array.from(w);
    wp[i] += h; wm[i] -= h;
    const num = (I.lossAndGrad(wp, sample).loss - I.lossAndGrad(wm, sample).loss) / (2 * h);
    assert.ok(Math.abs(num - grad[i]) < 1e-5, `${i}: ${num} / ${grad[i]}`);
  }
});

test('模倣学習: 旧型 AI どうしの試合から隊長と護衛のお手本を集め、学習すると誤差が減る', () => {
  const data = I.collect({games: 2, seed: 11, dt: 1 / 30, maxTime: 60});
  assert.ok(data.leader.length > 0 && data.escort.length > 0);
  assert.ok(data.escort.every(s => s.input.length === B.INPUTS));
  const rng = E.mulberry32(3);
  const w0 = I.initialWeights(rng);
  const samples = data.escort.slice(0, 200);
  const w1 = I.train(w0, samples, rng, {epochs: 5, lr: 0.003, batch: 32});
  assert.ok(I.meanLoss(w1, samples) < I.meanLoss(w0, samples));
});
