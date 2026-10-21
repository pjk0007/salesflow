# 17-1 0089 로컬 확인 (2026-10-21, Claude)

로컬 DB(PostgreSQL 17.7, email_send_logs 213,221행)에서 `BEGIN; \i drizzle/0089_email_open_tracking.sql; … ROLLBACK;`

- filenode 전 1066899 → 후 1066899 (표 재작성 없음)
- pg_attribute open_tracked: atthasmissing=t, attmissingval={f} (메타데이터만 변경)
- open_tracked=true 0 / 213221
- email_open_logs: 칸 8개, PK, 색인 (send_log_id, is_machine), FK send_log_id → email_send_logs(id) ON DELETE CASCADE
- ROLLBACK으로 되돌림. 서버 부팅 경로(migrate.ts) 확인은 다음 단계에서 한다.

## 빈 DB 서버 부팅 (2026-10-21 2차, 0089에 색인 2개 추가 뒤)
```
[migrate] 마이그레이션 시작...
[migrate] 새 DB 감지, 전체 마이그레이션 실행
[migrate] 마이그레이션 완료!
 rows_1775200000000 
--------------------
                  1
(1 row)

              indexname               
--------------------------------------
 email_click_logs_org_clicked_idx
 email_open_logs_org_opened_idx
 email_open_logs_send_log_machine_idx
(3 rows)

```

## 재부팅 (같은 DB)
```
[migrate] 마이그레이션 시작...
[migrate] 마이그레이션 완료!
 rows_1775200000000=1

```
