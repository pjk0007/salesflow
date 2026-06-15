"use client";

import { useRef, useState } from "react";
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
    const [isDragging, setIsDragging] = useState(false);

    const parseFile = (file: File) => {
        if (!file.name.toLowerCase().endsWith(".csv")) {
            onError([{ row: 0, message: "CSV 파일만 업로드할 수 있습니다." }]);
            return;
        }

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
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) parseFile(file);
        e.target.value = "";
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (!isDragging) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        // 자식 요소로 이동 시 발생하는 leave는 무시 (박스 밖으로 나갈 때만 해제)
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) parseFile(file);
    };

    return (
        <div className="space-y-4">
            <div
                className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                    isDragging ? "border-primary bg-primary/5" : "hover:border-primary/50"
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground mt-2">
                    {isDragging
                        ? "여기에 놓아서 업로드하세요"
                        : "CSV 파일을 끌어다 놓거나 클릭하여 선택하세요"}
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
