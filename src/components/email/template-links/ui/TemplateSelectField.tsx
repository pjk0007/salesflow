"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TEMPLATE_OPTION_LIMIT } from "@/hooks/useEmailTemplates";

interface TemplateOption {
    id: number;
    name: string;
    status?: string | null;
}

interface TemplateSelectFieldProps {
    value: number | null;
    onChange: (id: number) => void;
    templates: TemplateOption[];
    /** 입력이 멈춘 뒤(300ms) 검색어를 알린다 */
    onSearchChange: (q: string) => void;
    /** 검색 결과가 선택지 상한보다 많다 */
    truncated: boolean;
    total: number;
}

/**
 * 템플릿 연결 화면의 템플릿 선택칸. 서버 검색(q)으로 좁히고, 이미 고른 템플릿은 목록 밖·초안이어도 보인다 (UX-146).
 */
export default function TemplateSelectField({
    value, onChange, templates, onSearchChange, truncated, total,
}: TemplateSelectFieldProps) {
    const [input, setInput] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => onSearchChange(input.trim()), 300);
        return () => clearTimeout(timer);
    }, [input, onSearchChange]);
    return (
        <div className="space-y-2">
            <Input
                aria-label="템플릿 이름·제목 검색"
                placeholder="템플릿 이름·제목 검색"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="h-8 text-sm"
            />
            <Select value={value ? String(value) : ""} onValueChange={(v) => onChange(Number(v))}>
                <SelectTrigger>
                    <SelectValue placeholder="템플릿 선택" />
                </SelectTrigger>
                <SelectContent>
                    {templates.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                            {t.name}{t.status === "draft" ? " (임시저장)" : ""}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {truncated && (
                <p className="text-xs text-muted-foreground">
                    발행 템플릿 {total.toLocaleString()}개 중 최근 {TEMPLATE_OPTION_LIMIT}개만 표시합니다. 이름·제목으로 검색해 좁혀 주세요.
                </p>
            )}
        </div>
    );
}
