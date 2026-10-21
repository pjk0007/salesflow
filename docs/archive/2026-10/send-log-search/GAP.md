# GAP — docs/2026-10-21-send-log-search/

- 2026-10-21 · 판정: **unproven 0** (2차) · Match Rate 100% (참고)

## 1차 (gap-detector) — unproven 1
- S2의 "부팅 뒤 valid" 주장에 파일 증거가 없었다(behaviors.json에만 적힘).
- evidence ref가 사이클 기준 상대경로라 unresolved 6, S1 인용 요약문(uncited), S2·S7 cmd가 서술형(no-cmd-match).
- 코드 쪽 gap 없음. 설계 밖 구현 없음. target 줄번호 모두 일치.

## 보완
- `evidence/boot-index.txt`: 빈 DB 부팅 로그 `[indexes] email_send_logs 색인 준비됨 (53.7초, 새로 2개)`와 `pg_index`(email_send_logs_org_recipient_lower_idx indisvalid=t), 표 30만 행·391MB.
- ref를 저장소 기준 전체 경로로, cmd를 실제 실행 명령 하나로, output을 러너 출력 줄 그대로로 고쳤다.
- 리뷰 반영(placeholder 축약, 테스트 경로를 import.meta.url 기준) 뒤 S1·S2·S7을 다시 돌렸다.

## 2차 — verify-evidence
- unresolved 0 · uncited 0 · no-cmd-match 0 · no-receipt 0 · dead-branch 0 · lineDrift 0

| behavior | 판정 | 근거 |
|---|---|---|
| S1 | ✅ | send-log-search.test.ts, `ℹ pass 4` |
| S2 | ✅ | send-log-indexes.test.ts + evidence/boot-index.txt |
| S3 | ✅ | evidence/api.txt — 대소문자·공백 무관 총 2, 다른 주소·제목 일치 제외 |
| S4 | ✅ | evidence/api.txt — 정확 검색 이메일만, alimtalk 0, 부분 검색 기존대로 6 |
| S5 | ✅ | evidence/explain.txt — Index Scan 0.25~0.48ms·블록 3~6 vs 옛 ILIKE 183ms·블록 5만; 통계 없는 상태도 새 색인 사용(explain-nostats.txt) |
| S6 | ✅ | evidence/api.txt — 조직 B는 B1만 |
| S7 | ✅ | tsc 0, eslint 0, 전체 테스트 1529 중 실패 1(무관 시간 제한, 단독 pass 12) |

## 남은 확인
- 운영: 배포 뒤 색인 생성 로그와 읽기 전용 EXPLAIN(목록 쿼리 LIMIT 포함)으로 S5 재확인.
- 저장된 주소에 앞뒤 공백이 있는 행은 정확 검색에서 빠진다(운영 미확인, PLAN 리스크).
