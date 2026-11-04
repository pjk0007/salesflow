import { classifyInflow, parseUtm } from "@/components/journey/utils/referrer";

/** 경로의 연결 근거다. 수신자 본인 확인이나 전환의 인과관계 판정이 아니다. */
export interface AlertAcquisition {
    channel: string;
    certainty: "confirmed" | "inferred" | "unknown";
    evidence: string;
}
export const unknownAcquisition = (evidence = "판단할 단서 부족"): AlertAcquisition =>
    ({ channel: "유입 미확인", certainty: "unknown", evidence });
export function acquisitionText(value: AlertAcquisition = unknownAcquisition()): string {
    return `${value.channel}${value.certainty === "unknown" ? "" : ` [${value.certainty === "confirmed" ? "확인" : "추정"}]`} — ${value.evidence}`;
}
export function senderDomain(address: string | null | undefined): string | null {
    const match = /^[^\s<>@]+@([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63})$/i.exec(address?.trim() ?? "");
    return match && !match[1].includes("..") ? match[1].toLowerCase() : null;
}
export function mailAcquisition(address: string | null | undefined, direct: boolean, journey = false): AlertAcquisition {
    const domain = senderDomain(address);
    return {
        channel: `메일 · ${domain ?? "발신 도메인 미확인"}`,
        certainty: direct ? "confirmed" : "inferred",
        evidence: direct ? journey ? "해당 레코드의 메일 클릭과 이번 방문이 직접 연결됨" : "메일 클릭과 상담 방문의 직접 연결 기록 있음"
            : "최근 발송·방문 단서는 있으나 접수와의 직접 연결 기록은 없음",
    };
}
export function websiteAcquisition(session: { referrer: string | null; landingPage: string | null }, direct: boolean): AlertAcquisition {
    let ref = "", host = "";
    try { const url = new URL(session.referrer ?? ""); if (["https:", "http:"].includes(url.protocol)) { ref = url.origin; host = url.hostname; } } catch { /* 원문 URL을 출력하지 않는다. */ }
    const channel = classifyInflow(ref || null, session.landingPage);
    const utm = parseUtm(session.landingPage);
    if (channel === "직접" || channel === "기타") return unknownAcquisition();
    if (channel === "메일") return { channel: "메일 · 발신 도메인 미확인", certainty: "inferred", evidence: "메일 유입 표시는 있으나 유효한 발송·클릭 연결 기록은 없음" };
    // URL 문자열의 google.com 조각이나 UTM만으로 검색 방문을 확정하지 않는다.
    const searchRef = channel === "구글 검색" ? /(^|\.)google\.(com|co\.kr|co\.jp|co\.uk)$/.test(host)
        : channel === "네이버 검색" ? host === "search.naver.com"
        : channel === "검색" ? /(^|\.)(bing\.com|duckduckgo\.com|daum\.net)$/.test(host) : false;
    if (channel === "구글 검색" && host && !searchRef && !utm.source) return unknownAcquisition();
    if (channel === "네이버 검색" && host && !searchRef && !utm.source) return unknownAcquisition();
    const confirmed = direct && searchRef;
    return { channel: `홈페이지 · ${channel}`, certainty: confirmed ? "confirmed" : "inferred",
        evidence: confirmed ? "검색 방문과 상담의 직접 연결 기록 있음" : "방문·유입 표시가 있으나 접수까지의 직접 연결은 미확인" };
}

/** 부가 정보 조회 실패로 기존 상담 알림을 중단하지 않는다. */
export async function optionalAcquisition(load: () => Promise<AlertAcquisition>): Promise<AlertAcquisition> {
    try { return await load(); }
    catch { console.warn("[alert-acquisition] 유입 기록 조회 실패"); return unknownAcquisition("유입 기록 조회 실패"); }
}
