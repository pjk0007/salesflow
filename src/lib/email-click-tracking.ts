import { db, emailClickLogs, emailSendLogs } from "@/lib/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr";

/**
 * HTML href 속성 값에 들어있는 엔티티(&amp; 등)를 진짜 문자로 변환.
 * 그래야 redirect 시 URL이 깨지지 않음.
 */
function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}

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
            // HTML 엔티티 디코딩 (&amp; → &)
            const decoded = decodeHtmlEntities(url);
            const trackingUrl = `${BASE_URL}/api/track/click?id=${sendLogId}&url=${encodeURIComponent(decoded)}`;
            return `${prefix}${trackingUrl}${suffix}`;
        }
    );
}

/**
 * 클릭 로그를 기록하고 click_id 토큰을 발급합니다.
 * 발급된 click_id는 트래커가 사이트 행동을 sendb 리드와 연결하는 키로 사용됩니다.
 */
export async function recordClick(
    sendLogId: number,
    url: string,
    ip?: string,
    userAgent?: string,
): Promise<{ clickId: string } | null> {
    const [log] = await db
        .select({ orgId: emailSendLogs.orgId })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.id, sendLogId))
        .limit(1);

    if (!log) return null;

    const clickId = `clk_${nanoid(21)}`;

    await db.insert(emailClickLogs).values({
        orgId: log.orgId,
        sendLogId,
        url,
        clickId,
        ip: ip || null,
        userAgent: userAgent || null,
    });

    return { clickId };
}

/**
 * 발송 로그에 링크 클릭이 한 번이라도 기록됐는지 여부.
 * 후속 메일 분기(clicked/not_clicked)의 판정 기준 — 수신확인(open)보다 정확.
 */
export async function hasClicked(sendLogId: number): Promise<boolean> {
    const [row] = await db
        .select({ id: emailClickLogs.id })
        .from(emailClickLogs)
        .where(eq(emailClickLogs.sendLogId, sendLogId))
        .limit(1);
    return !!row;
}

/**
 * redirect 도착지 URL에 sendb_cid 파라미터를 부착합니다.
 * 트래커가 이 값을 보고 방문자를 sendb 리드와 자동 연결합니다.
 */
export function appendSendbCid(targetUrl: string, clickId: string): string {
    try {
        const url = new URL(targetUrl);
        url.searchParams.set("sendb_cid", clickId);
        return url.toString();
    } catch {
        // 잘못된 URL이면 원본 그대로 반환
        return targetUrl;
    }
}
