"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import type { SegmentFilters, ChannelMode } from "../../types/overview";

const DEVICES = [
    { value: "desktop", label: "데스크톱" },
    { value: "mobile", label: "모바일" },
    { value: "tablet", label: "태블릿" },
];

// 채널 드롭다운(상위 그룹). null=전체.
// groupChannel(referrer.ts)의 출력 라벨과 동일해야 함.
const CHANNELS = ["직접", "네이버", "구글", "메타 광고", "메일", "기타"];

// 광고/자연 모드 토글은 "전체/네이버/구글" 일 때만 의미 있음 (검색엔진은 둘이 섞임).
// 그 외(직접·메타 광고·메일·기타)는 토글 숨김.
const CHANNELS_WITH_MODE = new Set<string>(["네이버", "구글"]);

const MODE_OPTIONS: Array<{ value: ChannelMode; label: string }> = [
    { value: "all", label: "전체" },
    { value: "paid", label: "광고만" },
    { value: "organic", label: "자연만" },
];

const ALL = "__all__";

interface Props {
    value: SegmentFilters;
    onChange: (next: SegmentFilters) => void;
}

export function SegmentFilter({ value, onChange }: Props) {
    // 광고/자연 토글 노출 여부: 채널이 null(전체) 또는 검색엔진 그룹일 때만.
    const showMode = value.channel === null || CHANNELS_WITH_MODE.has(value.channel);
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
                onValueChange={(v) => {
                    const nextChannel = v === ALL ? null : v;
                    // 검색엔진 외 채널로 가면 광고/자연 모드는 "all"로 리셋 (의미 없는 조합 방지)
                    const nextMode: ChannelMode = (nextChannel === null || CHANNELS_WITH_MODE.has(nextChannel))
                        ? value.channelMode
                        : "all";
                    onChange({ ...value, channel: nextChannel, channelMode: nextMode });
                }}
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

            {showMode && (
                <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-[11px]">
                    {MODE_OPTIONS.map((m) => (
                        <button
                            key={m.value}
                            type="button"
                            onClick={() => onChange({ ...value, channelMode: m.value })}
                            className={
                                value.channelMode === m.value
                                    ? "rounded bg-background px-2 py-0.5 font-medium shadow-sm"
                                    : "rounded px-2 py-0.5 text-muted-foreground hover:text-foreground"
                            }
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
            )}

            {(value.device || value.channel || value.channelMode !== "all") && (
                <button
                    type="button"
                    onClick={() => onChange({ device: null, channel: null, channelMode: "all" })}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <X className="h-3 w-3" />
                    필터 해제
                </button>
            )}
        </div>
    );
}
