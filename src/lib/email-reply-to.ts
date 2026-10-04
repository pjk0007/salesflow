/**
 * 레코드의 워크스페이스 → 답장 받을 주소 (DESIGN-3 1절). 발송 경로가 NHN customHeaders에 Reply-To를 넣을 때 쓴다.
 *
 * 워크스페이스는 메일을 받는 레코드의 records.workspace_id다 (레코드가 없으면 규칙·로그 파티션의 워크스페이스).
 * 규칙·캐시는 reply-to-rules.ts(순수), 여기는 DB 조회만 붙인다.
 * 워커(대기열·후속·반복)는 회차마다 newReplyToResolver()를 하나 만들어 줄마다 넘긴다.
 */
import { db, workspaces } from "@/lib/db";
import { eq } from "drizzle-orm";
import { resolveWorkspaceId } from "@/lib/email-unsubscribe";
import { createReplyToResolver } from "@/lib/reply-to-rules";
import type { ReplyToResolver } from "@/lib/reply-to-rules";

export type { ReplyToResolver };

/** 워크스페이스에 저장된 답장 받을 주소 (없으면 null) */
export async function loadWorkspaceReplyTo(workspaceId: number): Promise<string | null> {
    const [row] = await db
        .select({ replyToEmail: workspaces.replyToEmail })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
    return row?.replyToEmail ?? null;
}

/** 새 회차 캐시. 한 건씩 보내는 경로는 호출마다 하나, 워커는 회차마다 하나 */
export function newReplyToResolver(): ReplyToResolver {
    return createReplyToResolver({
        loadWorkspaceReplyTo,
        loadPartitionWorkspaceId: resolveWorkspaceId,
    });
}
