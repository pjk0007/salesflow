import { db, emailUnsubscribes, emailSendLogs, partitions } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr";

/** 수신거부 확인 페이지 경로. wrapTrackingUrls가 이 URL을 이중 래핑하지 않도록 판별에도 쓴다. */
const UNSUBSCRIBE_PATH = "/unsubscribe";

/**
 * 발송 건마다 새로 발급하는 수신거부 토큰. email_click_logs.click_id와 같은 방식.
 * 이메일 주소를 URL에 직접 노출하지 않기 위해 토큰으로 우회한다.
 */
export function generateUnsubscribeToken(): string {
    return `unsub_${nanoid(21)}`;
}

export function buildUnsubscribeUrl(token: string): string {
    return `${BASE_URL}${UNSUBSCRIBE_PATH}?token=${token}`;
}

/** 트래킹 래핑에서 제외해야 하는 수신거부 링크인지 판별. */
export function isUnsubscribeUrl(url: string): boolean {
    return url.startsWith(`${BASE_URL}${UNSUBSCRIBE_PATH}`);
}

/**
 * RFC 8058 원클릭 수신거부 헤더.
 *
 * 메일 클라이언트(Gmail/Apple 등)가 상단에 "구독취소" 버튼을 띄우고,
 * 누르면 이 URL로 곧장 POST한다 — 확인 페이지를 거치지 않는다.
 * 본문 링크가 2단계인 것과 대비되는데, 헤더 경로는 봇이 긁을 수 없으므로
 * 즉시 처리해도 안전하다(본문 링크는 스캐너 프리페치 위험이 있어 확인을 둔다).
 *
 * 2024년 2월 Gmail/Yahoo 대량 발신자 가이드라인이 이 헤더를 요구한다.
 */
export function buildListUnsubscribeHeaders(token: string): Record<string, string> {
    const oneClickUrl = `${BASE_URL}/api/email/unsubscribe/one-click?token=${token}`;
    return {
        "List-Unsubscribe": `<${oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
}

/**
 * 본문 맨 아래에 수신거부 안내를 붙인다. appendSignature와 같은 자리(</body> 직전).
 */
export function appendUnsubscribeFooter(htmlBody: string, unsubscribeUrl: string): string {
    // 수신거부는 눈에 잘 띄어야 한다. 찾기 어려우면 수신자가 스팸 신고를 눌러
    // 발신 도메인 평판이 깎인다(Gmail 발신자 가이드라인도 명확한 노출을 요구).
    const footer =
        `<div style="margin-top:32px; padding-top:16px; border-top:1px solid #e5e5e5; font-size:13px; color:#666; line-height:1.6; text-align:center;">` +
        `이 메일을 더 이상 받고 싶지 않으시면 ` +
        `<a href="${unsubscribeUrl}" style="color:#333; font-weight:600; text-decoration:underline;">수신거부</a>` +
        `를 눌러주세요.` +
        `</div>`;

    if (htmlBody.includes("</body>")) {
        return htmlBody.replace("</body>", footer + "</body>");
    }
    return htmlBody + footer;
}

/**
 * 이 워크스페이스에서 해당 주소가 수신거부 상태인지.
 * 대소문자 차이로 우회되지 않도록 lower()로 비교한다(UNIQUE 인덱스도 동일 기준).
 */
export async function isUnsubscribed(workspaceId: number, email: string): Promise<boolean> {
    const [row] = await db
        .select({ id: emailUnsubscribes.id })
        .from(emailUnsubscribes)
        .where(
            and(
                eq(emailUnsubscribes.workspaceId, workspaceId),
                sql`lower(${emailUnsubscribes.email}) = lower(${email})`
            )
        )
        .limit(1);
    return !!row;
}

/**
 * partitionId로 workspaceId를 찾는다.
 * 발송 로직은 partitionId만 들고 있고 email_send_logs에는 workspace_id가 없다.
 */
export async function resolveWorkspaceId(partitionId: number): Promise<number | null> {
    const [row] = await db
        .select({ workspaceId: partitions.workspaceId })
        .from(partitions)
        .where(eq(partitions.id, partitionId))
        .limit(1);
    return row?.workspaceId ?? null;
}

/**
 * 수신거부 토큰으로 발송 건을 되짚어 거부 대상 정보를 얻는다.
 * 확인 페이지에서 "무엇을 거부하는지" 보여주고, 실제 등록 시 재사용한다.
 */
export async function resolveUnsubscribeTarget(token: string): Promise<{
    orgId: string;
    workspaceId: number;
    email: string;
    sendLogId: number;
    recordId: number | null;
    alreadyUnsubscribed: boolean;
} | null> {
    const [log] = await db
        .select({
            id: emailSendLogs.id,
            orgId: emailSendLogs.orgId,
            partitionId: emailSendLogs.partitionId,
            recipientEmail: emailSendLogs.recipientEmail,
            recordId: emailSendLogs.recordId,
        })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.unsubscribeToken, token))
        .limit(1);

    if (!log || !log.partitionId) return null;

    const workspaceId = await resolveWorkspaceId(log.partitionId);
    if (!workspaceId) return null;

    return {
        orgId: log.orgId,
        workspaceId,
        email: log.recipientEmail,
        sendLogId: log.id,
        recordId: log.recordId,
        alreadyUnsubscribed: await isUnsubscribed(workspaceId, log.recipientEmail),
    };
}

/**
 * 수신거부 등록. 이미 거부된 주소면 조용히 넘어간다(재클릭은 에러가 아니다).
 */
export async function recordUnsubscribe(args: {
    orgId: string;
    workspaceId: number;
    email: string;
    sendLogId?: number;
    recordId?: number | null;
    /** link=본문 링크+확인 페이지, one_click=메일 클라이언트 상단 버튼, manual=운영자 등록 */
    source?: "link" | "one_click" | "manual";
    reason?: string | null;
}): Promise<void> {
    await db
        .insert(emailUnsubscribes)
        .values({
            orgId: args.orgId,
            workspaceId: args.workspaceId,
            email: args.email,
            sendLogId: args.sendLogId ?? null,
            recordId: args.recordId ?? null,
            source: args.source ?? "link",
            reason: args.reason ?? null,
        })
        .onConflictDoNothing();
}

/**
 * 이미 등록된 수신거부에 사유만 덧붙인다.
 * 거부 처리와 사유 수집을 분리해, 사유를 남기지 않아도 거부는 이미 끝나 있게 한다.
 */
export async function attachUnsubscribeReason(token: string, reason: string): Promise<boolean> {
    const target = await resolveUnsubscribeTarget(token);
    if (!target) return false;

    const result = await db
        .update(emailUnsubscribes)
        .set({ reason })
        .where(
            and(
                eq(emailUnsubscribes.workspaceId, target.workspaceId),
                sql`lower(${emailUnsubscribes.email}) = lower(${target.email})`
            )
        )
        .returning({ id: emailUnsubscribes.id });

    return result.length > 0;
}
