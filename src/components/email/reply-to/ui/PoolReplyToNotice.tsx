"use client";

import Link from "next/link";
import { useSession } from "@/contexts/SessionContext";
import { useReplyToStatus } from "../hooks/useReplyToStatus";
import { POOL_REPLY_NOTICE_TEXT, poolReplyNotice, replyToSettingsHref } from "../utils/replyTo";
import ReplyToWarning from "./ReplyToWarning";

interface PoolReplyToNoticeProps {
    /** 규칙의 파티션 — 그 워크스페이스의 답장 받을 주소를 본다 */
    partitionId: number | null | undefined;
    /** 폼에서 지금 고른 발신 묶음. 빈 배열 = 기본 발신 프로필 */
    ids: number[];
}

/**
 * 발신 묶음 칸 안내 (DESIGN-3 3절): 묶인 주소의 도메인에 MX가 없고 워크스페이스 답장 받을 주소도 비어 있으면
 * 고객 답장이 되돌아간다고 알리고 워크스페이스 설정으로 보낸다. 링크는 새 탭으로 연다 — 쓰던 규칙 폼을 잃지 않게.
 * 답장 주소는 관리자만 바꿀 수 있으므로 멤버에게는 링크 대신 요청하라고 알린다.
 */
export default function PoolReplyToNotice({ partitionId, ids }: PoolReplyToNoticeProps) {
    const { user } = useSession();
    const { loaded, replyToEmail, pool, workspaceId } = useReplyToStatus(partitionId, ids);
    if (!partitionId || !loaded) return null;

    const notice = poolReplyNotice(replyToEmail, pool);
    if (!notice) return null;
    const isAdmin = user?.role === "owner" || user?.role === "admin";

    return (
        <ReplyToWarning>
            <p className="font-medium">{POOL_REPLY_NOTICE_TEXT}</p>
            <p>
                메일을 받지 않는 도메인: <span className="font-mono">{notice.domains.join(", ")}</span> — 이 주소로 온
                메일에 고객이 답장하면 되돌아갑니다.
            </p>
            {isAdmin ? (
                <Link
                    href={replyToSettingsHref(workspaceId)}
                    target="_blank"
                    rel="noopener"
                    className="inline-block font-medium underline underline-offset-2"
                >
                    워크스페이스 설정에서 답장 받을 주소 정하기 (새 탭)
                </Link>
            ) : (
                <p>워크스페이스 관리자에게 답장 받을 주소를 정해 달라고 요청하세요.</p>
            )}
        </ReplyToWarning>
    );
}
