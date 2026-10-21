# REVIEW — docs/2026-10-16-template-link-sender/ · 2026-10-20 (1회차)

범위: `git show bf23964 0931152` (DB 0088, 템플릿 연결 API, sendEmailSingle pool 전환, markLinkBlocked, 템플릿 후속, 연결 화면 카드·요약·훅, SenderPoolField 검색)
판정: 🔴 0 · 🟡 2 · 🟢 4 · 확인 필요 3

이상 없음으로 확인한 것: 조직 격리(저장 resolveRuleSenderPool 400 + 발송 pickSenderCandidates + markLinkBlocked의 orgId·templateLinkId 조건), 입력 검증(normalizeSenderPool), 한국어 에러, PUT 부분 갱신(묶음 칸 없으면 유지), 막힘 범위가 예전 범위의 부분집합.

## 🟡 정확성·운영 (2)

1. **자동 멈춤 예외·알림 대상이 아직 "조직 기본 주소"·AI 규칙만 본다** — `src/lib/sender-health-rules.ts:1109, :1181`, `src/lib/sender-health.ts:944-963`(rulePoolsFor), `src/lib/partition-hold.ts:339-345`(senderWorkspaceIds). 연결 묶음의 주소가 전부 자동 멈추면 그 연결의 문의 첫 메일이 기본 주소로 넘어가지 않고 `paused`로 1시간마다 미뤄지기를 반복하며, 알림도 템플릿 연결 쪽 사업 스페이스로 가지 않는다. DESIGN에서 범위 밖으로 둔 항목이지만 문의 메일이 조용히 멈출 수 있는 경로라 남은 결함으로 올린다.
2. **검색 중에도 고른 줄은 전부 보인다** — `src/components/email/sender-profiles/ui/SenderPoolField.tsx:136-163`. 많이 골라 둔 상태에서 검색하면 결과가 고른 줄 밑(스크롤 아래)으로 밀리고, 고른 주소를 찾아 풀 때 목록이 줄지 않는다. 검색 중에는 고른 줄도 검색 결과로 거르는 편이 맞다.

## 🟢 nit (4)

- `src/lib/email-automation.ts:102`, `:483-484` 주석이 "기본 발신 주소/조직" 기준으로 남아 있다.
- `src/lib/sender-health-rules.ts:1256`, `SenderLimitSection.tsx:244` "멈추면 이 조직의 템플릿 메일이 모두 멈춥니다" 문구가 반만 맞다.
- 두 page.tsx에 `scrollIntoView` 인라인 핸들러 추가(기존 패턴), `useSenderPoolSearch.ts:22`의 `> 8` 매직 넘버.

## 확인 필요

- 수동으로 바꾼 연결의 숨은 묶음: 바꾸기 전에 쌓인 first·first_bulk 대기 줄과 원본 주소가 지워진 후속은 저장된 묶음으로 나가지만 요약은 "발송 창에서 선택"으로 보인다.
- 권한: 템플릿 연결 POST·PUT에 member 403 체크가 없다(원래 없었고 AI 규칙 라우트도 같음). 이번 변경으로 발신 주소까지 정하게 됐다.
- 회차당 claimSender 호출이 연결 수만큼 늘어 미뤄진 시각이 더 퍼질 수 있다 — 운영 로그로 확인할 만함.
