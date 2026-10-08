// 試合を複数のワーカー (CPU のコア) に振り分けて並べて回す
const path = require('node:path');
const {Worker} = require('node:worker_threads');

// workerFile: 試合を回すワーカー (省略時はモダンの match-worker.js。クラシックは classic-match-worker.js)
function createPool(size, workerFile){
  const workers = Array.from({length: size}, () => new Worker(workerFile || path.join(__dirname, 'match-worker.js')));
  return {
    // tasks: [{blue, red, opts}] → 同じ順の結果の配列
    run(tasks){
      return new Promise((resolve, reject) => {
        const results = new Array(tasks.length);
        let next = 0, done = 0;
        if(!tasks.length) return resolve(results);
        const feed = w => {
          if(next < tasks.length){
            const id = next++;
            w.postMessage(Object.assign({id}, tasks[id]));
          }
        };
        for(const w of workers){
          w.removeAllListeners('message');
          w.removeAllListeners('error');
          w.on('message', msg => {
            results[msg.id] = msg.result;
            if(++done === tasks.length) resolve(results);
            else feed(w);
          });
          w.on('error', reject);
          feed(w);
        }
      });
    },
    close(){ return Promise.all(workers.map(w => w.terminate())); }
  };
}

module.exports = {createPool};
