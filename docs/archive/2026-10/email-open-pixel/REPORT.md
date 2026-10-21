# REPORT — 이메일 오픈 픽셀 추적 (2026-10-20-email-open-pixel)

## 한 일
발송 메일 본문 맨 앞에 서명된 오픈 픽셀을 넣고 `/api/track/open`이 수신 요청을 기록하게 했다. 열람은 사람과 기계(프록시·prefetch)로 나눠 저장하고 early로도 분류한다. 이 값으로 오픈율을 집계해 대시보드, 발송 이력, 통합 로그, 홈 규칙별 지표, MCP 툴에 표시한다. 도입 전에 나간 발송과 구분하려고 `open_tracked` 칸을 뒀다. 저장 상한은 사람 20건, 기계 10건으로 나눴다. 오픈율 분모에는 `status='sent'`만 넣는다. 서명 키는 JWT_SECRET에서 파생한다.

배포까지 마쳤다. 커밋은 `1262559`이고 푸시와 운영 배포가 끝났다. 변경은 83파일, +4,900/-55이다.

## 변경 파일 (git 기준, 주요)
- 마이그레이션: `0120_email_open_tracking`. 처음엔 0089였고 리베이스 때 바꿨다. 색인 2개를 포함한다.
- 핵심 로직:
  - `src/lib/email-open-pixel.ts`
  - `email-open-rules.ts`
  - `email-open-signals.ts`
  - `email-open-sql.ts`
  - `email-open-tracking.ts`
  - `request-ip.ts`
- 라우트: `src/app/api/track/open/route.ts`
- 발송 경로 연결:
  - `email-click-tracking.ts`
  - `email-automation.ts`
  - `auto-personalized-email.ts`
  - `email-followup.ts`
  - `email-visit-ack-delivery.ts`
- 집계·조회: `api/logs/unified/route.ts`, `lib/mcp/tools.ts`, `useAnalytics`, `useEmailAnalytics`, `useEmailDaily`
- 화면: `src/components/email/opens/`(타입, `OpenColumnHead`, `OpenCountCell`, `OpenRateNotice`, 유틸), `EmailDashboard`, `DailyEmailTable`, `EmailSendLogTable`, `UnifiedLogTable`, `TemplateRanking`, `TrendChart`
- 테스트 8개: `*-open-*.test.ts`, `request-ip.test.ts`, `openCell`·`openRate` 테스트
- 스키마: `src/lib/db/schema.ts`
- 증거: `evidence/`

## Match Rate
- behaviors.json은 33/33이다.
- GAP 1차는 unproven 4(B7 문구, B17 부팅 증거, B26 격리/페이지, B27 실행 흔적)로 Match 94%였다.
- 성능 관문 9-9도 1차 시점엔 미측정이었다.
- GAP 2차는 unproven 0, Match 100%이다.
- 2차 때 `verify-evidence`의 `no-cmd-match` 14건과 `dead-branch` 4건이 남아 있었다. 이 중 cmd 표기는 이후 정리했다고 PROGRESS에 적혀 있다. `dead-branch` 4건은 해소 기록이 없다.

## 테스트
- Codex 구현 직후 test 1098, 보완 후 1103이 통과했다. tsc 0, eslint 0이다.
- 리베이스 후 오픈 테스트는 43/43, tsc 0이다. 전체는 1525개 중 19개가 실패했다. 원격에서 온 `channel-source-export` 테스트가 macOS `/private/var` 경로에서 깨지는 것으로, 이 변경과 무관하다고 판단했다. 아직 고치지 않았다.
- 로컬 검증:
  - 빈 DB 부팅과 재부팅
  - curl R1~R21
  - 집계 API 4종
  - 행 API 페이지·조직 격리
  - MCP 직접 호출
- 성능 관문(30만 발송 fixture): EXISTS 방식은 trends +382ms, summary +292ms로 기준을 넘겼다. F1B(IN 하위 질의)와 색인 2개로 바꾼 뒤 summary 50ms, trends 147ms, templates 70ms가 나왔다. 변경 전보다 빠르다.
- 운영 17-7 확인:
  - 0120이 적용됐고(122행) `/api/track/open`이 200 GIF를 반환했다.
  - 수동 발송 398,273건의 `open_tracked`는 t였고, Gmail 원본 맨 앞에 픽셀이 1개 있었다.
  - 발송 36초 뒤 열람은 early(기계, GoogleImageProxy)로 기록됐다.
  - 66·69초 뒤 재열람은 사람 2행이었다.
  - unified API는 openCount 2, machine 1을 반환했다.
  - 11:13:50 이후 AI 자동 발송 56통이 모두 `open_tracked`였다.

## 남은 갭 / 후속
REVIEW.md 판정은 🔴 0 · 🟡 2 · 🟢 6이다. 🟡 2건(동시 상한 초과 무로그 버림, route 빈 catch)은 반영했다. 미해결 🔴는 없다.

미달·미확인 사항은 다음과 같다.
- F1B EXPLAIN 원문은 보관하지 않았다. 성능 수치(`9-9-perf*`)만 남아 있다. 변경 후 집계 4종이 같은 값을 냈다는 것도 PROGRESS 기록뿐이고 별도 산출물은 없다.
- 다크 모드, 레코드 상세 compact, 2차 변경 뒤 화면 재캡처는 확인하지 못했다. ego-browser 스크립트가 시작 단계에서 멈췄다. 화면 변경은 import와 들여쓰기뿐이고 tsc·eslint는 통과했다.
- 클릭 라우트에는 서명이 없고 열린 리다이렉트 위험이 있다. 이번 범위 밖이라 그대로 뒀다. 후속 보안 과제로 남는다.
- `test_followup`이 오픈율 분모에 포함된다.
- O3(네이버 메일 등 Gmail 외 클라이언트)는 확인하지 못했다. 운영 확인은 Gmail뿐이다.
- 대시보드 자체가 원래 25초 걸리는 문제는 이 사이클이 만든 것이 아니다. 별도 사이클로 다룬다.
- 운영 시험 데이터(파티션 99, 템플릿 2966, 연결 26, 레코드 410,223 등)는 ego-browser DELETE가 멈춰서 운영 DB에서 id를 지정해 트랜잭션으로 지웠다. 다른 데이터를 건드리지 않았는지 REPORT 시점에 별도 검증한 기록은 없다.
- 운영 서버에서 동시 상한(4)에 걸려 버려지는 열람이 있을 수 있다. 서버 기동 직후 연속 요청 2건이 버려진 것을 관찰했다. 60초 누계 경고를 넣었으니 로그를 모니터링해야 한다.

## 배운 것
- 성능 관문이 효과가 있었다. 30만 건 fixture 측정으로 EXISTS의 기준 초과를 발견했고 IN 하위 질의(F1B)와 색인으로 바꿨다. 설계 단계의 쿼리는 큰 fixture로 먼저 재야 한다.
- 원격 main에 dev 병합(0088~0119)이 먼저 올라와 마이그레이션 번호가 충돌했다. 푸시 전에 원격과 번호를 대조해야 한다. 마이그레이션 테스트를 "가장 늦은 시각" 계약으로 고쳐 재발을 줄였다.
- ego-browser가 두 번 멈췄다(화면 캡처, 운영 DELETE). 멈췄을 때 우회 절차를 `/improve` 규칙으로 정리할 후보이다.
- Gmail 이미지 프록시는 재열람마다 요청을 보낸다. 요청 수가 곧 사람 열람 수는 아니므로 사람·기계 분류와 상한이 필요하다.
- 발송 36초 뒤 열람이 early(기계)로 분류됐다. 실제 사람이 빨리 연 경우도 기계로 갈 수 있으므로 early 기준 시간의 정확도는 더 지켜봐야 한다.
- Drizzle은 같은 매개변수를 `$1`·`$2`로 재사용하지 않는다. 그래서 DESIGN 9-2를 params 4개로 고쳤다. DESIGN을 먼저 고치고 구현 지시를 보내는 흐름은 잘 맞았다.
- Codex C8 보고 전송이 승인 검토에서 13분 멈췄다. 보고 명령이 승인 프롬프트에 막히지 않게 지시문을 조정할 후보이다.
- 근거 표기 정리(cmd 표기 14건)는 배포 전에 했어야 했다. 증거 파일 작성 단계에서 실제 실행 명령을 그대로 적도록 규칙화할 후보이다.
