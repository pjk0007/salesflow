"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { poolSenderEntries } from "@/lib/reply-to-rules";
import type { ApiResponse } from "@/types";
import type { ReplyToStatusResponse, SenderMxEntry } from "../types";
import { REPLY_TO_STATUS_KEY } from "../api/replyTo";

/**
 * AI 규칙 화면의 답장 안내 — 폼에서 지금 고른 발신 묶음이 실제로 쓸 주소들과 그 도메인의 MX.
 * 고객 답장은 메일을 보낸 주소로 가므로, MX가 없는 도메인 주소로 나간 메일의 답장은 되돌아간다.
 * 묶음 주소는 서버가 준 조직 주소 전부(senders)에서 발송과 같은 규칙(poolSenderEntries)으로 고른다 — 체크를 바꿔도 요청이 다시 나가지 않는다.
 * 요약 칸("답장")과 발신 묶음 칸 안내가 같은 키를 쓰므로 요청은 한 번만 나간다.
 * 안내용이라 실패하면 아무것도 보이지 않는다 — 답장 안내를 못 읽었다고 규칙 저장을 막지 않는다.
 */
export function useReplyToStatus(profileIds: readonly number[]) {
    const { data, error, isLoading } = useSWR<ApiResponse<ReplyToStatusResponse>>(REPLY_TO_STATUS_KEY, defaultFetcher);

    const status = data?.success ? data.data ?? null : null;
    const senders = status?.senders;
    const pool: SenderMxEntry[] = useMemo(() => (senders ? poolSenderEntries(profileIds, senders) : []), [senders, profileIds]);

    return {
        /** 읽었는가. 못 읽었으면 "받을 수 있음"으로 보이지 않게 가린다 */
        loaded: senders !== undefined,
        loadFailed: !!error || (data !== undefined && !data.success),
        isLoading,
        pool,
    };
}
