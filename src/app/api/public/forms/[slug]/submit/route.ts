import { NextRequest, NextResponse } from "next/server";
import { db, webForms, webFormFields, partitions, workspaces } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { linkVisitorByFormSubmit } from "@/lib/tracker/match-record";
import { parseAttributionParams } from "@/lib/attribution/parse-params";
import { resolveAttribution } from "@/lib/attribution/resolve-attribution";
import { createRecord, toRecordCreatePartition } from "@/lib/record-create";
import { parseCheckboxValue } from "@/lib/checkbox-value";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;
    if (!slug) {
        return NextResponse.json({ success: false, error: "slug가 필요합니다." }, { status: 400 });
    }

    const reqBody = await req.json();
    const submitData = reqBody?.data;
    const visitorId: string | undefined = typeof reqBody?.visitor_id === "string" ? reqBody.visitor_id : undefined;
    // 파싱은 서버에서 한다 — 화이트리스트·clk_ 검증을 클라이언트에 맡기지 않는다.
    const attributionParams = parseAttributionParams(
        typeof reqBody?.attribution === "string" ? reqBody.attribution : ""
    );
    if (!submitData || typeof submitData !== "object" || Array.isArray(submitData)) {
        return NextResponse.json({ success: false, error: "제출 데이터가 필요합니다." }, { status: 400 });
    }

    try {
        // 폼 조회
        const [form] = await db
            .select()
            .from(webForms)
            .where(and(eq(webForms.slug, slug), eq(webForms.isActive, 1)));

        if (!form) {
            return NextResponse.json({ success: false, error: "폼을 찾을 수 없습니다." }, { status: 404 });
        }

        // 필드 목록 조회
        const fields = await db
            .select()
            .from(webFormFields)
            .where(eq(webFormFields.formId, form.id))
            .orderBy(asc(webFormFields.sortOrder));

        const fieldIds = new Set(fields.map((field) => String(field.id)));
        if (Object.keys(submitData).some((id) => !fieldIds.has(id))) {
            return NextResponse.json({ success: false, error: "질문 구성이 변경되었습니다. 폼을 새로 불러온 뒤 제출해주세요." }, { status: 409 });
        }

        // required 검증 — 필수 체크박스(동의)는 체크(참)일 때만 통과한다. 해제하면 "false"가 오므로 빈 값 검사만으로는 막지 못한다 (UX-046)
        for (const field of fields) {
            if (field.isRequired) {
                const val = submitData[String(field.id)];
                if (field.fieldType === "checkbox" ? !parseCheckboxValue(val) : val === undefined || val === null || val === "") {
                    return NextResponse.json({
                        success: false,
                        error: field.fieldType === "checkbox"
                            ? `"${field.label}" 항목에 체크해야 제출할 수 있습니다.`
                            : `"${field.label}" 필드는 필수입니다.`,
                    }, { status: 400 });
                }
            }
        }

        // linkedFieldKey 기반으로 records.data 구성 (체크박스는 boolean으로 정규화)
        const recordData: Record<string, unknown> = {};
        for (const field of fields) {
            const val = submitData[String(field.id)];
            if (field.linkedFieldKey && val !== undefined && val !== null && val !== "") {
                recordData[field.linkedFieldKey] = field.fieldType === "checkbox" ? parseCheckboxValue(val) : val;
            }
        }

        // 유입 출처 기록 (defaultValues보다 먼저 — 폼 기본값이 실제 캠페인을 덮지 않도록)
        //
        // 조회 실패가 폼 제출을 막으면 안 된다. 리드 유실이 캠페인 정보 유실보다
        // 훨씬 비싸므로 여기서만 의도적으로 degrade한다 (로그는 남긴다).
        try {
            const attribution = await resolveAttribution(attributionParams);
            if (attribution.campaignName) recordData.campaignName = attribution.campaignName;
            if (attribution.adName) recordData.adName = attribution.adName;
        } catch (err) {
            console.error("Attribution resolve error:", err);
        }

        // 폼 조직의 파티션일 때만 받는다 — 다른 조직 파티션을 가리키는 폼으로 남의 목록에 리드를 넣지 못하게
        const [partition] = await db
            .select({ partition: partitions })
            .from(partitions)
            .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
            .where(and(eq(partitions.id, form.partitionId), eq(workspaces.orgId, form.orgId)))
            .then((rows) => rows.map((r) => r.partition));
        if (!partition) {
            return NextResponse.json({ success: false, error: "폼을 찾을 수 없습니다." }, { status: 404 });
        }

        // 폼 defaultValues는 빈 칸에만 적용 — 다른 유입 경로와 같은 생성 함수(중복 정책·발번·분배·기본값·후처리)를 쓴다 (UX-043)
        const sourceDefaults: Record<string, unknown> = {};
        for (const dv of form.defaultValues ?? []) {
            if (dv.field && dv.value) sourceDefaults[dv.field] = dv.value;
        }

        const created = await createRecord({
            orgId: form.orgId,
            partition: toRecordCreatePartition(partition),
            data: recordData,
            sourceDefaults,
            source: "web_form",
        });

        if (created.status === "duplicate") {
            return NextResponse.json({
                success: false,
                error: `이미 접수된 정보입니다. (${created.fieldLabel}: ${created.value})`,
            }, { status: 409 });
        }
        if (created.status === "plan_limit") {
            throw new Error("웹 폼 제출은 레코드 한도를 강제하지 않는다 — plan_limit가 올 수 없음");
        }
        const result = created.record;

        // 트래커 visitor 연결 (있을 때만, 실패해도 무시)
        if (visitorId) {
            linkVisitorByFormSubmit({
                workspaceId: form.workspaceId,
                visitorId,
                recordId: result.id,
                email: typeof result.data === "object" && result.data && "email" in result.data
                    ? (result.data as Record<string, unknown>).email as string | undefined
                    : null,
                name: typeof result.data === "object" && result.data && "name" in result.data
                    ? (result.data as Record<string, unknown>).name as string | undefined
                    : null,
                phone: typeof result.data === "object" && result.data && "phone" in result.data
                    ? (result.data as Record<string, unknown>).phone as string | undefined
                    : null,
            }).catch((err) => console.error("Visitor link error:", err));
        }

        return NextResponse.json({ success: true }, { status: created.status === "merged" ? 200 : 201 });
    } catch (error) {
        console.error("Form submit error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
