# Gap Analysis: email-read-tracking

## Match Rate: 100%

## Design vs Implementation Comparison

| # | Design Item | Status | File |
|---|------------|--------|------|
| 1 | `isOpened: integer("is_opened").default(0).notNull()` | MATCH | schema.ts:524 |
| 2 | `openedAt: timestamptz("opened_at")` | MATCH | schema.ts:525 |
| 3 | Migration: `is_opened` column | MATCH | 0023_email_read_tracking.sql |
| 4 | Migration: `opened_at` column | MATCH | 0023_email_read_tracking.sql |
| 5 | Journal entry idx 23 | MATCH | _journal.json |
| 6 | `NhnEmailQueryResult.isOpened?: boolean` | MATCH | nhn-email.ts:44 |
| 7 | `NhnEmailQueryResult.openedDate?: string` | MATCH | nhn-email.ts:45 |
| 8 | Sync Stage 1: pending logs (status=pending, limit 100) | MATCH | sync/route.ts |
| 9 | Sync Stage 1: isOpened/openedAt in .set() | MATCH | sync/route.ts:58-65 |
| 10 | Sync Stage 2: unread sent (status=sent, isOpened=0, 7d) | MATCH | sync/route.ts:76-90 |
| 11 | Sync Stage 2: isOpened/openedAt only update | MATCH | sync/route.ts:111-114 |
| 12 | Sync: readUpdated counter | MATCH | sync/route.ts |
| 13 | Sync response: { synced, updated, readUpdated } | MATCH | sync/route.ts:124-127 |
| 14 | EmailSendLogTable: "읽음" header | MATCH | EmailSendLogTable.tsx:126 |
| 15 | EmailSendLogTable: read badge (green/outline/null) | MATCH | EmailSendLogTable.tsx:149-157 |
| 16 | EmailSendLogTable: Sheet detail read info | MATCH | EmailSendLogTable.tsx:232-241 |
| 17 | EmailSendLogTable: sync toast with readUpdated | MATCH | EmailSendLogTable.tsx:64 |
| 18 | Unified API: email isOpened/openedAt columns | MATCH | unified/route.ts:33 |
| 19 | Unified API: alimtalk 0/NULL defaults | MATCH | unified/route.ts:34 |
| 20 | UnifiedLog.isOpened: number | MATCH | types/index.ts:371 |
| 21 | UnifiedLog.openedAt: string | null | MATCH | types/index.ts:372 |
| 22 | UnifiedLogTable: "읽음" header | MATCH | UnifiedLogTable.tsx:168 |
| 23 | UnifiedLogTable: read badge (email+sent) | MATCH | UnifiedLogTable.tsx:198-205 |
| 24 | EmailSendLog type auto-inferred | MATCH | schema.ts:903 |
| 25 | "읽음" visible in compact mode | MATCH | UnifiedLogTable.tsx:168 |

## Gaps Found

None.

## Summary

25개 설계 항목 모두 구현과 정확히 일치. 9개 파일 전체 검증 완료.
Match Rate **100%** — 추가 조치 불필요.
