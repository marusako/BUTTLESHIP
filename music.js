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

  // ---- 曲 (すべてオリジナル。第 2.8 段階から海の舞台) ----
  // タイトル: D マイナーの 3 拍子の舟歌風。波のような分散和音 (鐘の音色)・柔らかな和音・低いベース・弦の旋律
  const seaChords = [['D4', 'F4', 'A4'], ['C4', 'E4', 'G4'], ['Bb3', 'D4', 'F4'], ['A3', 'C#4', 'E4'],
                     ['D4', 'F4', 'A4'], ['G3', 'Bb3', 'D4'], ['C4', 'E4', 'G4'], ['A3', 'C#4', 'E4']];
  const seaWaves = [['D3', 'A3', 'D4', 'F4', 'D4', 'A3'], ['C3', 'G3', 'C4', 'E4', 'C4', 'G3'], ['Bb2', 'F3', 'Bb3', 'D4', 'Bb3', 'F3'], ['A2', 'E3', 'A3', 'C#4', 'A3', 'E3'],
                    ['D3', 'A3', 'D4', 'F4', 'D4', 'A3'], ['G2', 'D3', 'G3', 'Bb3', 'G3', 'D3'], ['C3', 'G3', 'C4', 'E4', 'C4', 'G3'], ['A2', 'E3', 'A3', 'C#4', 'A3', 'E3']];
  const TITLE = {
    tempo: 72, beatsPerBar: 3, bars: 8,
    parts: {
      pad: {voice: 'pad', notes: seaChords.map(n => ({n, dur: 3}))},
      bass: {voice: 'bass', notes: seq([['D2', 3], ['C2', 3], ['Bb1', 3], ['A1', 3], ['D2', 3], ['G1', 3], ['C2', 3], ['A1', 3]])},
      waves: {voice: 'bell', notes: seaWaves.flat().map(n => ({n, dur: 0.5}))},
      melody: {voice: 'strings', notes: seq([
        ['A4', 2], ['F4', 1], ['E4', 2], ['G4', 1], ['F4', 1.5], ['E4', 0.5], ['D4', 1], ['E4', 3],
        ['A4', 2], ['D5', 1], ['D5', 1], ['C5', 1], ['Bb4', 1], ['G4', 1.5], ['A4', 0.5], ['Bb4', 1], ['A4', 3]
      ])}
    }
  };

  // 戦闘: E マイナーの行進曲風 (海軍の行進のイメージ)。8 分音符で刻むベース・弦の刻み・金管風の旋律・小太鼓の刻み
  const battleRoots = [['E2', 'E3'], ['E2', 'E3'], ['C2', 'C3'], ['D2', 'D3'], ['E2', 'E3'], ['E2', 'E3'], ['A1', 'A2'], ['B1', 'B2']];
  const battleChords = [['E4', 'G4', 'B4'], ['E4', 'G4', 'B4'], ['C4', 'E4', 'G4'], ['D4', 'F#4', 'A4'],
                        ['E4', 'G4', 'B4'], ['E4', 'G4', 'B4'], ['C4', 'E4', 'A4'], ['B3', 'D#4', 'F#4']];
  const BATTLE = {
    tempo: 126, beatsPerBar: 4, bars: 8,
    parts: {
      bass: {voice: 'bass', notes: battleRoots.flatMap(([lo, hi]) => seq([[lo, 0.5], [lo, 0.5], [hi, 0.5], [lo, 0.5], [lo, 0.5], [hi, 0.5], [lo, 0.5], [hi, 0.5]]))},
      strings: {voice: 'strings', notes: battleChords.flatMap(n => [{n, dur: 1.5}, {n: 'R', dur: 0.5}, {n, dur: 2}])},
      lead: {voice: 'brass', notes: seq([
        ['E4', 1.5], ['B3', 0.5], ['E4', 1], ['G4', 1], ['B4', 2], ['A4', 1], ['G4', 1],
        ['E4', 1.5], ['G4', 0.5], ['C5', 2], ['B4', 1], ['A4', 1], ['F#4', 2],
        ['E5', 1.5], ['D5', 0.5], ['B4', 2], ['G4', 1], ['A4', 1], ['B4', 2],
        ['C5', 1.5], ['B4', 0.5], ['A4', 1], ['E4', 1], ['F#4', 2], ['D#4', 2]
      ])},
      kick: {drum: true, notes: repeat(drumBar('kick', 'x...x...'), 8)},
      snare: {drum: true, notes: repeat(drumBar('snare', '..x.xx.x'), 8)},
      hat: {drum: true, notes: repeat(drumBar('hat', 'x.x.x.x.'), 8)}
    }
  };

  const SONGS = {title: TITLE, battle: BATTLE};

  const api = {noteToFreq, beatSeconds, loopSeconds, validateSong, buildSchedule, SONGS};
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SagittariusMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
