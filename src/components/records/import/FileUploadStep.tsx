"use client";

import { useRef } from "react";
import Papa from "papaparse";
import { Upload, AlertCircle } from "lucide-react";
import type { FieldDefinition } from "@/types";

interface FileUploadStepProps {
    mappableFields: FieldDefinition[];
    errors: Array<{ row: number; message: string }>;
    onParsed: (
        headers: string[],
        data: string[][],
        autoMapping: Record<string, string>
    ) => void;
    onError: (errors: Array<{ row: number; message: string }>) => void;
}

export default function FileUploadStep({
    mappableFields,
    errors,
    onParsed,
    onError,
}: FileUploadStepProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

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
                if (data.length > 3000) {
                    onError([{ row: 0, message: `${data.length}건 감지 — 최대 3,000건까지 가능합니다.` }]);
                    return;
                }

                const autoMapping: Record<string, string> = {};
                for (const header of headers) {
                    const match = mappableFields.find(f => f.label === header);
                    if (match) autoMapping[header] = match.key;
                }
                onParsed(headers, data, autoMapping);
            },
        });

        e.target.value = "";
    };

    return (
        <div className="space-y-4">
            <div
                className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
            >
                <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground mt-2">
                    CSV 파일을 여기에 클릭하여 선택하세요
                </p>
                <p className="text-xs text-muted-foreground mt-1">최대 3,000건</p>
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
    );
}
