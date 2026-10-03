/**
 * 템플릿 발송 규칙(email_template_links)이 가리키는 템플릿 id 모으기. DB를 모른다.
 *
 * 규칙은 첫 메일 템플릿(emailTemplateId)과 후속 단계 템플릿(followupConfig의 onClicked/onNotClicked.templateId)을
 * 가리킨다. 저장할 때 이 id가 모두 이 조직 템플릿인지 확인해야 한다 — 확인하지 않으면 다른 조직 템플릿 id를 넣은
 * 규칙으로 그 조직 템플릿 내용을 받아 볼 수 있다. 소유 확인(DB)은 email-template-ownership.ts가 한다.
 */

export type TemplateIdsResult = { ok: true; ids: number[] } | { ok: false; error: string };

const INVALID_ID = "템플릿 id가 올바르지 않습니다.";
const INVALID_FOLLOWUP = "후속 발송 설정 형식이 올바르지 않습니다.";

/** 양의 정수 또는 그런 숫자 문자열만 id로 읽는다. 아니면 null */
function readTemplateId(v: unknown): number | null {
    if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) {
        const n = Number(v.trim());
        return Number.isSafeInteger(n) && n > 0 ? n : null;
    }
    return null;
}

/**
 * 규칙이 가리키는 템플릿 id를 중복 없이 모은다.
 *   emailTemplateId  undefined면 보지 않는다 (수정 API는 이 칸을 받지 않는다). 그 밖에는 반드시 올바른 id
 *   followupConfig   null·undefined면 후속 없음. 단계 하나(객체) 또는 단계 목록. 분기의 templateId는 비어 있어도 된다
 *                    (그 분기는 보내지 않는다) — 있으면 올바른 id여야 한다
 */
export function collectLinkTemplateIds(input: { emailTemplateId?: unknown; followupConfig?: unknown }): TemplateIdsResult {
    const ids = new Set<number>();

    if (input.emailTemplateId !== undefined) {
        const id = readTemplateId(input.emailTemplateId);
        if (id === null) return { ok: false, error: INVALID_ID };
        ids.add(id);
    }

    const config = input.followupConfig;
    if (config !== undefined && config !== null) {
        const steps: unknown[] = Array.isArray(config) ? config : [config];
        for (const step of steps) {
            if (!step || typeof step !== "object") return { ok: false, error: INVALID_FOLLOWUP };
            for (const branch of ["onClicked", "onNotClicked"] as const) {
                const action = (step as Record<string, unknown>)[branch];
                if (action === undefined || action === null) continue;
                if (typeof action !== "object") return { ok: false, error: INVALID_FOLLOWUP };
                const raw = (action as Record<string, unknown>).templateId;
                // 비운 분기는 "보내지 않음"이다 (후속 워커도 templateId가 없으면 건너뛴다)
                if (raw === undefined || raw === null || raw === "" || raw === 0) continue;
                const id = readTemplateId(raw);
                if (id === null) return { ok: false, error: INVALID_ID };
                ids.add(id);
            }
        }
    }

    return { ok: true, ids: [...ids] };
}
