# TTU — 한 건을 끝내는 소개 보드

현재 HW6 제출 후보. 이전 SAI 카운터·싱글 중심 검토 자료와 구분한다. 외부 패키지·API 키·유료 인프라 없이 Node.js 18 이상으로 실행한다.

```powershell
node --test prototypes/gyunggoo/tests/core.test.mjs prototypes/gyunggoo/tests/integration.test.mjs
node prototypes/gyunggoo/server.mjs 8767
```

Chrome에서 http://127.0.0.1:8767 을 연다. `.data/board.local.json`에 합성 기록이 저장된다. 파일을 직접 여는 방식은 서버 상태·관계 검사를 실행하지 않는다. 서버는 127.0.0.1에만 바인딩하고 HTML/CSS/JS 등 허용한 파일만 제공한다.

모든 후보·actor·동의·연결 확인은 합성이다. 역할 선택은 실제 인증이 아니며 header를 바꾸면 해당 합성 actor로 시험할 수 있다. 실제 인증·관계 DB·TTU 서비스 보안이나 실제 사용 성과의 증거로 쓰지 않는다. 실제 개인정보 입력 필드·연락처·외부 발송·AI 모델은 없다.

명세: [gyunggoo-introduction-board.md](../../docs/specs/gyunggoo-introduction-board.md). WhyTree: [gyunggoo.md](../../docs/whytree/gyunggoo.md).
PPTX/PDF와 성찰 초안·최종 본인 체크는 작업 패키지에 함께 제공한다. 실제 사용자 면담·본인 화면 검사를 에이전트 작업으로 대신 완료했다고 쓰지 않는다.
