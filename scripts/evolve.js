// 神経進化 (AI の脳を育てる) の部品: 乱数、1 試合、成績、突然変異、次の世代、対戦表。
// 学習 (scripts/train.js) と評価 (scripts/evaluate.js) から使う。どれも決まった乱数なら決まった結果になる。
const L = require('../logic.js');
const B = require('../brain.js');

const TIMEOUT_SCORE = -0.25; // 時間切れ (と両旗艦の同時撃沈) の成績。負け (0) より悪くして、逃げ回りを得にしない
const SHIPS_BONUS = 0.1;     // 残存戦力の差 (全艦艇数に対する割合) に掛けて足す
const DAMAGE_BONUS = 0.2;    // 途中のごほうび: 敵に与えたダメージ (敵が失った艦艇数の、全艦艇数に対する割合) に掛けて足す
const SPOT_BONUS = 0.1;      // 途中のごほうび: 敵の旗艦を一度でも見つけたら足す
const EDGE_PENALTY = 0.3;    // 端にいた艦隊の割合 (チームごと) に掛けて成績から引く (端に張りつく癖を防ぐ)
// 小さいマップから始める (カリキュラム学習): 学習の試合のマップの広さの段階。最後が本番の広さ
const WORLD_STAGES = [{w: 4000, h: 8000}, {w: 8000, h: 16000}, {w: 16000, h: 32000}];
const STAGE_TIMEOUT_RATE = 0.3; // 時間切れの割合がこれ未満で
const STAGE_EDGE_RATE = 0.5;    // 端にいる割合がこれ未満の世代が
const STAGE_STREAK = 5;         // これだけ続き、
const STAGE_MIN_GENS = 20;      // 同じ広さでこれだけの世代を学んだら次の広さへ
const EDGE_MARGIN = 250;     // マップの端からこの距離より近ければ「端にいる」
const TOTAL_SHIPS = L.FORMATION.reduce((sum, role) => sum + L.maxHpOf(role), 0); // チームの最大 HP の合計 (試合の中の HP)

// 種が近くてもばらつく乱数 (0 以上 1 未満)
function mulberry32(seed){
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 標準正規分布の乱数 (ボックス=ミュラー法)
function gaussian(rng){
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// AI 同士の 1 試合。blue / red は createGame の controllers に渡す関数。プレイヤーはいない (青の旗艦も AI)。
// opts: seed, dt (1 ステップの秒数), maxTime (これを超えたら時間切れ), redFirst (処理順を赤が先に), world (マップの広さ {w, h}。省略時は本番の広さ)、
//   map (地図 'fixed' / 'random'。省略時は島なし。第 4 段階)
// 返り値: outcome (青から見た 'win' / 'lose' / 'draw'、または 'timeout')、time、ships (チームごとの残存戦力)、
//   spotted (チームごとに、敵の旗艦を一度でも見つけたか)、metrics
function playMatch(blue, red, opts){
  L.setWorld(opts.world && opts.world.w, opts.world && opts.world.h);
  try{
    return runMatch(blue, red, opts);
  }finally{
    L.setWorld(); // ほかの試合やゲームに影響しないように本番の広さへ戻す
  }
}

function runMatch(blue, red, opts){
  const rng = mulberry32(opts.seed);
  const g = L.createGame({controllers: {blue, red}, map: opts.map, mapSeed: opts.seed});
  for(const f of g.fleets) f.isPlayer = false;
  if(opts.redFirst) g.fleets = [...g.fleets.filter(f => f.team === 'red'), ...g.fleets.filter(f => f.team === 'blue')];

  let edgeSum = 0, samples = 0, nextSample = 0;
  const edgeTeam = {blue: 0, red: 0}, samplesTeam = {blue: 0, red: 0};
  const advance = {blue: 0, red: 0};
  const spotted = {blue: false, red: false};
  const flagId = {blue: 'red1', red: 'blue1'}; // 敵の旗艦
  while(!g.outcome && g.time < opts.maxTime){
    L.step(g, opts.dt, rng);
    for(const team of ['blue', 'red']){
      const info = g.intel[team][flagId[team]];
      if(info && info.visible) spotted[team] = true;
    }
    if(g.time >= nextSample){
      nextSample += 1;
      const living = g.fleets.filter(f => f.ships > 0);
      const atEdge = f => Math.min(f.x, f.y, L.WORLD.w - f.x, L.WORLD.h - f.y) < EDGE_MARGIN;
      if(living.length){
        edgeSum += living.filter(atEdge).length / living.length;
        samples++;
      }
      for(const team of ['blue', 'red']){
        const mine = living.filter(f => f.team === team);
        if(!mine.length) continue;
        edgeTeam[team] += mine.filter(atEdge).length / mine.length;
        samplesTeam[team]++;
      }
      for(const f of living.filter(f => f.flagship)){
        const progress = f.team === 'blue' ? 1 - f.y / L.WORLD.h : f.y / L.WORLD.h; // 自陣の端 0 → 敵陣の端 1
        advance[f.team] = Math.max(advance[f.team], progress);
      }
    }
  }
  const ships = {blue: 0, red: 0};
  for(const f of g.fleets) ships[f.team] += f.ships;
  return {
    outcome: g.outcome || 'timeout',
    time: g.time,
    ships,
    spotted,
    islands: g.islands.length, // 島の数 (地図を指定したか確かめる用)
    metrics: {
      edgeRatio: samples ? edgeSum / samples : 0,
      edgeByTeam: {blue: samplesTeam.blue ? edgeTeam.blue / samplesTeam.blue : 0, red: samplesTeam.red ? edgeTeam.red / samplesTeam.red : 0},
      flagAdvance: advance
    }
  };
}

// team から見た 1 試合の成績 (勝敗 + 残存戦力の差 + 途中のごほうび)
function matchScore(result, team){
  const other = team === 'blue' ? 'red' : 'blue';
  const bonus = SHIPS_BONUS * (result.ships[team] - result.ships[other]) / TOTAL_SHIPS
    + DAMAGE_BONUS * (TOTAL_SHIPS - result.ships[other]) / TOTAL_SHIPS
    + (result.spotted && result.spotted[team] ? SPOT_BONUS : 0)
    - EDGE_PENALTY * (result.metrics && result.metrics.edgeByTeam ? result.metrics.edgeByTeam[team] : 0);
  if(result.outcome === 'timeout' || result.outcome === 'draw') return TIMEOUT_SCORE + bonus;
  const won = (result.outcome === 'win') === (team === 'blue');
  return (won ? 1 : 0) + bonus;
}

// 突然変異: 各重みを確率 rate で、標準偏差 sigma の乱れだけずらした新しい脳の組を返す (元は変えない)
function mutate(set, rng, opts){
  const next = {};
  for(const r of B.ROLES){
    const w = Float64Array.from(set[r]);
    for(let i = 0; i < w.length; i++){
      if(rng() < opts.rate) w[i] += gaussian(rng) * opts.sigma;
    }
    next[r] = w;
  }
  return next;
}

// 次の世代: 成績の上位 elite 個はそのまま残し、残りはトーナメント選択 (ランダムに tournament 個選んで最も成績の良いもの) で選んだ親に突然変異を加えて作る
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

// 対戦表: 各個体 (subject) が games 試合ずつ。相手は確率 ruleProb で旧型 AI、それ以外は殿堂入り (過去の強い脳。まだいなければ集団の自分以外)。
// 青・赤を交互に受け持ち、処理順 (青が先 / 赤が先) も 2 試合ごとに入れ替える
function schedule(popSize, games, hallSize, rng, ruleProb){
  const list = [];
  for(let i = 0; i < popSize; i++){
    for(let k = 0; k < games; k++){
      let opponent;
      if(rng() < ruleProb) opponent = {kind: 'rule'};
      else if(hallSize > 0) opponent = {kind: 'hall', index: Math.floor(rng() * hallSize)};
      else{
        let j = Math.floor(rng() * (popSize - 1));
        if(j >= i) j++;
        opponent = {kind: 'pop', index: j};
      }
      list.push({subject: i, opponent, side: k % 2 === 0 ? 'blue' : 'red', redFirst: k % 4 >= 2, seed: Math.floor(rng() * 2147483647)});
    }
  }
  return list;
}

// 小さいマップから始める: 時間切れと端にいる割合を見て、次の広さへ進むか決める。curriculum: {stage, streak, gens}
function advanceCurriculum(curriculum, timeoutRate, edgeRatio){
  const streak = timeoutRate < STAGE_TIMEOUT_RATE && edgeRatio < STAGE_EDGE_RATE ? curriculum.streak + 1 : 0;
  const gens = (curriculum.gens || 0) + 1;
  if(gens >= STAGE_MIN_GENS && streak >= STAGE_STREAK && curriculum.stage < WORLD_STAGES.length - 1) return {stage: curriculum.stage + 1, streak: 0, gens: 0};
  return {stage: curriculum.stage, streak, gens};
}

// 出発点の脳 (模倣学習の結果など) から集団を作る。1 個体目はそのまま、残りは突然変異を加えたもの
function seedPopulation(seed, size, rng, opts){
  return Array.from({length: size}, (_, i) => (i === 0 ? seed : mutate(seed, rng, opts)));
}

// 学習の進み具合 (training/progress.json に書き出す): 始めた時刻・終わる予定 (始め + minutes 分)・今の世代・終わったか。
// 観戦画面 (watch.html) が学習全体の残り時間を出すのに使う。時刻は ISO 8601 の文字列
function progressRecord({startedAt, minutes, generation, finished}){
  return {startedAt: new Date(startedAt).toISOString(), deadline: new Date(startedAt + minutes * 60000).toISOString(), minutes, generation, finished: !!finished};
}

// 学習型 AI の脳のファイル (learned-brain.js) の中身。best: training/best.json と同じ形 ({generation, brains, ...})。
// ブラウザでは window.SagittariusLearnedBrain、Node では require() で読める
function learnedBrainSource(best){
  const data = JSON.stringify({generation: best.generation, brains: best.brains});
  return `// 学習型 AI の脳 (第 ${best.generation} 世代)。npm run train の終わりか npm run export-brain で書き出す。手で書き換えない
(function(root){
  const brain = ${data};
  if(typeof module !== 'undefined' && module.exports) module.exports = brain;
  else root.SagittariusLearnedBrain = brain;
})(typeof window !== 'undefined' ? window : globalThis);
`;
}

module.exports = {learnedBrainSource, progressRecord, TIMEOUT_SCORE, EDGE_MARGIN, WORLD_STAGES, advanceCurriculum, seedPopulation, mulberry32, gaussian, playMatch, matchScore, mutate, nextGeneration, schedule};
