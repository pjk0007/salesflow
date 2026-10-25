import { appendOpenPixel, clickSignature, parseOpenId, verifyClickSignature } from "@/lib/email-open-pixel";
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
    // 링크마다 발송 id+도착 주소 서명을 붙인다 — 서명 없는 주소로 아무 곳에나 보내는 열린 이동을 막는다 (UX-271)
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET 환경 변수가 설정되지 않았습니다.");
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
            const trackingUrl =
                `${BASE_URL}/api/track/click?id=${sendLogId}&url=${encodeURIComponent(decoded)}` +
                `&s=${clickSignature(sendLogId, decoded, secret)}`;
            return `${prefix}${trackingUrl}${suffix}`;
        }
    );
}

/** 서명 없는 예전 클릭 링크를 받아 주는 기간 (발송 시각부터). 그 뒤에는 이동하지 않는다 (UX-271, DECISIONS 참고) */
export const UNSIGNED_CLICK_GRACE_MS = 180 * 24 * 60 * 60 * 1000;

function isWebUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.protocol === "https:" || u.protocol === "http:";
    } catch {
        return false;
    }
}

/** 본문 <a href>의 웹 주소 호스트 (소문자). 서명 없는 예전 링크가 그 메일에 실제로 있던 곳으로만 가는지 본다 */
function bodyLinkHosts(html: string): Set<string> {
    const hosts = new Set<string>();
    for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
        const href = decodeHtmlEntities(m[1]);
        if (!isWebUrl(href)) continue;
        hosts.add(new URL(href).host.toLowerCase());
    }
    return hosts;
}

/**
 * 클릭 추적 주소(/api/track/click?id&url&s)가 이동해도 되는 곳인지 (UX-271). 안 되면 null.
 *   서명 있음  → 발송 id·도착 주소 서명이 맞아야 한다 (오픈 픽셀과 같은 방식)
 *   서명 없음  → 이 변경 전에 보낸 메일의 링크. 발송 기록이 있고, 보낸 지 UNSIGNED_CLICK_GRACE_MS 안이며,
 *               도착 호스트가 그 메일 본문에 있던 링크 호스트일 때만 (아무 외부 주소로나 보내지 않는다)
 * http(s)가 아닌 주소(javascript: 등)는 언제나 거절한다.
 */
export async function verifiedClickTarget(
    params: URLSearchParams,
    now: Date = new Date()
): Promise<{ sendLogId: number; url: string } | null> {
    const sendLogId = parseOpenId(params.get("id"));
    const url = params.get("url");
    if (sendLogId === null || !url || !isWebUrl(url)) return null;
    const signature = params.get("s");
    if (signature !== null) return verifyClickSignature(sendLogId, url, signature) ? { sendLogId, url } : null;

    const [log] = await db
        .select({ body: emailSendLogs.body, sentAt: emailSendLogs.sentAt })
        .from(emailSendLogs)
        .where(eq(emailSendLogs.id, sendLogId))
        .limit(1);
    if (!log?.sentAt || now.getTime() - log.sentAt.getTime() > UNSIGNED_CLICK_GRACE_MS) return null;
    return bodyLinkHosts(log.body ?? "").has(new URL(url).host.toLowerCase()) ? { sendLogId, url } : null;
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
