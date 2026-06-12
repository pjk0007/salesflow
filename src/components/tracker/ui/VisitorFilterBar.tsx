"use client";

import { useMemo } from "react";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import type { TrackerPageItem } from "../hooks/useTrackerPages";

// SegmentFilter(개요 탭)의 상위 채널 그룹과 동일 — groupChannel(referrer.ts) 출력 라벨.
const CHANNELS = ["직접", "네이버", "구글", "메타 광고", "메일", "기타"];

const ALL = "__all__";

export type VisitorFilters = {
    pagePath: string | null;
    channel: string | null;
};

interface Props {
    pages: TrackerPageItem[];
    /** 분석 제외 경로 prefix (사이트 설정 excludePaths) — 매칭 페이지는 하단 그룹으로 분리 */
    excludePaths: string[];
    value: VisitorFilters;
    onChange: (next: VisitorFilters) => void;
}

/** 방문자 탭 전용 — 방문 페이지 + 유입경로 필터 */
export function VisitorFilterBar({ pages, excludePaths, value, onChange }: Props) {
    // title이 비었거나 다른 path와 중복이면 path를 메인 라벨로 승격 (SPA 등 title 미변경 대비)
    // 분석 제외 경로(로그인 후 영역 등)는 별도 그룹으로 분리해 하단 배치.
    const { publicPages, memberPages } = useMemo(() => {
        const titleCounts = new Map<string, number>();
        for (const p of pages) {
            if (p.title) titleCounts.set(p.title, (titleCounts.get(p.title) ?? 0) + 1);
        }
        const labeled = pages.map((p) => {
            const dupOrEmpty = !p.title || (titleCounts.get(p.title) ?? 0) > 1;
            return {
                ...p,
                main: dupOrEmpty ? p.path : (p.title as string),
                sub: dupOrEmpty ? null : p.path,
            };
        });
        // SQL의 LIKE 'prefix%'와 동일 기준 — "/main"이 "/main/"에도 매칭되도록 양쪽 모두 비교
        const isMember = (path: string) =>
            excludePaths.some((prefix) => path.startsWith(prefix) || (path + "/").startsWith(prefix));
        return {
            publicPages: labeled.filter((p) => !isMember(p.path)),
            memberPages: labeled.filter((p) => isMember(p.path)),
        };
    }, [pages, excludePaths]);

    const renderItem = (p: (typeof publicPages)[number]) => (
        <SelectItem key={p.path} value={p.path}>
            <span className="flex items-center gap-1.5">
                <span className="max-w-44 truncate">{p.main}</span>
                {p.sub && (
                    <span className="max-w-28 truncate text-xs text-muted-foreground">{p.sub}</span>
                )}
                <span className="text-xs tabular-nums text-muted-foreground">
                    · {p.views.toLocaleString()}뷰
                </span>
            </span>
        </SelectItem>
    );

    return (
        <>
            <Select
                value={value.pagePath ?? ALL}
                onValueChange={(v) => onChange({ ...value, pagePath: v === ALL ? null : v })}
            >
                <SelectTrigger className="w-64">
                    <SelectValue placeholder="페이지" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>전체 페이지</SelectItem>
                    {publicPages.map(renderItem)}
                    {memberPages.length > 0 && (
                        <>
                            <SelectSeparator />
                            <SelectGroup>
                                <SelectLabel className="bg-muted/60 font-medium text-foreground">
                                    분석 제외 영역
                                </SelectLabel>
                                {memberPages.map(renderItem)}
                            </SelectGroup>
                        </>
                    )}
                </SelectContent>
            </Select>

            <Select
                value={value.channel ?? ALL}
                onValueChange={(v) => onChange({ ...value, channel: v === ALL ? null : v })}
            >
                <SelectTrigger className="w-36">
                    <SelectValue placeholder="유입경로" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>전체 유입경로</SelectItem>
                    {CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>
                            {c}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {(value.pagePath || value.channel) && (
                <button
                    type="button"
                    onClick={() => onChange({ pagePath: null, channel: null })}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                    <X className="h-3 w-3" />
                    필터 해제
                </button>
            )}
        </>
    );
}
