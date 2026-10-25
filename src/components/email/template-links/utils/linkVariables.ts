import { collectLinkTemplateIds } from "@/lib/email-template-link-rules";
import { unmappedEmailVariables } from "@/lib/email-utils";

interface TemplateText {
    id: number;
    subject: string;
    htmlBody: string;
}

/**
 * 연결이 보내는 모든 템플릿(첫 메일 + 후속 단계)의 변수 — 연결 화면의 변수 매핑 목록 (UX-163).
 * 후속 템플릿에만 있는 변수도 여기서 매핑해야 한다. 발송 경로는 연결의 매핑 하나로 모든 단계를 치환한다.
 */
export function linkTemplateTexts(
    templates: readonly TemplateText[],
    emailTemplateId: number | null,
    followupConfig: unknown
): string[] {
    const collected = collectLinkTemplateIds({ emailTemplateId: emailTemplateId ?? undefined, followupConfig });
    const ids = collected.ok ? collected.ids : emailTemplateId ? [emailTemplateId] : [];
    return ids.flatMap((id) => {
        const template = templates.find((t) => t.id === id);
        return template ? [template.subject, template.htmlBody] : [];
    });
}

/** 화면 표시용: 전체 변수, 매핑 안 된 변수 */
export function linkVariableStatus(texts: readonly string[], mappings: Record<string, string>) {
    const all = unmappedEmailVariables(texts, {});
    const unmapped = unmappedEmailVariables(texts, mappings);
    return { all, unmapped, mappedCount: all.length - unmapped.length };
}
