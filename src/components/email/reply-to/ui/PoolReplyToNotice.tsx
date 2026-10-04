"use client";

import { useReplyToStatus } from "../hooks/useReplyToStatus";
import { POOL_REPLY_NOTICE_TEXT, POOL_REPLY_RECHECK_TEXT, poolNoMxDomains } from "../utils/replyTo";
import ReplyToWarning from "./ReplyToWarning";

interface PoolReplyToNoticeProps {
    /** 폼에서 지금 고른 발신 묶음. 빈 배열 = 기본 발신 프로필 */
    ids: number[];
}

/**
 * 발신 묶음 칸 안내 (DESIGN-3): 고객 답장은 메일을 보낸 주소로 간다. 묶인 주소의 도메인에 메일 수신(MX)이 없으면
 * 그 주소로 나간 메일의 답장은 되돌아간다고 알린다. 답장 주소를 따로 정하는 곳은 없다 — NHN이 Reply-To 헤더를 받지 않는다.
 */
export default function PoolReplyToNotice({ ids }: PoolReplyToNoticeProps) {
    const { loaded, pool } = useReplyToStatus(ids);
    if (!loaded) return null;

    const domains = poolNoMxDomains(pool);
    if (domains.length === 0) return null;

    return (
        <ReplyToWarning>
            <p className="font-medium">{POOL_REPLY_NOTICE_TEXT}</p>
            <p>
                메일 수신(MX)이 없는 도메인: <span className="font-mono">{domains.join(", ")}</span> — 고객 답장은 메일을 보낸
                주소로 가므로, 이 도메인 주소로 나간 메일에 고객이 답장하면 되돌아갑니다.
            </p>
            <p>{POOL_REPLY_RECHECK_TEXT}</p>
        </ReplyToWarning>
    );
}
