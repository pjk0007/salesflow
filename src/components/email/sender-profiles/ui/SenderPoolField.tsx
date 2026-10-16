"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toLimitSettings } from "@/lib/email-sender-limit-rules";
import { useSenderProfiles } from "../hooks/useSenderProfiles";
import { useSenderUsage } from "../hooks/useSenderUsage";
import { usePoolCapacity } from "../hooks/usePoolCapacity";
import type { SenderProfile, SenderUsageView } from "../types";
import {
    inboundReserveNote,
    memberRemainingLabel,
    poolCapacityLine,
    type MemberToday,
} from "../utils/poolCapacity";
import SenderLimitBadges from "./SenderLimitBadges";
import PoolReplyToNotice from "@/components/email/reply-to/ui/PoolReplyToNotice";

interface SenderPoolFieldProps {
    /** 고른 발신 프로필 id (고른 순서로 저장한다 — 발송 순서가 아니다). 빈 배열 = 기본 발신 프로필 */
    value: number[];
    onChange: (ids: number[]) => void;
    showBulkScheduleNotice?: boolean;
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

/** 주소 한 줄 끝의 "남은 6통" / "한도 없음". 사용량을 못 읽었으면 비운다 */
function RemainingToday({ today }: { today?: MemberToday }) {
    const label = today ? memberRemainingLabel(today) : null;
    if (!label) return null;
    return (
        <span
            className={cn(
                "shrink-0 text-xs tabular-nums",
                today?.remaining === 0 ? "text-amber-700" : "text-muted-foreground"
            )}
        >
            {label}
        </span>
    );
}

/**
 * AI 규칙의 발신 주소 묶음 선택. 고른 주소가 위에 모인다 (고른 순서대로 — 우선순위가 아니다).
 * 서버는 오늘 보낼 수 있는 주소 중 가장 오래 쉰 주소부터 돌아가며 고르므로 순서를 바꾸는 칸을 두지 않는다
 * (순서는 쉰 시간이 같을 때만 쓰인다). 대신 주소마다 오늘 남은 수와 묶음 합계를 보인다.
 * 규칙 폼(new/[id]) 두 곳이 공용으로 쓴다. 모양은 AssetPickerField와 같다 ({value, onChange}).
 */
export default function SenderPoolField({ value, onChange, showBulkScheduleNotice = true }: SenderPoolFieldProps) {
    const selectAllId = useId();
    const { profiles, isLoading, loadFailed } = useSenderProfiles();
    const { usageById } = useSenderUsage();
    const { capacity, todayById } = usePoolCapacity(value);

    const byId = new Map(profiles.map((p) => [p.id, p]));
    const picked = new Set(value);
    const rest = profiles.filter((p) => !picked.has(p.id));
    const allSelected = profiles.length > 0 && rest.length === 0;
    // 서버(pickSender)는 기본 표시가 있는 프로필만 기본으로 쓴다 — 목록 첫 줄로 대신하지 않는다
    const defaultProfile = profiles.find((p) => p.isDefault) ?? null;
    const hasMissing = !isLoading && !loadFailed && value.some((id) => !byId.has(id));
    const capacityLine = poolCapacityLine(capacity);
    const reserveNote = inboundReserveNote(capacity, new Date());

    const add = (id: number) => onChange([...value, id]);
    const remove = (id: number) => onChange(value.filter((x) => x !== id));
    const toggleAll = (checked: boolean) => onChange(checked ? [...value, ...rest.map((p) => p.id)] : []);

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
                <>
                    <p className="text-xs text-muted-foreground">
                        메일 한 통은 선택한 주소 중 하나로 나가며, 주소마다 설정한 하루 한도와 웜업을 지킵니다.
                    </p>
                    {showBulkScheduleNotice && (
                        <p className="text-xs text-muted-foreground">
                            하루 한도가 있는 주소는 대량 명단의 메일을 미리 작성한 뒤, 주소별 시간대 안에서 매일 다른 예약 시각에 나눠 보냅니다. 시간대 미지정 시 한국 시간 09~18시를 사용합니다. 한도가 없는 주소는 기존 방식으로 발송합니다.
                        </p>
                    )}
                    {profiles.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <Switch
                                    id={selectAllId}
                                    checked={allSelected}
                                    onCheckedChange={toggleAll}
                                    disabled={loadFailed}
                                    aria-label="발신 프로필 전체 선택"
                                />
                                <Label htmlFor={selectAllId} className="cursor-pointer">전체 선택</Label>
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                                {profiles.length - rest.length} / {profiles.length}개 선택
                            </span>
                        </div>
                    )}
                    <div className="rounded-md border divide-y">
                        {value.map((id) => {
                            const p = byId.get(id);
                            return (
                                <label key={id} className="flex cursor-pointer items-center gap-3 px-3 py-2">
                                    <Checkbox checked onCheckedChange={() => remove(id)} />
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
                                    <RemainingToday today={todayById.get(id)} />
                                </label>
                            );
                        })}
                        {rest.map((p) => (
                            <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2">
                                <Checkbox checked={false} onCheckedChange={() => add(p.id)} />
                                <div className="flex-1 min-w-0">
                                    <ProfileLabel profile={p} usage={usageById.get(p.id)} />
                                </div>
                                <RemainingToday today={todayById.get(p.id)} />
                            </label>
                        ))}
                    </div>
                </>
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
            {capacityLine && (
                <p className="text-xs font-medium tabular-nums">{capacityLine}</p>
            )}
            {reserveNote && <p className="text-xs text-muted-foreground">{reserveNote}</p>}
            {/* 답장은 보낸 주소로 간다 — 묶인 주소의 도메인이 메일을 받지 않으면 알린다 (DESIGN-3) */}
            <PoolReplyToNotice ids={value} />
            {value.length > 1 && (
                <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                    <li>모두 지금 보낼 수 없으면(한도·시간대·정지) 메일을 버리지 않고 가장 먼저 보낼 수 있는 때로 미룹니다.</li>
                    <li>후속 메일은 첫 메일을 보낸 프로필로 이어서 보냅니다.</li>
                </ul>
            )}
        </div>
    );
}
