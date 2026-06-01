// 광고 그룹 키 — 세션의 referrer + landingPage(utm)에서 "플랫폼별로 아는 만큼" 그룹 단위를 조립.
// 메타는 광고 ID(utm_term)까지, 구글 cpc는 검색 키워드, 구글 pmax는 퉁침, 네이버는 content+키워드.
// classifyInflow 와 동일 정책을 공유 — paid 채널만 광고 그룹으로 본다.

import { classifyInflow, isPaidChannel } from "./referrer";

export interface AdGroup {
    key: string;        // 동일 광고를 식별하는 안정적 키 (집계 GROUP BY 용)
    platform: "meta" | "google" | "naver";
    label: string;      // 화면 표시용 사람이 읽는 라벨
    // 디버깅/상세용 원본 utm
    raw: { source: string | null; medium: string | null; campaign: string | null; content: string | null; term: string | null };
}

function getUtm(landingPage: string | null) {
    const empty = { source: null, medium: null, campaign: null, content: null, term: null } as AdGroup["raw"];
    if (!landingPage) return empty;
    try {
        const q = new URL(landingPage).searchParams;
        // 깨진 제어문자 방어 — utm_medium 등에 \x08 같은 값이 섞여 들어온 케이스 존재.
        const clean = (v: string | null) => {
            if (v == null) return null;
            const c = v.replace(/[\x00-\x1f]/g, "").trim();
            return c.length ? c : null;
        };
        return {
            source: clean(q.get("utm_source")),
            medium: clean(q.get("utm_medium")),
            campaign: clean(q.get("utm_campaign")),
            content: clean(q.get("utm_content")),
            term: clean(q.get("utm_term")),
        };
    } catch {
        return empty;
    }
}

// " · " 로 빈 값 제외하고 이어붙임
function join(parts: Array<string | null | undefined>): string {
    return parts.filter((p) => p && p.trim()).join(" · ");
}

/**
 * 세션을 광고 그룹으로 분류. 유료 광고가 아니면 null.
 *
 * - 메타 광고:    메타 · {campaign} · {content} · {term=광고ID}
 * - 구글 pmax:    구글 · PMax  (캠페인/소재 식별 불가 → 하나로 퉁침)
 * - 구글 cpc:     구글 · 검색 · {term=키워드}
 * - 네이버 검색광고: 네이버 · {content} · {term=키워드}
 */
export function classifyAdGroup(referrer: string | null, landingPage: string | null): AdGroup | null {
    const channel = classifyInflow(referrer, landingPage);
    if (!isPaidChannel(channel)) return null;

    const u = getUtm(landingPage);

    if (channel === "메타 광고") {
        return {
            key: `meta|${u.campaign ?? ""}|${u.content ?? ""}|${u.term ?? ""}`,
            platform: "meta",
            label: join(["메타", u.campaign, u.content, u.term]) || "메타 광고",
            raw: u,
        };
    }

    if (channel === "구글 검색광고") {
        if (u.medium === "pmax") {
            return { key: "google|pmax", platform: "google", label: "구글 · PMax", raw: u };
        }
        // cpc 등 검색광고 — 키워드(term)까지만 식별 가능
        return {
            key: `google|search|${u.term ?? ""}`,
            platform: "google",
            label: u.term ? `구글 · 검색 · ${u.term}` : "구글 · 검색",
            raw: u,
        };
    }

    if (channel === "네이버 검색광고") {
        return {
            key: `naver|${u.content ?? ""}|${u.term ?? ""}`,
            platform: "naver",
            label: join(["네이버", u.content, u.term]) || "네이버 광고",
            raw: u,
        };
    }

    return null;
}
