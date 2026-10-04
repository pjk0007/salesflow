"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { poolSenderEntries } from "@/lib/reply-to-rules";
import type { ApiResponse } from "@/types";
import type { ReplyToStatusResponse, SenderMxEntry } from "../types";
import { replyToStatusKey } from "../api/replyTo";

/**
 * AI 규칙 화면의 답장 상태 — 규칙 파티션의 워크스페이스 답장 받을 주소와, 폼에서 지금 고른 발신 묶음이 실제로 쓸 주소들의 MX.
 * 묶음 주소는 서버가 준 조직 주소 전부(senders)에서 발송과 같은 규칙(poolSenderEntries)으로 고른다 — 체크를 바꿔도 요청이 다시 나가지 않는다.
 * 요약 칸("답장")과 발신 묶음 칸 안내가 같은 키를 쓰므로 요청은 한 번만 나간다.
 * 안내용이라 실패하면 아무것도 보이지 않는다 — 답장 상태를 못 읽었다고 규칙 저장을 막지 않는다.
 */
export function useReplyToStatus(partitionId: number | null | undefined, profileIds: readonly number[]) {
    // 링크로 연 설정 탭에서 답장 주소를 정하고 돌아오면 창 포커스로 같은 키를 다시 읽어 안내를 걷는다 (SWR 기본 동작 —
    // 같은 키는 다시 읽는 동안에도 이전 값을 그대로 보인다). MX는 서버가 하루 캐시한다.
    // keepPreviousData는 쓰지 않는다: 키는 파티션마다 다르므로, 다른 워크스페이스의 파티션으로 바꾼 직후 이전 워크스페이스의
    // 답장 주소·안내·설정 링크가 새 응답이 올 때까지 남아 보인다 (REVIEW-3 F2). 키가 바뀌면 data가 비고 loaded=false로 가린다
    const { data, error, isLoading } = useSWR<ApiResponse<ReplyToStatusResponse>>(
        replyToStatusKey(partitionId),
        defaultFetcher
    );

    const status = data?.success ? data.data ?? null : null;
    const senders = status?.senders;
    const pool: SenderMxEntry[] = useMemo(() => (senders ? poolSenderEntries(profileIds, senders) : []), [senders, profileIds]);
    const workspace = status?.workspace ?? null;

    return {
        /** 읽었는가. 못 읽었으면 "없음"으로 보이지 않게 가린다 */
        loaded: workspace !== null,
        loadFailed: !!error || (data !== undefined && !data.success),
        isLoading,
        workspaceId: workspace?.id ?? null,
        replyToEmail: workspace?.replyToEmail ?? null,
        replyToMx: workspace?.replyToMx ?? null,
        pool,
    };
}
