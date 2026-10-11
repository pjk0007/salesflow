/**
 * 수동 발송 결과의 "보내지 않은 레코드"를 이유별로 묶는다. 순수 함수만.
 * 서버(POST /api/email/send)가 레코드마다 이유를 주므로 화면은 묶어서 누구인지 함께 보인다.
 */
import type { SendErrorEntry } from "../types";

export interface NotSentGroup {
    message: string;
    count: number;
    /** 이 이유로 보내지 않은 레코드 — "DH-0002 · s2@company-b.test" (서버가 준 순서) */
    recipients: Array<{ recordId: number; label: string }>;
}

/** 레코드를 사람이 알아볼 이름으로. 코드·이메일이 없으면(옛 응답) 레코드 번호 */
export function recipientLabel(e: SendErrorEntry): string {
    const parts = [e.code, e.email].filter((v): v is string => typeof v === "string" && v.trim() !== "");
    return parts.length > 0 ? parts.join(" · ") : `레코드 #${e.recordId}`;
}

/** 같은 문구끼리 묶고 많은 이유부터. 이유 안에서는 서버 순서를 지킨다 */
export function groupNotSent(errors: readonly SendErrorEntry[] | undefined): NotSentGroup[] {
    const groups = new Map<string, NotSentGroup>();
    for (const e of errors ?? []) {
        let g = groups.get(e.error);
        if (!g) {
            g = { message: e.error, count: 0, recipients: [] };
            groups.set(e.error, g);
        }
        g.count++;
        g.recipients.push({ recordId: e.recordId, label: recipientLabel(e) });
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
}
