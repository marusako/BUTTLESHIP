// 模倣学習: 旧ルール AI の命令をお手本にして、脳 (brain.js) を誤差逆伝播で学習させる。神経進化の出発点に使う。
//   node scripts/imitate.js                    お手本を集めて学習し、training/imitation.json に保存する
//   node scripts/imitate.js --games 60 --epochs 30 --eval-games 40
// 外部パッケージは使わない (誤差逆伝播と Adam (重みの直し方を自動で調整する方法) を自分で計算する)
const fs = require('node:fs');
const path = require('node:path');
const L = require('../logic.js');
const B = require('../brain.js');
const R = require('../rule-ai.js');
const E = require('./evolve.js');

const MOVE_CLIP = 0.9; // 移動のお手本を tanh の手前の値に直すときの上限 (1 に近いと値が大きくなりすぎる)
const {INPUTS, HIDDEN, OUTPUTS, OUT} = B;
const ATTACK_LOGITS = [OUT.attackNone, OUT.attack0, OUT.attack1, OUT.attack2]; // 攻撃の点数の出力 (攻撃しない、近い順の敵 3 つ)

// 旧ルール AI の命令を、脳の出力のお手本にする。
// 返り値: {move: [x, y] (tanh の手前の値。攻撃のときは null), attack: 0 (攻撃しない) / 1〜3 (近い順の見えている敵), choices: 選べる数 (1 + 見えている敵の数、最大 4)}
function toTarget(order, f, fleets, intel){
  const targets = B.visibleTargets(f, intel);
  const choices = 1 + targets.length;
  if(order && order.type === 'attack'){
    const i = targets.findIndex(t => t.id === order.targetId);
    if(i >= 0) return {move: null, attack: i + 1, choices};
    const info = intel[order.targetId]; // 見えていない相手 → 最終確認位置への移動として扱う
    return {move: moveTarget(f, info || f), attack: 0, choices};
  }
  if(order && order.type === 'move') return {move: moveTarget(f, order), attack: 0, choices};
  if(order && order.type === 'course'){
    return {move: moveTarget(f, {x: f.x + Math.cos(order.angle) * B.MOVE_REACH * 2, y: f.y + Math.sin(order.angle) * B.MOVE_REACH * 2}), attack: 0, choices};
  }
  return {move: [0, 0], attack: 0, choices};
}

// 移動先への向きと距離 (MOVE_REACH を 1) を、チームから見た向きで tanh の手前の値にする
function moveTarget(f, dest){
  const s = f.team === 'red' ? -1 : 1;
  const dx = (dest.x - f.x) * s, dy = (dest.y - f.y) * s;
  const d = Math.hypot(dx, dy);
  if(d === 0) return [0, 0];
  const k = Math.min(d / B.MOVE_REACH, 1);
  const clip = v => Math.atanh(Math.max(-MOVE_CLIP, Math.min(MOVE_CLIP, v)));
  return [clip(dx / d * k), clip(dy / d * k)];
}

// brain.js の forward と同じ計算で、中間層の値も返す (誤差逆伝播に使う)
function forwardWithHidden(w, input){
  const hidden = new Float64Array(HIDDEN);
  let k = 0;
  for(let h = 0; h < HIDDEN; h++){
    let sum = 0;
    for(let i = 0; i < INPUTS; i++) sum += w[k++] * input[i];
    hidden[h] = sum;
  }
  for(let h = 0; h < HIDDEN; h++) hidden[h] = Math.tanh(hidden[h] + w[k++]);
  const out = new Float64Array(OUTPUTS);
  for(let o = 0; o < OUTPUTS; o++){
    let sum = 0;
    for(let h = 0; h < HIDDEN; h++) sum += w[k++] * hidden[h];
    out[o] = sum;
  }
  for(let o = 0; o < OUTPUTS; o++) out[o] += w[k++];
  return {hidden, out};
}

// 1 つのお手本の誤差と勾配。移動は二乗誤差 × 1/2 (攻撃のときは数えない)、攻撃の点数はソフトマックス交差エントロピー (選べるものの中だけ)
function lossAndGrad(w, sample, grad){
  const g = grad || new Float64Array(w.length);
  const {hidden, out} = forwardWithHidden(w, sample.input);
  const dOut = new Float64Array(OUTPUTS);
  let loss = 0;
  if(sample.move){
    for(const [j, o] of [[0, OUT.moveX], [1, OUT.moveY]]){
      const e = out[o] - sample.move[j];
      loss += 0.5 * e * e;
      dOut[o] += e;
    }
  }
  const n = sample.choices;
  let max = -Infinity;
  for(let c = 0; c < n; c++) max = Math.max(max, out[ATTACK_LOGITS[c]]);
  let sum = 0;
  const p = new Float64Array(n);
  for(let c = 0; c < n; c++){ p[c] = Math.exp(out[ATTACK_LOGITS[c]] - max); sum += p[c]; }
  for(let c = 0; c < n; c++){
    p[c] /= sum;
    dOut[ATTACK_LOGITS[c]] += p[c] - (c === sample.attack ? 1 : 0);
  }
  loss -= Math.log(p[sample.attack]);

  // 逆向きに勾配を計算する (出力層 → 中間層 → 入力層)
  const w2 = HIDDEN * INPUTS + HIDDEN, b2 = w2 + OUTPUTS * HIDDEN;
  const dHidden = new Float64Array(HIDDEN);
  for(let o = 0; o < OUTPUTS; o++){
    if(dOut[o] === 0) continue;
    for(let h = 0; h < HIDDEN; h++){
      g[w2 + o * HIDDEN + h] += dOut[o] * hidden[h];
      dHidden[h] += dOut[o] * w[w2 + o * HIDDEN + h];
    }
    g[b2 + o] += dOut[o];
  }
  for(let h = 0; h < HIDDEN; h++){
    const d = dHidden[h] * (1 - hidden[h] * hidden[h]); // tanh の微分
    if(d === 0) continue;
    for(let i = 0; i < INPUTS; i++) g[h * INPUTS + i] += d * sample.input[i];
    g[HIDDEN * INPUTS + h] += d;
  }
  return {loss, grad: g};
}

function meanLoss(w, samples){
  return samples.reduce((s, x) => s + lossAndGrad(w, x).loss, 0) / samples.length;
}

// 学習前の重み (小さな乱数)
function initialWeights(rng){
  return Float64Array.from({length: B.paramCount()}, () => (rng() * 2 - 1) * 0.1);
}

// ミニバッチ (少しずつ) の Adam で学習する。元の重みは変えない
function train(w0, samples, rng, opts){
  const w = Float64Array.from(w0);
  const m = new Float64Array(w.length), v = new Float64Array(w.length);
  const b1 = 0.9, b2 = 0.999, eps = 1e-8;
  let t = 0;
  const order = samples.map((_, i) => i);
  for(let epoch = 0; epoch < opts.epochs; epoch++){
    for(let i = order.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for(let start = 0; start < order.length; start += opts.batch){
      const grad = new Float64Array(w.length);
      const end = Math.min(order.length, start + opts.batch);
      for(let k = start; k < end; k++) lossAndGrad(w, samples[order[k]], grad);
      t++;
      for(let i = 0; i < w.length; i++){
        const gi = grad[i] / (end - start);
        m[i] = b1 * m[i] + (1 - b1) * gi;
        v[i] = b2 * v[i] + (1 - b2) * gi * gi;
        w[i] -= opts.lr * (m[i] / (1 - Math.pow(b1, t))) / (Math.sqrt(v[i] / (1 - Math.pow(b2, t))) + eps);
      }
    }
    if(opts.onEpoch) opts.onEpoch(epoch, w);
  }
  return w;
}

// 旧ルール AI どうしの試合から、艦種ごとに (入力, お手本) を集める。opts: games, seed, dt, maxTime, world
function collect(opts){
  const data = {};
  for(const r of B.ROLES) data[r] = [];
  const recorder = () => {
    const rule = R.controller();
    return (f, fleets, intel, rng) => {
      const order = rule(f, fleets, intel, rng);
      data[f.role].push(Object.assign({input: B.observe(f, fleets, intel)}, toTarget(order, f, fleets, intel)));
      return order;
    };
  };
  for(let k = 0; k < opts.games; k++){
    E.playMatch(recorder(), recorder(), {seed: opts.seed + k * 7919, dt: opts.dt, maxTime: opts.maxTime, world: opts.world, redFirst: k % 2 === 1});
  }
  return data;
}

// 攻撃の選び方がお手本と一致した割合と、移動の向きの一致 (コサイン類似度の平均)
function agreement(w, samples){
  let attackOk = 0, moveSum = 0, moveN = 0;
  for(const s of samples){
    const out = B.forward(w, s.input);
    let best = 0;
    for(let c = 1; c < s.choices; c++) if(out[ATTACK_LOGITS[c]] > out[ATTACK_LOGITS[best]]) best = c;
    if(best === s.attack) attackOk++;
    if(s.move && Math.hypot(s.move[0], s.move[1]) > 0.1){
      const a = [Math.tanh(out[OUT.moveX]), Math.tanh(out[OUT.moveY])], b = s.move.map(Math.tanh);
      moveSum += (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(a[0], a[1]) || 1) * Math.hypot(b[0], b[1]));
      moveN++;
    }
  }
  return {attack: attackOk / samples.length, move: moveN ? moveSum / moveN : 0};
}

function parseArgs(argv){
  const o = {games: 60, epochs: 30, lr: 0.003, batch: 64, seed: 20260927, 'eval-games': 40, workers: 5};
  for(let i = 0; i < argv.length; i++){
    const key = argv[i].replace(/^--/, '');
    if(!(key in o)) throw new Error(`知らないオプション: ${argv[i]}`);
    o[key] = Number(argv[++i]);
  }
  return o;
}

async function main(){
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();
  // 学習の 3 つの広さでお手本を集める (どの広さでもまねできるように)
  const data = {};
  for(const r of B.ROLES) data[r] = [];
  E.WORLD_STAGES.forEach((world, i) => {
    const part = collect({games: Math.ceil(args.games / E.WORLD_STAGES.length), seed: args.seed + i * 100003, dt: 1 / 30, maxTime: 600, world});
    for(const r of B.ROLES) data[r].push(...part[r]);
  });
  console.log(`お手本: ${B.ROLES.map(r => `${r} ${data[r].length}`).join(' / ')} (${((Date.now() - started) / 1000).toFixed(0)} 秒)`);

  const rng = E.mulberry32(args.seed);
  const brains = {};
  for(const r of B.ROLES){
    const w0 = initialWeights(rng);
    const before = agreement(w0, data[r]);
    brains[r] = train(w0, data[r], rng, {epochs: args.epochs, lr: args.lr, batch: args.batch});
    const after = agreement(brains[r], data[r]);
    console.log(`${r}: 攻撃の一致 ${(before.attack * 100).toFixed(0)}% → ${(after.attack * 100).toFixed(0)}%、移動の向き ${before.move.toFixed(2)} → ${after.move.toFixed(2)} (誤差 ${meanLoss(brains[r], data[r]).toFixed(3)})`);
  }

  const dir = path.join(__dirname, '..', 'training');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'imitation.json');
  fs.writeFileSync(file, JSON.stringify({kind: 'imitation', brains: B.toPlain(brains)}));
  console.log(`保存しました: training/imitation.json (${((Date.now() - started) / 1000).toFixed(0)} 秒)`);

  if(args['eval-games'] > 0){
    const {createPool} = require('./pool.js');
    const pool = createPool(args.workers);
    const learned = {kind: 'brain', brains: B.toPlain(brains)};
    const evalRng = E.mulberry32(424242);
    const tasks = Array.from({length: args['eval-games']}, (_, k) => ({
      blue: k % 2 === 0 ? learned : {kind: 'rule'}, red: k % 2 === 0 ? {kind: 'rule'} : learned,
      opts: {seed: Math.floor(evalRng() * 2147483647), dt: 1 / 60, maxTime: 900, redFirst: k % 4 >= 2}
    }));
    const results = await pool.run(tasks);
    await pool.close();
    const won = results.filter((r, k) => r.outcome !== 'timeout' && r.outcome !== 'draw' && (r.outcome === 'win') === (k % 2 === 0)).length;
    const timeouts = results.filter(r => r.outcome === 'timeout').length;
    console.log(`まねした脳 対 旧ルール AI: ${args['eval-games']} 試合で ${won} 勝 (時間切れ ${timeouts})`);
  }
}

if(require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = {MOVE_CLIP, toTarget, forwardWithHidden, lossAndGrad, meanLoss, initialWeights, train, collect, agreement};
