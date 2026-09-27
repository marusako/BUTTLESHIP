const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('./package.js');

// zip の中央ディレクトリからファイル名の一覧を読む
function zipEntries(file){
  const buf = fs.readFileSync(file);
  const names = [];
  for(let i = 0; i + 46 <= buf.length; i++){
    if(buf.readUInt32LE(i) !== 0x02014b50) continue;
    const len = buf.readUInt16LE(i + 28);
    names.push(buf.toString('utf8', i + 46, i + 46 + len));
    i += 45 + len;
  }
  return names;
}

test('配布ファイル名: タグ名を含む zip 名になる', () => {
  assert.equal(P.zipName('v1.1'), 'the-day-of-sagittarius-v1.1.zip');
});

test('タグ名: vX.Y / vX.Y.Z の形だけ受け付ける', () => {
  assert.equal(P.isVersionTag('v1.0'), true);
  assert.equal(P.isVersionTag('v1.2.3'), true);
  assert.equal(P.isVersionTag('1.0'), false);
  assert.equal(P.isVersionTag('v1'), false);
  assert.equal(P.isVersionTag('v1.0; rm'), false);
});

test('zip の中身: ゲームに必要なファイルだけが、バージョン名のフォルダに入る', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagittarius-'));
  const file = P.buildZip('v1.0', dir);
  assert.equal(path.basename(file), 'the-day-of-sagittarius-v1.0.zip');
  const names = zipEntries(file).filter(n => !n.endsWith('/')).sort();
  assert.deepEqual(names, ['the-day-of-sagittarius-v1.0/index.html', 'the-day-of-sagittarius-v1.0/logic.js']);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('zip に入れるファイル: ゲームに必要なものだけを、その版にあるぶんだけ選ぶ', () => {
  assert.deepEqual(P.pickGameFiles(['README.md', 'logic.js', 'index.html', 'DESIGN.md']), ['index.html', 'logic.js']);
  assert.deepEqual(P.pickGameFiles(['classic', 'settings.js', 'logic.js', 'index.html', 'logic.test.js', 'scripts']),
    ['index.html', 'logic.js', 'settings.js', 'classic']);
  assert.deepEqual(P.pickGameFiles(['sound.js', 'music.js', 'music.test.js', 'settings.js', 'logic.js', 'index.html', 'classic']),
    ['index.html', 'logic.js', 'settings.js', 'music.js', 'sound.js', 'classic']);
  assert.deepEqual(P.pickGameFiles(['rule-ai.js', 'rule-ai.test.js', 'logic.js', 'index.html']), ['index.html', 'logic.js', 'rule-ai.js']);
});

test('存在しないタグはエラーになる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagittarius-'));
  assert.throws(() => P.buildZip('v99.0', dir));
  fs.rmSync(dir, {recursive: true, force: true});
});
