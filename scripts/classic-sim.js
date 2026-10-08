// クラシックのバランス確認: AI どうしの試合を回して、試合時間と勝率を測る (青の第 1 艦隊も AI。開発用)
//   node scripts/classic-sim.js [試合数 (既定 200)] [mode: flagship (大将戦。既定) / annihilation (全滅戦)] [cheat (敵 = 赤がズルをする)]
// 青の第 1 艦隊の性能は AI と同じ 4 つの型からランダム。処理順 (青が先 / 赤が先) を半分ずつ入れ替える
const path = require('node:path');
const L = require(path.join(__dirname, '..', 'classic', 'logic.js'));
const {mulberry32} = require('./evolve.js');

function playClassic(seed, mode, redFirst, maxTime, enemyCheat){
  const rng = mulberry32(seed);
  const preset = L.AI_PRESETS[Math.floor(rng() * L.AI_PRESETS.length)];
  const g = L.createGame(Object.assign({}, preset.params), rng, mode, {enemyCheat: !!enemyCheat});
  for(const f of g.fleets) f.isPlayer = false;
  if(redFirst) g.fleets = [...g.fleets.filter(f => f.team === 'red'), ...g.fleets.filter(f => f.team === 'blue')];
  while(!g.outcome && g.time < maxTime) L.step(g, 1 / 30, rng);
  return {outcome: g.outcome || 'timeout', time: g.time};
}

function summarize(results){
  const count = {win: 0, lose: 0, draw: 0, timeout: 0};
  for(const r of results) count[r.outcome]++;
  const times = results.map(r => r.time).sort((a, b) => a - b);
  return {count, median: times[times.length >> 1], p95: times[Math.floor(times.length * 0.95)]};
}

if(require.main === module){
  const games = Number(process.argv[2] || 200);
  const mode = process.argv[3] || 'flagship';
  const cheat = process.argv[4] === 'cheat';
  const rng = mulberry32(20261008);
  const all = [], byOrder = {blueFirst: [], redFirst: []};
  for(let k = 0; k < games; k++){
    const redFirst = k % 2 === 1;
    const r = playClassic(Math.floor(rng() * 2147483647), mode, redFirst, 900, cheat);
    all.push(r);
    byOrder[redFirst ? 'redFirst' : 'blueFirst'].push(r);
  }
  const line = (label, rs) => {
    const s = summarize(rs);
    console.log(`${label}: 青の勝ち ${s.count.win} / 赤の勝ち ${s.count.lose} / 引き分け ${s.count.draw} / 時間切れ ${s.count.timeout}  試合時間 中央値 ${s.median.toFixed(0)} 秒・95% ${s.p95.toFixed(0)} 秒`);
  };
  console.log(`クラシック ${mode === 'annihilation' ? '全滅戦' : '大将戦'} ${games} 試合${cheat ? ' (赤がズルをする)' : ''}`);
  line('全体', all);
  line('  青が先に処理', byOrder.blueFirst);
  line('  赤が先に処理', byOrder.redFirst);
}

module.exports = {playClassic, summarize};
