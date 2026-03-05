# Design: 이메일 읽음 확인 (Email Read Tracking)

## 참조
- Plan: `docs/01-plan/features/email-read-tracking.plan.md`

## 1. DB 스키마 변경

### `emailSendLogs` 테이블 컬럼 추가 (`schema.ts:523` 뒤)

```typescript
isOpened: integer("is_opened").default(0).notNull(),  // 0=미확인, 1=읽음
openedAt: timestamptz("opened_at"),
```

### 마이그레이션 `drizzle/0023_email_read_tracking.sql`

```sql
ALTER TABLE "email_send_logs" ADD COLUMN "is_opened" integer DEFAULT 0 NOT NULL;
ALTER TABLE "email_send_logs" ADD COLUMN "opened_at" timestamp with time zone;
```

### `drizzle/meta/_journal.json` 엔트리 추가

```json
{ "idx": 23, "version": "7", "when": 1770948600000, "tag": "0023_email_read_tracking", "breakpoints": true }
```

## 2. NHN 타입 확장

### `src/lib/nhn-email.ts` — `NhnEmailQueryResult` 인터페이스

기존 필드에 추가:
```typescript
isOpened?: boolean;      // 읽음 여부
openedDate?: string;     // 읽은 일시 "2019-01-01 00:00:00"
```

## 3. Sync API 확장

### `src/app/api/email/logs/sync/route.ts`

**기존 동작**: `status = "pending"` 로그 100건 → requestId별 NHN 조회 → status 업데이트

**변경 동작**: 2단계로 분리

#### 단계 1: Pending 상태 동기화 (기존)
- 기존 로직 유지
- `isOpened`/`openedAt` 추가 업데이트:
  ```typescript
  .set({
      status: newStatus,
      resultCode: mail.resultCode,
      resultMessage: mail.resultCodeName,
      completedAt: mail.resultDate ? new Date(mail.resultDate) : new Date(),
      // 추가
      isOpened: mail.isOpened ? 1 : 0,
      openedAt: mail.openedDate ? new Date(mail.openedDate) : null,
  })
  ```

#### 단계 2: Sent 읽음 동기화 (신규)
- 대상: `status = "sent"` AND `is_opened = 0` AND `sent_at >= 7일 전` 로그 (최대 100건)
- requestId별 NHN 조회 → `isOpened`/`openedAt`만 업데이트
- `readUpdated` 카운터 별도 집계

**응답 변경**:
```json
{
  "success": true,
  "data": { "synced": 100, "updated": 45, "readUpdated": 12 }
}
```

**toast 메시지 변경** (EmailSendLogTable.tsx):
```
동기화 완료: 45건 상태 업데이트, 12건 읽음 확인
```

## 4. EmailSendLogTable UI 변경

### `src/components/email/EmailSendLogTable.tsx`

#### 테이블 헤더 추가
`발송일` 앞에 `읽음` 컬럼 추가

#### 테이블 바디
```tsx
<TableCell>
    {log.status === "sent" && log.isOpened ? (
        <Badge variant="default" className="bg-green-600">읽음</Badge>
    ) : log.status === "sent" ? (
        <Badge variant="outline">안읽음</Badge>
    ) : null}
</TableCell>
```
- `sent` 상태일 때만 읽음/안읽음 표시
- pending/failed/rejected에는 표시하지 않음

#### Sheet 상세 정보 추가
`방식` 행 아래에:
```tsx
{selectedLog.status === "sent" && (
    <div className="grid grid-cols-3 gap-2 py-2 border-b">
        <span className="text-sm text-muted-foreground">읽음</span>
        <span className="col-span-2 text-sm">
            {selectedLog.isOpened
                ? formatDateFull(selectedLog.openedAt)
                : "안읽음"}
        </span>
    </div>
)}
```

#### sync 결과 toast
```typescript
toast.success(`동기화 완료: ${result.data.updated}건 상태 업데이트${result.data.readUpdated ? `, ${result.data.readUpdated}건 읽음 확인` : ""}`);
```

## 5. 통합 로그 API 변경

### `src/app/api/logs/unified/route.ts`

email 서브쿼리 SELECT에 추가:
```sql
is_opened as "isOpened", opened_at as "openedAt"
```

alimtalk 서브쿼리에는 기본값:
```sql
0 as "isOpened", NULL::timestamptz as "openedAt"
```

## 6. UnifiedLog 타입 변경

### `src/types/index.ts`

```typescript
export interface UnifiedLog {
    // ... 기존 필드
    completedAt: string | null;
    isOpened: number;        // 추가
    openedAt: string | null; // 추가
}
```

## 7. UnifiedLogTable UI 변경

### `src/components/logs/UnifiedLogTable.tsx`

#### 테이블 헤더
`상태` 뒤에 `읽음` 컬럼 추가 (compact 모드에서도 표시)

#### 테이블 바디
```tsx
<TableCell>
    {log.channel === "email" && log.status === "sent" ? (
        log.isOpened ? (
            <Badge variant="default" className="bg-green-600 text-xs">읽음</Badge>
        ) : (
            <Badge variant="outline" className="text-xs">안읽음</Badge>
        )
    ) : null}
</TableCell>
```
- 이메일 채널 + sent 상태일 때만 표시
- 알림톡은 읽음 추적 불가하므로 빈 셀

## 8. EmailSendLog 타입

### `src/lib/db` (infer type)

Drizzle의 `InferSelectModel<typeof emailSendLogs>`로 자동 추론됨.
`isOpened: number`, `openedAt: Date | null` 필드가 자동으로 포함.

## 구현 순서

| # | 작업 | 파일 |
|---|------|------|
| 1 | DB 스키마 + 마이그레이션 | `schema.ts`, `0023_email_read_tracking.sql`, `_journal.json` |
| 2 | NHN 타입 확장 | `nhn-email.ts` |
| 3 | Sync API 확장 | `sync/route.ts` |
| 4 | EmailSendLogTable UI | `EmailSendLogTable.tsx` |
| 5 | 통합 로그 API + 타입 | `unified/route.ts`, `types/index.ts` |
| 6 | UnifiedLogTable UI | `UnifiedLogTable.tsx` |
| 7 | 빌드 검증 | `npx next build` |
