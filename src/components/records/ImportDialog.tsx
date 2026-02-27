import { useState, useMemo, useRef } from "react";
import Papa from "papaparse";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import type { FieldDefinition, ImportResult } from "@/types";

const EXCLUDED_TYPES = ["file", "formula", "user_select"];

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

export default function ImportDialog({
    open,
    onOpenChange,
    fields,
    duplicateCheckField,
    onImport,
}: ImportDialogProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [csvData, setCsvData] = useState<string[][]>([]);
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [duplicateAction, setDuplicateAction] = useState<"skip" | "error">("skip");
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [errors, setErrors] = useState<Array<{ row: number; message: string }>>([]);

    const mappableFields = useMemo(
        () => fields.filter(f => !EXCLUDED_TYPES.includes(f.fieldType)),
        [fields]
    );

    const activeMappings = useMemo(
        () => Object.entries(mapping).filter(([, v]) => v),
        [mapping]
    );

    const previewRows = csvData.slice(0, 5);

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

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: false,
            skipEmptyLines: true,
            complete: (result) => {
                const rows = result.data as string[][];
                if (rows.length < 2) return;
                const headers = rows[0];
                const data = rows.slice(1);
                if (data.length > 1000) {
                    setErrors([{ row: 0, message: `${data.length}건 감지 — 최대 1,000건까지 가능합니다.` }]);
                    return;
                }
                setCsvHeaders(headers);
                setCsvData(data);
                setErrors([]);

                // 자동 매핑
                const autoMapping: Record<string, string> = {};
                for (const header of headers) {
                    const match = mappableFields.find(f => f.label === header);
                    if (match) autoMapping[header] = match.key;
                }
                setMapping(autoMapping);
                setStep(2);
            },
        });

        // 같은 파일 재선택 허용
        e.target.value = "";
    };

    function validateData(): Array<{ row: number; message: string }> {
        const errs: Array<{ row: number; message: string }> = [];
        for (let i = 0; i < csvData.length; i++) {
            const row = csvData[i];
            for (const [header, fieldKey] of activeMappings) {
                const field = fields.find(f => f.key === fieldKey);
                if (!field) continue;
                const colIndex = csvHeaders.indexOf(header);
                const val = row[colIndex]?.trim() ?? "";

                if (field.isRequired && !val) {
                    errs.push({ row: i + 1, message: `${field.label}: 필수 필드입니다` });
                    continue;
                }
                if (!val) continue;

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

    const handleGoToPreview = () => {
        const validationErrors = validateData();
        setErrors(validationErrors);
        setStep(3);
    };

    const handleImport = async () => {
        setImporting(true);
        try {
            const validationErrors = validateData();
            const errorRows = new Set(validationErrors.map(e => e.row - 1));

            const importRecords = csvData
                .map((row, i) => {
                    if (errorRows.has(i)) return null;
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
                })
                .filter((r): r is Record<string, unknown> => r !== null);

            if (importRecords.length === 0) {
                setResult({
                    success: true,
                    totalCount: csvData.length,
                    insertedCount: 0,
                    skippedCount: 0,
                    errors: validationErrors,
                });
                return;
            }

            const apiResult = await onImport(importRecords, duplicateAction);
            setResult({
                ...apiResult,
                errors: [...validationErrors, ...apiResult.errors],
            });
        } finally {
            setImporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>CSV 가져오기</DialogTitle>
                    <DialogDescription>
                        {step === 1 && "CSV 파일을 선택하세요."}
                        {step === 2 && "CSV 컬럼을 필드에 매핑하세요."}
                        {step === 3 && (result ? "가져오기가 완료되었습니다." : "데이터를 확인하고 가져오기를 실행하세요.")}
                    </DialogDescription>
                </DialogHeader>

                {/* Step 1: 파일 선택 */}
                {step === 1 && (
                    <div className="space-y-4">
                        <div
                            className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                            <p className="text-sm text-muted-foreground mt-2">
                                CSV 파일을 여기에 클릭하여 선택하세요
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">최대 1,000건</p>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={handleFileSelect}
                            />
                        </div>
                        {errors.length > 0 && (
                            <div className="text-sm text-destructive flex items-center gap-1">
                                <AlertCircle className="h-4 w-4" />
                                {errors[0].message}
                            </div>
                        )}
                    </div>
                )}

                {/* Step 2: 필드 매핑 */}
                {step === 2 && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            CSV 헤더를 필드에 매핑하세요. 매핑하지 않은 컬럼은 무시됩니다.
                        </p>
                        <div className="max-h-[400px] overflow-y-auto space-y-2">
                            {csvHeaders.map(header => (
                                <div key={header} className="flex items-center gap-3">
                                    <span className="w-[200px] text-sm font-medium truncate" title={header}>
                                        {header}
                                    </span>
                                    <span className="text-muted-foreground">&rarr;</span>
                                    <Select
                                        value={mapping[header] || "__skip__"}
                                        onValueChange={(v) =>
                                            setMapping(prev => ({
                                                ...prev,
                                                [header]: v === "__skip__" ? "" : v,
                                            }))
                                        }
                                    >
                                        <SelectTrigger className="w-[200px]">
                                            <SelectValue placeholder="건너뛰기" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__skip__">건너뛰기</SelectItem>
                                            {mappableFields.map(f => (
                                                <SelectItem key={f.key} value={f.key}>
                                                    {f.label} ({f.fieldType})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {mapping[header] && <Badge variant="secondary">매핑됨</Badge>}
                                </div>
                            ))}
                        </div>
                        <div className="border-t pt-4 space-y-2">
                            <Label>중복 처리</Label>
                            <Select
                                value={duplicateAction}
                                onValueChange={(v) => setDuplicateAction(v as "skip" | "error")}
                            >
                                <SelectTrigger className="w-[200px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="skip">건너뛰기</SelectItem>
                                    <SelectItem value="error">에러 표시</SelectItem>
                                </SelectContent>
                            </Select>
                            {duplicateCheckField && (
                                <p className="text-xs text-muted-foreground">
                                    중복 기준 필드: {duplicateCheckField}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 3: 미리보기 및 결과 */}
                {step === 3 && (
                    <div className="space-y-4">
                        {result === null && (
                            <p className="text-sm text-muted-foreground">
                                {csvData.length}건 중 처음 5건을 미리보기합니다.
                            </p>
                        )}

                        {errors.length > 0 && result === null && (
                            <div className="border border-destructive/50 rounded-lg p-3 space-y-1">
                                <p className="text-sm font-medium text-destructive flex items-center gap-1">
                                    <AlertCircle className="h-4 w-4" /> {errors.length}건의 유효성 오류
                                </p>
                                <ul className="text-xs text-destructive space-y-0.5 max-h-[100px] overflow-y-auto">
                                    {errors.slice(0, 10).map((e, i) => (
                                        <li key={i}>{e.row}행: {e.message}</li>
                                    ))}
                                    {errors.length > 10 && <li>... 외 {errors.length - 10}건</li>}
                                </ul>
                            </div>
                        )}

                        {result === null && activeMappings.length > 0 && (
                            <div className="border rounded-lg overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>#</TableHead>
                                            {activeMappings.map(([, fieldKey]) => (
                                                <TableHead key={fieldKey}>
                                                    {fields.find(f => f.key === fieldKey)?.label || fieldKey}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {previewRows.map((row, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                                                {activeMappings.map(([header, fieldKey]) => {
                                                    const colIndex = csvHeaders.indexOf(header);
                                                    return (
                                                        <TableCell key={fieldKey} className="text-sm">
                                                            {row[colIndex] || "-"}
                                                        </TableCell>
                                                    );
                                                })}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        {result !== null && (
                            <div className="border border-green-200 bg-green-50 rounded-lg p-4 space-y-1">
                                <p className="text-sm font-medium text-green-700 flex items-center gap-1">
                                    <CheckCircle2 className="h-4 w-4" /> 가져오기 완료
                                </p>
                                <p className="text-sm">전체: {result.totalCount}건</p>
                                <p className="text-sm">성공: {result.insertedCount}건</p>
                                {result.skippedCount > 0 && (
                                    <p className="text-sm">건너뛰기: {result.skippedCount}건</p>
                                )}
                                {result.errors.length > 0 && (
                                    <p className="text-sm text-destructive">에러: {result.errors.length}건</p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    {step === 2 && (
                        <>
                            <Button variant="outline" onClick={() => setStep(1)}>
                                이전
                            </Button>
                            <Button
                                onClick={handleGoToPreview}
                                disabled={activeMappings.length === 0}
                            >
                                다음
                            </Button>
                        </>
                    )}
                    {step === 3 && result === null && (
                        <>
                            <Button variant="outline" onClick={() => setStep(2)}>
                                이전
                            </Button>
                            <Button
                                onClick={handleImport}
                                disabled={importing || errors.length > 0}
                            >
                                {importing ? "가져오는 중..." : "가져오기"}
                            </Button>
                        </>
                    )}
                    {step === 3 && result !== null && (
                        <Button onClick={() => handleOpenChange(false)}>
                            닫기
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
