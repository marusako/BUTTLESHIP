// 設定 (キー配置・音量・自艦隊の名前) の初期値・検証・保存。描画や DOM に依存しない。
// ブラウザでは window.SagittariusSettings、Node では require('./settings.js') で使う。
(function(root){
  'use strict';

  const STORAGE_KEY = 'sagittarius.settings';
  const NAME_MAX = 12;
  const DEFAULT_NAME = '味方第1艦隊';

  // キーを変えられる操作 (設定画面に出す順)
  const ACTIONS = [
    {id: 'moveUp', label: '移動 上', key: 'KeyO'},
    {id: 'moveDown', label: '移動 下', key: 'KeyL'},
    {id: 'moveLeft', label: '移動 左', key: 'KeyK'},
    {id: 'moveRight', label: '移動 右', key: 'Semicolon'},
    {id: 'shell', label: 'SHELL (通常弾) オン / オフ', key: 'Digit1'},
    {id: 'torpid', label: 'TORPID (爆発弾) オン / オフ', key: 'Digit2'},
    {id: 'camUp', label: '視点 上', key: 'KeyW'},
    {id: 'camDown', label: '視点 下', key: 'KeyS'},
    {id: 'camLeft', label: '視点 左', key: 'KeyA'},
    {id: 'camRight', label: '視点 右', key: 'KeyD'},
    {id: 'center', label: '自艦隊へ視点移動', key: 'KeyC'},
    {id: 'pause', label: '一時停止', key: 'Space'}
  ];

  // クレジット (原作 → 製作 → 開発支援)
  const CREDITS = [
    {role: '原作', name: '谷川流『涼宮ハルヒの暴走』「射手座の日」'},
    {role: '製作', name: 'marusako'},
    {role: '開発支援', name: 'Claude (Anthropic)'}
  ];

  // 割り当てられないキー: 矢印 (自艦隊の移動) と Esc (一時停止) は固定で使うため。Tab・Enter・修飾キーは誤操作を防ぐため
  function isReservedKey(code){
    return /^Arrow/.test(code) || /^(Escape|Tab|Enter|NumpadEnter)$/.test(code) || /^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(code);
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
  function load(storage){
    try{
      const text = storage && storage.getItem(STORAGE_KEY);
      return text ? normalize(JSON.parse(text)) : defaults();
    }catch(e){
      return defaults();
    }
  }

  function save(storage, settings){
    try{
      if(storage) storage.setItem(STORAGE_KEY, JSON.stringify(normalize(settings)));
    }catch(e){
      // 保存できない環境 (プライベートウィンドウなど) では、その回だけの設定になる
    }
  }

  const SYMBOL_LABELS = {Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`'};

  function keyLabel(code){
    let m;
    if((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if((m = /^Digit(\d)$/.exec(code))) return m[1];
    if((m = /^Numpad(\d)$/.exec(code))) return 'テンキー' + m[1];
    if(code in SYMBOL_LABELS) return SYMBOL_LABELS[code];
    return code;
  }

  // 画面に出す自艦隊の名前。空なら「味方第N艦隊」(no: 選んだ艦隊の番号。省略時は 1)
  function fleetName(settings, no){
    return settings.name || (no ? `味方第${no}艦隊` : DEFAULT_NAME);
  }

  const api = {STORAGE_KEY, NAME_MAX, DEFAULT_NAME, ACTIONS, CREDITS, isReservedKey, defaults, assignKey, normalize, load, save, keyLabel, fleetName};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusSettings = api;
})(typeof window !== 'undefined' ? window : globalThis);
