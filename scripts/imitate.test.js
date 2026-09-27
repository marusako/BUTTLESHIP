const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');
const B = require('../brain.js');
const E = require('./evolve.js');
const I = require('./imitate.js');

// テスト用の艦隊
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', role: 'cruiser', x: 5000, y: 10000, hitRadius: 25,
    ships: L.INITIAL_SHIPS, params: {speed: 45, defense: 30, attack: 25},
    order: null, isPlayer: false, ai: {nextThink: 0}, heading: 0, flagship: false,
    cooldown: 0, aaCooldown: 0, stealth: 0, weapons: {fire: true}
  }, over);
}
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

test('お手本の変換: 見えている敵への攻撃命令 → その敵の攻撃の点数 (近い順 1〜3)。移動は数えない', () => {
  const me = fleet({id: 'me'});
  const intel = {a: {x: 5000, y: 9800, visible: true}, b: {x: 5000, y: 9500, visible: true}};
  const t = I.toTarget({type: 'attack', targetId: 'b'}, me, [me], intel);
  assert.deepEqual([t.attack, t.move, t.choices], [2, null, 3]);
});

test('お手本の変換: 見えていない相手への攻撃命令 → 最終確認位置への移動', () => {
  const me = fleet({id: 'me'});
  const intel = {g: {x: 5000, y: 8000, visible: false}};
  const t = I.toTarget({type: 'attack', targetId: 'g'}, me, [me], intel);
  assert.equal(t.attack, 0);
  assert.ok(near(t.move[0], 0) && near(t.move[1], -Math.atanh(I.MOVE_CLIP)), JSON.stringify(t.move));
});

test('お手本の変換: 移動命令 → チームから見た向きと距離 (MOVE_REACH で割り、端は切る)。赤は向きが逆。命令なしは止まる', () => {
  const me = fleet({id: 'me'});
  const t = I.toTarget({type: 'move', x: 5000 + B.MOVE_REACH / 2, y: 10000}, me, [me], {});
  assert.equal(t.attack, 0);
  assert.ok(near(t.move[0], Math.atanh(0.5)) && near(t.move[1], 0));
  const red = fleet({id: 'r', team: 'red'});
  const tr = I.toTarget({type: 'move', x: 5000 + B.MOVE_REACH / 2, y: 10000}, red, [red], {});
  assert.ok(near(tr.move[0], -Math.atanh(0.5)), '赤から見た右は、マップでは左');
  const stop = I.toTarget(null, me, [me], {});
  assert.deepEqual([stop.attack, stop.move], [0, [0, 0]]);
  const course = I.toTarget({type: 'course', angle: Math.PI / 2}, me, [me], {});
  assert.ok(near(course.move[0], 0) && near(course.move[1], Math.atanh(I.MOVE_CLIP)));
});

test('計算: 途中の値も返す forward は brain.js の forward と同じ出力', () => {
  const w = B.randomBrainSet(E.mulberry32(3)).cruiser;
  const input = Array.from({length: B.INPUTS}, (_, i) => Math.sin(i));
  const {out} = I.forwardWithHidden(w, input);
  const ref = B.forward(w, input);
  out.forEach((v, i) => assert.ok(near(v, ref[i], 1e-12)));
});

test('誤差逆伝播: 勾配が数値微分と一致する (移動と攻撃の両方)', () => {
  const rng = E.mulberry32(11);
  const w = Float64Array.from({length: B.paramCount()}, () => (rng() * 2 - 1) * 0.3);
  const input = Array.from({length: B.INPUTS}, () => rng() * 2 - 1);
  for(const sample of [{input, move: [0.4, -0.7], attack: 0, choices: 3}, {input, move: null, attack: 2, choices: 3}]){
    const {grad} = I.lossAndGrad(w, sample);
    for(let k = 0; k < 25; k++){
      const i = Math.floor(rng() * w.length);
      const h = 1e-6;
      const orig = w[i];
      w[i] = orig + h; const lp = I.lossAndGrad(w, sample).loss;
      w[i] = orig - h; const lm = I.lossAndGrad(w, sample).loss;
      w[i] = orig;
      assert.ok(Math.abs((lp - lm) / (2 * h) - grad[i]) < 1e-5, `重み ${i}: 数値微分 ${(lp - lm) / (2 * h)} / 勾配 ${grad[i]}`);
    }
  }
});

test('学習: お手本に近づくように重みを直すと、誤差が下がる', () => {
  const rng = E.mulberry32(5);
  const samples = Array.from({length: 60}, (_, k) => ({
    input: Array.from({length: B.INPUTS}, () => rng() * 2 - 1),
    move: k % 3 === 0 ? null : [0.8, -0.3],
    attack: k % 3 === 0 ? 1 : 0,
    choices: 3
  }));
  const w0 = I.initialWeights(E.mulberry32(1));
  const before = I.meanLoss(w0, samples);
  const w = I.train(w0, samples, E.mulberry32(2), {epochs: 60, lr: 0.01, batch: 16});
  assert.ok(I.meanLoss(w, samples) < before * 0.3, `${before} → ${I.meanLoss(w, samples)}`);
});

test('お手本集め: 旧ルール AI どうしの試合から、艦種ごとに (入力, お手本) を集める', () => {
  const data = I.collect({games: 1, seed: 1, dt: 1 / 10, maxTime: 30, world: {w: 2500, h: 5000}});
  for(const r of B.ROLES){
    assert.ok(data[r].length > 0, r);
    assert.equal(data[r][0].input.length, B.INPUTS);
  }
  assert.deepEqual(L.WORLD, {w: 10000, h: 20000}, '終わったら本番の広さに戻る');
});
