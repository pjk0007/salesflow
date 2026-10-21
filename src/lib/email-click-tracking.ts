import { appendOpenPixel } from "@/lib/email-open-pixel";
import { db, emailClickLogs, emailSendLogs } from "@/lib/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { isUnsubscribeUrl } from "@/lib/email-unsubscribe";

import { BURST_WINDOW_MS, instantBotReason, newBurstClickIds } from "@/lib/email-click-bot-rules";

const CLICK_BURST_LOCK = 0x5c4edf14;
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
            // 수신거부 링크는 트래킹하지 않는다.
            // 감싸면 수신거부 클릭이 CTA 클릭으로 집계되어 후속 메일 분기(hasClicked)가 오염된다.
            if (isUnsubscribeUrl(url)) {
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
 * 클릭 로그를 기록하고 click_id 토큰을 발급합니다. 봇 판정(R6, is_bot·bot_reason)을 함께 저장합니다.
 * 판정 입력은 UA·발송 시각·같은 발송의 다른 클릭뿐 — 트래커 데이터는 보지 않는다.
 * 봇으로 판정돼도 click_id는 그대로 발급되고 트래커 매칭 키로 쓰인다.
 */
export async function recordClick(
    sendLogId: number,
    url: string,
    ip?: string,
    userAgent?: string,
): Promise<{ clickId: string } | null> {
    const [log] = await db
        .select({ orgId: emailSendLogs.orgId, sentAt: emailSendLogs.sentAt })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.id, sendLogId))
        .limit(1);
    if (!log) return null;

    const { orgId, sentAt } = log;
    const clickId = `clk_${nanoid(21)}`;
    const ua = userAgent || null;

    await db.transaction(async (tx) => {
        // 1) 발송 단위 잠금 (커밋까지). 뒤 요청은 앞 요청의 클릭이 커밋된 뒤에 판정한다 (B10)
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${CLICK_BURST_LOCK}, ${sendLogId})`);
        // 저장 시각과 판정 시각을 맞춰 백필과 같은 결과를 유지한다.
        const clickedAt = new Date();
        const reason = instantBotReason({ userAgent: ua, sentAt, clickedAt });
        await tx.insert(emailClickLogs).values({
            orgId, sendLogId, url, clickId, ip: ip || null, userAgent: ua,
            clickedAt, isBot: reason !== null, botReason: reason,
        });
        // 4) ±2·BURST_WINDOW_MS 창. 새 클릭 ±10초 안 클릭들의 이웃(각자 ±10초)이 모두 들어온다
        const nearby = await tx
            .select({
                id: emailClickLogs.id,
                sendLogId: emailClickLogs.sendLogId,
                clickedAt: emailClickLogs.clickedAt,
                isBot: emailClickLogs.isBot,
            })
            .from(emailClickLogs)
            .where(and(
                eq(emailClickLogs.sendLogId, sendLogId),
                gte(emailClickLogs.clickedAt, new Date(clickedAt.getTime() - 2 * BURST_WINDOW_MS)),
                lte(emailClickLogs.clickedAt, new Date(clickedAt.getTime() + 2 * BURST_WINDOW_MS)),
            ));
        // 5) 아직 봇이 아닌 연속 클릭만 burst (B9·B11). is_bot = false 조건은 DB 쪽 안전장치
        const burstIds = newBurstClickIds(nearby);
        if (burstIds.length > 0) {
            await tx.update(emailClickLogs)
                .set({ isBot: true, botReason: "burst" })
                .where(and(
                    eq(emailClickLogs.sendLogId, sendLogId),
                    inArray(emailClickLogs.id, burstIds),
                    eq(emailClickLogs.isBot, false),
                ));
        }
    });

    return { clickId };
}

/**
 * 후속 메일 분기(clicked/not_clicked)는 사람 클릭(is_bot = false)만 기준으로 삼는다.
 * 봇 클릭만 있는 발송이면 false를 반환한다.
 */
export async function hasClicked(sendLogId: number): Promise<boolean> {
    const [row] = await db
        .select({ id: emailClickLogs.id })
        .from(emailClickLogs)
        .where(and(eq(emailClickLogs.sendLogId, sendLogId), eq(emailClickLogs.isBot, false)))
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

/** DB body는 추적 전 본문을 저장하며, 발송 로그 insert 뒤 NHN 직전에 호출한다. */
export function applyEmailTracking(html: string, sendLogId: number): string {
    return appendOpenPixel(wrapTrackingUrls(html, sendLogId), sendLogId);
}
