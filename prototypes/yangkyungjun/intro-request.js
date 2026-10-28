/*
 * intro-request.js — "소개 부탁 보내기"(①) 상태 기계
 *
 * 이 파일이 이 프로토타입의 1차 산출물이다. UI는 버려지고 이 파일은 실제 앱으로 옮겨진다.
 * 스펙: docs/specs/yangkyungjun-feature.md
 *
 * 설계 원칙
 *  - 순수 함수. 시간은 반드시 인자 `now`로 주입한다(Date.now()를 내부에서 부르지 않는다).
 *    만료·쿨다운이 전부 시간 기반이라, 시계를 주입하지 않으면 검증 자체가 불가능하다.
 *  - 모든 변경 함수는 { ok: true, store, request } 또는 { ok: false, error, message } 를 돌려준다.
 *  - 저장소(store)는 갈아치운다. 인자로 받은 store는 수정하지 않는다.
 *
 * 브라우저(file://)와 node --test 양쪽에서 쓰려고 CommonJS 겸용으로 썼다.
 * ES 모듈로 쓰면 file:// 에서 CORS로 막혀 채점자가 서버를 띄워야 한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.IntroRequest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;

  /* ── 정책값 ───────────────────────────────────────────────
   * PRD v0.5 가 "세부 넛지 한도는 미결정"으로 비워둔 칸을 이 스펙이 채운다.
   * 베타 기간이 11/7~12/19로 6주뿐이라 짧은 쪽 숫자를 골랐다. 늘리는 건 나중에 할 수 있지만
   * 안 쌓인 데이터는 되돌릴 수 없다.
   */
  var RULES = {
    maxMust: 2,                  // 필수 조건 상한. "양보"를 강제로 드러내는 장치.
    minSignal: 1,                // 필수+선호가 0이면 부탁이 아니라 백지다.
    maxActiveRequests: 3,        // 싱글 1명이 동시에 띄울 수 있는 부탁 수.
    expireDays: 7,               // 보낸 뒤 무응답 만료.
    holdExtendDays: 7,           // 보류 시 연장.
    acceptExtendDays: 7,         // 확인("찾아볼게요") 시 연장.
    maxHoldExtensions: 1,        // 영구 보류 방지.
    cooldownDays: 14,            // 주선자가 닫은(declined/expired) 뒤 재부탁 금지 기간.
    matchmakerWindowDays: 30,    // 같은 주선자 누적 상한의 관찰 창.
    maxPerMatchmakerInWindow: 2, // 취소→재전송 반복 스팸 차단.
    maxNoteLength: 200
  };

  /* ── 조건 항목 ─────────────────────────────────────────── */
  var FIELDS = [
    { key: 'age',            label: '나이대',        options: ['20대 중후반', '30대 초반', '30대 중후반', '40대 이상'] },
    { key: 'region',         label: '거주 지역',     options: ['서울', '경기·인천', '대전·세종', '부산·경남', '그 외 지역'] },
    { key: 'marriageTiming', label: '결혼 의향 시점', options: ['1년 안에', '2~3년 안에', '아직 정하지 않음'] },
    { key: 'religion',       label: '종교',          options: ['무교', '기독교', '천주교', '불교'] },
    { key: 'smoking',        label: '흡연',          options: ['비흡연이었으면', '흡연해도 괜찮음'] },
    { key: 'career',         label: '직업·학력 성향', options: ['전문직·연구직', '사무·기업', '자영업·창업', '직업보다 태도'] },
    { key: 'personality',    label: '성격',          options: ['외향적인 편', '내향적인 편', '상황에 맞춰 유연한 편'] }
  ];

  var FIELD_KEYS = FIELDS.map(function (f) { return f.key; });
  var GRADES = ['must', 'prefer', 'any']; // 필수 / 선호 / 상관없음

  var STATES = ['sent', 'held', 'accepted', 'closed'];
  var ACTIVE_STATES = ['sent', 'held', 'accepted'];
  var CLOSE_REASONS = ['declined', 'expired', 'cancelled'];

  /* 싱글에게 보이는 라벨. 내부 상태 4개를 3개로 접는다.
   * - held 를 노출하지 않는 이유: "보류"는 싱글에게 '밀리고 있는 중'으로 읽힌다.
   *   보류는 주선자가 자기 부탁함을 정리하는 도구이지 싱글에게 보낼 신호가 아니다.
   * - declined 와 expired 가 같은 문구인 이유: 거절이 상대에게 그대로 전달되면
   *   주선자는 종료 버튼을 안 누르고 앱을 닫는다. 그러면 전부 만료로만 흘러가 데이터가 죽는다.
   */
  var SINGLE_LABELS = {
    sent: '전달됨',
    held: '전달됨',
    accepted: '찾아보는 중',
    closed: '이번엔 닫힘'
  };

  var MATCHMAKER_LABELS = {
    sent: '새 부탁',
    held: '보류 중',
    accepted: '찾아보는 중',
    closed: '종료됨'
  };

  /* ── 유틸 ─────────────────────────────────────────────── */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function fail(error, message) {
    return { ok: false, error: error, message: message };
  }

  function days(n) {
    return n * DAY;
  }

  function isActive(request) {
    return ACTIVE_STATES.indexOf(request.state) !== -1;
  }

  /* ── 저장소 ───────────────────────────────────────────── */
  function createStore(seed) {
    seed = seed || {};
    return {
      matchmakers: clone(seed.matchmakers || []),
      requests: clone(seed.requests || []),
      seq: seed.seq || 0
    };
  }

  /* ── 작성 검증 ────────────────────────────────────────────
   * PRD H6 의 판정 기준이 "양질 요청 5건"인데 '양질'의 정의가 PRD 어디에도 없다.
   * 여기서 정의한다: 필수 ≤ 2 그리고 (필수 + 선호) ≥ 1.
   */
  function validateDraft(draft) {
    var errors = [];
    draft = draft || {};
    var conditions = draft.conditions || {};

    var mustCount = 0;
    var signalCount = 0;

    FIELD_KEYS.forEach(function (key) {
      var entry = conditions[key];
      if (!entry || typeof entry !== 'object') {
        errors.push({ error: 'MISSING_FIELD', field: key, message: FIELD_LABEL(key) + ' 항목의 등급이 없습니다.' });
        return;
      }
      if (GRADES.indexOf(entry.grade) === -1) {
        errors.push({ error: 'INVALID_GRADE', field: key, message: FIELD_LABEL(key) + ' 등급 값이 올바르지 않습니다.' });
        return;
      }
      if (entry.grade === 'any') return;

      signalCount += 1;
      if (entry.grade === 'must') mustCount += 1;

      if (!entry.value) {
        errors.push({ error: 'MISSING_VALUE', field: key, message: FIELD_LABEL(key) + '을(를) 필수/선호로 두었으면 값을 골라야 합니다.' });
        return;
      }
      if (FIELD_OPTIONS(key).indexOf(entry.value) === -1) {
        errors.push({ error: 'UNKNOWN_VALUE', field: key, message: FIELD_LABEL(key) + '에 없는 값입니다: ' + entry.value });
      }
    });

    if (mustCount > RULES.maxMust) {
      errors.push({
        error: 'MUST_LIMIT_EXCEEDED',
        message: '필수 조건은 최대 ' + RULES.maxMust + '개까지입니다. 지금 ' + mustCount + '개를 고르셨습니다.'
      });
    }
    if (signalCount < RULES.minSignal) {
      errors.push({
        error: 'NO_SIGNAL',
        message: '모든 항목이 "상관없음"입니다. 주선자가 떠올릴 실마리가 하나도 없습니다.'
      });
    }
    if (draft.note && String(draft.note).length > RULES.maxNoteLength) {
      errors.push({
        error: 'NOTE_TOO_LONG',
        message: '한마디는 ' + RULES.maxNoteLength + '자까지입니다.'
      });
    }

    return { ok: errors.length === 0, errors: errors, mustCount: mustCount, signalCount: signalCount };
  }

  function FIELD_LABEL(key) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === key) return FIELDS[i].label;
    return key;
  }

  function FIELD_OPTIONS(key) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === key) return FIELDS[i].options;
    return [];
  }

  /* ── 시계 ─────────────────────────────────────────────────
   * 만료는 사람이 아니라 시계가 만든다. 모든 액션 앞에서 먼저 돌린다.
   * 그래야 "만료된 부탁에 확인을 누르는" 경로가 생기지 않는다.
   */
  function tick(store, now) {
    var next = createStore(store);
    next.requests = next.requests.map(function (request) {
      if (!isActive(request)) return request;
      if (request.expiresAt > now) return request;
      request.state = 'closed';
      request.closedReason = 'expired';
      request.closedAt = request.expiresAt;
      return request;
    });
    return next;
  }

  /* ── 전송 가능 여부 ───────────────────────────────────── */
  function canSend(store, singleId, matchmakerId, now) {
    var s = tick(store, now);

    if (s.matchmakers.length && !s.matchmakers.some(function (m) { return m.id === matchmakerId; })) {
      return fail('UNKNOWN_MATCHMAKER', '연결되지 않은 주선자입니다.');
    }

    var mine = s.requests.filter(function (r) { return r.singleId === singleId; });

    var activeCount = mine.filter(isActive).length;
    if (activeCount >= RULES.maxActiveRequests) {
      return fail('ACTIVE_LIMIT_REACHED',
        '진행 중인 부탁이 ' + activeCount + '건입니다. 동시에 ' + RULES.maxActiveRequests + '건까지만 보낼 수 있습니다.');
    }

    var toThem = mine.filter(function (r) { return r.matchmakerId === matchmakerId; });

    if (toThem.some(isActive)) {
      return fail('DUPLICATE_ACTIVE', '이 주선자에게 이미 진행 중인 부탁이 있습니다.');
    }

    // 쿨다운: 주선자가 닫은 건(declined/expired)만 대상이다.
    // 내가 취소한 건은 압박의 주체가 나 자신이므로 쿨다운을 걸지 않는다(PRD H6 "압박 여부 기록").
    var blocking = toThem.filter(function (r) {
      return r.state === 'closed' && (r.closedReason === 'declined' || r.closedReason === 'expired');
    });
    for (var i = 0; i < blocking.length; i++) {
      var elapsed = now - blocking[i].closedAt;
      if (elapsed < days(RULES.cooldownDays)) {
        var remain = Math.ceil((days(RULES.cooldownDays) - elapsed) / DAY);
        return fail('COOLDOWN_ACTIVE', '같은 주선자에게는 ' + RULES.cooldownDays + '일 뒤에 다시 부탁할 수 있습니다. ' + remain + '일 남았습니다.');
      }
    }

    // 취소→재전송 반복 스팸 차단. 쿨다운을 면제한 대가로 누적 상한을 둔다.
    var inWindow = toThem.filter(function (r) {
      return now - r.createdAt < days(RULES.matchmakerWindowDays);
    }).length;
    if (inWindow >= RULES.maxPerMatchmakerInWindow) {
      return fail('MATCHMAKER_WINDOW_LIMIT',
        '같은 주선자에게는 ' + RULES.matchmakerWindowDays + '일 안에 ' + RULES.maxPerMatchmakerInWindow + '건까지만 보낼 수 있습니다.');
    }

    return { ok: true, store: s };
  }

  /* ── 전송 ─────────────────────────────────────────────── */
  function send(store, draft, now) {
    var validation = validateDraft(draft);
    if (!validation.ok) {
      return { ok: false, error: validation.errors[0].error, message: validation.errors[0].message, errors: validation.errors };
    }

    var gate = canSend(store, draft.singleId, draft.matchmakerId, now);
    if (!gate.ok) return gate;

    var s = gate.store;
    s.seq += 1;

    var request = {
      id: 'req_' + s.seq,
      singleId: draft.singleId,
      matchmakerId: draft.matchmakerId,
      conditions: clone(draft.conditions),
      note: draft.note ? String(draft.note) : '',
      state: 'sent',
      closedReason: null,
      createdAt: now,
      updatedAt: now,
      readAt: null,
      expiresAt: now + days(RULES.expireDays),
      closedAt: null,
      holdExtensions: 0
    };

    s.requests = s.requests.concat([request]);
    return { ok: true, store: s, request: request };
  }

  /* ── 열람 ─────────────────────────────────────────────────
   * 읽음은 상태가 아니라 타임스탬프다. 수정 권한의 경계로만 쓴다.
   */
  function markRead(store, requestId, now) {
    return mutate(store, requestId, now, function (request) {
      if (!isActive(request)) return fail('INVALID_TRANSITION', '닫힌 부탁입니다.');
      if (!request.readAt) request.readAt = now;
      return { ok: true };
    });
  }

  /* ── 싱글 액션 ────────────────────────────────────────── */
  function edit(store, requestId, draft, now) {
    var validation = validateDraft(draft);
    if (!validation.ok) {
      return { ok: false, error: validation.errors[0].error, message: validation.errors[0].message, errors: validation.errors };
    }
    return mutate(store, requestId, now, function (request) {
      if (request.state !== 'sent') {
        return fail('EDIT_LOCKED', '주선자가 이미 움직인 부탁은 고칠 수 없습니다. 취소만 할 수 있습니다.');
      }
      if (request.readAt) {
        return fail('EDIT_LOCKED', '주선자가 이미 열어본 부탁입니다. 고치면 떠올려 본 수고가 버려집니다. 취소만 할 수 있습니다.');
      }
      request.conditions = clone(draft.conditions);
      request.note = draft.note ? String(draft.note) : '';
      return { ok: true };
    });
  }

  function cancel(store, requestId, now) {
    return mutate(store, requestId, now, function (request) {
      if (!isActive(request)) return fail('INVALID_TRANSITION', '이미 닫힌 부탁입니다.');
      request.state = 'closed';
      request.closedReason = 'cancelled';
      request.closedAt = now;
      return { ok: true };
    });
  }

  /* ── 주선자 액션 ──────────────────────────────────────── */
  function accept(store, requestId, now) {
    return mutate(store, requestId, now, function (request) {
      if (request.state !== 'sent' && request.state !== 'held') {
        return fail('INVALID_TRANSITION', '확인할 수 없는 상태입니다: ' + request.state);
      }
      request.state = 'accepted';
      // "찾아볼게요"에도 시계가 계속 돈다. 그러지 않으면 가장 흔한 응답이
      // 싱글의 한도 한 칸을 영구히 잠근다.
      request.expiresAt = now + days(RULES.acceptExtendDays);
      return { ok: true };
    });
  }

  function hold(store, requestId, now) {
    return mutate(store, requestId, now, function (request) {
      if (request.state !== 'sent') {
        return fail('INVALID_TRANSITION', '보류할 수 없는 상태입니다: ' + request.state);
      }
      if (request.holdExtensions >= RULES.maxHoldExtensions) {
        return fail('HOLD_LIMIT_REACHED', '보류는 ' + RULES.maxHoldExtensions + '회까지만 가능합니다.');
      }
      request.state = 'held';
      request.holdExtensions += 1;
      request.expiresAt = now + days(RULES.holdExtendDays);
      return { ok: true };
    });
  }

  function decline(store, requestId, now) {
    return mutate(store, requestId, now, function (request) {
      if (!isActive(request)) return fail('INVALID_TRANSITION', '이미 닫힌 부탁입니다.');
      request.state = 'closed';
      request.closedReason = 'declined';
      request.closedAt = now;
      return { ok: true };
    });
  }

  /* ── 공통 변경 래퍼 ───────────────────────────────────── */
  function mutate(store, requestId, now, apply) {
    var s = tick(store, now);
    var target = null;
    for (var i = 0; i < s.requests.length; i++) {
      if (s.requests[i].id === requestId) { target = s.requests[i]; break; }
    }
    if (!target) return fail('NOT_FOUND', '부탁을 찾을 수 없습니다: ' + requestId);

    var result = apply(target);
    if (!result.ok) return result;

    target.updatedAt = now;
    return { ok: true, store: s, request: target };
  }

  /* ── 읽기 ─────────────────────────────────────────────── */
  function singleLabel(request) {
    return SINGLE_LABELS[request.state];
  }

  function matchmakerLabel(request) {
    return MATCHMAKER_LABELS[request.state];
  }

  function mustConditions(request) {
    return FIELDS
      .filter(function (f) {
        var entry = request.conditions[f.key];
        return entry && entry.grade === 'must';
      })
      .map(function (f) { return { key: f.key, label: f.label, value: request.conditions[f.key].value }; });
  }

  function preferConditions(request) {
    return FIELDS
      .filter(function (f) {
        var entry = request.conditions[f.key];
        return entry && entry.grade === 'prefer';
      })
      .map(function (f) { return { key: f.key, label: f.label, value: request.conditions[f.key].value }; });
  }

  function activeRequestsOf(store, singleId, now) {
    return tick(store, now).requests.filter(function (r) {
      return r.singleId === singleId && isActive(r);
    });
  }

  function remainingSlots(store, singleId, now) {
    return RULES.maxActiveRequests - activeRequestsOf(store, singleId, now).length;
  }

  function inboxOf(store, matchmakerId, now) {
    return tick(store, now).requests.filter(function (r) {
      return r.matchmakerId === matchmakerId;
    });
  }

  return {
    DAY: DAY,
    RULES: RULES,
    FIELDS: FIELDS,
    FIELD_KEYS: FIELD_KEYS,
    GRADES: GRADES,
    STATES: STATES,
    ACTIVE_STATES: ACTIVE_STATES,
    CLOSE_REASONS: CLOSE_REASONS,
    SINGLE_LABELS: SINGLE_LABELS,

    createStore: createStore,
    validateDraft: validateDraft,
    tick: tick,
    canSend: canSend,
    send: send,
    markRead: markRead,
    edit: edit,
    cancel: cancel,
    accept: accept,
    hold: hold,
    decline: decline,

    isActive: isActive,
    singleLabel: singleLabel,
    matchmakerLabel: matchmakerLabel,
    mustConditions: mustConditions,
    preferConditions: preferConditions,
    activeRequestsOf: activeRequestsOf,
    remainingSlots: remainingSlots,
    inboxOf: inboxOf,
    fieldLabel: FIELD_LABEL,
    fieldOptions: FIELD_OPTIONS
  };
});
