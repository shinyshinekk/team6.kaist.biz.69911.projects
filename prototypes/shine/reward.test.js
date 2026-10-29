/*
 * reward.test.js — 탐색 리워드 보상 규칙
 *
 * 실행:  node --test prototypes/shine/reward.test.js
 * 설치할 것 없음(Node 내장 test runner).
 *
 * 수동 체크 M1~M3(docs/specs/shine-exploration-reward.md §6)의 규칙 부분을 코드로 먼저 확인한다.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const R = require('./reward.js');

const T0 = Date.UTC(2026, 9, 30);
const VALID = '둘 다 등산 좋아해'; // 띄어쓰기 포함 정확히 10자

describe('M1 입력 조건과 최초 적립', () => {
  test('공백만 입력하면 저장 거부', () => {
    const r = R.savePair(R.emptyStore(), 'f1', 'f2', '     ', T0);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'REASON_TOO_SHORT');
  });

  test('앞뒤 공백을 빼면 9자인 이유는 거부', () => {
    assert.equal(R.reasonLength('  둘 다 등산 좋아  '), 9);
    const r = R.savePair(R.emptyStore(), 'f1', 'f2', '  둘 다 등산 좋아  ', T0);
    assert.equal(r.error, 'REASON_TOO_SHORT');
  });

  test('띄어쓰기 포함 정확히 10자면 저장되고 +10P', () => {
    assert.equal(R.reasonLength(VALID), 10);
    const r = R.savePair(R.emptyStore(), 'f1', 'f2', VALID, T0);
    assert.equal(r.ok, true);
    assert.equal(r.rewarded, true);
    assert.equal(r.points, 10);
    assert.equal(r.store.totalPoints, 10);
    assert.equal(r.store.pairs.length, 1);
  });

  test('저장된 이유는 앞뒤 공백이 제거된다', () => {
    const r = R.savePair(R.emptyStore(), 'f1', 'f2', '   ' + VALID + '  ', T0);
    assert.equal(r.pair.reason, VALID);
  });

  test('같은 친구 두 번 선택은 거부', () => {
    const r = R.savePair(R.emptyStore(), 'f1', 'f1', VALID, T0);
    assert.equal(r.error, 'SAME_FRIEND');
  });

  test('인자로 받은 store는 바뀌지 않는다', () => {
    const s0 = R.emptyStore();
    R.savePair(s0, 'f1', 'f2', VALID, T0);
    assert.deepEqual(s0, { pairs: [], totalPoints: 0 });
  });
});

describe('M2 순서를 바꾼 중복 조합·메모 수정 시 추가 적립 방지', () => {
  const first = R.savePair(R.emptyStore(), 'f1', 'f2', VALID, T0).store;

  test('A-B와 B-A는 같은 pairKey', () => {
    assert.equal(R.pairKey('f1', 'f2'), R.pairKey('f2', 'f1'));
  });

  test('반대 순서로 재저장하면 메모만 바뀌고 0P, 조합은 1개 그대로', () => {
    const r = R.savePair(first, 'f2', 'f1', '둘 다 주말에 캠핑을 다녀요', T0 + 1000);
    assert.equal(r.ok, true);
    assert.equal(r.rewarded, false);
    assert.equal(r.points, 0);
    assert.equal(r.store.totalPoints, 10);
    assert.equal(r.store.pairs.length, 1);
    assert.equal(r.store.pairs[0].reason, '둘 다 주말에 캠핑을 다녀요');
    assert.equal(r.store.pairs[0].createdAt, T0);
    assert.equal(r.store.pairs[0].updatedAt, T0 + 1000);
  });

  test('카드에서 이유를 수정해도 0P', () => {
    const r = R.updateReason(first, R.pairKey('f1', 'f2'), '대화 속도가 비슷할 것 같아요', T0 + 2000);
    assert.equal(r.ok, true);
    assert.equal(r.points, 0);
    assert.equal(r.store.totalPoints, 10);
  });

  test('수정에도 10자 조건이 적용되고, 실패하면 내용이 그대로', () => {
    const r = R.updateReason(first, R.pairKey('f1', 'f2'), '짧음', T0 + 2000);
    assert.equal(r.error, 'REASON_TOO_SHORT');
    assert.equal(R.findPair(first, R.pairKey('f1', 'f2')).reason, VALID);
  });

  test('없는 조합 수정은 거부', () => {
    const r = R.updateReason(first, R.pairKey('f3', 'f4'), VALID, T0);
    assert.equal(r.error, 'PAIR_NOT_FOUND');
  });

  test('다른 새 조합을 저장할 때만 20P', () => {
    const r = R.savePair(first, 'f3', 'f1', VALID, T0 + 3000);
    assert.equal(r.rewarded, true);
    assert.equal(r.store.totalPoints, 20);
    assert.equal(r.store.pairs.length, 2);
  });
});

describe('M3 새로고침 유지와 체험 초기화', () => {
  test('저장 → 문자열 → 복원 시 포인트와 메모가 그대로', () => {
    let s = R.savePair(R.emptyStore(), 'f1', 'f2', VALID, T0).store;
    s = R.updateReason(s, R.pairKey('f1', 'f2'), '대화 속도가 비슷할 것 같아요', T0 + 1).store;
    s = R.savePair(s, 'f3', 'f4', VALID, T0 + 2).store;
    const restored = R.parseStore(JSON.stringify(s));
    assert.deepEqual(restored, s);
    assert.equal(restored.totalPoints, 20);
  });

  test('저장값이 없거나 깨졌으면 빈 store', () => {
    assert.deepEqual(R.parseStore(null), R.emptyStore());
    assert.deepEqual(R.parseStore('{not json'), R.emptyStore());
    assert.deepEqual(R.parseStore('{"pairs":"x"}'), R.emptyStore());
  });

  test('저장된 포인트 값은 믿지 않고 보상받은 조합 수로 다시 센다', () => {
    const tampered = JSON.stringify({
      pairs: [{ pairKey: 'f1|f2', friendIds: ['f1', 'f2'], reason: VALID, rewarded: true }],
      totalPoints: 9999
    });
    assert.equal(R.parseStore(tampered).totalPoints, 10);
  });

  test('같은 pairKey가 중복 저장돼 있으면 하나만 남긴다', () => {
    const p = { pairKey: 'f1|f2', friendIds: ['f1', 'f2'], reason: VALID, rewarded: true };
    const restored = R.parseStore(JSON.stringify({ pairs: [p, p], totalPoints: 20 }));
    assert.equal(restored.pairs.length, 1);
    assert.equal(restored.totalPoints, 10);
  });
});
