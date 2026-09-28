const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./settings.js');

// テスト用の保存先 (localStorage の代わり)
function memoryStorage(initial){
  const data = Object.assign({}, initial);
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data
  };
}

test('初期設定: 操作ごとのキー、音量、名前 (空)', () => {
  const d = S.defaults();
  assert.equal(d.keys.camUp, 'KeyW');
  assert.equal(d.keys.camDown, 'KeyS');
  assert.equal(d.keys.camLeft, 'KeyA');
  assert.equal(d.keys.camRight, 'KeyD');
  assert.deepEqual([d.keys.moveUp, d.keys.moveLeft, d.keys.moveDown, d.keys.moveRight], ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'], '移動は矢印キー (第 3.3 段階)');
  assert.equal(d.keys.fire, 'KeyZ');
  assert.equal(d.keys.autoSpecial, 'KeyX', '特殊攻撃の自動使用 オン / オフ');
  assert.equal(d.keys.special, 'Space', '特殊攻撃を今使う');
  assert.equal(d.keys.center, 'KeyC', '自艦へ視点移動 (第 4.1 段階で Q → C)');
  assert.deepEqual([d.keys.zoomOut, d.keys.zoomIn], ['KeyQ', 'KeyE'], '縮小・拡大 (第 4.1 段階)');
  assert.equal('centerFlagship' in d.keys, false, '味方旗艦へ視点移動はない (第 4.1 段階)');
  assert.equal('pause' in d.keys, false, '一時停止は Esc で固定 (設定の一覧に出さない)');
  assert.deepEqual(d.volume, {bgm: 70, sfx: 80});
  assert.equal(d.name, '');
  assert.equal(new Set(Object.values(d.keys)).size, Object.keys(d.keys).length, 'キーは重ならない');
});

test('初期設定: 呼ぶたびに別のオブジェクト (書き換えても初期値が変わらない)', () => {
  const a = S.defaults();
  a.keys.camUp = 'KeyZ';
  assert.equal(S.defaults().keys.camUp, 'KeyW');
});

test('読み込み: 保存がなければ初期設定', () => {
  assert.deepEqual(S.load(memoryStorage()), S.defaults());
});

test('読み込み: 保存した設定を読み、足りない項目は初期値で補う', () => {
  const st = memoryStorage({[S.STORAGE_KEY]: JSON.stringify({keys: {camUp: 'KeyI'}, volume: {bgm: 20}, name: 'ヤマト'})});
  const s = S.load(st);
  assert.equal(s.keys.camUp, 'KeyI');
  assert.equal(s.keys.camDown, 'KeyS');
  assert.deepEqual(s.volume, {bgm: 20, sfx: 80});
  assert.equal(s.name, 'ヤマト');
});

test('読み込み: 壊れたデータや保存先の例外でも初期設定で遊べる', () => {
  assert.deepEqual(S.load(memoryStorage({[S.STORAGE_KEY]: '{壊れた'})), S.defaults());
  const throwing = {getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); }};
  assert.deepEqual(S.load(throwing), S.defaults());
  assert.doesNotThrow(() => S.save(throwing, S.defaults()));
  assert.deepEqual(S.load(null), S.defaults());
});

test('読み込み: おかしな値は直す (音量は 0〜100 の整数、名前は 12 文字まで、知らない・重なったキーは初期値)', () => {
  const raw = {
    keys: {camUp: 'KeyD', camRight: 'KeyD', center: 123, unknownAction: 'KeyZ', fire: 'Escape'},
    volume: {bgm: 150, sfx: -3.7},
    name: '  とても長い艦隊の名前をつけてみた  '
  };
  const s = S.normalize(raw);
  // 操作の順に割り当て (重なれば入れ替え) をくり返すので、同じキーはあとの操作が使い、前の操作は入れ替え先のキーになる
  assert.equal(s.keys.camRight, 'KeyD');
  assert.equal(s.keys.camUp, 'KeyW');
  assert.equal(new Set(Object.values(s.keys)).size, Object.keys(s.keys).length, '重ならない');
  assert.equal(s.keys.center, 'KeyC', 'おかしな値は初期値');
  assert.equal(s.keys.fire, 'KeyZ', '予約されたキー (Esc) は使えない');
  assert.equal('unknownAction' in s.keys, false);
  assert.deepEqual(s.volume, {bgm: 100, sfx: 0});
  assert.equal(s.name, 'とても長い艦隊の名前をつ');
  assert.equal([...s.name].length, S.NAME_MAX);
});

test('保存: 保存して読み込むと同じ設定になる', () => {
  const st = memoryStorage();
  const s = S.assignKey(S.defaults(), 'center', 'KeyP');
  s.volume.bgm = 35;
  s.name = 'ヤマト';
  S.save(st, s);
  assert.deepEqual(S.load(st), s);
});

test('キーの割り当て: 別の操作と同じキーなら入れ替える', () => {
  const s = S.assignKey(S.defaults(), 'camUp', 'KeyS');
  assert.equal(s.keys.camUp, 'KeyS');
  assert.equal(s.keys.camDown, 'KeyW');
  assert.equal(S.defaults().keys.camUp, 'KeyW', '元の設定は変えない');
});

test('キーの割り当て: Esc (一時停止で固定)・Tab・Enter・修飾キーは割り当てられない。矢印キーは割り当てられる', () => {
  assert.equal(S.assignKey(S.defaults(), 'camUp', 'ArrowUp').keys.camUp, 'ArrowUp');
  assert.equal(S.assignKey(S.defaults(), 'camUp', 'ArrowUp').keys.moveUp, 'KeyW', '入れ替わる');
  assert.equal(S.isReservedKey('ArrowUp'), false);
  for(const code of ['Escape', 'Tab', 'Enter', 'ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft']){
    assert.equal(S.assignKey(S.defaults(), 'camUp', code).keys.camUp, 'KeyW', code);
    assert.equal(S.isReservedKey(code), true, code);
  }
  assert.equal(S.isReservedKey('KeyP'), false);
});

test('キーの表示名: 画面に出す短い名前', () => {
  assert.equal(S.keyLabel('KeyW'), 'W');
  assert.equal(S.keyLabel('Digit3'), '3');
  assert.equal(S.keyLabel('Numpad3'), 'テンキー3');
  assert.equal(S.keyLabel('Space'), 'Space');
  assert.equal(S.keyLabel('Semicolon'), ';');
  assert.equal(S.keyLabel('Enter'), 'Enter');
  assert.deepEqual(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(S.keyLabel), ['↑', '↓', '←', '→']);
});

test('操作の一覧: 設定画面に出す順番と名前', () => {
  const ids = S.ACTIONS.map(a => a.id);
  assert.deepEqual(ids, ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'fire', 'autoSpecial', 'special', 'camUp', 'camDown', 'camLeft', 'camRight', 'center', 'zoomOut', 'zoomIn']);
  assert.ok(S.ACTIONS.every(a => a.label));
});

test('自艦隊の名前: 空なら「味方」+ 選んだ艦種の名前 (省略時は戦艦)', () => {
  assert.equal(S.DEFAULT_NAME, '味方戦艦');
  assert.equal(S.fleetName(S.defaults()), '味方戦艦');
  assert.equal(S.fleetName(S.defaults(), '駆逐艦Ⅰ型'), '味方駆逐艦Ⅰ型');
  assert.equal(S.fleetName(Object.assign(S.defaults(), {name: 'ヤマト'}), '駆逐艦Ⅰ型'), 'ヤマト');
});

test('クレジット: 原作 → 製作者 → 開発支援 の順', () => {
  assert.deepEqual(S.CREDITS.map(c => c.role), ['原作', '製作', '開発支援']);
  assert.equal(S.CREDITS[1].name, 'marusako');
});

test('読み込み: 前の版の保存データ (回転・SPEED のキーがある) も読める。なくなった操作は捨て、キーが重なれば入れ替える', () => {
  const old = {keys: {camUp: 'KeyO', rotLeft: 'KeyQ', north: 'KeyR', speed1: 'Digit1', speed4: 'Digit4'}, volume: {bgm: 40, sfx: 60}, name: 'ヤマト'};
  const s = S.load(memoryStorage({[S.STORAGE_KEY]: JSON.stringify(old)}));
  assert.deepEqual(Object.keys(s.keys).sort(), S.ACTIONS.map(a => a.id).sort());
  assert.equal(s.keys.camUp, 'KeyO');
  assert.equal(s.keys.fire, 'KeyZ');
  assert.equal(new Set(Object.values(s.keys)).size, Object.keys(s.keys).length);
  assert.deepEqual(s.volume, {bgm: 40, sfx: 60});
});

test('読み込み: 第 3.3 段階より前の保存データは、前の初期のキーのままの操作を新しい初期のキーにする (自分で変えたキーは残す)。一時停止は捨てる', () => {
  const old = {keys: {moveUp: 'KeyO', moveDown: 'KeyL', moveLeft: 'KeyK', moveRight: 'Semicolon', fire: 'Digit1', special: 'Digit2', center: 'KeyC', pause: 'Space', camUp: 'KeyI'}, volume: {bgm: 0, sfx: 80}, name: ''};
  const s = S.load(memoryStorage({[S.STORAGE_KEY]: JSON.stringify(old)}));
  assert.deepEqual(s.keys, Object.assign(S.defaults().keys, {camUp: 'KeyI'}));
  assert.deepEqual(s.volume, {bgm: 0, sfx: 80}, '音量はそのまま');
  const custom = S.load(memoryStorage({[S.STORAGE_KEY]: JSON.stringify({keys: {fire: 'KeyF', center: 'KeyC'}})}));
  assert.deepEqual([custom.keys.fire, custom.keys.center], ['KeyF', 'KeyC']);
});

test('保存: 設定の版 (SETTINGS_VERSION) を一緒に保存し、今の版のデータは移し替えずにそのまま読む', () => {
  const st = memoryStorage();
  const s = S.assignKey(S.defaults(), 'center', 'KeyQ'); // 前の版の初期のキーと同じでも、今の版で選んだものは残す
  S.save(st, s);
  assert.equal(S.SETTINGS_VERSION, 3);
  assert.equal(JSON.parse(st.data[S.STORAGE_KEY]).version, S.SETTINGS_VERSION);
  assert.equal(S.load(st).keys.center, 'KeyQ');
});

test('音量の表示: 保存する値 (0〜100) と画面の 10 段階 (0〜10) の変換。10 刻みでない値は近い段階に丸める', () => {
  assert.deepEqual([0, 70, 100, 35, 44, 5].map(S.volumeStep), [0, 7, 10, 4, 4, 1]);
  assert.deepEqual([0, 7, 10].map(S.volumeFromStep), [0, 70, 100]);
  assert.deepEqual([-1, 11, 3.6].map(S.volumeFromStep), [0, 100, 40], '範囲外・小数は直す');
});

test('読み込み: 第 2.5 段階の保存データ (SHELL / TORPID のキー) も読める。FIRE は初期のキーになる', () => {
  const old = {keys: {shell: 'KeyF', torpid: 'KeyG', camUp: 'KeyI'}, volume: {bgm: 50, sfx: 50}, name: ''};
  const s = S.load(memoryStorage({[S.STORAGE_KEY]: JSON.stringify(old)}));
  assert.deepEqual(Object.keys(s.keys).sort(), S.ACTIONS.map(a => a.id).sort());
  assert.equal('shell' in s.keys || 'torpid' in s.keys, false);
  assert.equal(s.keys.fire, 'KeyZ');
  assert.equal(s.keys.camUp, 'KeyI');
});

test('対戦する AI (第 3.5 段階): 味方と敵を 旧型 AI (rule) / 学習型 AI (learned) から選ぶ。初めは両方 旧型 AI。おかしな値は旧型 AI', () => {
  assert.deepEqual(S.AI_KINDS.map(a => [a.id, a.label]), [['rule', '旧型 AI'], ['learned', '学習型 AI']]);
  assert.deepEqual(S.defaults().ai, {ally: 'rule', enemy: 'rule'});
  assert.deepEqual(S.normalize({ai: {ally: 'learned', enemy: 'random'}}).ai, {ally: 'learned', enemy: 'rule'});
  assert.deepEqual(S.normalize({}).ai, {ally: 'rule', enemy: 'rule'});
  const st = memoryStorage();
  const s = Object.assign(S.defaults(), {ai: {ally: 'rule', enemy: 'learned'}});
  S.save(st, s);
  assert.deepEqual(S.load(st).ai, {ally: 'rule', enemy: 'learned'});
  assert.deepEqual(S.assignKey(s, 'camUp', 'KeyI').ai, s.ai, 'キーを変えても AI の選択は残る');
});

test('地図 (第 4.1 段階): 固定 (fixed) / ランダム (random) から選ぶ。初めは固定。おかしな値は固定。保存して読み込める。キーを変えても残る', () => {
  assert.deepEqual(S.MAP_KINDS.map(m => [m.id, m.label]), [['fixed', '固定'], ['random', 'ランダム']]);
  assert.equal(S.defaults().map, 'fixed');
  assert.equal(S.normalize({map: 'random'}).map, 'random');
  assert.equal(S.normalize({map: 'island'}).map, 'fixed');
  assert.equal(S.normalize({}).map, 'fixed');
  const st = memoryStorage();
  const s = Object.assign(S.defaults(), {map: 'random'});
  S.save(st, s);
  assert.equal(S.load(st).map, 'random');
  assert.equal(S.assignKey(s, 'camUp', 'KeyI').map, 'random');
});

test('読み込み: 版 2 (第 3.3〜4.0 段階) の保存データは、初期のキーのままの自艦へ視点移動 (Q) を新しい初期のキー (C) にし、味方旗艦へ視点移動は捨てる。自分で変えたキーは残す', () => {
  const v2 = {version: 2, keys: {center: 'KeyQ', centerFlagship: 'KeyE', fire: 'KeyF'}, volume: {bgm: 50, sfx: 50}, name: ''};
  const s = S.load(memoryStorage({[S.STORAGE_KEY]: JSON.stringify(v2)}));
  assert.deepEqual([s.keys.center, s.keys.zoomOut, s.keys.zoomIn, s.keys.fire], ['KeyC', 'KeyQ', 'KeyE', 'KeyF']);
  assert.equal('centerFlagship' in s.keys, false);
  const custom = S.load(memoryStorage({[S.STORAGE_KEY]: JSON.stringify({version: 2, keys: {center: 'KeyP'}})}));
  assert.equal(custom.keys.center, 'KeyP');
});
