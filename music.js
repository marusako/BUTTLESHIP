// BGM (Web Audio で合成するオリジナル曲) の楽譜データと、描画・DOM・Web Audio に依存しない純粋関数。
// 実際の再生は sound.js が行う。
// ブラウザでは <script src="music.js"> で window.SagittariusMusic に、Node では require() で読み込む。
(function(root){
  'use strict';

  // ---- 音名 → 周波数 ----
  const PITCH_CLASS = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
  const NOTE_RE = /^([A-G])([#b]?)(-?\d)$/;

  // 'A4' のような音名を周波数 (Hz) にする。A4 = 440Hz を基準にした平均律
  function noteToFreq(note){
    const m = NOTE_RE.exec(String(note).trim());
    if(!m) throw new Error('invalid note: ' + note);
    let semitone = PITCH_CLASS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    semitone += Number(m[3]) * 12;
    return 440 * Math.pow(2, (semitone - (4 * 12 + 9)) / 12);
  }

  const isRest = n => n === 'R' || n === 'rest';

  function beatSeconds(tempo){ return 60 / tempo; }

  function loopSeconds(song){ return song.bars * song.beatsPerBar * beatSeconds(song.tempo); }

  // 各パートの長さが「小節数 × 1 小節の拍数」とそろっているか。そろっていないパートの説明を返す
  function validateSong(song){
    const want = song.bars * song.beatsPerBar;
    const problems = [];
    for(const [name, part] of Object.entries(song.parts)){
      const total = part.notes.reduce((sum, x) => sum + x.dur, 0);
      if(Math.abs(total - want) > 1e-9) problems.push(`${name}: ${total} 拍 (${want} 拍のはず)`);
    }
    return problems;
  }

  // 楽譜から再生の予定を作る: [{time, dur, part, voice, freqs} | {time, dur, part, drum}] を時刻順に
  function buildSchedule(song){
    const beat = beatSeconds(song.tempo);
    const events = [];
    for(const [name, part] of Object.entries(song.parts)){
      let t = 0;
      for(const x of part.notes){
        if(!isRest(x.n)){
          const ev = {time: t * beat, dur: x.dur * beat, part: name};
          if(part.drum) ev.drum = x.n;
          else{
            ev.voice = part.voice;
            ev.freqs = (Array.isArray(x.n) ? x.n : [x.n]).map(noteToFreq);
          }
          events.push(ev);
        }
        t += x.dur;
      }
    }
    return events.sort((a, b) => a.time - b.time);
  }

  // ---- 楽譜を書くための小道具 ----
  // [音名, 拍] の並びを音符の配列に
  const seq = pairs => pairs.map(([n, dur]) => ({n, dur}));
  // 同じ並びを times 回くり返す
  const repeat = (notes, times) => Array.from({length: times}, () => notes).flat();
  // 1 小節 8 分音符 8 つのリズム ('x' で鳴らす) をドラムの音符に
  const drumBar = (name, pattern) => [...pattern].map(c => ({n: c === 'x' ? name : 'rest', dur: 0.5}));

  // ---- 曲 (すべてオリジナル) ----
  // タイトル: A マイナーの静かな曲。弦楽器風の和音・低いベース・鐘のような旋律
  const titleChords = [['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'C4', 'E4'], ['G3', 'B3', 'D4'],
                       ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['F3', 'A3', 'D4'], ['E3', 'G#3', 'B3']];
  const TITLE = {
    tempo: 72, beatsPerBar: 4, bars: 8,
    parts: {
      pad: {voice: 'pad', notes: titleChords.map(n => ({n, dur: 4}))},
      bass: {voice: 'bass', notes: seq([['A2', 4], ['F2', 4], ['C3', 4], ['G2', 4], ['A2', 4], ['F2', 4], ['D2', 4], ['E2', 4]])},
      melody: {voice: 'bell', notes: seq([
        ['E5', 2], ['D5', 1], ['C5', 1], ['A4', 4], ['G4', 2], ['E4', 2], ['D4', 4],
        ['E5', 2], ['C5', 2], ['F5', 2], ['E5', 2], ['D5', 2], ['C5', 1], ['B4', 1], ['B4', 4]
      ])}
    }
  };

  // 戦闘: D マイナーの緊迫した曲。8 分音符で刻むベース・弦の刻み・金管風の旋律・太鼓風のリズム
  const battleRoots = [['D2', 'D3'], ['D2', 'D3'], ['Bb1', 'Bb2'], ['C2', 'C3'], ['D2', 'D3'], ['D2', 'D3'], ['G1', 'G2'], ['A1', 'A2']];
  const battleChords = [['D4', 'F4', 'A4'], ['D4', 'F4', 'A4'], ['D4', 'F4', 'Bb4'], ['C4', 'E4', 'G4'],
                        ['D4', 'F4', 'A4'], ['D4', 'F4', 'A4'], ['D4', 'G4', 'Bb4'], ['C#4', 'E4', 'A4']];
  const BATTLE = {
    tempo: 132, beatsPerBar: 4, bars: 8,
    parts: {
      bass: {voice: 'bass', notes: battleRoots.flatMap(([lo, hi]) => seq([[lo, 0.5], [lo, 0.5], [hi, 0.5], [lo, 0.5], [lo, 0.5], [hi, 0.5], [lo, 0.5], [hi, 0.5]]))},
      strings: {voice: 'strings', notes: battleChords.flatMap(n => [{n, dur: 1.5}, {n: 'R', dur: 0.5}, {n, dur: 2}])},
      lead: {voice: 'brass', notes: seq([
        ['D4', 1.5], ['F4', 0.5], ['A4', 2], ['G4', 1], ['F4', 1], ['E4', 2],
        ['F4', 1.5], ['D4', 0.5], ['Bb3', 2], ['C4', 2], ['E4', 2],
        ['D5', 1.5], ['C5', 0.5], ['A4', 2], ['Bb4', 1], ['A4', 1], ['G4', 2],
        ['G4', 1], ['Bb4', 1], ['D5', 2], ['C#5', 2], ['E5', 2]
      ])},
      kick: {drum: true, notes: repeat(drumBar('kick', 'x..xx...'), 8)},
      snare: {drum: true, notes: repeat(drumBar('snare', '..x...x.'), 8)},
      hat: {drum: true, notes: repeat(drumBar('hat', 'xxxxxxxx'), 8)}
    }
  };

  const SONGS = {title: TITLE, battle: BATTLE};

  const api = {noteToFreq, beatSeconds, loopSeconds, validateSong, buildSchedule, SONGS};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
