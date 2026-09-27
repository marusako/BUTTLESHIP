// バージョン別の配布用 zip を作る (依存なし。git archive を使う)。
//   npm run package -- v1.1        … 指定したタグの zip を dist/ に作る
//   npm run package                … vX.Y / vX.Y.Z の全タグの zip を作る
// zip にはゲームに必要なファイルだけを入れる。解凍して index.html を開けば遊べる (クラシックは classic/index.html)。
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// ゲームに必要なファイル (古い版にないものは、その版の zip には入らない)
const GAME_FILES = ['index.html', 'logic.js', 'rule-ai.js', 'brain.js', 'learned-brain.js', 'settings.js', 'music.js', 'sound.js', 'classic'];
const EXCLUDE = [':(exclude)classic/*.test.js']; // クラシックのテストは遊ぶのに要らない
const NAME = 'the-day-of-sagittarius';

const zipName = tag => `${NAME}-${tag}.zip`;
const isVersionTag = tag => /^v\d+\.\d+(\.\d+)?$/.test(tag);
// その版の一番上にあるファイル名の一覧から、zip に入れるものを GAME_FILES の順に選ぶ
const pickGameFiles = names => GAME_FILES.filter(f => names.includes(f));

function git(args){
  return execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

function versionTags(){
  return git(['tag', '--list', 'v*']).split(/\r?\n/).filter(isVersionTag);
}

// tag の時点のゲームファイルを outDir に zip で書き出し、そのパスを返す
function buildZip(tag, outDir){
  if(!isVersionTag(tag)) throw new Error(`バージョンのタグ名ではありません: ${tag}`);
  fs.mkdirSync(outDir, {recursive: true});
  const out = path.join(outDir, zipName(tag));
  const names = git(['ls-tree', '--name-only', tag]).split(/\r?\n/);
  git(['archive', '--format=zip', `--prefix=${NAME}-${tag}/`, '-o', out, tag, '--', ...pickGameFiles(names), ...EXCLUDE]);
  return out;
}

if(require.main === module){
  const tags = process.argv.slice(2);
  const targets = tags.length ? tags : versionTags();
  if(!targets.length){
    console.error('vX.Y の形のタグがありません');
    process.exit(1);
  }
  for(const tag of targets){
    const file = buildZip(tag, path.join(ROOT, 'dist'));
    console.log(`${path.relative(ROOT, file)} (${fs.statSync(file).size} bytes)`);
  }
}

module.exports = {zipName, isVersionTag, pickGameFiles, buildZip, versionTags};
