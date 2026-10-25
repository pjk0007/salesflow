import { and, eq, inArray } from "drizzle-orm";
import { db, emailTemplateLinks, emailTemplates, partitions, workspaces } from "@/lib/db";
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

/**
 * 이 템플릿을 첫 메일 또는 후속 단계로 쓰는 이 조직의 템플릿 연결(자동 발송 규칙).
 * 템플릿을 지우면 첫 메일로 쓰는 연결은 DB CASCADE로 함께 지워지고, 후속으로 쓰는 연결은 그 단계가 조용히 멈춘다 —
 * 삭제 전에 이 목록이 비어 있는지 확인한다 (UX-157).
 */
export async function findLinksUsingTemplate(orgId: string, templateId: number): Promise<Array<{ id: number; name: string }>> {
    const links = await db
        .select({ id: emailTemplateLinks.id, name: emailTemplateLinks.name, emailTemplateId: emailTemplateLinks.emailTemplateId, followupConfig: emailTemplateLinks.followupConfig })
        .from(emailTemplateLinks)
        .innerJoin(partitions, eq(partitions.id, emailTemplateLinks.partitionId))
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(eq(workspaces.orgId, orgId));
    return links
        .filter((link) => {
            if (link.emailTemplateId === templateId) return true;
            const followup = collectLinkTemplateIds({ followupConfig: link.followupConfig });
            return followup.ok && followup.ids.includes(templateId);
        })
        .map(({ id, name }) => ({ id, name }));
}
