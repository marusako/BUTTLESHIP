// exe 化 (Electron) のアプリの中身を desktop/build/app/ に組み立てる (外部パッケージなし)。
//   node desktop/build.js [タグ (例 v3.0.8)]
// ゲームのファイル (scripts/package.js の GAME_FILES。テストと開発用の観戦画面は除く) を game/ に写し、main.js とアプリの package.json を置く。
// exe にするのは GitHub Actions (.github/workflows/release.yml) で、@electron/packager を使う
const fs = require('node:fs');
const path = require('node:path');
const {GAME_FILES, isDevOnly} = require('../scripts/package.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'build', 'app');

// タグ (vX.Y / vX.Y.Z) を Electron のアプリの版 (X.Y.Z) にする。タグでなければ 0.0.0
function appVersion(tag){
  const m = /^v(\d+)\.(\d+)(?:\.(\d+))?$/.exec(tag || '');
  return m ? `${m[1]}.${m[2]}.${m[3] || 0}` : '0.0.0';
}

// srcRoot のゲームのファイルから、outDir にアプリの中身を作る (outDir は作り直す)
function buildApp(srcRoot, outDir, version){
  fs.rmSync(outDir, {recursive: true, force: true});
  const game = path.join(outDir, 'game');
  fs.mkdirSync(game, {recursive: true});
  for(const name of GAME_FILES){
    const from = path.join(srcRoot, name);
    if(!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(game, name), {recursive: true, filter: src => !isDevOnly(path.relative(srcRoot, src))});
  }
  fs.copyFileSync(path.join(__dirname, 'main.js'), path.join(outDir, 'main.js'));
  const pkg = {name: 'battleship', productName: 'BATTLESHIP', version, private: true, main: 'main.js'};
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  return outDir;
}

if(require.main === module){
  const tag = process.argv[2];
  buildApp(ROOT, OUT, appVersion(tag));
  console.log(`${path.relative(ROOT, OUT)} を作りました (版 ${appVersion(tag)})`);
}

module.exports = {appVersion, buildApp};
