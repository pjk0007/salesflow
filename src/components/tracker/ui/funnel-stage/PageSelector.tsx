"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StageMatch } from "../../types/funnel";
import { CUSTOM } from "./constants";

interface Props {
    popularPaths: string[];
    current: Extract<StageMatch, { type: "page_url" }>;
    onChange: (next: StageMatch) => void;
}

/** 페이지 경로 — 인기 페이지 드롭다운 + 직접 입력 */
export function PageSelector({ popularPaths, current, onChange }: Props) {
    const isCustom = current.pathPrefix && !popularPaths.includes(current.pathPrefix);

    return (
        <>
            <Select
                value={isCustom ? CUSTOM : (current.pathPrefix || "")}
                onValueChange={(v) => {
                    if (v === CUSTOM) onChange({ type: "page_url", pathPrefix: "" });
                    else onChange({ type: "page_url", pathPrefix: v });
                }}
            >
                <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder="인기 페이지 선택" />
                </SelectTrigger>
                <SelectContent>
                    {popularPaths.map((p) => (
                        <SelectItem key={p} value={p}>
                            <span className="font-mono">{p}</span>
                        </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>직접 입력</SelectItem>
                </SelectContent>
            </Select>
            {isCustom && (
                <Input
                    placeholder="경로 prefix (예: /pricing)"
                    value={current.pathPrefix}
                    onChange={(e) => onChange({ ...current, pathPrefix: e.target.value })}
                    className="h-8 w-44 font-mono text-xs"
                />
            )}
        </>
    );
}
