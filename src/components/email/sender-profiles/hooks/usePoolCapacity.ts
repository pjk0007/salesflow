"use client";

import { useMemo } from "react";
import { toLimitSettings } from "@/lib/email-sender-limit-rules";
import { useSenderProfiles } from "./useSenderProfiles";
import { useSenderUsage } from "./useSenderUsage";
import { memberToday, poolCapacity, type MemberToday, type PoolCapacity } from "../utils/poolCapacity";

/**
 * 발신 주소 묶음의 오늘 용량과 주소별 오늘 상태.
 * 빈 묶음은 기본 발신 프로필 하나로 본다 (서버 pickSender와 같게 — 기본 표시가 없으면 아무 주소도 세지 않는다).
 * 지워진 프로필은 용량을 알 수 없어 세지 않는다. 프로필·사용량 SWR 키를 SenderPoolField와 같이 써서 요청이 더 나가지 않는다.
 */
export function usePoolCapacity(ids: readonly number[]): {
    capacity: PoolCapacity;
    todayById: Map<number, MemberToday>;
    isLoading: boolean;
} {
    const { profiles, isLoading } = useSenderProfiles();
    const { usageById } = useSenderUsage();

    const computed = useMemo(() => {
        const now = new Date();
        const todayById = new Map(
            profiles.map((p) => [p.id, memberToday(toLimitSettings(p), usageById.get(p.id), now)] as const)
        );
        const poolIds = ids.length > 0 ? ids : profiles.filter((p) => p.isDefault).map((p) => p.id);
        const members = poolIds.flatMap((id) => todayById.get(id) ?? []);
        return { capacity: poolCapacity(members), todayById };
    }, [ids, profiles, usageById]);

    return { ...computed, isLoading };
}
