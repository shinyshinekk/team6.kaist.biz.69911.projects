/*
 * reward.js — 주선자 탐색 리워드(짝 후보 메모) 보상 규칙
 *
 * 스펙: docs/specs/shine-exploration-reward.md
 *
 * 설계 원칙
 *  - 순수 함수. 시간은 인자 `now`로 주입한다.
 *  - 변경 함수는 { ok: true, store, pair, rewarded, points } 또는 { ok: false, error, message } 를 돌려준다.
 *  - 인자로 받은 store는 수정하지 않고 새 store를 돌려준다.
 *
 * 브라우저(file://)와 node --test 양쪽에서 쓰려고 CommonJS 겸용으로 썼다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ShineReward = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ── 실험용 규칙값 ─────────────────────────────────────────
   * 실제 서비스의 금액·상한은 정하지 않았다. 이번 체험에서만 쓰는 값이다.
   */
  var RULES = {
    pointsPerNewPair: 10,  // 새 조합을 처음 저장할 때만 지급.
    minReasonLength: 10    // 앞뒤 공백 제거 후, 문장 안 띄어쓰기 포함.
  };

  var MESSAGES = {
    SAME_FRIEND: '서로 다른 친구 두 명을 골라 주세요.',
    REASON_TOO_SHORT: '어울릴 것 같은 이유를 10자 이상 적어 주세요.',
    PAIR_NOT_FOUND: '저장된 짝 후보를 찾을 수 없어요.'
  };

  function fail(error) {
    return { ok: false, error: error, message: MESSAGES[error] };
  }

  function emptyStore() {
    return { pairs: [], totalPoints: 0 };
  }

  /* A-B와 B-A를 같은 조합으로 보기 위해 id를 정렬해 잇는다. */
  function pairKey(idA, idB) {
    if (idA === idB) return null;
    return [String(idA), String(idB)].sort().join('|');
  }

  function normalizeReason(text) {
    return String(text == null ? '' : text).trim();
  }

  function reasonLength(text) {
    return normalizeReason(text).length;
  }

  function isReasonValid(text) {
    return reasonLength(text) >= RULES.minReasonLength;
  }

  function findPair(store, key) {
    for (var i = 0; i < store.pairs.length; i++) {
      if (store.pairs[i].pairKey === key) return store.pairs[i];
    }
    return null;
  }

  function replacePair(store, updated) {
    return {
      pairs: store.pairs.map(function (p) { return p.pairKey === updated.pairKey ? updated : p; }),
      totalPoints: store.totalPoints
    };
  }

  /*
   * 짝 후보 저장. 새 조합이면 +10P, 이미 있는 조합이면 메모만 바꾸고 0P.
   * 선택 순서는 그대로 friendIds에 남기되, 판정은 pairKey로만 한다.
   */
  function savePair(store, idA, idB, reason, now) {
    var key = pairKey(idA, idB);
    if (key === null) return fail('SAME_FRIEND');
    if (!isReasonValid(reason)) return fail('REASON_TOO_SHORT');

    var text = normalizeReason(reason);
    var existing = findPair(store, key);

    if (existing) {
      var edited = Object.assign({}, existing, { reason: text, updatedAt: now });
      return { ok: true, store: replacePair(store, edited), pair: edited, rewarded: false, points: 0 };
    }

    var pair = {
      pairKey: key,
      friendIds: [String(idA), String(idB)],
      reason: text,
      rewarded: true,
      createdAt: now,
      updatedAt: now
    };
    return {
      ok: true,
      store: { pairs: store.pairs.concat([pair]), totalPoints: store.totalPoints + RULES.pointsPerNewPair },
      pair: pair,
      rewarded: true,
      points: RULES.pointsPerNewPair
    };
  }

  /* 저장된 카드에서 이유만 고친다. 보상은 없다. */
  function updateReason(store, key, reason, now) {
    var existing = findPair(store, key);
    if (!existing) return fail('PAIR_NOT_FOUND');
    if (!isReasonValid(reason)) return fail('REASON_TOO_SHORT');
    var edited = Object.assign({}, existing, { reason: normalizeReason(reason), updatedAt: now });
    return { ok: true, store: replacePair(store, edited), pair: edited, rewarded: false, points: 0 };
  }

  /*
   * localStorage에서 읽은 문자열을 store로 되돌린다.
   * 깨졌거나 모양이 다르면 빈 store로 시작한다. 포인트는 저장값을 믿지 않고 보상받은 조합 수로 다시 센다.
   */
  function parseStore(raw) {
    try {
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.pairs)) return emptyStore();
      var seen = {};
      var pairs = data.pairs.filter(function (p) {
        if (!p || typeof p.pairKey !== 'string' || seen[p.pairKey]) return false;
        seen[p.pairKey] = true;
        return true;
      });
      var rewardedCount = pairs.filter(function (p) { return p.rewarded === true; }).length;
      return { pairs: pairs, totalPoints: rewardedCount * RULES.pointsPerNewPair };
    } catch (e) {
      return emptyStore();
    }
  }

  return {
    RULES: RULES,
    MESSAGES: MESSAGES,
    emptyStore: emptyStore,
    pairKey: pairKey,
    normalizeReason: normalizeReason,
    reasonLength: reasonLength,
    isReasonValid: isReasonValid,
    findPair: findPair,
    savePair: savePair,
    updateReason: updateReason,
    parseStore: parseStore
  };
});
