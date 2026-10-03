import { and, eq, inArray } from "drizzle-orm";
import { db, emailTemplates } from "@/lib/db";
import { collectLinkTemplateIds } from "@/lib/email-template-link-rules";

/**
 * 템플릿 발송 규칙이 가리키는 템플릿(첫 메일·후속 단계)이 모두 이 조직 것인지 확인한다.
 * 규칙 만들기(POST)·고치기(PUT)가 저장 전에 부른다. 아니면 400에 그대로 쓸 한국어 문구를 준다.
 *
 * 발송 쪽(수동 발송·자동 첫 메일·템플릿 후속)도 템플릿을 조직 조건으로 읽지만, 저장 때 막아야
 * 남의 템플릿 id가 규칙에 남아 "템플릿 없음"으로 조용히 실패하는 일도 없다.
 */
export async function checkLinkTemplatesOwned(
    orgId: string,
    input: { emailTemplateId?: unknown; followupConfig?: unknown }
): Promise<{ ok: true } | { ok: false; error: string }> {
    const collected = collectLinkTemplateIds(input);
    if (!collected.ok) return collected;
    if (collected.ids.length === 0) return { ok: true };

    const owned = await db
        .select({ id: emailTemplates.id })
        .from(emailTemplates)
        .where(and(inArray(emailTemplates.id, collected.ids), eq(emailTemplates.orgId, orgId)));

    if (owned.length !== collected.ids.length) {
        return { ok: false, error: "선택한 이메일 템플릿을 찾을 수 없습니다." };
    }
    return { ok: true };
}
