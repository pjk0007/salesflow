# Design: record-manual-send — 레코드 상세 수동 발송 UI

> **Plan 문서**: [record-manual-send.plan.md](../../01-plan/features/record-manual-send.plan.md)

## 1. 개요

레코드 행 클릭 → 상세 다이얼로그 → 알림톡/이메일 개별 발송 기능.
새 API 없음. 기존 send API + 훅 100% 재활용.

## 2. 구현 순서

```
1. SendEmailDialog.tsx (신규) — 이메일 발송 다이얼로그
2. RecordDetailDialog.tsx (신규) — 레코드 상세 다이얼로그
3. RecordTable.tsx (수정) — 행 클릭 콜백 추가
4. RecordToolbar.tsx (수정) — 이메일 발송 버튼 추가
5. records.tsx (수정) — 다이얼로그 상태 관리 통합
```

## 3. 컴포넌트 설계

### 3.1 SendEmailDialog (신규)

**파일**: `src/components/records/SendEmailDialog.tsx`

**Props**:
```typescript
interface SendEmailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    recordIds: number[];
}
```

**내부 상태**:
```typescript
const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
const [loading, setLoading] = useState(false);
const [result, setResult] = useState<EmailSendResult | null>(null);
```

**타입** (컴포넌트 내부 정의):
```typescript
interface EmailSendResult {
    totalCount: number;
    successCount: number;
    failCount: number;
}
```

**사용 훅**:
- `useEmailTemplateLinks(partitionId)` — 활성 이메일 템플릿 링크 목록
- `useEmailSend()` — `sendEmail({ templateLinkId, recordIds })`

**UI 구조** (SendAlimtalkDialog 패턴 동일):
```
Dialog
├── DialogHeader: "이메일 발송" / "{N}건의 레코드에 이메일을 발송합니다."
├── [결과 화면] (result !== null 일 때)
│   ├── CheckCircle2 아이콘
│   ├── 성공 N건 / 실패 N건
│   └── 닫기 버튼
└── [발송 화면] (result === null 일 때)
    ├── 템플릿 선택 Select
    │   ├── placeholder: "발송할 템플릿 선택"
    │   └── activeLinks.map → SelectItem: "{link.name}"
    ├── 선택된 템플릿 정보 박스 (bg-muted rounded-lg)
    │   ├── 수신이메일 필드: {link.recipientField}
    │   └── 변수 매핑: Badge[] (link.variableMappings keys)
    ├── 경고 박스 (bg-yellow-50)
    │   └── "이메일 주소가 없거나 형식이 맞지 않는 레코드는 자동으로 제외됩니다."
    └── 발송 버튼: "{N}건 발송" (disabled: loading || !selectedLinkId)
```

**발송 로직**:
```typescript
const handleSend = async () => {
    if (!selectedLinkId) { toast.error("템플릿을 선택해주세요."); return; }
    setLoading(true);
    const sendResult = await sendEmail({ templateLinkId: selectedLinkId, recordIds });
    setLoading(false);
    if (sendResult.success) {
        setResult(sendResult.data);
        toast.success(`발송 완료: 성공 ${sendResult.data.successCount}건, 실패 ${sendResult.data.failCount}건`);
    } else {
        toast.error(sendResult.error || "발송에 실패했습니다.");
    }
};
```

**닫기 로직**:
```typescript
const handleClose = () => {
    setSelectedLinkId(null);
    setResult(null);
    onOpenChange(false);
};
```

**아이콘**: `Loader2`, `Send`, `CheckCircle2`, `XCircle` from lucide-react
**UI 라이브러리**: Dialog, Select, Button, Badge from shadcn/ui

---

### 3.2 RecordDetailDialog (신규)

**파일**: `src/components/records/RecordDetailDialog.tsx`

**Props**:
```typescript
interface RecordDetailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    record: DbRecord | null;
    fields: FieldDefinition[];
    partitionId: number;
}
```

**import 타입**:
```typescript
import type { DbRecord } from "@/lib/db";
import type { FieldDefinition } from "@/types";
```

**내부 상태**:
```typescript
const [alimtalkOpen, setAlimtalkOpen] = useState(false);
const [emailOpen, setEmailOpen] = useState(false);
```

**UI 구조**:
```
Sheet (side="right", className="sm:max-w-lg")
├── SheetHeader
│   ├── SheetTitle: "{record.integratedCode}"
│   └── SheetDescription: "레코드 상세 정보"
├── SheetContent 본문 (overflow-y-auto)
│   ├── 메타 정보 섹션
│   │   ├── "등록일": {record.registeredAt} toLocaleString("ko-KR")
│   │   └── "수정일": {record.updatedAt} toLocaleString("ko-KR")
│   └── 필드 목록 섹션
│       └── fields.map → 각 필드:
│           ├── label (text-sm text-muted-foreground)
│           └── value (text-sm font-medium) — CellRenderer 활용
└── SheetFooter (하단 고정)
    ├── Button "알림톡 발송" (variant="outline", icon=MessageSquare)
    └── Button "이메일 발송" (variant="outline", icon=Mail)

SendAlimtalkDialog (open=alimtalkOpen, recordIds=[record.id], partitionId)
SendEmailDialog (open=emailOpen, recordIds=[record.id], partitionId)
```

**Sheet 사용 이유**: Dialog 대신 Sheet(side panel)를 사용하면 레코드 목록을 가리지 않고 상세를 볼 수 있음. Shadcn Sheet 컴포넌트 사용.

**필드 값 렌더링**:
```typescript
import CellRenderer from "./CellRenderer";

// 각 필드 값 표시
{fields.map((field) => {
    const data = record.data as Record<string, unknown>;
    return (
        <div key={field.key} className="grid grid-cols-3 gap-2 py-2 border-b last:border-0">
            <span className="text-sm text-muted-foreground">{field.label}</span>
            <span className="col-span-2 text-sm">
                <CellRenderer field={field} value={data[field.key]} />
            </span>
        </div>
    );
})}
```

**발송 다이얼로그 연계**:
- "알림톡 발송" 클릭 → `setAlimtalkOpen(true)`
- "이메일 발송" 클릭 → `setEmailOpen(true)`
- 기존 `SendAlimtalkDialog`에 `recordIds={[record.id]}` 전달
- 새 `SendEmailDialog`에 `recordIds={[record.id]}` 전달

---

### 3.3 RecordTable.tsx (수정)

**변경 내용**: `onRecordClick` 콜백 prop 추가

**Props 추가**:
```typescript
interface RecordTableProps {
    // ... 기존 props 유지
    onRecordClick?: (record: DbRecord) => void;  // 추가
}
```

**행 클릭 처리**:
통합코드 셀에 클릭 핸들러 추가 (인라인 편집과 충돌 방지를 위해 통합코드 셀만 클릭 가능):

```typescript
<TableCell
    className="font-mono text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
    onClick={() => onRecordClick?.(record)}
>
    {record.integratedCode}
</TableCell>
```

**변경 범위**:
- `RecordTableProps`에 `onRecordClick` 추가
- 컴포넌트 매개변수에 `onRecordClick` 추가
- 통합코드 `<TableCell>`에 onClick + cursor-pointer + hover 스타일

---

### 3.4 RecordToolbar.tsx (수정)

**변경 내용**: 이메일 발송 버튼 추가

**Props 추가**:
```typescript
interface RecordToolbarProps {
    // ... 기존 props 유지
    onEmailSend?: () => void;  // 추가
}
```

**UI 추가** (알림톡 발송 버튼 아래에):
```tsx
{onEmailSend && (
    <Button
        variant="outline"
        size="sm"
        onClick={onEmailSend}
        className="gap-1.5"
    >
        <Mail className="h-4 w-4" />
        이메일 발송
    </Button>
)}
```

**import 추가**: `Mail` from lucide-react

**변경 범위**:
- `RecordToolbarProps`에 `onEmailSend` 추가
- 컴포넌트 매개변수에 `onEmailSend` 추가
- 선택 액션 영역에 이메일 발송 버튼 (알림톡 버튼 바로 아래)
- `Mail` 아이콘 import 추가

---

### 3.5 records.tsx (수정)

**변경 내용**: RecordDetailDialog + SendEmailDialog 상태 관리

**import 추가**:
```typescript
import RecordDetailDialog from "@/components/records/RecordDetailDialog";
import SendEmailDialog from "@/components/records/SendEmailDialog";
import type { DbRecord } from "@/lib/db";
```

**상태 추가**:
```typescript
const [detailRecord, setDetailRecord] = useState<DbRecord | null>(null);
const [emailDialogOpen, setEmailDialogOpen] = useState(false);
```

**핸들러 추가**:
```typescript
const handleRecordClick = useCallback((record: DbRecord) => {
    setDetailRecord(record);
}, []);
```

**RecordToolbar 수정**:
```tsx
<RecordToolbar
    // ... 기존 props
    onEmailSend={() => setEmailDialogOpen(true)}  // 추가
/>
```

**RecordTable 수정**:
```tsx
<RecordTable
    // ... 기존 props
    onRecordClick={handleRecordClick}  // 추가
/>
```

**다이얼로그 추가** (기존 SendAlimtalkDialog 아래):
```tsx
{partitionId && (
    <SendEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        partitionId={partitionId}
        recordIds={Array.from(selectedIds)}
    />
)}
<RecordDetailDialog
    open={detailRecord !== null}
    onOpenChange={(open) => { if (!open) setDetailRecord(null); }}
    record={detailRecord}
    fields={fields}
    partitionId={partitionId!}
/>
```

## 4. 변경 파일 요약

| # | 파일 | 변경 | 주요 내용 |
|---|------|------|-----------|
| 1 | `src/components/records/SendEmailDialog.tsx` | 신규 ~130줄 | SendAlimtalkDialog 패턴 복제, useEmailSend + useEmailTemplateLinks |
| 2 | `src/components/records/RecordDetailDialog.tsx` | 신규 ~120줄 | Sheet 기반, 필드 목록 + 발송 버튼 2개 |
| 3 | `src/components/records/RecordTable.tsx` | 수정 ~5줄 | onRecordClick prop, 통합코드 셀 클릭 |
| 4 | `src/components/records/RecordToolbar.tsx` | 수정 ~15줄 | onEmailSend prop, Mail 버튼 |
| 5 | `src/pages/records.tsx` | 수정 ~20줄 | detailRecord/emailDialogOpen 상태, 다이얼로그 2개 추가 |

## 5. 사용하지 않는 것

- 새 API 엔드포인트: 없음
- 새 DB 테이블/컬럼: 없음
- 새 SWR 훅: 없음
- 새 외부 라이브러리: 없음

## 6. 검증 기준

| # | 항목 | 방법 |
|---|------|------|
| 1 | `npx next build` 성공 | 빌드 실행 |
| 2 | 통합코드 클릭 → Sheet 열림 | 레코드 목록에서 통합코드 클릭 |
| 3 | Sheet에서 모든 필드 값 표시 | 커스텀 필드 + 메타 정보 확인 |
| 4 | Sheet "알림톡 발송" → SendAlimtalkDialog | 클릭 후 다이얼로그 확인 |
| 5 | Sheet "이메일 발송" → SendEmailDialog | 클릭 후 다이얼로그 확인 |
| 6 | 알림톡 1건 발송 성공 | 템플릿 선택 → 발송 → 결과 확인 |
| 7 | 이메일 1건 발송 성공 | 템플릿 선택 → 발송 → 결과 확인 |
| 8 | Toolbar 이메일 발송 (일괄) | 복수 선택 → 이메일 발송 버튼 → 발송 |
| 9 | 체크박스 클릭 시 Sheet 안 열림 | 체크박스만 클릭 → 선택만 변경 |
| 10 | 인라인 편집 셀 클릭 시 Sheet 안 열림 | 셀 클릭 → 편집 모드만 진입 |
