import { useState, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import FileUploadStep from "./import/FileUploadStep";
import FieldMappingStep from "./import/FieldMappingStep";
import ImportResultStep from "./import/ImportResultStep";
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

                {step === 1 && (
                    <FileUploadStep
                        mappableFields={mappableFields}
                        errors={errors}
                        onParsed={(headers, data, autoMapping) => {
                            setCsvHeaders(headers);
                            setCsvData(data);
                            setErrors([]);
                            setMapping(autoMapping);
                            setStep(2);
                        }}
                        onError={setErrors}
                    />
                )}

                {step === 2 && (
                    <FieldMappingStep
                        csvHeaders={csvHeaders}
                        mapping={mapping}
                        onMappingChange={setMapping}
                        mappableFields={mappableFields}
                        duplicateAction={duplicateAction}
                        onDuplicateActionChange={setDuplicateAction}
                        duplicateCheckField={duplicateCheckField}
                    />
                )}

                {step === 3 && (
                    <ImportResultStep
                        csvData={csvData}
                        csvHeaders={csvHeaders}
                        activeMappings={activeMappings}
                        fields={fields}
                        errors={errors}
                        result={result}
                    />
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
