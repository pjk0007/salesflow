import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { FieldType } from "@/types";
import CellRenderer from "./CellRenderer";
import type { FieldDefinition } from "@/types";

interface InlineEditCellProps {
    field: FieldDefinition;
    value: unknown;
    onSave: (value: unknown) => void;
}

export default function InlineEditCell({ field, value, onSave }: InlineEditCellProps) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(String(value ?? ""));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    const handleSave = useCallback(() => {
        setEditing(false);
        const newVal = field.fieldType === "number" || field.fieldType === "currency"
            ? editValue === "" ? null : Number(editValue)
            : editValue;
        if (newVal !== value) {
            onSave(newVal);
        }
    }, [editValue, field.fieldType, onSave, value]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleSave();
        } else if (e.key === "Escape") {
            setEditing(false);
            setEditValue(String(value ?? ""));
        }
    };

    // 읽기 전용 필드
    if (
        field.cellType === "readonly" ||
        field.cellType === "formula" ||
        field.fieldType === "formula"
    ) {
        return <CellRenderer field={field} value={value} />;
    }

    // 체크박스
    if (field.fieldType === "checkbox") {
        return (
            <Checkbox
                checked={Boolean(value)}
                onCheckedChange={(checked) => onSave(checked)}
            />
        );
    }

    // Select 타입
    if (field.fieldType === "select" && field.options) {
        return (
            <Select
                value={String(value ?? "")}
                onValueChange={(v) => onSave(v)}
            >
                <SelectTrigger size="sm" className="h-7 border-0 shadow-none">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {field.options.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                            {opt}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    }

    // 편집 모드
    if (editing) {
        return (
            <Input
                ref={inputRef}
                type={
                    field.fieldType === "number" || field.fieldType === "currency"
                        ? "number"
                        : field.fieldType === "date"
                            ? "date"
                            : "text"
                }
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className="h-7 border-0 shadow-none focus-visible:ring-1 px-1"
            />
        );
    }

    // 읽기 모드 (클릭 시 편집)
    return (
        <div
            className="cursor-text px-1 py-0.5 min-h-[28px] flex items-center rounded hover:bg-muted/50"
            onClick={() => {
                setEditValue(String(value ?? ""));
                setEditing(true);
            }}
        >
            <CellRenderer field={field} value={value} />
        </div>
    );
}
