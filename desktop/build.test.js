const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('./build.js');

test('exe の版: タグ vX.Y / vX.Y.Z を Electron のアプリの版 (X.Y.Z) にする', () => {
  assert.equal(D.appVersion('v3.0.8'), '3.0.8');
  assert.equal(D.appVersion('v3.1'), '3.1.0');
  assert.equal(D.appVersion(undefined), '0.0.0');
  assert.equal(D.appVersion('main'), '0.0.0');
});

test('exe のアプリの中身: ゲームのファイルを game/ に写し (クラシックのテストは除く)、main.js とアプリの package.json を置く', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-src-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-out-'));
  fs.writeFileSync(path.join(src, 'index.html'), '<title>t</title>');
  fs.writeFileSync(path.join(src, 'logic.js'), '// l');
  fs.writeFileSync(path.join(src, 'logic.test.js'), '// 配らない');
  fs.mkdirSync(path.join(src, 'classic'));
  fs.writeFileSync(path.join(src, 'classic', 'index.html'), '<title>c</title>');
  fs.writeFileSync(path.join(src, 'classic', 'logic.test.js'), '// 配らない');
  fs.writeFileSync(path.join(src, 'classic', 'watch.html'), '// 開発用');
  fs.writeFileSync(path.join(out, 'old.txt'), '前の組み立ての残り');

  D.buildApp(src, out, '3.0.8');

  assert.ok(fs.existsSync(path.join(out, 'game', 'index.html')));
  assert.ok(fs.existsSync(path.join(out, 'game', 'logic.js')));
  assert.ok(fs.existsSync(path.join(out, 'game', 'classic', 'index.html')));
  assert.ok(!fs.existsSync(path.join(out, 'game', 'logic.test.js')), 'GAME_FILES にないものは入れない');
  assert.ok(!fs.existsSync(path.join(out, 'game', 'classic', 'logic.test.js')), 'クラシックのテストは入れない');
  assert.ok(!fs.existsSync(path.join(out, 'game', 'classic', 'watch.html')), '開発用の観戦画面は入れない');
  assert.ok(!fs.existsSync(path.join(out, 'old.txt')), '前の組み立ては消してから作る');
  assert.equal(fs.readFileSync(path.join(out, 'main.js'), 'utf8'), fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
  assert.deepEqual([pkg.productName, pkg.version, pkg.main], ['BATTLESHIP', '3.0.8', 'main.js']);
});
