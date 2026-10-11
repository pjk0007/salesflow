/**
 * 답장 안내 화면 글 — AI 규칙 요약 칸의 "답장" 줄과 발신 묶음 칸 안내. 순수 함수만.
 *
 * 고객 답장은 메일을 보낸 주소(From)로 간다. 답장 주소(Reply-To)를 따로 정할 수 없다 — 2026-10-04 실제 발송에서
 * NHN이 Reply-To 사용자 지정 헤더를 거절했다 (DESIGN-3 6절 "실제 발송 결과(2026-10-04)와 바뀐 결정").
 * 발신 도메인 대부분은 메일을 받지 않으므로(MX 없음) 그 주소로 나간 메일의 답장은 되돌아간다. 그래서 MX가 없는 도메인을
 * 화면에서 알린다. 답장을 받으려면 그 도메인에 메일 수신(MX)을 연결해야 한다 (DESIGN 3-B).
 */
import { MX_NONE_TTL_MS } from "@/lib/reply-to-rules";
import type { SenderMxEntry } from "@/lib/reply-to-rules";

/** 요약 칸 "답장" 줄 — 답장이 가는 곳 */
export const REPLY_SUMMARY_TEXT = "보낸 주소로 갑니다";

export const POOL_REPLY_NOTICE_TEXT =
    "이 주소들은 답장을 받을 수 없습니다 — 도메인에 메일 수신(MX)을 연결해야 답장이 옵니다";

/**
 * 안내 상자 끝 줄 — MX를 연결해도 서버가 "MX 없음"을 MX_NONE_TTL_MS(10분) 동안 기억하므로 바로 걷히지 않는다.
 * 연결이 실패한 줄 알고 DNS를 다시 고치지 않게 언제 다시 확인되는지 알린다 (REVIEW-4 F1)
 */
export const POOL_REPLY_RECHECK_TEXT = `MX를 연결했다면 ${Math.round(MX_NONE_TTL_MS / 60_000)}분쯤 뒤 이 화면을 다시 열면 확인됩니다 (DNS 반영이 늦으면 더 걸릴 수 있습니다).`;

/**
 * 발신 묶음이 실제로 쓸 주소(poolSenderEntries) 중 메일을 받지 않는(MX 없음) 도메인 — 소문자, 중복 없이, 묶음 순서.
 * 받거나(ok) 확인하지 못한(unknown·조회 안 함) 도메인은 넣지 않는다 (확인 못 한 것을 "받을 수 없음"으로 말하지 않는다)
 */
export function poolNoMxDomains(
    entries: ReadonlyArray<Pick<SenderMxEntry, "domain" | "mx">> | null | undefined
): string[] {
    const domains: string[] = [];
    for (const entry of entries ?? []) {
        if (entry.mx !== "none" || !entry.domain) continue;
        const d = entry.domain.toLowerCase();
        if (!domains.includes(d)) domains.push(d);
    }
    return domains;
}

/** 요약 칸 "답장" 줄 아래 노란 글. 받을 수 없는 도메인이 없으면 null */
export function replySummaryWarning(noMxDomains: readonly string[]): string | null {
    return noMxDomains.length > 0 ? `받을 수 없는 도메인 ${noMxDomains.length}곳 — 발신 프로필 칸 참고` : null;
}
