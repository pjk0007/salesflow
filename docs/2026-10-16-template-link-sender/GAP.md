# GAP — docs/2026-10-16-template-link-sender/ · 2026-10-20

**unproven: 0 — 게이트 통과** (분모 31: ✅ 28 · ⚠️ 3 · ❌ 0, Match Rate 약 94% · 참고)

## 실행
- `pnpm test` 1060/1060, `npx tsc --noEmit` exit 0, 변경 src eslint 출력 없음(1차)
- verify-evidence: unresolved 0, uncited·no-cmd-match·no-receipt 0. 커버리지는 수집 안 됨(lcov 9월 자)

## 1차 → 2차 변경
- B11·B13·B14·B16·B17·B18 evidence ref가 scratchpad라 unresolved 6 → `evidence/sender-test.ts`로 옮겨 해소
- 검색 기능(0931152)을 B28~B31로 소급 추가(분모 27→31), 순수 함수 테스트 10건 + 브라우저 확인
- O2 힌트는 page.tsx가 아니라 `TemplateLinkSenderCard.tsx` 수동 안내 두 번째 줄로 충족

## ⚠️ 약점 (게이트 무관, 정리함)
- 운영 재확인 문구가 B13·B14·B17·B18에도 붙어 있었음 → 이 네 항목은 로컬 시나리오가 근거라고 고쳐 적음
- B28~B31 cmd의 테스트 건수 표기 오류(11 → 10) 고침
- B29가 저장소에 없는 캡처를 언급 → 화면 확인 서술 + 코드 클래스로 고쳐 적음

## DESIGN 대비
- C1~C6을 커밋 하나(bf23964)로 합침 — "C3는 한 커밋" 조건은 충족
- evidence 스크립트의 절대 경로를 상대 경로로 바꿈, ui-fixture.ts 비밀번호는 환경 변수로
