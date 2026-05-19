"use client";

import { useFields } from "@/hooks/useFields";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const DEFAULT_VALUE = "__default__";

/**
 * 트래커 식별 매칭 필드 선택.
 * 비우면(기본) email/phone 으로 매칭, 지정하면 그 필드로 우선 매칭.
 */
export function MatchFieldSelect({
    workspaceId,
    value,
    onChange,
}: {
    workspaceId: number;
    value: string | null;
    onChange: (v: string | null) => void;
}) {
    const { fields } = useFields(workspaceId);

    // key 중복 제거 (속성 타입이 여러 개면 같은 key가 나올 수 있음)
    const seen = new Set<string>();
    const fieldOptions = fields.filter((f) => {
        if (seen.has(f.key)) return false;
        seen.add(f.key);
        return true;
    });

    return (
        <div className="space-y-1.5">
            <Label htmlFor="match-field">식별 매칭 필드</Label>
            <Select
                value={value ?? DEFAULT_VALUE}
                onValueChange={(v) => onChange(v === DEFAULT_VALUE ? null : v)}
            >
                <SelectTrigger id="match-field">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={DEFAULT_VALUE}>
                        기본 (이메일 · 전화번호)
                    </SelectItem>
                    {fieldOptions.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                            {f.label}{" "}
                            <span className="text-muted-foreground">({f.key})</span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
                방문자를 어떤 필드로 고객 레코드와 연결할지 선택합니다. 비우면
                이메일·전화번호로 자동 매칭됩니다.
            </p>
        </div>
    );
}
