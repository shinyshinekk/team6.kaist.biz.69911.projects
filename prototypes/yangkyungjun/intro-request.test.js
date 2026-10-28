/*
 * intro-request.test.js — 스펙의 checks 22개
 *
 * 실행:  node --test
 * 설치할 것 없음(Node 내장 test runner).
 *
 * 번호는 docs/specs/yangkyungjun-feature.md 의 "Checks" 표와 1:1로 대응한다.
 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const IR = require('./intro-request.js');

const DAY = IR.DAY;
const T0 = Date.UTC(2026, 10, 1); // 2026-11-01
const SINGLE = 'single_kyungjun';

const MATCHMAKERS = [
  { id: 'mm_1', name: '김선영' },
  { id: 'mm_2', name: '박지훈' },
  { id: 'mm_3', name: '이수진' }
];

function store() {
  return IR.createStore({ matchmakers: MATCHMAKERS });
}

/** 전 항목 "상관없음"에서 출발해 넘긴 것만 덮어쓴다. */
function conditions(overrides) {
  const base = {};
  IR.FIELD_KEYS.forEach((key) => { base[key] = { grade: 'any', value: null }; });
  return Object.assign(base, overrides || {});
}

/** 유효한 기본 초안: 필수 2 + 선호 1 */
function draft(overrides) {
  return Object.assign({
    singleId: SINGLE,
    matchmakerId: 'mm_1',
    conditions: conditions({
      age: { grade: 'must', value: '30대 초반' },
      region: { grade: 'must', value: '서울' },
      marriageTiming: { grade: 'prefer', value: '2~3년 안에' }
    }),
    note: '조용한 자리에서 오래 이야기할 수 있는 분이면 좋겠어요.'
  }, overrides || {});
}

/** send 가 성공한다고 믿고 { store, request } 를 돌려준다. */
function sent(s, overrides, now) {
  const result = IR.send(s, draft(overrides), now === undefined ? T0 : now);
  assert.equal(result.ok, true, result.message);
  return result;
}

/* ───────────────────────── 작성 ───────────────────────── */
describe('작성 규칙', () => {
  test('① 필수 조건을 3개 고르면 전송이 거부된다', () => {
    const result = IR.send(store(), draft({
      conditions: conditions({
        age: { grade: 'must', value: '30대 초반' },
        region: { grade: 'must', value: '서울' },
        religion: { grade: 'must', value: '무교' }
      })
    }), T0);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'MUST_LIMIT_EXCEEDED');
    assert.equal(IR.RULES.maxMust, 2);
  });

  test('② 전 항목이 "상관없음"이면 전송이 거부된다', () => {
    const result = IR.send(store(), draft({ conditions: conditions() }), T0);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'NO_SIGNAL');
  });

  test('③ 유효한 부탁은 sent 로 생성되고 만료일이 7일 뒤로 찍힌다', () => {
    const { request } = sent(store());

    assert.equal(request.state, 'sent');
    assert.equal(request.closedReason, null);
    assert.equal(request.readAt, null);
    assert.equal(request.expiresAt, T0 + 7 * DAY);
    assert.deepEqual(
      IR.mustConditions(request).map((c) => c.key),
      ['age', 'region']
    );
  });
});

/* ───────────────────────── 한도 ───────────────────────── */
describe('한도와 중복', () => {
  test('④ 진행 중 3건이면 4번째 부탁이 거부된다', () => {
    let s = store();
    s = sent(s, { matchmakerId: 'mm_1' }).store;
    s = sent(s, { matchmakerId: 'mm_2' }).store;
    s = sent(s, { matchmakerId: 'mm_3' }).store;

    // 4번째로 보낼 주선자를 하나 더 붙여서, 거부 사유가 '중복'이 아니라 '한도'임을 확실히 한다.
    s.matchmakers = s.matchmakers.concat([{ id: 'mm_4', name: '정우성' }]);
    const result = IR.send(s, draft({ matchmakerId: 'mm_4' }), T0);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'ACTIVE_LIMIT_REACHED');
    assert.equal(IR.remainingSlots(s, SINGLE, T0), 0);
  });

  test('⑤ 같은 주선자에게 진행 중인 부탁이 있으면 중복 전송이 거부된다', () => {
    const s = sent(store()).store;
    const result = IR.send(s, draft({ matchmakerId: 'mm_1' }), T0);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'DUPLICATE_ACTIVE');
  });

  test('⑥ 같은 주선자에게 30일 안에 3번째 부탁은 거부된다', () => {
    // 취소는 쿨다운이 면제되므로, 누적 상한이 없으면 취소→재전송을 무한 반복할 수 있다.
    let s = store();
    const first = sent(s, {}, T0);
    s = IR.cancel(first.store, first.request.id, T0 + 1 * DAY).store;

    const second = sent(s, {}, T0 + 2 * DAY);
    s = IR.cancel(second.store, second.request.id, T0 + 3 * DAY).store;

    const third = IR.send(s, draft(), T0 + 4 * DAY);

    assert.equal(third.ok, false);
    assert.equal(third.error, 'MATCHMAKER_WINDOW_LIMIT');
  });
});

/* ───────────────────────── 전이 ───────────────────────── */
describe('상태 전이', () => {
  test('⑦ sent 에서 확인·보류·종료가 모두 가능하다', () => {
    const a = sent(store());
    assert.equal(IR.accept(a.store, a.request.id, T0).ok, true);

    const b = sent(store());
    assert.equal(IR.hold(b.store, b.request.id, T0).ok, true);

    const c = sent(store());
    assert.equal(IR.decline(c.store, c.request.id, T0).ok, true);
  });

  test('⑧ held 에서 확인·종료가 가능하다', () => {
    const base = sent(store());
    const held = IR.hold(base.store, base.request.id, T0 + 1 * DAY);

    const accepted = IR.accept(held.store, base.request.id, T0 + 2 * DAY);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.request.state, 'accepted');

    const declined = IR.decline(held.store, base.request.id, T0 + 2 * DAY);
    assert.equal(declined.ok, true);
    assert.equal(declined.request.closedReason, 'declined');
  });

  test('⑨ accepted 에서 종료가 가능하다 — "찾아볼게요" 뒤의 "못 찾았어요"', () => {
    const base = sent(store());
    const accepted = IR.accept(base.store, base.request.id, T0 + 1 * DAY);
    const declined = IR.decline(accepted.store, base.request.id, T0 + 3 * DAY);

    assert.equal(declined.ok, true);
    assert.equal(declined.request.state, 'closed');
    assert.equal(declined.request.closedReason, 'declined');
  });

  test('⑩ closed 상태에서는 주선자 액션이 모두 거부된다', () => {
    const base = sent(store());
    const closed = IR.decline(base.store, base.request.id, T0 + 1 * DAY).store;

    ['accept', 'hold', 'decline'].forEach((action) => {
      const result = IR[action](closed, base.request.id, T0 + 2 * DAY);
      assert.equal(result.ok, false, action + ' 가 거부되지 않았다');
      assert.equal(result.error, 'INVALID_TRANSITION');
    });
  });
});

/* ───────────────────────── 시계 ───────────────────────── */
describe('시계', () => {
  test('⑪ 7일이 지나면 만료된다', () => {
    const base = sent(store());

    const before = IR.tick(base.store, T0 + 7 * DAY - 1).requests[0];
    assert.equal(before.state, 'sent');

    const after = IR.tick(base.store, T0 + 7 * DAY).requests[0];
    assert.equal(after.state, 'closed');
    assert.equal(after.closedReason, 'expired');
    assert.equal(after.closedAt, T0 + 7 * DAY);
  });

  test('⑫ 보류는 1회만 — 두 번째 보류 시도는 거부되고 기한도 안 늘어난다', () => {
    const base = sent(store());
    const held = IR.hold(base.store, base.request.id, T0 + 1 * DAY);
    assert.equal(held.request.expiresAt, T0 + 8 * DAY);

    const again = IR.hold(held.store, base.request.id, T0 + 2 * DAY);
    assert.equal(again.ok, false);
    assert.equal(IR.tick(held.store, T0 + 2 * DAY).requests[0].expiresAt, T0 + 8 * DAY);
  });

  test('⑬ 확인하면 만료일이 7일 뒤로 다시 찍힌다', () => {
    const base = sent(store());
    const accepted = IR.accept(base.store, base.request.id, T0 + 5 * DAY);

    assert.equal(accepted.request.expiresAt, T0 + 12 * DAY);

    // 확인해도 영원히 열려 있지는 않다. 방치하면 만료된다.
    const later = IR.tick(accepted.store, T0 + 12 * DAY).requests[0];
    assert.equal(later.state, 'closed');
    assert.equal(later.closedReason, 'expired');
  });

  test('⑭ 닫힌 부탁은 시간이 더 지나도 변하지 않는다', () => {
    const base = sent(store());
    const closed = IR.decline(base.store, base.request.id, T0 + 1 * DAY).store;

    const later = IR.tick(closed, T0 + 400 * DAY).requests[0];
    assert.equal(later.state, 'closed');
    assert.equal(later.closedReason, 'declined');
    assert.equal(later.closedAt, T0 + 1 * DAY);
  });
});

/* ───────────────────────── 싱글 액션 ───────────────────────── */
describe('싱글 액션', () => {
  test('⑮ 취소하면 cancelled 로 닫히고 한도가 즉시 돌아온다', () => {
    let s = store();
    s = sent(s, { matchmakerId: 'mm_1' }).store;
    s = sent(s, { matchmakerId: 'mm_2' }).store;
    const third = sent(s, { matchmakerId: 'mm_3' });
    assert.equal(IR.remainingSlots(third.store, SINGLE, T0), 0);

    const cancelled = IR.cancel(third.store, third.request.id, T0 + 1 * DAY);

    assert.equal(cancelled.request.state, 'closed');
    assert.equal(cancelled.request.closedReason, 'cancelled');
    assert.equal(IR.remainingSlots(cancelled.store, SINGLE, T0 + 1 * DAY), 1);
  });

  test('⑯ 주선자가 아직 열어보지 않았으면 수정할 수 있다', () => {
    const base = sent(store());
    const edited = IR.edit(base.store, base.request.id, draft({
      conditions: conditions({ religion: { grade: 'must', value: '불교' } }),
      note: '고쳐 썼습니다.'
    }), T0 + 1 * 60 * 1000);

    assert.equal(edited.ok, true);
    assert.equal(edited.request.note, '고쳐 썼습니다.');
    assert.deepEqual(IR.mustConditions(edited.request).map((c) => c.key), ['religion']);
  });

  test('⑰ 주선자가 열어본 뒤에는 수정이 거부된다', () => {
    const base = sent(store());
    const read = IR.markRead(base.store, base.request.id, T0 + 1 * DAY);

    const edited = IR.edit(read.store, base.request.id, draft({ note: '몰래 바꾸기' }), T0 + 2 * DAY);

    assert.equal(edited.ok, false);
    assert.equal(edited.error, 'EDIT_LOCKED');
    assert.equal(IR.tick(read.store, T0 + 2 * DAY).requests[0].note, base.request.note);
  });
});

/* ───────────────────────── 쿨다운 ───────────────────────── */
describe('쿨다운', () => {
  test('⑱ 종료 13일째는 거부, 15일째는 허용된다', () => {
    const base = sent(store());
    const closedAt = T0 + 1 * DAY;
    const s = IR.decline(base.store, base.request.id, closedAt).store;

    const tooSoon = IR.send(s, draft(), closedAt + 13 * DAY);
    assert.equal(tooSoon.ok, false);
    assert.equal(tooSoon.error, 'COOLDOWN_ACTIVE');

    const later = IR.send(s, draft(), closedAt + 15 * DAY);
    assert.equal(later.ok, true, later.message);
  });

  test('⑲ 만료에도 같은 쿨다운이 걸린다', () => {
    const base = sent(store());
    const expiredAt = T0 + 7 * DAY;

    const tooSoon = IR.send(base.store, draft(), expiredAt + 13 * DAY);
    assert.equal(tooSoon.ok, false);
    assert.equal(tooSoon.error, 'COOLDOWN_ACTIVE');

    const later = IR.send(base.store, draft(), expiredAt + 15 * DAY);
    assert.equal(later.ok, true, later.message);
  });

  test('⑳ 내가 취소한 건에는 쿨다운이 붙지 않는다', () => {
    const base = sent(store());
    const s = IR.cancel(base.store, base.request.id, T0 + 1 * DAY).store;

    const again = IR.send(s, draft(), T0 + 1 * DAY + 60 * 1000);

    assert.equal(again.ok, true, again.message);
  });
});

/* ───────────────────────── 가시성 ───────────────────────── */
describe('가시성', () => {
  test('㉑ 싱글 화면에서는 종료와 만료가 같은 문구로 보인다', () => {
    const a = sent(store());
    const declined = IR.decline(a.store, a.request.id, T0 + 1 * DAY).request;

    const b = sent(store());
    const expired = IR.tick(b.store, T0 + 7 * DAY).requests[0];

    assert.equal(IR.singleLabel(declined), IR.singleLabel(expired));
    assert.equal(IR.singleLabel(declined), '이번엔 닫힘');

    // 보류도 싱글에게는 드러나지 않는다 — "밀리고 있는 중"으로 읽히기 때문.
    const c = sent(store());
    const held = IR.hold(c.store, c.request.id, T0 + 1 * DAY).request;
    assert.equal(IR.singleLabel(held), '전달됨');
    assert.equal(IR.singleLabel(c.request), '전달됨');
  });

  test('㉒ 내부에는 종료와 만료가 구분되어 저장된다', () => {
    const a = sent(store());
    const declined = IR.decline(a.store, a.request.id, T0 + 1 * DAY).request;

    const b = sent(store());
    const expired = IR.tick(b.store, T0 + 7 * DAY).requests[0];

    assert.equal(declined.closedReason, 'declined');
    assert.equal(expired.closedReason, 'expired');
    assert.notEqual(declined.closedReason, expired.closedReason);
  });
});
