import { db } from "@/lib/db";
import { createEmailUnsubscribeStore } from "./email-unsubscribe-store";
import { buildPublicUnsubscribeUrl, isPublicUnsubscribeUrl } from "./email-public-url";
import { nanoid } from "nanoid";

export const {
    isOrganizationUnsubscribed, isUnsubscribed, resolveWorkspaceId, resolveUnsubscribeTarget,
    recordUnsubscribe, attachUnsubscribeReason,
} = createEmailUnsubscribeStore(db);

/**
 * 발송 건마다 새로 발급하는 수신거부 토큰. email_click_logs.click_id와 같은 방식.
 * 이메일 주소를 URL에 직접 노출하지 않기 위해 토큰으로 우회한다.
 */
export function generateUnsubscribeToken(): string {
    return `unsub_${nanoid(21)}`;
}

export function buildUnsubscribeUrl(token: string): string {
    return buildPublicUnsubscribeUrl(token);
}

/** 트래킹 래핑에서 제외해야 하는 수신거부 링크인지 판별. */
export function isUnsubscribeUrl(url: string): boolean {
    return isPublicUnsubscribeUrl(url);
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
    const oneClickUrl = buildPublicUnsubscribeUrl(token, true);
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
