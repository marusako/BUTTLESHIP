// 試合を 1 つずつ受け取って回すワーカー (別のスレッドで動く)。scripts/pool.js から使う。
// 受け取る: {id, blue, red, opts}。blue / red は {kind: 'brain', brains: 脳の組 (JSON にできる形)} か {kind: 'rule'} (旧ルール AI)
const {parentPort} = require('node:worker_threads');
const B = require('../brain.js');
const R = require('../rule-ai.js');
const E = require('./evolve.js');

function controllerOf(side){
  if(side.kind === 'rule') return R.controller();
  return B.controller(B.fromPlain(side.brains));
}

parentPort.on('message', task => {
  const result = E.playMatch(controllerOf(task.blue), controllerOf(task.red), task.opts);
  parentPort.postMessage({id: task.id, result});
});
