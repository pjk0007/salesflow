# GAP — 2026-10-13-email-click-bot-filter (커밋 6cdb0ac)

**결론: unproven 0 · 내용 28/28 일치 · 설계 밖 구현 0건**

## 1회차 (devkit:gap-detector)

- 내용 결함은 0건이다. B1~B28 모두 코드와 테스트 또는 실행 기록으로 확인했다.
- 직접 다시 실행했다: `pnpm test` 978/0, `tsc --noEmit` 오류 0, 변경 파일 22개 eslint exit 0.
- **게이트 미달 27건은 모두 evidence 서식 문제였다.**
  - unresolved 16건: ref가 세션 임시 경로에 설명 문구까지 붙어 있어 저장소 경로로 풀리지 않았다.
  - uncited 11건: output을 러너 출력 그대로 적지 않고 요약문으로 적었다.

## 보완

- 검증 스크립트를 `evidence/`로 옮겼다: `check-click.ts`, `b12.sql`, `api_check.py`, `check-mcp.ts`, `prod-badges.png`.
- 로컬 사본으로 찍은 화면 캡처 3장은 고객 이메일이 보여서 저장소에 넣지 않았다. B27은 운영 캡처(본인 테스트 발송)로 대체했다.
- test evidence의 output을 실제 러너 줄(`ℹ pass 978`, `ℹ fail 0`)로 바꿨다. 그 전에 `pnpm test`를 다시 실행해 receipt를 남겼다.
- `verify-evidence`를 다시 돌린 결과 unresolved 0, uncited 0, no-cmd-match 0, no-receipt 0이다.

## 설계 대비 사소한 차이 (고치지 않음)

- `recordClick`의 단계 주석 번호가 1), 4), 5)로 건너뛴다.
- DESIGN 4-1에 적은 schema 주석 두 줄이 코드에 없다.
- 일부 파일에서 새 import가 기존 import보다 위에 있다.

## 남은 한계 (범위 밖, 설계에 명시됨)

- B8~B11, B15, B25는 회귀 테스트가 아니라 일회성 스크립트로 검증했다. 스크립트는 `evidence/`에 남겼다.
- 깊이 알림은 여전히 2분 규칙으로 판정한다. 그래서 "사람 클릭" 기준이 두 가지 공존한다.
- B13은 문자열 대조만 한다. 비ASCII 공백(NBSP 등)에서는 JS와 SQL의 판정이 갈릴 수 있다.
