import { NextRequest, NextResponse } from "next/server";
import { db, alimtalkTemplateLinks, records, partitions, workspaces } from "@/lib/db";
import { eq, and, inArray } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { sendAlimtalkForOrg } from "@/lib/alimtalk/send-service";

export async function POST(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    try {
        const { templateLinkId, recordIds } = await req.json();

        if (!templateLinkId || !recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
            return NextResponse.json({
                success: false,
                error: "templateLinkId와 recordIds는 필수입니다.",
            }, { status: 400 });
        }

        if (recordIds.length > 1000) {
            return NextResponse.json({
                success: false,
                error: "한 번에 최대 1,000건까지 발송할 수 있습니다.",
            }, { status: 400 });
        }

        // 템플릿 연결 정보 조회 (소유권 확인 포함)
        const [link] = await db
            .select()
            .from(alimtalkTemplateLinks)
            .innerJoin(partitions, eq(partitions.id, alimtalkTemplateLinks.partitionId))
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(
                and(
                    eq(alimtalkTemplateLinks.id, templateLinkId),
                    eq(workspaces.orgId, user.orgId)
                )
            )
            .limit(1);

        if (!link) {
            return NextResponse.json({ success: false, error: "템플릿 연결을 찾을 수 없습니다." }, { status: 404 });
        }

        const templateLink = link.alimtalk_template_links;

        // 연결 파티션에 대한 요청자 권한 확인 (접근 금지 member는 발송 전에 막는다)
        const access = await requirePartitionAccess(user, templateLink.partitionId, "read");
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        const ids = [...new Set(recordIds.map(Number))];
        if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
            return NextResponse.json({ success: false, error: "발송 대상 레코드 ID를 확인해주세요." }, { status: 400 });
        }

        // 레코드 조회 — 연결된 파티션의 레코드만 대상으로 한다
        const recordList = await db
            .select()
            .from(records)
            .where(and(inArray(records.id, ids), eq(records.partitionId, templateLink.partitionId)));

        // 다른 조직·다른 파티션·없는 레코드가 하나라도 섞이면 아무에게도 보내지 않는다
        if (recordList.length !== ids.length) {
            return NextResponse.json({
                success: false,
                error: "발송 대상 중 이 템플릿 연결의 파티션에서 찾을 수 없는 레코드가 있습니다. 목록을 새로고침한 뒤 다시 선택해주세요.",
            }, { status: 404 });
        }

        const result = await sendAlimtalkForOrg({
            orgId: user.orgId, senderKey: templateLink.senderKey, templateCode: templateLink.templateCode,
            triggerType: "manual", sentBy: user.userId,
            recipients: recordList.map(record => {
                const data = record.data as Record<string, unknown>;
                const mappings = templateLink.variableMappings as Record<string, string> | null;
                return {
                    phoneNumber: typeof data[templateLink.recipientField] === "string" ? data[templateLink.recipientField] as string : "",
                    templateParameter: Object.fromEntries(Object.entries(mappings ?? {}).map(([variable, field]) =>
                        [variable.replace(/^#\{|\}$/g, ""), data[field] != null ? String(data[field]) : ""])),
                    recordId: record.id, templateLinkId: templateLink.id, partitionId: templateLink.partitionId,
                };
            }),
        });
        if (!result.ok) return NextResponse.json({ success: false, error: result.error, data: { errors: result.errors } }, { status: result.status });
        return NextResponse.json({ success: true, data: { ...result.data, totalCount: ids.length,
            excludedCount: result.data.errors?.length ?? 0,
            errors: [...(result.data.errors ?? []), ...result.data.results.filter(r => r.status !== "pending").map(r => ({ recordId: r.recordId, error: r.resultMessage }))],
        } });
    } catch (error) {
        console.error("Alimtalk send error:", error);
        return NextResponse.json({ success: false, error: "발송에 실패했습니다." }, { status: 500 });
    }
}
