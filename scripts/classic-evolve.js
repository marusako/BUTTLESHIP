// クラシックの神経進化の部品 (第 6 段階): 1 試合、成績、突然変異、次の世代、学習型 AI の脳のファイル。
// 学習 (scripts/classic-train.js) と評価 (scripts/classic-evaluate.js) から使う。乱数・対戦表・進み具合は scripts/evolve.js のものを使う
const L = require('../classic/logic.js');
const B = require('../classic/brain.js');
const {mulberry32, gaussian, schedule, progressRecord} = require('./evolve.js');

const TIMEOUT_SCORE = -0.25; // 時間切れ (と引き分け) の成績。負け (0) より悪くして、逃げ回りを得にしない
const SHIPS_BONUS = 0.1;     // 残った隻数の差 (チームの最初の隻数に対する割合) に掛けて足す
const DAMAGE_BONUS = 0.2;    // 途中のごほうび: 敵に与えた損害 (敵が失った隻数の割合) に掛けて足す
const SPOT_BONUS = 0.1;      // 途中のごほうび: 敵の旗艦を一度でも見つけたら足す
const TEAM_SHIPS = 5 * L.INITIAL_SHIPS;

// AI どうしの 1 試合 (大将戦が既定)。blue / red は createGame の controllers に渡す関数 (null なら旧型 AI)。青の第 1 艦隊も AI。
// 青の第 1 艦隊の性能は旧型 AI と同じ 4 つの型からランダム。opts: seed, dt, maxTime, redFirst, mode
// 返り値: outcome (青から見た 'win' / 'lose' / 'draw'、または 'timeout')、time、ships (チームごとの残った隻数)、spotted (敵の旗艦を見つけたか)
function playClassicMatch(blue, red, opts){
  const rng = mulberry32(opts.seed);
  const preset = L.AI_PRESETS[Math.floor(rng() * L.AI_PRESETS.length)];
  const controllers = {};
  if(blue) controllers.blue = blue;
  if(red) controllers.red = red;
  const g = L.createGame(Object.assign({}, preset.params), rng, opts.mode || 'flagship', {controllers});
  for(const f of g.fleets) f.isPlayer = false;
  if(opts.redFirst) g.fleets = [...g.fleets.filter(f => f.team === 'red'), ...g.fleets.filter(f => f.team === 'blue')];
  const spotted = {blue: false, red: false};
  while(!g.outcome && g.time < opts.maxTime){
    L.step(g, opts.dt, rng);
    for(const team of ['blue', 'red']){
      const flag = g.fleets.find(f => f.team !== team && f.flagship);
      const info = flag && g.intel[team][flag.id];
      if(info && info.visible) spotted[team] = true;
    }
  }
  const ships = {blue: 0, red: 0};
  for(const f of g.fleets) ships[f.team] += Math.max(0, f.ships);
  return {outcome: g.outcome || 'timeout', time: g.time, ships, spotted};
}

// team から見た 1 試合の成績 (勝敗 + 残った隻数の差 + 途中のごほうび)
function matchScore(result, team){
  const other = team === 'blue' ? 'red' : 'blue';
  const bonus = SHIPS_BONUS * (result.ships[team] - result.ships[other]) / TEAM_SHIPS
    + DAMAGE_BONUS * (TEAM_SHIPS - result.ships[other]) / TEAM_SHIPS
    + (result.spotted && result.spotted[team] ? SPOT_BONUS : 0);
  if(result.outcome === 'timeout' || result.outcome === 'draw') return TIMEOUT_SCORE + bonus;
  const won = (result.outcome === 'win') === (team === 'blue');
  return (won ? 1 : 0) + bonus;
}

// 突然変異: 各重みを確率 rate で、標準偏差 sigma の乱れだけずらした新しい脳の組を返す (元は変えない)
function mutate(set, rng, opts){
  const next = {};
  for(const r of B.ROLES){
    const w = Float64Array.from(set[r]);
    for(let i = 0; i < w.length; i++) if(rng() < opts.rate) w[i] += gaussian(rng) * opts.sigma;
    next[r] = w;
  }
  return next;
}

// 次の世代: 成績の上位 elite 個はそのまま、残りはトーナメント選択で選んだ親に突然変異を加えて作る
function nextGeneration(pop, fitness, rng, opts){
  const order = pop.map((_, i) => i).sort((a, b) => fitness[b] - fitness[a] || a - b);
  const next = order.slice(0, opts.elite).map(i => pop[i]);
  while(next.length < pop.length){
    let best = -1;
    for(let k = 0; k < opts.tournament; k++){
      const i = Math.floor(rng() * pop.length);
      if(best < 0 || fitness[i] > fitness[best]) best = i;
    }
    next.push(mutate(pop[best], rng, opts));
  }
  return next;
}

// 出発点の脳 (模倣学習の結果など) から集団を作る。1 個体目はそのまま、残りは突然変異を加えたもの
function seedPopulation(seed, size, rng, opts){
  return Array.from({length: size}, (_, i) => (i === 0 ? seed : mutate(seed, rng, opts)));
}

// クラシックの学習型 AI の脳のファイル (classic/learned-brain.js) の中身。best: {generation, brains, ...}。
// ブラウザでは window.SagittariusLearnedBrain、Node では require() で読める
function learnedBrainSource(best){
  const data = JSON.stringify({generation: best.generation, brains: best.brains});
  return `// クラシックの学習型 AI の脳 (第 ${best.generation} 世代)。npm run classic-train の終わりか npm run classic-export-brain で書き出す。手で書き換えない
(function(root){
  const brain = ${data};
  if(typeof module !== 'undefined' && module.exports) module.exports = brain;
  else root.SagittariusLearnedBrain = brain;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

module.exports = {TIMEOUT_SCORE, playClassicMatch, matchScore, mutate, nextGeneration, seedPopulation, learnedBrainSource, schedule, progressRecord, mulberry32};
