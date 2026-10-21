# REPORT — 발송 기록 정확 주소 검색 + 수신자 색인

- 사이클: `2026-10-21-send-log-search` · track Quick · 2026-10-21
- 결과: behaviors 7/7 통과, GAP unproven 0, REVIEW 🔴0

## 한 일
- 검색어가 이메일 주소 전체면 `lower(recipient_email) = lower(trim(검색어))`로 정확 검색한다. 제목 ILIKE는 쓰지 않고, 통합 이력은 알림톡을 건너뛴다. 그 밖의 검색어는 기존 부분 검색 그대로다.
  - `src/lib/send-log-search.ts`(`isExactEmailSearch`), `src/app/api/email/logs/route.ts`, `src/app/api/logs/unified/route.ts`
- `(org_id, lower(recipient_email))` 색인을 기존 부팅 뒤 CONCURRENTLY 경로(`src/lib/db/send-log-indexes.ts`)에 더했다. 마이그레이션·journal은 바뀌지 않는다. schema.ts에 선언.
- 검색창 안내: "수신자/제목 또는 이메일 주소 전체", "수신자 이메일 주소 전체 또는 제목".

## 숫자 (로컬, 30만 행·391MB)
- 정확 주소: Index Scan 0.25~0.48ms, 읽은 블록 3~6
- 옛 부분 검색(같은 주소): Parallel Seq Scan 183ms, 블록 약 5만
- API: 첫 호출 0.78s(컴파일 포함), 이후 0.01~0.03s

## 설계 변경
- 처음 PLAN은 마이그레이션 0121 + 운영에 손으로 CONCURRENTLY 생성이었다. 구현 리뷰 중 저장소에 이미 `send-log-indexes.ts`(부팅 뒤 CONCURRENTLY·advisory 잠금) 패턴이 있는 것을 보고 그쪽으로 바꿨다. 운영 DB 수동 쓰기가 필요 없어졌다.

## 남은 것
- 배포 직후 색인이 만들어지는 몇 분(로컬 54초, 운영은 더 길 수 있음)은 예전처럼 느리다.
- 운영 배포 뒤: 로그 `[indexes] … 색인 준비됨`과 읽기 전용 EXPLAIN(목록 쿼리 LIMIT 포함)으로 확인.
- 저장된 주소에 앞뒤 공백이 있는 행은 정확 검색에서 빠진다(운영 미확인).
- 도메인 검색(`@inzent.com`)·회사명·제목 부분 검색은 여전히 느리다(범위 밖, 필요하면 trigram).
- 전체 테스트의 channel-source-export 시간 제한 테스트가 가끔 실패한다(무관, 별건).

## 배운 것
- 큰 표 색인은 이 저장소에서 마이그레이션이 아니라 `send-log-indexes.ts`로 만든다. PLAN 단계에서 schema.ts 색인 주석을 먼저 봤으면 처음부터 맞췄다.
- `next dev`를 띄워 둔 채 tsc를 돌리면 `.next/dev/types`가 섞여 실패한다. 서버를 끄고 돌린다.
