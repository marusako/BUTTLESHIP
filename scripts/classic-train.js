// クラシックの AI の脳を神経進化で育てる (第 6 段階)。途中経過は training/classic/ に保存し、次に動かすと続きから再開する。
//   node scripts/classic-train.js --minutes 60            学習を 60 分 (その世代が終わるまで) 回す
//   node scripts/classic-train.js --minutes 60 --from training/classic/imitation.json   模倣学習の脳を出発点にして最初から (前の学習は training/classic/archive/ へ)
//   node scripts/classic-train.js --export-brain          training/classic/best.json を classic/learned-brain.js に書き出す
// 試合は大将戦 (原作の対戦のルール)。学習の相手は 旧型 AI 75%・殿堂入り 25%。担当 (青 / 赤) と処理順を入れ替える
// ほかのオプション: --workers 5 --pop 48 --games 6 --elite 6 --sigma 0.05 --rate 0.1 --tournament 3
//   --rule-prob 0.75 --hall-every 5 --hall-max 20 --eval-every 10 --eval-games 20 --dt 0.0333 --max-time 300 --seed 1
const fs = require('node:fs');
const path = require('node:path');
const B = require('../classic/brain.js');
const E = require('./classic-evolve.js');
const {createPool} = require('./pool.js');

const DIR = path.join(__dirname, '..', 'training', 'classic');
const WORKER = path.join(__dirname, 'classic-match-worker.js');
const DEFAULTS = {
  minutes: 60, workers: 5, pop: 48, games: 6, elite: 6, sigma: 0.05, rate: 0.1, tournament: 3,
  'rule-prob': 0.75, 'hall-every': 5, 'hall-max': 20, 'eval-every': 10, 'eval-games': 20,
  dt: 1 / 30, 'max-time': 300, seed: 1, from: ''
};

function parseArgs(argv){
  const o = Object.assign({}, DEFAULTS);
  for(let i = 0; i < argv.length; i++){
    const key = argv[i].replace(/^--/, '');
    if(!(key in DEFAULTS)) throw new Error(`知らないオプション: ${argv[i]}`);
    if(typeof DEFAULTS[key] === 'string') o[key] = argv[++i];
    else o[key] = Number(argv[++i]);
  }
  return o;
}

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// 前の学習の途中経過を training/classic/archive/<日時>/ へ移す (消さずに残す)
function archivePrevious(){
  if(!fs.existsSync(DIR)) return;
  const files = fs.readdirSync(DIR).filter(f => f !== 'archive' && f !== 'imitation.json');
  if(!files.length) return;
  const dest = path.join(DIR, 'archive', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dest, {recursive: true});
  for(const f of files) fs.renameSync(path.join(DIR, f), path.join(dest, f));
  console.log(`前の学習を ${path.relative(path.join(__dirname, '..'), dest)} へ移しました`);
}

function loadState(args){
  const file = path.join(DIR, 'state.json');
  if(args.from){
    const from = B.fromPlain(JSON.parse(fs.readFileSync(args.from, 'utf8')).brains);
    archivePrevious();
    const rng = E.mulberry32(args.seed);
    return {generation: 0, population: E.seedPopulation(from, args.pop, rng, {sigma: args.sigma, rate: args.rate}), hall: []};
  }
  if(!fs.existsSync(file)){
    const rng = E.mulberry32(args.seed);
    return {generation: 0, population: Array.from({length: args.pop}, () => B.randomBrainSet(rng)), hall: []};
  }
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {generation: s.generation, population: s.population.map(B.fromPlain), hall: s.hall.map(B.fromPlain)};
}

function saveState(state, best, info){
  fs.mkdirSync(DIR, {recursive: true});
  const tmp = path.join(DIR, 'state.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify({generation: state.generation, population: state.population.map(B.toPlain), hall: state.hall.map(B.toPlain)}));
  fs.renameSync(tmp, path.join(DIR, 'state.json')); // 書き込み中に止まっても前の保存が壊れないように
  const bestPlain = Object.assign({generation: state.generation}, info, {brains: B.toPlain(best)});
  fs.writeFileSync(path.join(DIR, 'best.json'), JSON.stringify(bestPlain));
  // 観戦画面 (classic/watch.html) が file:// でも読めるように JS でも書き出す
  fs.writeFileSync(path.join(DIR, 'best-brains.js'), `window.SAGITTARIUS_CLASSIC_TRAINING_BEST = ${JSON.stringify(bestPlain)};\n`);
}

// 学習型 AI の脳 (training/classic/best.json) を、ゲームが読む classic/learned-brain.js に書き出す
function exportLearnedBrain(){
  const best = JSON.parse(fs.readFileSync(path.join(DIR, 'best.json'), 'utf8'));
  fs.writeFileSync(path.join(__dirname, '..', 'classic', 'learned-brain.js'), E.learnedBrainSource(best));
  console.log(`クラシックの学習型 AI の脳を classic/learned-brain.js に書き出しました (第 ${best.generation} 世代)。差分を確認してコミットしてください`);
}

function saveProgress(record){
  fs.mkdirSync(DIR, {recursive: true});
  fs.writeFileSync(path.join(DIR, 'progress.json'), JSON.stringify(record));
}

function appendLog(row){
  fs.mkdirSync(DIR, {recursive: true});
  const file = path.join(DIR, 'log.csv');
  if(!fs.existsSync(file)) fs.writeFileSync(file, Object.keys(row).join(',') + '\n');
  fs.appendFileSync(file, Object.values(row).join(',') + '\n');
}

async function main(){
  const args = parseArgs(process.argv.slice(2));
  const state = loadState(args);
  const pool = createPool(args.workers, WORKER);
  const startedAt = Date.now();
  const deadline = startedAt + args.minutes * 60 * 1000;
  const progress = finished => saveProgress(E.progressRecord({startedAt, minutes: args.minutes, generation: state.generation, finished}));
  progress(false);
  console.log(`クラシックの学習開始: 第 ${state.generation} 世代から、${args.minutes} 分、ワーカー ${args.workers}、集団 ${args.pop}、1 個体 ${args.games} 試合`);

  let stop = false;
  process.on('SIGINT', () => { stop = true; console.log('\nこの世代が終わったら止めます (もう一度 Ctrl+C で即終了)'); process.once('SIGINT', () => process.exit(1)); });

  while(!stop && Date.now() < deadline){
    const started = Date.now();
    const rng = E.mulberry32(args.seed * 1000003 + state.generation * 7919 + 17);
    const sched = E.schedule(state.population.length, args.games, state.hall.length, rng, args['rule-prob']);
    const side = s => ({kind: 'brain', brains: B.toPlain(s)});
    const tasks = sched.map(m => {
      const me = side(state.population[m.subject]);
      const opp = m.opponent.kind === 'rule' ? {kind: 'rule'} : side(m.opponent.kind === 'hall' ? state.hall[m.opponent.index] : state.population[m.opponent.index]);
      return {blue: m.side === 'blue' ? me : opp, red: m.side === 'blue' ? opp : me, opts: {seed: m.seed, dt: args.dt, maxTime: args['max-time'], redFirst: m.redFirst}};
    });
    const results = await pool.run(tasks);

    const scores = state.population.map(() => []);
    sched.forEach((m, i) => scores[m.subject].push(E.matchScore(results[i], m.side)));
    const fitness = scores.map(mean);
    const bestIndex = fitness.indexOf(Math.max(...fitness));
    const best = state.population[bestIndex];

    const row = {
      generation: state.generation,
      best: fitness[bestIndex].toFixed(3),
      mean: mean(fitness).toFixed(3),
      timeoutRate: (results.filter(r => r.outcome === 'timeout').length / results.length).toFixed(3),
      medianTime: median(results.map(r => r.time)).toFixed(0),
      vsRuleWin: '',
      vsRuleTimeout: '',
      seconds: 0
    };

    // ものさし: 旧型 AI と戦わせて勝率を測る (学習の成績には入れない)
    if(state.generation % args['eval-every'] === 0){
      const evalRng = E.mulberry32(990001 + state.generation);
      const evalTasks = Array.from({length: args['eval-games']}, (_, k) => {
        const learnedBlue = k % 2 === 0;
        return {
          blue: learnedBlue ? side(best) : {kind: 'rule'}, red: learnedBlue ? {kind: 'rule'} : side(best),
          opts: {seed: Math.floor(evalRng() * 2147483647), dt: 1 / 60, maxTime: args['max-time'], redFirst: k % 4 >= 2}
        };
      });
      const ev = await pool.run(evalTasks);
      const won = ev.filter((r, k) => (k % 2 === 0) === (r.outcome === 'win') && r.outcome !== 'timeout' && r.outcome !== 'draw').length;
      row.vsRuleWin = (won / ev.length).toFixed(3);
      row.vsRuleTimeout = (ev.filter(r => r.outcome === 'timeout').length / ev.length).toFixed(3);
    }

    row.seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' '));
    appendLog(row);

    if(state.generation % args['hall-every'] === 0){
      state.hall.push(best);
      if(state.hall.length > args['hall-max']) state.hall.shift();
    }
    state.population = E.nextGeneration(state.population, fitness, rng, {elite: args.elite, sigma: args.sigma, rate: args.rate, tournament: args.tournament});
    state.generation++;
    saveState(state, best, {fitness: fitness[bestIndex], vsRuleWin: row.vsRuleWin});
    progress(false);
  }
  await pool.close();
  progress(true);
  exportLearnedBrain();
  console.log(`学習終了: 第 ${state.generation} 世代まで保存しました (training/classic/)`);
}

if(require.main === module){
  if(process.argv.includes('--export-brain')) exportLearnedBrain();
  else main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = {parseArgs};
