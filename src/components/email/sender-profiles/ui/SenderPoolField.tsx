"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toLimitSettings } from "@/lib/email-sender-limit-rules";
import { useSenderProfiles } from "../hooks/useSenderProfiles";
import { useSenderUsage } from "../hooks/useSenderUsage";
import type { SenderProfile, SenderUsageView } from "../types";
import SenderLimitBadges from "./SenderLimitBadges";

interface SenderPoolFieldProps {
    /** 고른 발신 프로필 id (순서 있음). 빈 배열 = 기본 발신 프로필 */
    value: number[];
    onChange: (ids: number[]) => void;
}

function ProfileLabel({ profile, usage }: { profile: SenderProfile; usage?: SenderUsageView }) {
    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium truncate">{profile.name}</span>
                {profile.isDefault && <Badge variant="secondary" className="text-xs">기본</Badge>}
                <SenderLimitBadges settings={toLimitSettings(profile)} usage={usage} />
            </div>
            <p className="text-xs text-muted-foreground truncate">
                {profile.fromName} &lt;{profile.fromEmail}&gt;
            </p>
        </div>
    );
}

/**
 * AI 규칙의 발신 주소 묶음 선택. 체크한 순서대로 위에 모이고 ↑↓로 순서를 바꾼다.
 * 규칙 폼(new/[id]) 두 곳이 공용으로 쓴다. 모양은 AssetPickerField와 같다 ({value, onChange}).
 */
export default function SenderPoolField({ value, onChange }: SenderPoolFieldProps) {
    const { profiles, isLoading, loadFailed } = useSenderProfiles();
    const { usageById } = useSenderUsage();

    const byId = new Map(profiles.map((p) => [p.id, p]));
    const picked = new Set(value);
    const rest = profiles.filter((p) => !picked.has(p.id));
    // 서버(pickSender)는 기본 표시가 있는 프로필만 기본으로 쓴다 — 목록 첫 줄로 대신하지 않는다
    const defaultProfile = profiles.find((p) => p.isDefault) ?? null;
    const hasMissing = !isLoading && !loadFailed && value.some((id) => !byId.has(id));

    const add = (id: number) => onChange([...value, id]);
    const remove = (id: number) => onChange(value.filter((x) => x !== id));
    const move = (index: number, delta: -1 | 1) => {
        const j = index + delta;
        if (j < 0 || j >= value.length) return;
        const next = [...value];
        [next[index], next[j]] = [next[j], next[index]];
        onChange(next);
    };

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                발신 프로필을 불러오는 중입니다.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {loadFailed && (
                <p className="text-xs text-destructive">발신 프로필 목록을 불러오지 못했습니다. 고른 프로필은 그대로 저장됩니다.</p>
            )}
            {profiles.length === 0 && value.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    등록된 발신 프로필이 없습니다. 이메일 설정 탭에서 추가하세요.
                </p>
            ) : (
                <div className="rounded-md border divide-y">
                    {value.map((id, i) => {
                        const p = byId.get(id);
                        return (
                            <div key={id} className="flex items-center gap-3 px-3 py-2">
                                <label className="flex flex-1 min-w-0 cursor-pointer items-center gap-3">
                                    <Checkbox checked onCheckedChange={() => remove(id)} />
                                    <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                                    <div className="flex-1 min-w-0">
                                        {p ? (
                                            <ProfileLabel profile={p} usage={usageById.get(id)} />
                                        ) : loadFailed ? (
                                            <p className="text-sm text-muted-foreground">프로필 #{id}</p>
                                        ) : (
                                            // 프로필을 지워도 규칙에는 id가 남는다. 이대로 저장하면 서버가 거절하므로 보이게 둔다
                                            <p className="text-sm text-destructive">삭제된 프로필 (#{id})</p>
                                        )}
                                    </div>
                                </label>
                                {value.length > 1 && (
                                    <div className="flex shrink-0 items-center">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => move(i, -1)}
                                            disabled={i === 0}
                                            aria-label="위로"
                                        >
                                            <ChevronUp className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => move(i, 1)}
                                            disabled={i === value.length - 1}
                                            aria-label="아래로"
                                        >
                                            <ChevronDown className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {rest.map((p) => (
                        <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2">
                            <Checkbox checked={false} onCheckedChange={() => add(p.id)} />
                            <span className="w-5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <ProfileLabel profile={p} usage={usageById.get(p.id)} />
                            </div>
                        </label>
                    ))}
                </div>
            )}

            {hasMissing && (
                <p className="text-xs text-destructive">삭제된 프로필이 묶음에 남아 있습니다. 체크를 풀어야 저장할 수 있습니다.</p>
            )}
            {value.length === 0 && (
                <p className="text-xs text-muted-foreground">
                    {defaultProfile
                        ? `선택하지 않으면 기본 발신 프로필(${defaultProfile.fromName} <${defaultProfile.fromEmail}>)로 보냅니다.`
                        : "선택하지 않으면 기본 발신 프로필로 보냅니다."}
                </p>
            )}
            {value.length > 1 && (
                <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                    <li>메일마다 오늘 보낼 수 있는 프로필 중 가장 오래 쉰 프로필로 보냅니다. 쉰 시간이 같으면 위에 있는 프로필부터 씁니다.</li>
                    <li>모두 지금 보낼 수 없으면(한도·시간대·정지) 메일을 버리지 않고 가장 먼저 보낼 수 있는 때로 미룹니다.</li>
                    <li>후속 메일은 첫 메일을 보낸 프로필로 이어서 보냅니다.</li>
                </ul>
            )}
        </div>
    );
}
