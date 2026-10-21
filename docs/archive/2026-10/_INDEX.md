# Archive Index - 2026-10

| Feature | Behaviors | Archived | Documents |
|---------|:---------:|----------|-----------|
| email-click-bot-filter | 28/28 | 2026-10-13 | [Plan](email-click-bot-filter/PLAN.md), [Design](email-click-bot-filter/DESIGN.md), [Gap](email-click-bot-filter/GAP.md), [Review](email-click-bot-filter/REVIEW.md), [Report](email-click-bot-filter/REPORT.md), [Progress](email-click-bot-filter/PROGRESS.md) |
| email-open-pixel | 33/33 | 2026-10-21 | [Plan](email-open-pixel/PLAN.md), [Design](email-open-pixel/DESIGN.md), [Gap](email-open-pixel/GAP.md), [Review](email-open-pixel/REVIEW.md), [Report](email-open-pixel/REPORT.md), [Progress](email-open-pixel/PROGRESS.md) |

## 비고

**email-click-bot-filter** — 메일 보안 검사기 클릭을 R6 규칙(발송 15초 안, 10초 안 연속 클릭, 봇 UA)으로 봇 판정하고 사람 클릭만 집계한다. 커밋 6cdb0ac, 운영 배포 2026-10-13.

**email-open-pixel** — 메일 본문 맨 앞에 서명된 1x1 픽셀을 넣어 우리 서버가 오픈을 직접 기록한다. 발송 60초 안·검사기 UA는 기계 오픈으로 빼고, 오픈율 = (사람 오픈 ∪ 사람 클릭) / 픽셀 넣은 발송. NHN isOpened는 쓰지 않는다. 마이그레이션 0120, 커밋 1262559, 운영 배포 2026-10-21(Gmail 실수신 확인).

**send-log-search** — 발송 기록 검색어가 이메일 주소 전체면 lower(recipient_email) 정확 일치로 찾고, (org_id, lower(recipient_email)) 색인을 부팅 뒤 CONCURRENTLY 경로(send-log-indexes.ts)로 만든다. 로컬 30만 행 기준 183ms→0.25ms. 마이그레이션 없음.
