const test = require('node:test');
const assert = require('node:assert/strict');
const Snd = require('./sound.js'); // Node では Web Audio がないので、計算の関数だけを確かめる

test('音量: 設定の 0〜100 を音の大きさ 0〜1 に (耳の感じ方に合わせて 2 乗のカーブ)', () => {
  assert.equal(Snd.volumeToGain(0), 0);
  assert.equal(Snd.volumeToGain(100), 1);
  assert.equal(Snd.volumeToGain(50), 0.25);
  assert.equal(Snd.volumeToGain(150), 1);
  assert.equal(Snd.volumeToGain(-5), 0);
});

test('左右の振り分け: 画面の左端 -0.8 〜 中央 0 〜 右端 0.8 (画面の外は端と同じ)', () => {
  assert.equal(Snd.panFromScreen(500, 1000), 0);
  assert.equal(Snd.panFromScreen(0, 1000), -0.8);
  assert.equal(Snd.panFromScreen(1000, 1000), 0.8);
  assert.equal(Snd.panFromScreen(-300, 1000), -0.8);
  assert.equal(Snd.panFromScreen(2000, 1000), 0.8);
  assert.equal(Snd.panFromScreen(250, 1000), -0.4);
});

test('発砲音の間隔の制限: 同じ種類の音は、決めた間隔が空くまで鳴らさない (種類ごとに別々)', () => {
  const allow = Snd.createThrottle(0.06);
  assert.equal(allow('blue', 1.00), true);
  assert.equal(allow('blue', 1.03), false);
  assert.equal(allow('red', 1.03), true, '別の種類は関係ない');
  assert.equal(allow('blue', 1.06), true);
  assert.equal(allow('blue', 1.07), false);
});

test('Node では音を鳴らす関数を呼んでも何も起きない (エラーにならない)', () => {
  assert.doesNotThrow(() => {
    Snd.unlock();
    Snd.setVolumes({bgm: 50, sfx: 50});
    Snd.fire('shell', 'blue', 0);
    Snd.fire('torpedo', 'red', 0.5);
    Snd.hit('torpedo', 0);
    Snd.intercept(0);
    Snd.destroyed(0);
    Snd.ping(false);
    Snd.jingle('win');
    Snd.playBgm('battle');
    Snd.setBgmDuck(true);
    Snd.stopBgm();
  });
});
