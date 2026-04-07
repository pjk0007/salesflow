import { db, emailClickLogs, emailSendLogs } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr";

/**
 * 이메일 HTML 본문의 <a href="..."> 링크를 트래킹 URL로 치환합니다.
 * sendLogId가 필요하므로 로그 insert 후에 호출해야 합니다.
 */
export function wrapTrackingUrls(html: string, sendLogId: number): string {
    // <a ... href="URL" ...> 패턴에서 URL 추출 및 치환
    return html.replace(
        /(<a\s[^>]*href\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
        (_match, prefix, url, suffix) => {
            // mailto:, tel:, #앵커, javascript: 등은 제외
            if (/^(mailto:|tel:|#|javascript:)/i.test(url)) {
                return `${prefix}${url}${suffix}`;
            }
            const trackingUrl = `${BASE_URL}/api/track/click?id=${sendLogId}&url=${encodeURIComponent(url)}`;
            return `${prefix}${trackingUrl}${suffix}`;
        }
    );
}

/**
 * 클릭 로그를 기록합니다.
 */
export async function recordClick(
    sendLogId: number,
    url: string,
    ip?: string,
    userAgent?: string,
): Promise<string | null> {
    // sendLog 존재 확인 및 orgId 조회
    const [log] = await db
        .select({ orgId: emailSendLogs.orgId })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.id, sendLogId))
        .limit(1);

    if (!log) return null;

    await db.insert(emailClickLogs).values({
        orgId: log.orgId,
        sendLogId,
        url,
        ip: ip || null,
        userAgent: userAgent || null,
    });

    return url;
}
