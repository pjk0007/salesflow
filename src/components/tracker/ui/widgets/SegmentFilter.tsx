"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import type { SegmentFilters } from "../../types/overview";

const DEVICES = [
    { value: "desktop", label: "데스크톱" },
    { value: "mobile", label: "모바일" },
    { value: "tablet", label: "태블릿" },
];

const CHANNELS = ["직접", "네이버", "구글 검색", "구글 검색광고", "메타 광고", "메일", "기타"];

const ALL = "__all__";

interface Props {
    value: SegmentFilters;
    onChange: (next: SegmentFilters) => void;
}

export function SegmentFilter({ value, onChange }: Props) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Select
                value={value.device ?? ALL}
                onValueChange={(v) => onChange({ ...value, device: v === ALL ? null : (v as SegmentFilters["device"]) })}
            >
                <SelectTrigger className="h-8 w-32 text-xs">
                    <SelectValue placeholder="디바이스" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>전체 디바이스</SelectItem>
                    {DEVICES.map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select
                value={value.channel ?? ALL}
                onValueChange={(v) => onChange({ ...value, channel: v === ALL ? null : v })}
            >
                <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue placeholder="유입 채널" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={ALL}>전체 채널</SelectItem>
                    {CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {(value.device || value.channel) && (
                <button
                    type="button"
                    onClick={() => onChange({ device: null, channel: null })}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <X className="h-3 w-3" />
                    필터 해제
                </button>
            )}
        </div>
    );
}
