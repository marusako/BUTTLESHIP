// クラシックの試合を 1 つずつ受け取って回すワーカー (別のスレッドで動く)。scripts/pool.js から使う (第 6 段階)。
// 受け取る: {id, blue, red, opts}。blue / red は {kind: 'brain', brains: 脳の組 (JSON にできる形)} か {kind: 'rule'} (旧型 AI)
const {parentPort} = require('node:worker_threads');
const B = require('../classic/brain.js');
const E = require('./classic-evolve.js');

const controllerOf = side => (side.kind === 'rule' ? null : B.controller(B.fromPlain(side.brains)));

parentPort.on('message', task => {
  const result = E.playClassicMatch(controllerOf(task.blue), controllerOf(task.red), task.opts);
  parentPort.postMessage({id: task.id, result});
});
