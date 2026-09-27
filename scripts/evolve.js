// 神経進化 (AI の脳を育てる) の部品: 乱数、1 試合、成績、突然変異、次の世代、対戦表。
// 学習 (scripts/train.js) と評価 (scripts/evaluate.js) から使う。どれも決まった乱数なら決まった結果になる。
const L = require('../logic.js');
const B = require('../brain.js');

const TIMEOUT_SCORE = -0.25; // 時間切れ (と両旗艦の同時撃沈) の成績。負け (0) より悪くして、逃げ回りを得にしない
const SHIPS_BONUS = 0.1;     // 残存戦力の差 (全艦艇数に対する割合) に掛けて足す
const DAMAGE_BONUS = 0.2;    // 途中のごほうび: 敵に与えたダメージ (敵が失った艦艇数の、全艦艇数に対する割合) に掛けて足す
const SPOT_BONUS = 0.1;      // 途中のごほうび: 敵の旗艦を一度でも見つけたら足す
// 小さいマップから始める (カリキュラム学習): 学習の試合のマップの広さの段階。最後が本番の広さ
const WORLD_STAGES = [{w: 2500, h: 5000}, {w: 5000, h: 10000}, {w: 10000, h: 20000}];
const STAGE_TIMEOUT_RATE = 0.3; // 時間切れの割合がこれ未満の世代が
const STAGE_STREAK = 5;         // これだけ続いたら次の広さへ
const EDGE_MARGIN = 250;     // マップの端からこの距離より近ければ「端にいる」
const TOTAL_SHIPS = L.INITIAL_SHIPS * L.FORMATION.length;

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
// opts: seed, dt (1 ステップの秒数), maxTime (これを超えたら時間切れ), redFirst (処理順を赤が先に), world (マップの広さ {w, h}。省略時は本番の広さ)
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
  const g = L.createGame({controllers: {blue, red}});
  for(const f of g.fleets) f.isPlayer = false;
  if(opts.redFirst) g.fleets = [...g.fleets.filter(f => f.team === 'red'), ...g.fleets.filter(f => f.team === 'blue')];

  let edgeSum = 0, samples = 0, nextSample = 0;
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
      if(living.length){
        const atEdge = living.filter(f => Math.min(f.x, f.y, L.WORLD.w - f.x, L.WORLD.h - f.y) < EDGE_MARGIN).length;
        edgeSum += atEdge / living.length;
        samples++;
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
    metrics: {edgeRatio: samples ? edgeSum / samples : 0, flagAdvance: advance}
  };
}

// team から見た 1 試合の成績 (勝敗 + 残存戦力の差 + 途中のごほうび)
function matchScore(result, team){
  const other = team === 'blue' ? 'red' : 'blue';
  const bonus = SHIPS_BONUS * (result.ships[team] - result.ships[other]) / TOTAL_SHIPS
    + DAMAGE_BONUS * (TOTAL_SHIPS - result.ships[other]) / TOTAL_SHIPS
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

// 対戦表: 各個体 (subject) が games 試合ずつ。相手は確率 hallProb で殿堂入り (過去の強い脳)、それ以外は集団の自分以外。青・赤を交互に受け持つ
function schedule(popSize, games, hallSize, rng, hallProb){
  const list = [];
  for(let i = 0; i < popSize; i++){
    for(let k = 0; k < games; k++){
      let opponent;
      if(hallSize > 0 && rng() < hallProb) opponent = {kind: 'hall', index: Math.floor(rng() * hallSize)};
      else{
        let j = Math.floor(rng() * (popSize - 1));
        if(j >= i) j++;
        opponent = {kind: 'pop', index: j};
      }
      list.push({subject: i, opponent, side: k % 2 === 0 ? 'blue' : 'red', seed: Math.floor(rng() * 2147483647)});
    }
  }
  return list;
}

// 小さいマップから始める: 時間切れの割合を見て、次の広さへ進むか決める。curriculum: {stage, streak}
function advanceCurriculum(curriculum, timeoutRate){
  const streak = timeoutRate < STAGE_TIMEOUT_RATE ? curriculum.streak + 1 : 0;
  if(streak >= STAGE_STREAK && curriculum.stage < WORLD_STAGES.length - 1) return {stage: curriculum.stage + 1, streak: 0};
  return {stage: curriculum.stage, streak};
}

module.exports = {TIMEOUT_SCORE, EDGE_MARGIN, WORLD_STAGES, advanceCurriculum, mulberry32, gaussian, playMatch, matchScore, mutate, nextGeneration, schedule};
