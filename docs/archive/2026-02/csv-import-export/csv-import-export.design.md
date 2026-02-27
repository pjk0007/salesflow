# Design: csv-import-export — CSV 가져오기/내보내기

> **Plan 문서**: [csv-import-export.plan.md](../../01-plan/features/csv-import-export.plan.md)

## 1. 개요

CSV 파일로 레코드 대량 내보내기/가져오기. 클라이언트 papaparse 파싱, 필드 매핑 UI, 서버 bulk insert.

## 2. 구현 순서

```
1. package.json (수정) — papaparse 의존성 추가
2. src/types/index.ts (수정) — ImportResult, ImportError 타입 추가
3. src/pages/api/partitions/[id]/records/export.ts (신규) — CSV 내보내기 API
4. src/pages/api/partitions/[id]/records/bulk-import.ts (신규) — CSV 가져오기 API
5. src/hooks/useRecords.ts (수정) — exportCsv, bulkImport 함수 추가
6. src/components/records/ImportDialog.tsx (신규) — 3단계 가져오기 다이얼로그
7. src/components/records/RecordToolbar.tsx (수정) — 내보내기/가져오기 버튼 추가
8. src/pages/records.tsx (수정) — ImportDialog 상태, export 핸들러 연결
```

## 3. 컴포넌트 설계

### 3.1 package.json (수정)

**의존성 추가**:
```bash
pnpm add papaparse
pnpm add -D @types/papaparse
```

---

### 3.2 src/types/index.ts (수정)

**추가 위치**: FilterCondition 인터페이스 아래 (line ~95 부근)

```typescript
// CSV 가져오기 결과
export interface ImportError {
    row: number;
    message: string;
}

export interface ImportResult {
    success: boolean;
    totalCount: number;
    insertedCount: number;
    skippedCount: number;
    errors: ImportError[];
}
```

---

### 3.3 src/pages/api/partitions/[id]/records/export.ts (신규)

**패턴**: 기존 `partitions/[id]/records.ts` GET 동일 구조

**import**:
```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, records, partitions, workspaces, fieldDefinitions } from "@/lib/db";
import { eq, and, sql, desc, asc, count } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
```

**핸들러**:
- GET only, 405 for non-GET
- 인증 체크: `getUserFromRequest()` → 401
- partitionId 파싱: `Number(req.query.id)`
- verifyPartitionAccess: 기존 records.ts와 동일 패턴 (partitions JOIN workspaces → orgId 검증)

**필드 목록 조회**:
```typescript
const allFields = await db
    .select()
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.workspaceId, partition.workspaceId))
    .orderBy(asc(fieldDefinitions.sortOrder));

// 내보내기 제외 필드
const EXCLUDED_TYPES = ["file", "formula", "user_select"];
const exportFields = allFields.filter(f => !EXCLUDED_TYPES.includes(f.fieldType));
```

**쿼리 파라미터 파싱**: records.ts GET과 동일 (search, filters, sortField, sortOrder)
- pageSize 없음 — 전체 레코드 (최대 10,000건 제한)

**WHERE 조건 구성**: records.ts와 동일 패턴 (conditions 배열 + and())
- 기존 records.ts의 필터 로직 그대로 복제

**레코드 조회**:
```typescript
const MAX_EXPORT = 10000;
const data = await db
    .select()
    .from(records)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(MAX_EXPORT);
```

**CSV 생성**:
```typescript
// BOM + 헤더
const BOM = "\uFEFF";
const headers = ["통합코드", ...exportFields.map(f => f.label)];

function formatValue(value: unknown, fieldType: string): string {
    if (value === null || value === undefined) return "";
    switch (fieldType) {
        case "date":
            try { return new Date(String(value)).toISOString().split("T")[0]; }
            catch { return String(value); }
        case "datetime":
            try {
                const d = new Date(String(value));
                return `${d.toISOString().split("T")[0]} ${d.toTimeString().slice(0, 5)}`;
            } catch { return String(value); }
        case "checkbox":
            return Boolean(value) ? "TRUE" : "FALSE";
        default:
            return String(value);
    }
}

function escapeCsv(val: string): string {
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
}

const rows = data.map(record => {
    const d = record.data as Record<string, unknown>;
    return [
        record.integratedCode || "",
        ...exportFields.map(f => formatValue(d[f.key], f.fieldType)),
    ].map(escapeCsv).join(",");
});

const csv = BOM + [headers.map(escapeCsv).join(","), ...rows].join("\n");
```

**응답**:
```typescript
const partitionName = partition.name || "records";
const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
const filename = `${partitionName}_${dateStr}.csv`;

res.setHeader("Content-Type", "text/csv; charset=utf-8");
res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
return res.status(200).send(csv);
```

**에러 핸들링**: try-catch, 500

---

### 3.4 src/pages/api/partitions/[id]/records/bulk-import.ts (신규)

**import**:
```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { db, records, partitions, workspaces, organizations } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";
```

**핸들러**:
- POST only, 405 for non-POST
- 인증 체크
- partitionId 파싱

**요청 바디**:
```typescript
const { records: importRecords, duplicateAction } = req.body as {
    records: Array<Record<string, unknown>>;
    duplicateAction: "skip" | "error";
};
```

**유효성 검사**:
```typescript
if (!Array.isArray(importRecords) || importRecords.length === 0) {
    return res.status(400).json({ success: false, error: "가져올 레코드가 없습니다." });
}
if (importRecords.length > 1000) {
    return res.status(400).json({ success: false, error: "최대 1,000건까지 가져올 수 있습니다." });
}
```

**트랜잭션 처리**:
```typescript
const result = await db.transaction(async (tx) => {
    // 1. 조직 정보 (통합코드용)
    const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, user.orgId));

    // 2. 중복 체크 필드 확인
    const duplicateField = partition.duplicateCheckField;
    let existingValues = new Set<string>();
    if (duplicateField) {
        const existing = await tx
            .select({ val: sql<string>`${records.data}->>${duplicateField}` })
            .from(records)
            .where(eq(records.partitionId, partitionId));
        existingValues = new Set(existing.map(r => r.val).filter(Boolean));
    }

    // 3. 레코드 순회 삽입
    const errors: Array<{ row: number; message: string }> = [];
    let insertedCount = 0;
    let skippedCount = 0;
    let currentSeq = org.integratedCodeSeq;

    for (let i = 0; i < importRecords.length; i++) {
        const data = importRecords[i];

        // 중복 체크
        if (duplicateField && data[duplicateField]) {
            const val = String(data[duplicateField]);
            if (existingValues.has(val)) {
                if (duplicateAction === "skip") {
                    skippedCount++;
                    continue;
                } else {
                    errors.push({ row: i + 1, message: `중복: ${duplicateField}="${val}"` });
                    continue;
                }
            }
            existingValues.add(val); // 새 레코드 내 중복도 방지
        }

        // 통합코드 생성
        currentSeq++;
        const integratedCode = `${org.integratedCodePrefix}-${String(currentSeq).padStart(4, "0")}`;

        await tx.insert(records).values({
            orgId: user.orgId,
            workspaceId: partition.workspaceId,
            partitionId,
            integratedCode,
            data,
        });
        insertedCount++;
    }

    // 4. 조직 시퀀스 업데이트
    await tx
        .update(organizations)
        .set({ integratedCodeSeq: currentSeq })
        .where(eq(organizations.id, org.id));

    return { totalCount: importRecords.length, insertedCount, skippedCount, errors };
});
```

**응답**:
```typescript
return res.status(200).json({
    success: true,
    totalCount: result.totalCount,
    insertedCount: result.insertedCount,
    skippedCount: result.skippedCount,
    errors: result.errors,
});
```

---

### 3.5 src/hooks/useRecords.ts (수정)

**추가 함수 2개** (bulkDelete 아래):

```typescript
const exportCsv = async (params: {
    search?: string;
    filters?: FilterCondition[];
    sortField?: string;
    sortOrder?: string;
}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.filters && params.filters.length > 0)
        qs.set("filters", JSON.stringify(params.filters));
    if (params.sortField) qs.set("sortField", params.sortField);
    if (params.sortOrder) qs.set("sortOrder", params.sortOrder);

    const res = await fetch(
        `/api/partitions/${params.partitionId}/records/export?${qs.toString()}`
    );
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
};

const bulkImport = async (
    importRecords: Array<Record<string, unknown>>,
    duplicateAction: "skip" | "error" = "skip"
) => {
    const res = await fetch(
        `/api/partitions/${params.partitionId}/records/bulk-import`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ records: importRecords, duplicateAction }),
        }
    );
    const result = await res.json();
    if (result.success && result.insertedCount > 0) mutate();
    return result;
};
```

**실제 exportCsv 구현 시 partitionId가 params 내부에 있으므로**:
```typescript
// exportCsv는 외부 params를 받지 않고, useRecords의 params.partitionId를 사용
const exportCsv = async (exportParams: {
    search?: string;
    filters?: FilterCondition[];
    sortField?: string;
    sortOrder?: string;
}) => {
    const qs = new URLSearchParams();
    if (exportParams.search) qs.set("search", exportParams.search);
    if (exportParams.filters && exportParams.filters.length > 0)
        qs.set("filters", JSON.stringify(exportParams.filters));
    if (exportParams.sortField) qs.set("sortField", exportParams.sortField);
    if (exportParams.sortOrder) qs.set("sortOrder", exportParams.sortOrder);

    const res = await fetch(
        `/api/partitions/${params.partitionId}/records/export?${qs.toString()}`
    );
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
};
```

**return 객체에 추가**:
```typescript
return {
    // ... 기존
    exportCsv,
    bulkImport,
};
```

**import 추가**: `FilterCondition` from "@/types" (이미 있음)

---

### 3.6 src/components/records/ImportDialog.tsx (신규)

**import**:
```typescript
import { useState, useMemo } from "react";
import Papa from "papaparse";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import type { FieldDefinition, ImportResult } from "@/types";
```

**Props**:
```typescript
interface ImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fields: FieldDefinition[];
    duplicateCheckField?: string;
    onImport: (
        records: Array<Record<string, unknown>>,
        duplicateAction: "skip" | "error"
    ) => Promise<ImportResult>;
}
```

**내부 상태**:
```typescript
const [step, setStep] = useState<1 | 2 | 3>(1);
const [csvData, setCsvData] = useState<string[][]>([]);      // 파싱된 행 (헤더 제외)
const [csvHeaders, setCsvHeaders] = useState<string[]>([]);   // CSV 헤더
const [mapping, setMapping] = useState<Record<string, string>>({}); // csvHeader → fieldKey
const [duplicateAction, setDuplicateAction] = useState<"skip" | "error">("skip");
const [importing, setImporting] = useState(false);
const [result, setResult] = useState<ImportResult | null>(null);
const [errors, setErrors] = useState<Array<{ row: number; message: string }>>([]);
```

**매핑 가능한 필드**:
```typescript
const EXCLUDED_TYPES = ["file", "formula", "user_select"];
const mappableFields = useMemo(
    () => fields.filter(f => !EXCLUDED_TYPES.includes(f.fieldType)),
    [fields]
);
```

**Step 1: 파일 선택**

```
<div className="space-y-4">
├── <div> (드래그앤드롭 영역)
│   ├── className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
│   ├── Upload 아이콘 (h-10 w-10 text-muted-foreground mx-auto)
│   ├── "CSV 파일을 여기에 끌어놓거나 클릭하세요" (text-sm text-muted-foreground mt-2)
│   ├── "최대 1,000건" (text-xs text-muted-foreground mt-1)
│   └── <input type="file" accept=".csv" hidden ref={fileInputRef} onChange={handleFileSelect} />
│   └── onClick → fileInputRef.current?.click()
└── 파일 선택 후: "{csvHeaders.length}개 컬럼, {csvData.length}건 감지" (text-sm)
</div>
```

**handleFileSelect 로직**:
```typescript
const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (result) => {
            const rows = result.data as string[][];
            if (rows.length < 2) return; // 헤더 + 최소 1행
            const headers = rows[0];
            const data = rows.slice(1);
            if (data.length > 1000) {
                // 에러 표시 — 1,000건 초과
                return;
            }
            setCsvHeaders(headers);
            setCsvData(data);

            // 자동 매핑: CSV 헤더 === field.label
            const autoMapping: Record<string, string> = {};
            for (const header of headers) {
                const match = mappableFields.find(f => f.label === header);
                if (match) autoMapping[header] = match.key;
            }
            setMapping(autoMapping);
            setStep(2);
        },
    });
};
```

**Step 2: 필드 매핑**

```
<div className="space-y-4">
├── <p className="text-sm text-muted-foreground">
│   "CSV 헤더를 필드에 매핑하세요. 매핑하지 않은 컬럼은 무시됩니다."
│   </p>
├── <div className="max-h-[400px] overflow-y-auto space-y-2">
│   {csvHeaders.map(header => (
│       <div key={header} className="flex items-center gap-3">
│           <span className="w-[200px] text-sm font-medium truncate">{header}</span>
│           <span className="text-muted-foreground">→</span>
│           <Select
│               value={mapping[header] || "__skip__"}
│               onValueChange={(v) => setMapping(prev => ({ ...prev, [header]: v === "__skip__" ? "" : v }))}
│           >
│               <SelectTrigger className="w-[200px]">
│                   <SelectValue placeholder="건너뛰기" />
│               </SelectTrigger>
│               <SelectContent>
│                   <SelectItem value="__skip__">건너뛰기</SelectItem>
│                   {mappableFields.map(f => (
│                       <SelectItem key={f.key} value={f.key}>
│                           {f.label} ({f.fieldType})
│                       </SelectItem>
│                   ))}
│               </SelectContent>
│           </Select>
│           {mapping[header] && <Badge variant="secondary">매핑됨</Badge>}
│       </div>
│   ))}
│   </div>
├── <div className="border-t pt-4 space-y-2">
│   <Label>중복 처리</Label>
│   <Select value={duplicateAction} onValueChange={(v) => setDuplicateAction(v as "skip" | "error")}>
│       <SelectTrigger className="w-[200px]">
│           <SelectValue />
│       </SelectTrigger>
│       <SelectContent>
│           <SelectItem value="skip">건너뛰기</SelectItem>
│           <SelectItem value="error">에러 표시</SelectItem>
│       </SelectContent>
│   </Select>
│   {duplicateCheckField && (
│       <p className="text-xs text-muted-foreground">
│           중복 기준 필드: {duplicateCheckField}
│       </p>
│   )}
│   </div>
</div>
```

**Step 3: 미리보기 및 확인**

```
<div className="space-y-4">
├── <p className="text-sm text-muted-foreground">
│   "{csvData.length}건 중 처음 5건을 미리보기합니다."
│   </p>
├── {errors.length > 0 && (
│   <div className="border border-destructive/50 rounded-lg p-3 space-y-1">
│       <p className="text-sm font-medium text-destructive flex items-center gap-1">
│           <AlertCircle className="h-4 w-4" /> {errors.length}건의 유효성 오류
│       </p>
│       <ul className="text-xs text-destructive space-y-0.5 max-h-[100px] overflow-y-auto">
│           {errors.slice(0, 10).map((e, i) => (
│               <li key={i}>{e.row}행: {e.message}</li>
│           ))}
│           {errors.length > 10 && <li>... 외 {errors.length - 10}건</li>}
│       </ul>
│   </div>
│   )}
├── <div className="border rounded-lg overflow-x-auto">
│   <Table>
│       <TableHeader>
│           <TableRow>
│               <TableHead>#</TableHead>
│               {activeMappings.map(([header, fieldKey]) => (
│                   <TableHead key={fieldKey}>
│                       {fields.find(f => f.key === fieldKey)?.label || fieldKey}
│                   </TableHead>
│               ))}
│           </TableRow>
│       </TableHeader>
│       <TableBody>
│           {previewRows.map((row, i) => (
│               <TableRow key={i}>
│                   <TableCell className="text-muted-foreground">{i + 1}</TableCell>
│                   {activeMappings.map(([header, fieldKey]) => {
│                       const colIndex = csvHeaders.indexOf(header);
│                       return (
│                           <TableCell key={fieldKey} className="text-sm">
│                               {row[colIndex] || "-"}
│                           </TableCell>
│                       );
│                   })}
│               </TableRow>
│           ))}
│       </TableBody>
│   </Table>
│   </div>
├── 결과 표시 (result !== null)
│   <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-1">
│       <p className="text-sm font-medium text-green-700 flex items-center gap-1">
│           <CheckCircle2 className="h-4 w-4" /> 가져오기 완료
│       </p>
│       <p className="text-sm">전체: {result.totalCount}건</p>
│       <p className="text-sm">성공: {result.insertedCount}건</p>
│       {result.skippedCount > 0 && <p className="text-sm">건너뛰기: {result.skippedCount}건</p>}
│       {result.errors.length > 0 && <p className="text-sm text-destructive">에러: {result.errors.length}건</p>}
│   </div>
</div>
```

**previewRows 계산**:
```typescript
const activeMappings = useMemo(
    () => Object.entries(mapping).filter(([_, v]) => v),
    [mapping]
);
const previewRows = csvData.slice(0, 5);
```

**유효성 검사 (Step 2 → Step 3 전환 시)**:
```typescript
function validateData(): Array<{ row: number; message: string }> {
    const errs: Array<{ row: number; message: string }> = [];
    for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i];
        for (const [header, fieldKey] of activeMappings) {
            const field = fields.find(f => f.key === fieldKey);
            if (!field) continue;
            const colIndex = csvHeaders.indexOf(header);
            const val = row[colIndex]?.trim() ?? "";

            // 필수 필드 체크
            if (field.isRequired && !val) {
                errs.push({ row: i + 1, message: `${field.label}: 필수 필드입니다` });
                continue;
            }
            if (!val) continue; // 비필수 빈 값은 OK

            // 타입별 검증
            switch (field.fieldType) {
                case "number":
                case "currency":
                    if (isNaN(Number(val))) {
                        errs.push({ row: i + 1, message: `${field.label}: 숫자가 아닙니다` });
                    }
                    break;
                case "date":
                case "datetime":
                    if (isNaN(Date.parse(val))) {
                        errs.push({ row: i + 1, message: `${field.label}: 유효하지 않은 날짜입니다` });
                    }
                    break;
                case "select":
                    if (field.options && !field.options.includes(val)) {
                        errs.push({ row: i + 1, message: `${field.label}: "${val}"은(는) 유효한 옵션이 아닙니다` });
                    }
                    break;
                case "checkbox": {
                    const lower = val.toLowerCase();
                    if (!["true", "false", "1", "0"].includes(lower)) {
                        errs.push({ row: i + 1, message: `${field.label}: TRUE/FALSE/1/0만 가능합니다` });
                    }
                    break;
                }
            }
        }
    }
    return errs;
}
```

**handleImport 로직**:
```typescript
const handleImport = async () => {
    setImporting(true);
    try {
        // CSV 행 → Record<string, unknown> 변환
        const importRecords = csvData.map(row => {
            const record: Record<string, unknown> = {};
            for (const [header, fieldKey] of activeMappings) {
                const field = fields.find(f => f.key === fieldKey);
                if (!field) continue;
                const colIndex = csvHeaders.indexOf(header);
                const val = row[colIndex]?.trim() ?? "";

                if (!val) {
                    record[fieldKey] = null;
                    continue;
                }

                switch (field.fieldType) {
                    case "number":
                    case "currency":
                        record[fieldKey] = Number(val);
                        break;
                    case "checkbox":
                        record[fieldKey] = val.toLowerCase() === "true" || val === "1";
                        break;
                    default:
                        record[fieldKey] = val;
                }
            }
            return record;
        });

        // 유효성 에러가 있는 행 제외
        const validIndices = new Set<number>();
        const validationErrors = validateData();
        const errorRows = new Set(validationErrors.map(e => e.row - 1));
        importRecords.forEach((_, i) => { if (!errorRows.has(i)) validIndices.add(i); });
        const validRecords = importRecords.filter((_, i) => validIndices.has(i));

        if (validRecords.length === 0) {
            setResult({
                success: true,
                totalCount: importRecords.length,
                insertedCount: 0,
                skippedCount: 0,
                errors: validationErrors,
            });
            return;
        }

        const apiResult = await onImport(validRecords, duplicateAction);
        setResult({
            ...apiResult,
            errors: [...validationErrors, ...apiResult.errors],
        });
    } finally {
        setImporting(false);
    }
};
```

**Dialog Footer 버튼**:
```typescript
// Step 1: 없음 (파일 선택하면 자동 전환)
// Step 2: "이전" (→ step 1), "다음" (→ validate → step 3)
// Step 3 (result === null): "이전" (→ step 2), "가져오기" (→ handleImport, errors.length > 0이면 비활성화)
// Step 3 (result !== null): "닫기" (→ onOpenChange(false))
```

**Dialog 닫힘 시 초기화**:
```typescript
const handleOpenChange = (open: boolean) => {
    if (!open) {
        setStep(1);
        setCsvData([]);
        setCsvHeaders([]);
        setMapping({});
        setDuplicateAction("skip");
        setResult(null);
        setErrors([]);
        setImporting(false);
    }
    onOpenChange(open);
};
```

---

### 3.7 src/components/records/RecordToolbar.tsx (수정)

**import 추가**:
```typescript
import { Download, Upload } from "lucide-react";
```

**Props 추가**:
```typescript
interface RecordToolbarProps {
    // ... 기존
    onExportClick?: () => void;
    onImportClick?: () => void;
    totalRecords?: number;  // 내보내기 비활성화 조건용
}
```

**UI 추가** — `<div className="flex-1" />` 아래, `{selectedCount > 0 &&` 위에:

```tsx
{/* 내보내기/가져오기 */}
{onExportClick && (
    <Button
        variant="outline"
        size="sm"
        onClick={onExportClick}
        disabled={!totalRecords}
        className="gap-1.5"
    >
        <Download className="h-4 w-4" />
        내보내기
    </Button>
)}
{onImportClick && (
    <Button
        variant="outline"
        size="sm"
        onClick={onImportClick}
        className="gap-1.5"
    >
        <Upload className="h-4 w-4" />
        가져오기
    </Button>
)}
```

---

### 3.8 src/pages/records.tsx (수정)

**import 추가**:
```typescript
import ImportDialog from "@/components/records/ImportDialog";
```

**상태 추가**:
```typescript
const [importDialogOpen, setImportDialogOpen] = useState(false);
```

**useRecords 반환값 확장**:
```typescript
const {
    // ... 기존
    exportCsv,
    bulkImport,
} = useRecords({ ... });
```

**내보내기 핸들러**:
```typescript
const handleExport = useCallback(async () => {
    try {
        const blob = await exportCsv({
            search: search || undefined,
            filters: filters.length > 0 ? filters : undefined,
            sortField,
            sortOrder,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${currentPartition?.name || "records"}_${new Date().toISOString().split("T")[0].replace(/-/g, "")}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("CSV 내보내기 완료");
    } catch {
        toast.error("내보내기에 실패했습니다.");
    }
}, [exportCsv, search, filters, sortField, sortOrder, currentPartition]);
```

**RecordToolbar에 props 추가**:
```tsx
<RecordToolbar
    // ... 기존
    onExportClick={handleExport}
    onImportClick={() => setImportDialogOpen(true)}
    totalRecords={total}
/>
```

**ImportDialog 렌더**:
```tsx
<ImportDialog
    open={importDialogOpen}
    onOpenChange={setImportDialogOpen}
    fields={fields}
    duplicateCheckField={currentPartition?.duplicateCheckField ?? undefined}
    onImport={bulkImport}
/>
```

## 4. 변경 파일 요약

| # | 파일 | 변경 | 주요 내용 |
|---|------|------|-----------|
| 1 | `package.json` | 수정 | papaparse, @types/papaparse |
| 2 | `src/types/index.ts` | 수정 ~10줄 | ImportError, ImportResult |
| 3 | `src/pages/api/partitions/[id]/records/export.ts` | 신규 ~120줄 | CSV 내보내기 API |
| 4 | `src/pages/api/partitions/[id]/records/bulk-import.ts` | 신규 ~100줄 | CSV 가져오기 API |
| 5 | `src/hooks/useRecords.ts` | 수정 ~30줄 | exportCsv, bulkImport |
| 6 | `src/components/records/ImportDialog.tsx` | 신규 ~350줄 | 3단계 가져오기 다이얼로그 |
| 7 | `src/components/records/RecordToolbar.tsx` | 수정 ~15줄 | 내보내기/가져오기 버튼 |
| 8 | `src/pages/records.tsx` | 수정 ~25줄 | ImportDialog 상태, export 핸들러 |

## 5. 사용하지 않는 것

- Excel (.xlsx) 지원: CSV만
- 서버 사이드 CSV 파싱: 클라이언트 papaparse로 처리
- 기존 레코드 업데이트: 신규 삽입만 (건너뛰기 또는 에러)
- 비동기 백그라운드 처리: 동기 트랜잭션
- 진행률 WebSocket: 단순 await
- file/formula/user_select 필드: 가져오기/내보내기 모두 제외

## 6. 검증 기준

| # | 항목 | 방법 |
|---|------|------|
| 1 | `npx next build` 성공 | 빌드 실행 |
| 2 | 내보내기: CSV 다운로드 | 레코드 있는 파티션 → 내보내기 클릭 |
| 3 | 내보내기: 한글 헤더 + BOM | 다운로드 파일 열기 |
| 4 | 내보내기: 필터 적용 결과 | 필터 설정 후 내보내기 |
| 5 | 내보내기: 레코드 0건 시 비활성화 | 빈 파티션 |
| 6 | 가져오기: 파일 선택 → 파싱 | CSV 업로드 |
| 7 | 가져오기: 자동 매핑 | CSV 헤더=필드 label 일치 |
| 8 | 가져오기: 수동 매핑 | Select로 필드 변경 |
| 9 | 가져오기: 미리보기 5행 | Step 3 테이블 |
| 10 | 가져오기: 유효성 에러 표시 | 필수 필드 누락, 타입 오류 |
| 11 | 가져오기: 일괄 삽입 성공 | 레코드 목록 갱신 |
| 12 | 가져오기: 중복 skip | duplicateCheckField 설정된 파티션 |
| 13 | 가져오기: 1,000건 초과 에러 | 대량 CSV |
| 14 | 가져오기: 결과 요약 | 성공/건너뛰기/에러 건수 |
