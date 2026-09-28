const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./logic.js');
const R = require('./rule-ai.js');

// テスト用の艦隊を作る (巡洋艦、最大 HP 50。「N / 300」は艦艇数 15000 の時代の値を HP 50 の基準に直したもの)
function fleet(over){
  return Object.assign({
    id: 'f', team: 'blue', name: 'f', role: 'cruiser', x: 0, y: 0,
    ships: 50, maxShips: 50, stats: Object.assign({}, L.SHIP_TYPES.cruiser.stats), charge: 0, boost: 0, lockId: null,
    order: null, isPlayer: false, ai: {nextThink: 0},
    heading: 0, flagship: false, shellCooldown: 0, torpedoCooldown: 0, interceptCooldown: 0,
    weapons: {shell: true, torpid: true}
  }, over);
}

// 決まった値を順に返す乱数
function seq(...values){
  let i = 0;
  return () => values[i++ % values.length];
}

const P = R.AI_PROFILES.standard;

test('AI (戦艦・旗艦): 索敵中は目的地に着くまで目的地を変えない', () => {
  const me = fleet({id: 'me', x: 300, y: 1500, role: 'battleship'});
  const first = R.aiDecide(me, [me], {}, seq(0.5));
  me.order = first;
  assert.deepEqual(R.aiDecide(me, [me], {}, seq(0.9)), first);
});

test('AI (戦艦・旗艦): 見えている敵がいれば近くて弱い敵を狙う', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'battleship'});
  const strongNear = fleet({id: 'strong', team: 'red', x: 400, y: 0, ships: 50});
  const weakNear = fleet({id: 'weak', team: 'red', x: 450, y: 0, ships: 50 / 6});
  const weakFar = fleet({id: 'far', team: 'red', x: 3000, y: 0, ships: 50 * 0.13});
  const fleets = [me, strongNear, weakNear, weakFar];
  const intel = {};
  L.updateIntel(intel, fleets, 'blue');
  intel.far = {x: 3000, y: 0, visible: true}; // 味方が見つけた扱い
  const order = R.aiDecide(me, fleets, intel, seq(0.5));
  assert.deepEqual(order, {type: 'attack', targetId: 'weak'});
});

test('AI (戦艦・旗艦): 敵が見えず最終確認位置があれば、最も近いそこへ向かう', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'battleship'});
  const intel = {a: {x: 1000, y: 0, visible: false}, b: {x: 500, y: 0, visible: false}};
  assert.deepEqual(R.aiDecide(me, [me], intel, seq(0.5)), {type: 'move', x: 500, y: 0});
});

test('AI (戦艦・旗艦): 手がかりがなければ敵陣の方向 (青は上・赤は下の半分) へ索敵に出る', () => {
  const blue = fleet({id: 'b', x: 1200, y: L.WORLD.h - 300, role: 'battleship'});
  const red = fleet({id: 'r', team: 'red', x: 1200, y: 300, role: 'battleship'});
  for(const v of [0, 0.5, 0.99]){
    const ob = R.aiDecide(blue, [blue], {}, seq(v));
    const or = R.aiDecide(red, [red], {}, seq(v));
    assert.equal(ob.type, 'move');
    assert.ok(ob.y <= L.WORLD.h / 2, 'blue y=' + ob.y);
    assert.ok(or.y >= L.WORLD.h / 2, 'red y=' + or.y);
    assert.ok(ob.x >= 0 && ob.x <= L.WORLD.w);
  }
});

test('AI (戦艦・旗艦): 見えている敵旗艦を、近くて弱い敵より優先して狙う', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'battleship', stats: Object.assign({}, L.SHIP_TYPES.battleship.stats), ships: 90, maxShips: 90});
  const weakNear = fleet({id: 'weak', team: 'red', x: 300, y: 0, ships: 50 / 6});
  const flag = fleet({id: 'flag', team: 'red', x: 900, y: 0, flagship: true});
  const intel = {weak: {x: 300, y: 0, visible: true}, flag: {x: 900, y: 0, visible: true}};
  assert.deepEqual(R.aiDecide(me, [me, weakNear, flag], intel, seq(0.5)), {type: 'attack', targetId: 'flag'});
});

test('AI (戦艦・旗艦): 最終確認位置や敵陣へ攻撃に向かう', () => {
  const flag = fleet({id: 'rf', team: 'red', x: 1200, y: 300, flagship: true, role: 'battleship'});
  const intel = {b: {x: 1200, y: 3500, visible: false}};
  assert.deepEqual(R.aiDecide(flag, [flag], intel, seq(0.5)), {type: 'move', x: 1200, y: 3500});
  for(const r of [0, 0.5, 0.99]){
    const o = R.aiDecide(flag, [flag], {}, seq(r));
    assert.ok(o.y >= L.WORLD.h / 2, 'y=' + o.y);
  }
});

test('AI: 狙いの点数 = 距離 / 100 − targetWeight × (期待ダメージ ÷ 相手の今の HP。1 で頭打ち) × (敵旗艦なら flagshipWeight)。小さいほど優先', () => {
  const me = fleet({id: 'me', x: 0, y: 0, role: 'battleship'});
  const fullNear = fleet({id: 'full', team: 'red', x: 400, y: 0, ships: 50});
  const halfFar = fleet({id: 'half', team: 'red', x: 1500, y: 0, ships: 50 / 2});
  const intel = {full: {x: 400, y: 0, visible: true}, half: {x: 1500, y: 0, visible: true}};
  // 期待ダメージ 0.4 × 90 = 36。近い: 4 − 10 × 0.72 = −3.2 < 遠い: 15 − 10 × 1 = 5
  assert.deepEqual(R.aiDecide(me, [me, fullNear, halfFar], intel, seq(0.5)), {type: 'attack', targetId: 'full'});
});

test('AI (巡洋艦): 同じ距離なら、弾が効かない敵旗艦 (戦艦。かすりだけ) より、よく効く空母を狙う (① 期待ダメージ)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, stats: Object.assign({}, L.SHIP_TYPES.battleship.stats), ships: 90, maxShips: 90});
  const me = fleet({id: 'a', x: 1200, y: 3000});
  const rf = fleet({id: 'rf', team: 'red', x: 1500, y: 2600, role: 'battleship', flagship: true, stats: Object.assign({}, L.SHIP_TYPES.battleship.stats), ships: 90, maxShips: 90});
  const cv = fleet({id: 'cv', team: 'red', x: 900, y: 2600, role: 'carrier', stats: Object.assign({}, L.SHIP_TYPES.carrier.stats), ships: 70, maxShips: 70});
  const intel = {rf: {x: rf.x, y: rf.y, visible: true}, cv: {x: cv.x, y: cv.y, visible: true}};
  assert.deepEqual(R.aiDecide(me, [flag, me, rf, cv], intel, seq(0.5), P), {type: 'attack', targetId: 'cv'});
  // 戦艦 (旗艦) の主砲は戦艦によく効くので、同じ並びなら敵旗艦を狙う
  assert.deepEqual(R.aiDecide(flag, [flag, me, rf, cv], intel, seq(0.5), P), {type: 'attack', targetId: 'rf'});
});

test('AI (戦艦・旗艦): すでに敵陣側にいて手がかりがなければ、マップ全体から索敵先を選ぶ (すれ違い対策)', () => {
  const blue = fleet({id: 'b', x: 1200, y: 500, role: 'battleship'}); // 青にとって敵陣側 (上半分)
  const o = R.aiDecide(blue, [blue], {}, seq(0.5, 0.9));
  assert.equal(o.type, 'move');
  assert.ok(o.y > L.WORLD.h / 2, '自陣側に戻ることもある y=' + o.y);
  const red = fleet({id: 'r', team: 'red', x: 1200, y: L.WORLD.h - 500, role: 'battleship'}); // 赤にとって敵陣側 (下半分)
  const or = R.aiDecide(red, [red], {}, seq(0.5, 0.1));
  assert.ok(or.y < L.WORLD.h / 2, 'y=' + or.y);
});

test('出撃位置: 巡洋艦は自分の隊列位置 (旗艦の左) と同じ側から出撃する', () => {
  const g = L.createGame();
  for(const team of ['blue', 'red']){
    const flag = g.fleets.find(f => f.id === team + '1');
    for(const a of g.fleets.filter(f => f.team === team && f.role === 'cruiser')){
      const o = R.aiDecide(a, g.fleets, {}, seq(0.5), R.AI_PROFILES.standard);
      assert.equal(Math.sign(o.x - flag.x), Math.sign(a.x - flag.x), a.id);
    }
  }
});

test('局地的な戦力比: 半径内の見えている敵の艦艇数 ÷ 味方の艦艇数', () => {
  const me = fleet({id: 'me', x: 0, y: 0, ships: 6000 / 300});
  const ally = fleet({id: 'a', x: 300, y: 0, ships: 4000 / 300});
  const farAlly = fleet({id: 'fa', x: 2000, y: 0, ships: 9000 / 300});
  const e1 = fleet({id: 'e1', team: 'red', x: 400, y: 0, ships: 12000 / 300});
  const e2 = fleet({id: 'e2', team: 'red', x: 500, y: 0, ships: 3000 / 300}); // 見えていない
  const intel = {e1: {x: 400, y: 0, visible: true}, e2: {x: 500, y: 0, visible: false}};
  assert.equal(R.localForceRatio(me, 'blue', [me, ally, farAlly, e1, e2], intel, 700), 12000 / 10000);
  assert.equal(R.localForceRatio(me, 'blue', [me], {}, 700), 0);
});

test('AI (戦艦・旗艦): 周りの戦力比が不利なら、味方の中心へ下がる', () => {
  const me = fleet({id: 'me', x: 1200, y: 2400, role: 'battleship', flagship: true, ships: 5000 / 300});
  const a = fleet({id: 'a', x: 1000, y: 4000, role: 'cruiser'});
  const b = fleet({id: 'b', x: 1400, y: 4000, role: 'cruiser'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2100, ships: 15000 / 300});
  const intel = {e: {x: 1200, y: 2100, visible: true}};
  assert.ok(R.localForceRatio(me, 'blue', [me, a, b, e], intel, P.localRadius) > P.flagshipRetreatRatio);
  assert.deepEqual(R.aiDecide(me, [me, a, b, e], intel, seq(0.5), P), {type: 'move', x: 1200, y: 4000});
});

test('AI (戦艦・旗艦): 不利でなければ進軍して攻撃する', () => {
  const me = fleet({id: 'me', x: 1200, y: 2400, role: 'battleship', flagship: true});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2100, ships: 8000 / 300});
  const intel = {e: {x: 1200, y: 2100, visible: true}};
  assert.deepEqual(R.aiDecide(me, [me, e], intel, seq(0.5), P), {type: 'attack', targetId: 'e'});
});

test('AI (戦艦・旗艦): HP が flagshipHoldHp (50%) 以下で、見えている敵旗艦より HP の割合が低ければ、敵旗艦の射程の外 (flagshipHoldDistance) へ下がる (② 粘る)', () => {
  assert.equal(P.flagshipHoldHp, 0.5);
  assert.ok(P.flagshipHoldDistance > L.RANGES.long, '戦艦の射程の外');
  const me = fleet({id: 'me', x: 1200, y: 3000, role: 'battleship', flagship: true, stats: Object.assign({}, L.SHIP_TYPES.battleship.stats), maxShips: 90, ships: 45});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 2400, role: 'battleship', flagship: true, stats: Object.assign({}, L.SHIP_TYPES.battleship.stats), maxShips: 90, ships: 60});
  const fleets = [me, rf];
  const intel = {rf: {x: rf.x, y: rf.y, visible: true}};
  const o = R.aiDecide(me, fleets, intel, seq(0.5), P);
  assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, 2400 + P.flagshipHoldDistance + 150], '敵旗艦と反対側へ');
  rf.ships = 40;
  assert.deepEqual(R.aiDecide(me, fleets, intel, seq(0.5), P), {type: 'attack', targetId: 'rf'}, '敵旗艦のほうが弱ければ撃ち合う');
  rf.ships = 60; me.ships = 46;
  assert.deepEqual(R.aiDecide(me, fleets, intel, seq(0.5), P), {type: 'attack', targetId: 'rf'}, 'HP が 50% より多ければ撃ち合う');
});

test('AI (戦艦・旗艦): 粘っているときは、射程の外にいる敵旗艦を狙わず、ほかの見えている敵を撃つ', () => {
  const me = fleet({id: 'me', x: 1200, y: 3000, role: 'battleship', flagship: true, stats: Object.assign({}, L.SHIP_TYPES.battleship.stats), maxShips: 90, ships: 30});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 3000 - P.flagshipHoldDistance - 100, role: 'battleship', flagship: true, stats: Object.assign({}, L.SHIP_TYPES.battleship.stats), maxShips: 90, ships: 90});
  const cr = fleet({id: 'cr', team: 'red', x: 1600, y: 3000});
  const allies = [fleet({id: 'a1', x: 1100, y: 3100}), fleet({id: 'a2', x: 1300, y: 3100})]; // 周りの戦力比は不利でない
  const intel = {rf: {x: rf.x, y: rf.y, visible: true}, cr: {x: cr.x, y: cr.y, visible: true}};
  assert.deepEqual(R.aiDecide(me, [me, ...allies, rf, cr], intel, seq(0.5), P), {type: 'attack', targetId: 'cr'});
});

test('AI (戦艦・旗艦): 見失った敵は、近い敵より敵旗艦の最終確認位置を優先して追う', () => {
  const me = fleet({id: 'me', x: 1200, y: 4000, role: 'battleship', flagship: true});
  const near = fleet({id: 'near', team: 'red', x: 1200, y: 3000});
  const flag = fleet({id: 'rf', team: 'red', x: 1200, y: 800, flagship: true});
  const intel = {near: {x: 1200, y: 3000, visible: false}, rf: {x: 1200, y: 800, visible: false}};
  assert.deepEqual(R.aiDecide(me, [me, near, flag], intel, seq(0.5), P), {type: 'move', x: 1200, y: 800});
});

test('AI (巡洋艦): 旗艦から attackerLeash 以内の敵を積極的に攻撃する (自分から遠くても)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true});
  const me = fleet({id: 'a', x: 1200, y: 3200, role: 'cruiser'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.attackerLeash + 20, ships: 5000 / 300});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  assert.deepEqual(R.aiDecide(me, [flag, me, e], intel, seq(0.5), P), {type: 'attack', targetId: 'e'});
});

test('AI (巡洋艦): 旗艦から attackerLeash より遠い敵は追わず、旗艦の前方の左右の隊列へ', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2});
  const a1 = fleet({id: 'a1', x: 1200, y: 3200, role: 'cruiser'});
  const a2 = fleet({id: 'a2', x: 1200, y: 3200, role: 'cruiser'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.attackerLeash - 50});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  const fleets = [flag, a1, a2, e];
  const o1 = R.aiDecide(a1, fleets, intel, seq(0.5), P);
  const o2 = R.aiDecide(a2, fleets, intel, seq(0.5), P);
  assert.equal(o1.type, 'move');
  assert.ok(o1.x < 1200 && o2.x > 1200, '左と右');
  assert.equal(Math.round(o1.y), 3000 - P.attackerForward, '旗艦の前方 (北向きの旗艦より北)');
  assert.equal(Math.round(o2.y), 3000 - P.attackerForward);
});

test('AI (巡洋艦): 攻撃対象がいなければ、旗艦の前方 attackerForward (標準 350)・左右 attackerDistance (標準 550) につく (第 3.6 段階: 旗艦の前に出て守る。第 3.9 段階で 200・700 から前へ)', () => {
  assert.deepEqual([P.attackerForward, P.attackerDistance], [350, 550]);
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2}); // 北向き
  const a1 = fleet({id: 'a1', x: 1200, y: 3500, role: 'cruiser'});
  const a2 = fleet({id: 'a2', x: 1200, y: 3500, role: 'cruiser'});
  const o1 = R.aiDecide(a1, [flag, a1, a2], {}, seq(0.5), P);
  const o2 = R.aiDecide(a2, [flag, a1, a2], {}, seq(0.5), P);
  assert.deepEqual([Math.round(o1.x), Math.round(o1.y)], [1200 - 550, 3000 - 350], '1 隻目は前方の左');
  assert.deepEqual([Math.round(o2.x), Math.round(o2.y)], [1200 + 550, 3000 - 350], '2 隻目は前方の右');
  const side = Object.assign({}, P, {attackerForward: 0, attackerDistance: 700});
  const o = R.aiDecide(a1, [flag, a1, a2], {}, seq(0.5), side);
  assert.deepEqual([Math.round(o.x), Math.round(o.y)], [500, 3000], 'つまみで真横にもできる');
});

test('AI (巡洋艦): 周りの戦力比が不利なら、旗艦のもとへ下がって合流する', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4800, role: 'battleship', flagship: true}); // 自分から localRadius の外
  const me = fleet({id: 'a', x: 1200, y: 3200, role: 'cruiser', ships: 25}); // HP 50% (escortRetreatHp より多い)。戦力比は 50 / 25 = 2
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2900, ships: 15000 / 300});
  const intel = {e: {x: 1200, y: 2900, visible: true}};
  assert.deepEqual(R.aiDecide(me, [flag, me, e], intel, seq(0.5), P), {type: 'move', x: 1200, y: 4800});
});

test('AI (駆逐艦): 最終戦でなければ、再装填が終わっていても近くの敵を攻撃せず離れる (偵察に専念。第 3.8 段階)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4000, role: 'battleship', flagship: true});
  const me = fleet({id: 's', x: 1200, y: 2000, role: 'destroyer', cooldown: 0});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 2000 - P.speederSafeDistance + 50, flagship: true});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  const o = R.aiDecide(me, [flag, me, e], intel, seq(0.5), P);
  assert.equal(o.type, 'move');
  assert.ok(o.y >= 2000 - 1e-9, '敵のほうへは進まない');
});

test('AI (駆逐艦): 強化中の敵巡洋艦が speederBoostAvoidDistance より近ければ、NP が満タンでも離れる (第 3.4 段階)', () => {
  assert.ok(P.speederBoostAvoidDistance > L.RANGES.medium, '巡洋艦の射程の外');
  const flag = fleet({id: 'f', x: 1200, y: 2800, role: 'battleship', flagship: true}); // 敵旗艦から 1300 (最終戦)
  const me = fleet({id: 's', x: 1200, y: 2000, role: 'destroyer', special: 'torpedo', charge: L.CHARGE_MAX});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 1500, role: 'battleship', flagship: true});
  const cr = fleet({id: 'cr', team: 'red', x: 1200, y: 2000 - P.speederBoostAvoidDistance + 50, boost: 5});
  const intel = {rf: {x: rf.x, y: rf.y, visible: true}, cr: {x: cr.x, y: cr.y, visible: true}};
  const o = R.aiDecide(me, [flag, me, rf, cr], intel, seq(0.5), P);
  assert.equal(o.type, 'move');
  assert.ok(o.y > 2000, '巡洋艦 (北) と反対の南へ');
  cr.boost = 0;
  assert.deepEqual(R.aiDecide(me, [flag, me, rf, cr], intel, seq(0.5), P), {type: 'attack', targetId: 'rf'}, '強化していなければ今までどおり攻める (最終戦)');
});

test('AI (駆逐艦): HP の割合が speederRetreatHp 以下なら、NP が満タンでも味方の旗艦のもとへ下がる (第 3.4 段階)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 2800, role: 'battleship', flagship: true}); // 敵旗艦から 1300 (最終戦)
  const me = fleet({id: 's', x: 1200, y: 2000, role: 'destroyer', special: 'torpedo', charge: L.CHARGE_MAX, maxShips: 30, ships: 30 * P.speederRetreatHp});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 1500, role: 'battleship', flagship: true});
  const intel = {rf: {x: rf.x, y: rf.y, visible: true}};
  assert.deepEqual(R.aiDecide(me, [flag, me, rf], intel, seq(0.5), P), {type: 'move', x: 1200, y: 2800});
  me.ships = 30;
  assert.equal(R.aiDecide(me, [flag, me, rf], intel, seq(0.5), P).type, 'attack');
});

test('AI (駆逐艦): 見えている敵空母から speederCarrierDistance (爆撃機の射程の外) を保つ (第 3.4 段階)', () => {
  assert.ok(P.speederCarrierDistance > L.RANGES.veryLong, '爆撃機の射程の外');
  const flag = fleet({id: 'f', x: 1200, y: 4000, role: 'battleship', flagship: true});
  const me = fleet({id: 's', x: 1200, y: 2000, role: 'destroyer', special: 'torpedo', charge: 0});
  const cv = fleet({id: 'cv', team: 'red', x: 1200, y: 2000 - P.speederCarrierDistance + 100, role: 'carrier'});
  const intel = {cv: {x: cv.x, y: cv.y, visible: true}};
  const o = R.aiDecide(me, [flag, me, cv], intel, seq(0.5), P);
  assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, Math.round(cv.y + P.speederCarrierDistance + 150)]);
  me.charge = L.CHARGE_MAX;
  assert.deepEqual(R.aiDecide(me, [flag, me, cv], intel, seq(0.5), P), {type: 'attack', targetId: 'cv'}, 'NP が満タン (最終戦) なら近くの空母に特殊攻撃をしに行く (第 3.9 段階)');
});

test('AI (駆逐艦): 敵旗艦の位置が分かれば、speederMarkDistance を保って見張る', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4000, role: 'battleship', flagship: true});
  const me = fleet({id: 's', x: 1200, y: 3000, role: 'destroyer'});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 1500, flagship: true});
  const intel = {rf: {x: 1200, y: 1500, visible: false}};
  const o = R.aiDecide(me, [flag, me, rf], intel, seq(0.5), P);
  assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, 1500 + P.speederMarkDistance]);
});

test('AI (駆逐艦): 敵旗艦の位置が分からなければ、敵陣側へ索敵に出る', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4500, role: 'battleship', flagship: true});
  const me = fleet({id: 's', x: 2000, y: 4500, role: 'destroyer'});
  const o = R.aiDecide(me, [flag, me], {}, seq(0.3), P);
  assert.equal(o.type, 'move');
  assert.ok(o.y < L.WORLD.h / 2);
});

test('AI プロファイル: つまみを変えると判断が変わる (学習で調整できる)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2});
  const me = fleet({id: 'a', x: 1200, y: 3200, role: 'cruiser'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.attackerLeash - 50, ships: 5000 / 300});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  assert.equal(R.aiDecide(me, [flag, me, e], intel, seq(0.5), P).type, 'move');
  const wide = Object.assign({}, P, {attackerLeash: P.attackerLeash + 200});
  assert.deepEqual(R.aiDecide(me, [flag, me, e], intel, seq(0.5), wide), {type: 'attack', targetId: 'e'});
});

test('controller: createGame に渡せる形の AI。指定したプロファイルで判断し、省略すると標準', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true});
  const me = fleet({id: 'a', x: 1200, y: 3000, role: 'cruiser'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3000 - P.attackerLeash - 50, ships: 5000 / 300});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  const wide = Object.assign({}, P, {attackerLeash: P.attackerLeash + 200});
  assert.deepEqual(R.controller(wide)(me, [flag, me, e], intel, seq(0.5)), R.aiDecide(me, [flag, me, e], intel, seq(0.5), wide));
  assert.deepEqual(R.controller()(me, [flag, me, e], intel, seq(0.5)), R.aiDecide(me, [flag, me, e], intel, seq(0.5), P));
  const g = L.createGame({controllers: {blue: R.controller(), red: R.controller()}});
  L.step(g, 1 / 60, seq(0.5));
  // 命令は到着するとすぐ消える (アタッカーは出撃位置が隊列位置と同じ) ので、AI が考えたか (次に考える時刻が進んだか) で確かめる
  assert.ok(g.fleets.filter(f => !f.isPlayer).every(f => f.ai.nextThink > 0), 'プレイヤー以外の全艦隊を AI が動かす');
  assert.equal(g.fleets.find(f => f.isPlayer).ai.nextThink, 0);
});

test('AI プロファイル (標準): 駆逐艦は撃たれない距離 (どの艦種の砲の射程よりも外) で、敵旗艦が見える距離 (索敵範囲の内側) から見張る', () => {
  const P = R.AI_PROFILES.standard;
  const g = L.createGame();
  const maxGun = Math.max(...g.fleets.filter(f => L.SHIP_TYPES[f.role].weapon.kind === 'gun').map(L.weaponRange));
  assert.ok(P.speederSafeDistance > maxGun);
  assert.ok(P.speederMarkDistance > P.speederSafeDistance);
  assert.ok(P.speederMarkDistance < L.sensorRange({stats: L.SHIP_TYPES.destroyer.stats}));
  assert.ok(P.speederMarkDistance > L.weaponRange(Object.assign(fleet({role: 'cruiser'}), {boost: 5})), '強化中の巡洋艦の射程の外から見張る (第 3.8 段階)');
});


test('AI (空母): 敵が見えなければ、旗艦 (戦艦) の後ろ carrierDistance につく', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2}); // 北向き
  const me = fleet({id: 'c', x: 1500, y: 3300, role: 'carrier'});
  const o = R.aiDecide(me, [flag, me], {}, seq(0.5), P);
  assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, 3000 + P.carrierDistance]);
});

test('AI (空母): 見えている敵が carrierSafeDistance より近ければ、その敵から離れる (爆撃機は自動で出る)', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2});
  const me = fleet({id: 'c', x: 1200, y: 3500, role: 'carrier'});
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 3500 - P.carrierSafeDistance + 50});
  const o = R.aiDecide(me, [flag, me, e], {e: {x: e.x, y: e.y, visible: true}}, seq(0.5), P);
  assert.equal(o.type, 'move');
  assert.ok(o.y > 3500, '敵 (北) と反対の南へ');
  const far = fleet({id: 'e', team: 'red', x: 1200, y: 3500 - P.carrierSafeDistance - 50});
  const o2 = R.aiDecide(me, [flag, me, far], {e: {x: far.x, y: far.y, visible: true}}, seq(0.5), P);
  assert.deepEqual([Math.round(o2.x), Math.round(o2.y)], [1200, 3000 + P.carrierDistance], '遠ければ定位置');
});

test('旧型 AI どうしの試合が最後まで進む (艦種・艦載機があっても)', () => {
  const g = L.createGame({controllers: {blue: R.controller(), red: R.controller()}});
  g.fleets.find(f => f.isPlayer).isPlayer = false;
  let rngState = 7;
  const rng = () => { rngState = (rngState * 16807) % 2147483647; return rngState / 2147483647; };
  for(let i = 0; i < 30 * 600 && !g.outcome; i++) L.step(g, 1 / 30, rng);
  assert.ok(g.outcome, '10 分以内に決着');
});

// ---------- 第 3.6 段階: 旗艦の命を最優先、各艦の命も大事に ----------

test('AI (巡洋艦): 自分に近い敵より、味方の旗艦から guardRadius 以内の敵 (旗艦への脅威) を狙う', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2});
  const me = fleet({id: 'a', x: 2000, y: 3000});
  const near = fleet({id: 'n', team: 'red', x: 2300, y: 3000});                       // 自分に近いが旗艦から 1100
  const threat = fleet({id: 't', team: 'red', x: 1200, y: 3000 - P.guardRadius + 100}); // 旗艦から guardRadius の内側
  const intel = {n: {x: near.x, y: near.y, visible: true}, t: {x: threat.x, y: threat.y, visible: true}};
  assert.deepEqual(R.aiDecide(me, [flag, me, near, threat], intel, seq(0.5), P), {type: 'attack', targetId: 't'});
  const calm = Object.assign({}, P, {guardWeight: 0});
  assert.deepEqual(R.aiDecide(me, [flag, me, near, threat], intel, seq(0.5), calm), {type: 'attack', targetId: 'n'}, 'guardWeight 0 なら今までどおり近い敵');
});

test('AI (駆逐艦): 最終戦では、敵旗艦より旗艦への脅威 (最も近いもの) を狙う', () => {
  const flag = fleet({id: 'f', x: 1200, y: 4000, role: 'battleship', flagship: true});
  const me = fleet({id: 's', x: 1200, y: 3000, role: 'destroyer', special: 'torpedo', charge: L.CHARGE_MAX});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 2600, role: 'battleship', flagship: true}); // 味方の旗艦から 1400
  const threat = fleet({id: 't', team: 'red', x: 1500, y: 4000 - P.guardRadius + 200});
  const intel = {rf: {x: rf.x, y: rf.y, visible: true}, t: {x: threat.x, y: threat.y, visible: true}};
  assert.deepEqual(R.aiDecide(me, [flag, me, rf, threat], intel, seq(0.5), P), {type: 'attack', targetId: 't'});
});

test('AI (巡洋艦・空母): HP の割合が escortRetreatHp 以下なら、旗艦の後ろ escortRetreatDistance へ下がる', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2}); // 北向き
  const e = fleet({id: 'e', team: 'red', x: 1500, y: 2600});
  const intel = {e: {x: e.x, y: e.y, visible: true}};
  for(const role of ['cruiser', 'carrier']){
    const me = fleet({id: 'm', x: 1400, y: 2800, role, maxShips: 50, ships: 50 * P.escortRetreatHp});
    const o = R.aiDecide(me, [flag, me, e], intel, seq(0.5), P);
    assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, 3000 + P.escortRetreatDistance], role);
    me.ships = 50;
    assert.notDeepEqual(R.aiDecide(me, [flag, me, e], intel, seq(0.5), P), o, role + ': HP が多ければ下がらない');
  }
});

// ---------- 第 3.8 段階: 駆逐艦は索敵・偵察が約 8 割、最終戦の特殊攻撃が約 2 割 ----------

// 最終戦の場面: 味方の旗艦 (y 5000) と敵の旗艦 (y 5000 − gap) が見えている。駆逐艦は y 4200
function finalScene(gap, over){
  const flag = fleet({id: 'f', x: 1200, y: 5000, role: 'battleship', flagship: true});
  const me = fleet(Object.assign({id: 's', x: 1200, y: 4200, role: 'destroyer', special: 'torpedo', charge: L.CHARGE_MAX, cooldown: 0}, over));
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 5000 - gap, role: 'battleship', flagship: true});
  return {me, fleets: [flag, me, rf], intel: {rf: {x: rf.x, y: rf.y, visible: true}}};
}

test('AI プロファイル (標準): 強化中の巡洋艦 (射程 675) は射程の外から避ける。最終戦はルールで決まるので speederFinalDistance はない (第 3.9 段階)', () => {
  assert.equal(P.speederFinalDistance, undefined);
  assert.ok(P.speederBoostAvoidDistance > L.weaponRange(Object.assign(fleet({role: 'cruiser'}), {boost: 5})));
  for(const k of ['speederEngageRange', 'speederHitAwayDistance', 'speederHoldAfterFire']) assert.equal(P[k], undefined, k + ' (ヒットアンドアウェイ) はもう使わない');
});

test('AI (駆逐艦): NP が満タン (最終戦の間だけたまる) で敵旗艦が見えていれば、敵旗艦に特殊攻撃をしに行く (旗艦どうしが遠くても)', () => {
  const s = finalScene(5000);
  assert.deepEqual(R.aiDecide(s.me, s.fleets, s.intel, seq(0.5), P), {type: 'attack', targetId: 'rf'});
});

test('AI (駆逐艦): 最終戦の条件が 1 つでも欠ければ攻撃しない', () => {
  const notFull = finalScene(2000, {charge: L.CHARGE_MAX - 1});
  assert.equal(R.aiDecide(notFull.me, notFull.fleets, notFull.intel, seq(0.5), P).type, 'move', 'NP が満タンでない');
});


test('AI (駆逐艦): 敵旗艦を見張る位置は、見えているほかの敵 (護衛) から speederSafeDistance 以上離れた方向を選ぶ', () => {
  const flag = fleet({id: 'f', x: 3000, y: 5000, role: 'battleship', flagship: true});
  const me = fleet({id: 's', x: 3000, y: 4000, role: 'destroyer'});
  const rf = fleet({id: 'rf', team: 'red', x: 3000, y: 2000, role: 'battleship', flagship: true});
  const cr = fleet({id: 'cr', team: 'red', x: 3000, y: 2000 + 700}); // 敵旗艦の南 (駆逐艦の側) に護衛
  const intel = {rf: {x: rf.x, y: rf.y, visible: true}, cr: {x: cr.x, y: cr.y, visible: true}};
  const o = R.aiDecide(me, [flag, me, rf, cr], intel, seq(0.5), P);
  assert.equal(o.type, 'move');
  assert.ok(Math.abs(Math.hypot(o.x - rf.x, o.y - rf.y) - P.speederMarkDistance) < 1e-6, '見張る距離は今までどおり');
  assert.ok(Math.hypot(o.x - cr.x, o.y - cr.y) >= P.speederSafeDistance, '護衛から離れた方向');
  const alone = R.aiDecide(me, [flag, me, rf], {rf: intel.rf}, seq(0.5), P);
  assert.deepEqual([Math.round(alone.x), Math.round(alone.y)], [3000, 2000 + P.speederMarkDistance], 'ほかの敵がいなければ今までどおり自分の側');
});

test('AI (駆逐艦): NP が満タンで敵旗艦が見えていなければ、speederFinalEngageRange 以内の見えている敵に特殊攻撃をしに行き、いなければ敵旗艦の最終確認位置へ向かう (第 3.9 段階)', () => {
  assert.equal(P.speederFinalEngageRange, 1500);
  const s = finalScene(2000);
  s.intel.rf.visible = false;
  const o = R.aiDecide(s.me, s.fleets, s.intel, seq(0.5), P);
  assert.deepEqual([o.type, Math.round(o.x), Math.round(o.y)], ['move', 1200, 3000], '最終確認位置へ');
  const e = fleet({id: 'e', team: 'red', x: 1200, y: 4200 - 1000});
  s.fleets.push(e); s.intel.e = {x: e.x, y: e.y, visible: true};
  assert.deepEqual(R.aiDecide(s.me, s.fleets, s.intel, seq(0.5), P), {type: 'attack', targetId: 'e'}, '近くの見えている敵');
  e.y = 4200 - P.speederFinalEngageRange - 100; s.intel.e.y = e.y;
  assert.equal(R.aiDecide(s.me, s.fleets, s.intel, seq(0.5), P).type, 'move', '遠い敵は追わない');
});

// ---------- 第 4.1 段階: 島 ----------

test('AI: 移動先が島の中なら、島のふちの外 (ISLAND_MARGIN の余裕) へ直す。島がなければ今までどおり', () => {
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2});
  const me = fleet({id: 'a', x: 1200, y: 3200, role: 'carrier'});
  const plain = R.aiDecide(me, [flag, me], {}, seq(0.5), P);
  const island = {x: plain.x, y: plain.y + 50, r: 300};
  const o = R.aiDecide(me, [flag, me], {}, seq(0.5), P, [island]);
  assert.equal(o.type, 'move');
  assert.ok(Math.abs(Math.hypot(o.x - island.x, o.y - island.y) - (island.r + R.ISLAND_MARGIN)) < 1e-6, '島のふちの外');
  assert.deepEqual(R.controller(P)(me, [flag, me], {}, seq(0.5), [island]), o, 'controller も島を受け取る');
});

// ---------- 第 4.3 段階: 敵駆逐艦は巡洋艦が迎え撃ち、旗艦は敵旗艦を目指す ----------

test('AI (旗艦): 敵の駆逐艦は攻撃の狙いにしない。敵旗艦の最終確認位置を目指す', () => {
  const me = fleet({id: 'me', x: 1200, y: 3000, role: 'battleship', flagship: true, ships: 1000, maxShips: 1000}); // 実際の戦艦の HP (駆逐艦 1 隻で下がらない)
  const dd = fleet({id: 'dd', team: 'red', x: 1200, y: 2600, role: 'destroyer', ships: 300, maxShips: 300});
  const rf = fleet({id: 'rf', team: 'red', x: 1200, y: 500, role: 'battleship', flagship: true});
  const intel = {dd: {x: dd.x, y: dd.y, visible: true}, rf: {x: 1200, y: 500, visible: false}};
  assert.deepEqual(R.aiDecide(me, [me, dd, rf], intel, seq(0.5), P), {type: 'move', x: 1200, y: 500});
  const cr = fleet({id: 'cr', team: 'red', x: 1300, y: 2600});
  intel.cr = {x: cr.x, y: cr.y, visible: true};
  assert.deepEqual(R.aiDecide(me, [me, dd, rf, cr], intel, seq(0.5), P), {type: 'attack', targetId: 'cr'}, '駆逐艦以外は今までどおり攻撃する');
});

test('AI (旗艦): 駆逐艦の最終確認位置は追わない (ほかになければ索敵)', () => {
  const me = fleet({id: 'me', x: 1200, y: 3000, role: 'battleship', flagship: true});
  const dd = fleet({id: 'dd', team: 'red', x: 1500, y: 2500, role: 'destroyer'});
  const intel = {dd: {x: 1500, y: 2500, visible: false}};
  const o = R.aiDecide(me, [me, dd], intel, seq(0.3), P);
  assert.equal(o.type, 'move');
  assert.notDeepEqual([o.x, o.y], [1500, 2500]);
});

test('AI (巡洋艦): 味方の旗艦から interceptRange (1500) 以内の敵の駆逐艦を、ほかの敵より優先して迎え撃つ', () => {
  assert.equal(P.interceptRange, 1500);
  const flag = fleet({id: 'f', x: 1200, y: 3000, role: 'battleship', flagship: true, heading: -Math.PI / 2});
  const me = fleet({id: 'a', x: 2000, y: 3000, role: 'cruiser'});
  const cr = fleet({id: 'c', team: 'red', x: 2300, y: 3000, ships: 5});
  const dd = fleet({id: 'dd', team: 'red', x: 1200, y: 3000 - 1400, role: 'destroyer', ships: 300, maxShips: 300});
  const intel = {c: {x: cr.x, y: cr.y, visible: true}, dd: {x: dd.x, y: dd.y, visible: true}};
  assert.deepEqual(R.aiDecide(me, [flag, me, cr, dd], intel, seq(0.5), P), {type: 'attack', targetId: 'dd'});
  dd.y = 3000 - 1600; intel.dd.y = dd.y;
  assert.deepEqual(R.aiDecide(me, [flag, me, cr, dd], intel, seq(0.5), P), {type: 'attack', targetId: 'c'}, '遠い駆逐艦は今までどおり');
});
