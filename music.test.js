const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./music.js');

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('音名 → 周波数: A4 = 440Hz を基準にした平均律 (♯・♭ も使える)', () => {
  assert.equal(M.noteToFreq('A4'), 440);
  assert.ok(near(M.noteToFreq('A3'), 220));
  assert.ok(near(M.noteToFreq('C4'), 261.6255653));
  assert.ok(near(M.noteToFreq('C#5'), M.noteToFreq('Db5')));
  assert.ok(near(M.noteToFreq('Bb3'), 233.0818808));
  assert.throws(() => M.noteToFreq('H4'));
  assert.throws(() => M.noteToFreq(''));
});

test('テンポ → 1 拍の秒数、曲 1 周の秒数', () => {
  assert.equal(M.beatSeconds(120), 0.5);
  assert.equal(M.loopSeconds({tempo: 120, beatsPerBar: 4, bars: 8}), 16);
});

test('再生の予定: 音符を拍の長さで並べ、秒に直す (休符は予定に入らない)', () => {
  const song = {tempo: 120, beatsPerBar: 4, bars: 1, parts: {
    lead: {voice: 'lead', notes: [{n: 'A4', dur: 1}, {n: 'R', dur: 1}, {n: ['C4', 'E4'], dur: 2}]}
  }};
  const events = M.buildSchedule(song);
  assert.equal(events.length, 2);
  assert.deepEqual([events[0].time, events[0].dur, events[0].part, events[0].voice], [0, 0.5, 'lead', 'lead']);
  assert.deepEqual(events[0].freqs, [440]);
  assert.equal(events[1].time, 1);
  assert.equal(events[1].dur, 1);
  assert.equal(events[1].freqs.length, 2, '和音は周波数を複数持つ');
});

test('再生の予定: ドラムは音色の名前で並べ、時刻順にそろえる', () => {
  const song = {tempo: 60, beatsPerBar: 2, bars: 1, parts: {
    bass: {voice: 'bass', notes: [{n: 'A2', dur: 2}]},
    drums: {drum: true, notes: [{n: 'kick', dur: 0.5}, {n: 'rest', dur: 0.5}, {n: 'snare', dur: 1}]}
  }};
  const events = M.buildSchedule(song);
  assert.deepEqual(events.map(e => [e.time, e.part, e.drum || null]), [[0, 'bass', null], [0, 'drums', 'kick'], [1, 'drums', 'snare']]);
});

test('曲の検査: 各パートの長さが「小節数 × 1 小節の拍数」とそろっていなければ知らせる', () => {
  const ok = {tempo: 100, beatsPerBar: 4, bars: 1, parts: {a: {voice: 'lead', notes: [{n: 'A4', dur: 4}]}}};
  const bad = {tempo: 100, beatsPerBar: 4, bars: 1, parts: {a: {voice: 'lead', notes: [{n: 'A4', dur: 3}]}}};
  assert.deepEqual(M.validateSong(ok), []);
  assert.deepEqual(M.validateSong(bad), ['a: 3 拍 (4 拍のはず)']);
});

test('用意した曲: タイトル用と戦闘用があり、どのパートも長さがそろい、音名も正しい', () => {
  assert.deepEqual(Object.keys(M.SONGS).sort(), ['battle', 'title']);
  for(const [key, song] of Object.entries(M.SONGS)){
    assert.deepEqual(M.validateSong(song), [], key);
    assert.doesNotThrow(() => M.buildSchedule(song), key);
    assert.ok(M.buildSchedule(song).length > 0, key);
  }
  assert.ok(M.SONGS.battle.tempo > M.SONGS.title.tempo, '戦闘の曲のほうが速い');
});

test('海の舞台の曲 (第 2.8 段階): タイトルは 3 拍子の舟歌風で、波のような分散和音 (8 分音符) がある。戦闘は 4 拍子の行進曲風で小太鼓がある', () => {
  const {title, battle} = M.SONGS;
  assert.equal(title.beatsPerBar, 3);
  assert.ok(Object.values(title.parts).some(p => !p.drum && p.notes.length === title.bars * 6 && p.notes.every(x => x.dur === 0.5)), '1 小節に 8 分音符 6 つの分散和音');
  assert.equal(battle.beatsPerBar, 4);
  assert.ok(battle.parts.snare && battle.parts.snare.drum);
});
