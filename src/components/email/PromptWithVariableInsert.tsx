"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus } from "lucide-react";

interface FieldOption {
    key: string;
    label: string;
}

interface Props {
    value: string;
    onChange: (value: string) => void;
    fields: FieldOption[];
    placeholder?: string;
    rows?: number;
    disabled?: boolean;
}

export function PromptWithVariableInsert({
    value,
    onChange,
    fields,
    placeholder,
    rows = 3,
    disabled,
}: Props) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [open, setOpen] = useState(false);

    const insertVariable = (fieldKey: string) => {
        const token = `##${fieldKey}##`;
        const el = textareaRef.current;
        if (!el) {
            onChange(value + token);
            setOpen(false);
            return;
        }
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? value.length;
        const next = value.slice(0, start) + token + value.slice(end);
        onChange(next);
        setOpen(false);
        requestAnimationFrame(() => {
            el.focus();
            const cursor = start + token.length;
            el.setSelectionRange(cursor, cursor);
        });
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-end">
                <DropdownMenu open={open} onOpenChange={setOpen}>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={disabled || fields.length === 0}
                            className="h-7 text-xs"
                        >
                            <Plus className="h-3 w-3 mr-1" />
                            변수 삽입
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                        {fields.length === 0 ? (
                            <DropdownMenuItem disabled>사용 가능한 필드 없음</DropdownMenuItem>
                        ) : (
                            fields.map((f) => (
                                <DropdownMenuItem
                                    key={f.key}
                                    onSelect={() => insertVariable(f.key)}
                                    className="text-xs"
                                >
                                    <span className="font-medium">{f.label}</span>
                                    <span className="ml-2 text-muted-foreground">##{f.key}##</span>
                                </DropdownMenuItem>
                            ))
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <Textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
                disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
                변수는 발송 시 수신자 레코드 값으로 자동 치환됩니다. 예) <code className="px-1 bg-muted rounded">##채널명##</code> → 실제 채널명
            </p>
        </div>
    );
}
