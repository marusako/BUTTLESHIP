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
  assert.deepEqual([d.keys.moveUp, d.keys.moveLeft, d.keys.moveDown, d.keys.moveRight], ['KeyO', 'KeyK', 'KeyL', 'Semicolon']);
  assert.equal(d.keys.shell, 'Digit1');
  assert.equal(d.keys.torpid, 'Digit2');
  assert.equal(d.keys.center, 'KeyC');
  assert.equal(d.keys.pause, 'Space');
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
    keys: {camUp: 'KeyD', camRight: 'KeyD', center: 123, unknownAction: 'KeyZ', pause: 'ArrowUp'},
    volume: {bgm: 150, sfx: -3.7},
    name: '  とても長い艦隊の名前をつけてみた  '
  };
  const s = S.normalize(raw);
  // 操作の順に割り当て (重なれば入れ替え) をくり返すので、同じキーはあとの操作が使い、前の操作は入れ替え先のキーになる
  assert.equal(s.keys.camRight, 'KeyD');
  assert.equal(s.keys.camUp, 'KeyW');
  assert.equal(new Set(Object.values(s.keys)).size, Object.keys(s.keys).length, '重ならない');
  assert.equal(s.keys.center, 'KeyC');
  assert.equal(s.keys.pause, 'Space', '予約されたキー (矢印) は使えない');
  assert.equal('unknownAction' in s.keys, false);
  assert.deepEqual(s.volume, {bgm: 100, sfx: 0});
  assert.equal(s.name, 'とても長い艦隊の名前をつ');
  assert.equal([...s.name].length, S.NAME_MAX);
});

test('保存: 保存して読み込むと同じ設定になる', () => {
  const st = memoryStorage();
  const s = S.assignKey(S.defaults(), 'pause', 'KeyP');
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

test('キーの割り当て: 矢印・Esc・Tab・Enter・修飾キーは割り当てられない', () => {
  for(const code of ['ArrowUp', 'ArrowLeft', 'Escape', 'Tab', 'Enter', 'ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft']){
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
});

test('操作の一覧: 設定画面に出す順番と名前', () => {
  const ids = S.ACTIONS.map(a => a.id);
  assert.deepEqual(ids, ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'shell', 'torpid', 'camUp', 'camDown', 'camLeft', 'camRight', 'center', 'pause']);
  assert.ok(S.ACTIONS.every(a => a.label));
});

test('自艦隊の名前: 空なら「味方第1艦隊」', () => {
  assert.equal(S.fleetName(S.defaults()), '味方第1艦隊');
  assert.equal(S.fleetName(Object.assign(S.defaults(), {name: 'ヤマト'})), 'ヤマト');
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
  assert.equal(s.keys.moveUp, 'KeyW', '重なった移動キーは入れ替わる');
  assert.equal(s.keys.shell, 'Digit1');
  assert.equal(new Set(Object.values(s.keys)).size, Object.keys(s.keys).length);
  assert.deepEqual(s.volume, {bgm: 40, sfx: 60});
});
