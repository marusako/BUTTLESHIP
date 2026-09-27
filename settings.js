// 設定 (キー配置・音量・自艦隊の名前) の初期値・検証・保存。描画や DOM に依存しない。
// ブラウザでは window.SagittariusSettings、Node では require('./settings.js') で使う。
(function(root){
  'use strict';

  const STORAGE_KEY = 'sagittarius.settings';
  const SETTINGS_VERSION = 2; // 保存データの版 (版がない = 第 2.10 段階より前)
  // 第 2.10 段階より前の初期のキー。前の版の保存データで、これと同じキーのままの操作は新しい初期のキーにする
  // (前は何かを変えると全部のキーが保存されたので、自分で選んだキーと区別するため)
  const LEGACY_DEFAULT_KEYS = {moveUp: 'KeyO', moveDown: 'KeyL', moveLeft: 'KeyK', moveRight: 'Semicolon', fire: 'Digit1', special: 'Digit2', center: 'KeyC'};
  const NAME_MAX = 12;
  const DEFAULT_NAME = '味方戦艦';

  // キーを変えられる操作 (設定画面に出す順)。一時停止は Esc で固定なので、ここには入れない
  const ACTIONS = [
    {id: 'moveUp', label: '移動 上', key: 'ArrowUp'},
    {id: 'moveDown', label: '移動 下', key: 'ArrowDown'},
    {id: 'moveLeft', label: '移動 左', key: 'ArrowLeft'},
    {id: 'moveRight', label: '移動 右', key: 'ArrowRight'},
    {id: 'fire', label: 'FIRE (通常射撃) オン / オフ', key: 'KeyZ'},
    {id: 'autoSpecial', label: 'AUTO (特殊攻撃の自動使用) オン / オフ', key: 'KeyX'},
    {id: 'special', label: 'SPECIAL (特殊攻撃を今使う)', key: 'Space'},
    {id: 'camUp', label: '視点 上', key: 'KeyW'},
    {id: 'camDown', label: '視点 下', key: 'KeyS'},
    {id: 'camLeft', label: '視点 左', key: 'KeyA'},
    {id: 'camRight', label: '視点 右', key: 'KeyD'},
    {id: 'center', label: '自艦へ視点移動', key: 'KeyQ'},
    {id: 'centerFlagship', label: '味方旗艦へ視点移動', key: 'KeyE'}
  ];

  // クレジット (原作 → 製作 → 開発支援)
  const CREDITS = [
    {role: '原作', name: '谷川流『涼宮ハルヒの暴走』「射手座の日」'},
    {role: '製作', name: 'marusako'},
    {role: '開発支援', name: 'Claude (Anthropic)'}
  ];

  // 割り当てられないキー: Esc は一時停止 (と設定画面の取り消し) で固定して使うため。Tab・Enter・修飾キーは誤操作を防ぐため
  function isReservedKey(code){
    return /^(Escape|Tab|Enter|NumpadEnter)$/.test(code) || /^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(code);
  }

  function defaults(){
    const keys = {};
    for(const a of ACTIONS) keys[a.id] = a.key;
    return {keys, volume: {bgm: 70, sfx: 80}, name: ''};
  }

  // action のキーを code にした新しい設定を返す。ほかの操作が code を使っていれば、その操作と入れ替える
  function assignKey(settings, action, code){
    const next = {keys: Object.assign({}, settings.keys), volume: Object.assign({}, settings.volume), name: settings.name};
    if(!(action in next.keys) || typeof code !== 'string' || isReservedKey(code)) return next;
    const other = Object.keys(next.keys).find(id => id !== action && next.keys[id] === code);
    if(other) next.keys[other] = next.keys[action];
    next.keys[action] = code;
    return next;
  }

  // 音量の画面の表示は 10 段階 (0〜10)。保存する値は 0〜100 のまま (前の版の保存データと合わせるため)
  const volumeStep = v => Math.round(Math.min(100, Math.max(0, v)) / 10);
  const volumeFromStep = n => Math.round(Math.min(10, Math.max(0, n))) * 10;

  const clampVolume = (v, fallback) => (typeof v === 'number' && isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : fallback);

  // 読み込んだデータを、使える設定に直す (足りない・おかしな値は初期値)
  function normalize(raw){
    let s = defaults();
    const r = raw && typeof raw === 'object' ? raw : {};
    const keys = r.keys && typeof r.keys === 'object' ? r.keys : {};
    for(const a of ACTIONS) if(typeof keys[a.id] === 'string') s = assignKey(s, a.id, keys[a.id]);
    const vol = r.volume && typeof r.volume === 'object' ? r.volume : {};
    s.volume = {bgm: clampVolume(vol.bgm, s.volume.bgm), sfx: clampVolume(vol.sfx, s.volume.sfx)};
    s.name = typeof r.name === 'string' ? [...r.name.trim()].slice(0, NAME_MAX).join('') : '';
    return s;
  }

  // storage: localStorage と同じ getItem / setItem を持つもの。使えなければ初期設定
  // 前の版の保存データを今の版に移し替える: 前の初期のキーのままの操作は外す (normalize で新しい初期のキーになる)
  function migrate(raw){
    if(!raw || typeof raw !== 'object' || raw.version === SETTINGS_VERSION || !raw.keys || typeof raw.keys !== 'object') return raw;
    const keys = {};
    for(const [id, code] of Object.entries(raw.keys)) if(LEGACY_DEFAULT_KEYS[id] !== code) keys[id] = code;
    return Object.assign({}, raw, {keys});
  }

  function load(storage){
    try{
      const text = storage && storage.getItem(STORAGE_KEY);
      return text ? normalize(migrate(JSON.parse(text))) : defaults();
    }catch(e){
      return defaults();
    }
  }

  function save(storage, settings){
    try{
      if(storage) storage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(normalize(settings), {version: SETTINGS_VERSION})));
    }catch(e){
      // 保存できない環境 (プライベートウィンドウなど) では、その回だけの設定になる
    }
  }

  const SYMBOL_LABELS = {ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`'};

  function keyLabel(code){
    let m;
    if((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if((m = /^Digit(\d)$/.exec(code))) return m[1];
    if((m = /^Numpad(\d)$/.exec(code))) return 'テンキー' + m[1];
    if(code in SYMBOL_LABELS) return SYMBOL_LABELS[code];
    return code;
  }

  // 自艦隊の名前。空なら「味方」+ 艦種の名前 (className。省略時は戦艦)
  function fleetName(settings, className){
    return settings.name || (className ? `味方${className}` : DEFAULT_NAME);
  }

  const api = {STORAGE_KEY, SETTINGS_VERSION, NAME_MAX, DEFAULT_NAME, ACTIONS, CREDITS, isReservedKey, defaults, assignKey, normalize, load, save, keyLabel, fleetName, volumeStep, volumeFromStep};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusSettings = api;
})(typeof window !== 'undefined' ? window : globalThis);
