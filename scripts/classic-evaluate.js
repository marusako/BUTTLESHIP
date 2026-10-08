// クラシックの学習型 AI の強さを、旧型 AI (ものさし) と戦わせて測る (第 6 段階)。大将戦、1/60 秒刻み。
//   node scripts/classic-evaluate.js                          training/classic/best.json の脳 対 旧型 AI を 200 試合
//   node scripts/classic-evaluate.js --brains <file> --games 400 --workers 5 --seed 424242
//   (--brains に classic/learned-brain.js のような JS を渡してもよい)
// 試合は、学習型 AI の担当 (青 / 赤) と処理順 (青が先 / 赤が先) の 4 通りを同じ数ずつ回す
const fs = require('node:fs');
const path = require('node:path');
const E = require('./classic-evolve.js');
const {createPool} = require('./pool.js');

function parseArgs(argv){
  const o = {brains: path.join(__dirname, '..', 'training', 'classic', 'best.json'), games: 200, workers: 5, seed: 424242, 'max-time': 300};
  for(let i = 0; i < argv.length; i++){
    const key = argv[i].replace(/^--/, '');
    if(!(key in o)) throw new Error(`知らないオプション: ${argv[i]}`);
    o[key] = key === 'brains' ? argv[++i] : Number(argv[++i]);
  }
  return o;
}

// 脳のファイル (JSON か learned-brain.js) を読む
function loadBrains(file){
  if(file.endsWith('.js')) return require(path.resolve(file));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function summarize(results, subjects){
  const count = {win: 0, lose: 0, timeout: 0, draw: 0};
  results.forEach((r, k) => {
    if(r.outcome === 'timeout' || r.outcome === 'draw') count[r.outcome]++;
    else count[(r.outcome === 'win') === (subjects[k] === 'blue') ? 'win' : 'lose']++;
  });
  const times = results.map(r => r.time).sort((a, b) => a - b);
  return {count, winRate: count.win / results.length, medianTime: times[times.length >> 1], p95Time: times[Math.floor(times.length * 0.95)]};
}

async function main(){
  const args = parseArgs(process.argv.slice(2));
  const data = loadBrains(args.brains);
  const learned = {kind: 'brain', brains: data.brains};
  console.log(`脳: ${args.brains}${data.generation !== undefined ? ` (第 ${data.generation} 世代)` : ''}`);
  const rng = E.mulberry32(args.seed);
  const subjects = [], tasks = [];
  for(let k = 0; k < args.games; k++){
    const side = k % 2 === 0 ? 'blue' : 'red';
    subjects.push(side);
    tasks.push({
      blue: side === 'blue' ? learned : {kind: 'rule'}, red: side === 'blue' ? {kind: 'rule'} : learned,
      opts: {seed: Math.floor(rng() * 2147483647), dt: 1 / 60, maxTime: args['max-time'], redFirst: k % 4 >= 2}
    });
  }
  const pool = createPool(args.workers, path.join(__dirname, 'classic-match-worker.js'));
  const started = Date.now();
  const results = await pool.run(tasks);
  await pool.close();

  const pick = f => results.filter((_, k) => f(k));
  const pickS = f => subjects.filter((_, k) => f(k));
  const line = (label, f) => {
    const s = summarize(pick(f), pickS(f));
    console.log(`${label}: 勝ち ${s.count.win} / 負け ${s.count.lose} / 時間切れ ${s.count.timeout} / 引き分け ${s.count.draw}  勝率 ${(s.winRate * 100).toFixed(1)}%  試合時間 中央値 ${s.medianTime.toFixed(0)} 秒・95% ${s.p95Time.toFixed(0)} 秒`);
  };
  line('学習型 AI 全体', () => true);
  line('  青を担当', k => subjects[k] === 'blue');
  line('  赤を担当', k => subjects[k] === 'red');
  line('  青が先に処理', k => k % 4 < 2);
  line('  赤が先に処理', k => k % 4 >= 2);
  console.log(`(${args.games} 試合、${((Date.now() - started) / 1000).toFixed(0)} 秒)`);
}

if(require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = {parseArgs, summarize};
