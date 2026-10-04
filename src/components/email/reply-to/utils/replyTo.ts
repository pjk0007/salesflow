/**
 * 사업(워크스페이스)별 답장 받을 주소(Reply-To) 화면 글 — 워크스페이스 설정 칸, AI 규칙 요약 칸, 발신 묶음 칸 안내. 순수 함수만.
 *
 * 서버는 워크스페이스에 답장 받을 주소가 있으면 그 워크스페이스로 나가는 모든 메일에 Reply-To 헤더를 넣고,
 * 비어 있으면 넣지 않는다 (예전과 같음 — 답장이 발신 주소로 간다). 발신 도메인 대부분은 메일을 받지 않으므로(MX 없음)
 * 답장 주소가 비어 있으면 고객 답장이 되돌아간다. 그래서 MX가 없는 도메인을 화면에서 알린다 (DESIGN-3 3절).
 * 형식 검사·도메인·발신 묶음 주소 고르기는 서버와 같은 순수 함수(@/lib/reply-to-rules)를 쓴다.
 */
import { emailDomain, normalizeReplyToInput } from "@/lib/reply-to-rules";
import type { MxStatus, SenderMxEntry } from "@/lib/reply-to-rules";

export type { MxStatus, SenderMxEntry };

export const REPLY_TO_HELP =
    "이 사업으로 나가는 모든 메일의 답장이 이 주소로 옵니다. 메일을 받을 수 있는 주소여야 합니다(예: 회사 메일).";

export const REPLY_TO_NONE_LABEL = "없음 — 답장이 발신 주소로 갑니다";

export const POOL_REPLY_NOTICE_TEXT = "이 주소들은 답장을 받을 수 없습니다. 워크스페이스에 답장 받을 주소를 정하세요.";

/**
 * 칸에 적은 값을 저장할 값으로 (서버와 같은 검사 — 앞뒤 공백을 지우고 도메인은 소문자).
 * 비었으면 value null (= 답장 주소 없음, Reply-To 헤더 없음). 형식이 아니면 오류 글
 */
export function replyToFieldValue(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
    return normalizeReplyToInput(raw);
}

/** AI 규칙 요약 칸의 "답장" 줄. 주소가 없으면 답장이 발신 주소로 간다고 알린다 */
export function replyToSummary(replyToEmail: string | null | undefined): { text: string; isSet: boolean } {
    const v = replyToEmail?.trim();
    return v ? { text: v, isSet: true } : { text: REPLY_TO_NONE_LABEL, isSet: false };
}

/**
 * 저장 응답의 MX 결과로 칸 아래에 보일 안내. 저장은 이미 되었다 (MX가 없어도 막지 않는다 — DNS 일시 오류일 수 있다).
 * - none: 노란 경고 — 그 도메인은 메일을 받지 않으므로 답장이 도착하지 않는다
 * - unknown: 회색 안내 — 확인하지 못했다
 * - ok·없음(null, 주소를 비웠거나 옛 서버): 안내 없음
 */
export function replyToMxNotice(
    mx: MxStatus | null | undefined,
    email: string | null | undefined
): { tone: "warning" | "muted"; text: string } | null {
    if (!email || !mx || mx === "ok") return null;
    const domain = emailDomain(email) ?? email;
    if (mx === "none") {
        return {
            tone: "warning",
            text: `${domain} 도메인은 메일을 받는 서버(MX)가 없어 이 주소로는 답장이 도착하지 않습니다. 저장은 되었습니다 — 메일을 받을 수 있는 주소(예: 회사 메일)로 바꾸세요.`,
        };
    }
    return {
        tone: "muted",
        text: `${domain} 도메인의 메일 받는 서버(MX)를 지금 확인하지 못했습니다. 저장은 되었습니다 — 메일을 받을 수 있는 주소인지 확인하세요.`,
    };
}

/**
 * 발신 묶음 칸 안내: 묶음이 실제로 쓸 주소(poolSenderEntries) 중 메일을 받지 않는 도메인(MX 없음)이 있고
 * 워크스페이스 답장 주소도 비어 있으면 그 도메인 목록(중복 없이, 묶음 순서).
 * 답장 주소가 있거나, 모두 받거나, 확인하지 못한 도메인(unknown·조회 안 함)뿐이면 null
 */
export function poolReplyNotice(
    replyToEmail: string | null | undefined,
    entries: ReadonlyArray<Pick<SenderMxEntry, "domain" | "mx">> | null | undefined
): { domains: string[] } | null {
    if (replyToEmail?.trim()) return null;
    const domains: string[] = [];
    for (const entry of entries ?? []) {
        if (entry.mx !== "none" || !entry.domain) continue;
        const d = entry.domain.toLowerCase();
        if (!domains.includes(d)) domains.push(d);
    }
    return domains.length > 0 ? { domains } : null;
}

/** 템플릿 테스트 발송 대화상자의 "고르지 않음" 값 (Radix Select는 빈 값을 쓸 수 없다) */
export const TEST_SEND_NO_WORKSPACE = "none";

/**
 * 템플릿 테스트 발송(POST /api/email/test-send)에 넘길 workspaceId. 템플릿은 조직 단위라 어느 사업의 답장 주소를 넣을지 모른다.
 * - 워크스페이스가 하나뿐이면 넘기지 않는다 (undefined) — 서버가 그 워크스페이스의 답장 주소를 쓴다
 * - 여럿이면 대화상자에서 고른 사업. 고르지 않았거나 목록에 없는 값이면 undefined — 서버는 Reply-To를 넣지 않는다 (예전과 같음)
 */
export function testSendWorkspaceId(workspaceIds: readonly number[], selected: string): number | undefined {
    if (workspaceIds.length < 2 || selected === TEST_SEND_NO_WORKSPACE) return undefined;
    const id = Number(selected);
    return workspaceIds.includes(id) ? id : undefined;
}

/** 워크스페이스 설정의 답장 받을 주소 칸으로 가는 주소 (그 워크스페이스를 골라 연다) */
export function replyToSettingsHref(workspaceId: number | null | undefined): string {
    return workspaceId ? `/settings/workspace?tab=workspace&workspaceId=${workspaceId}` : "/settings/workspace?tab=workspace";
}
