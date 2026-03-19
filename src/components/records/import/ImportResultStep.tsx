"use client";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { FieldDefinition, ImportResult } from "@/types";

interface ImportResultStepProps {
    csvData: string[][];
    csvHeaders: string[];
    activeMappings: Array<[string, string]>;
    fields: FieldDefinition[];
    errors: Array<{ row: number; message: string }>;
    result: ImportResult | null;
}

export default function ImportResultStep({
    csvData,
    csvHeaders,
    activeMappings,
    fields,
    errors,
    result,
}: ImportResultStepProps) {
    const previewRows = csvData.slice(0, 5);

    return (
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

            {result !== null && (() => {
                const hasIssues = result.skippedCount > 0 || result.errors.length > 0;
                const mergedCount = (result as ImportResult & { mergedCount?: number }).mergedCount || 0;
                const allSkipped = result.insertedCount === 0 && mergedCount === 0;
                const borderClass = allSkipped
                    ? "border-orange-200 bg-orange-50"
                    : hasIssues
                    ? "border-yellow-200 bg-yellow-50"
                    : "border-green-200 bg-green-50";
                const textClass = allSkipped
                    ? "text-orange-700"
                    : hasIssues
                    ? "text-yellow-700"
                    : "text-green-700";
                const label = allSkipped
                    ? "전부 건너뛰었습니다"
                    : hasIssues
                    ? "가져오기 완료 (일부 건너뜀)"
                    : "가져오기 완료";

                return (
                    <div className={`border rounded-lg p-4 space-y-1 ${borderClass}`}>
                        <p className={`text-sm font-medium flex items-center gap-1 ${textClass}`}>
                            {allSkipped ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            {label}
                        </p>
                        <p className="text-sm">전체: {result.totalCount}건</p>
                        {result.insertedCount > 0 && (
                            <p className="text-sm">신규 등록: {result.insertedCount}건</p>
                        )}
                        {mergedCount > 0 && (
                            <p className="text-sm">병합: {mergedCount}건</p>
                        )}
                        {result.skippedCount > 0 && (
                            <p className="text-sm text-orange-600">중복 건너뛰기: {result.skippedCount}건</p>
                        )}
                        {result.errors.length > 0 && (
                            <div>
                                <p className="text-sm text-destructive">에러: {result.errors.length}건</p>
                                <ul className="text-xs text-destructive mt-1 space-y-0.5 max-h-[80px] overflow-y-auto">
                                    {result.errors.slice(0, 5).map((e, i) => (
                                        <li key={i}>{e.row}행: {e.message}</li>
                                    ))}
                                    {result.errors.length > 5 && <li>... 외 {result.errors.length - 5}건</li>}
                                </ul>
                            </div>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}
