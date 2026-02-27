import { NextRequest, NextResponse } from "next/server";
import { db, webForms, webFormFields, records, organizations } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { assignDistributionOrder } from "@/lib/distribution";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { broadcastToPartition } from "@/lib/sse";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;
    if (!slug) {
        return NextResponse.json({ success: false, error: "slug가 필요합니다." }, { status: 400 });
    }

    const { data: submitData } = await req.json();
    if (!submitData || typeof submitData !== "object") {
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

        // required 검증
        for (const field of fields) {
            if (field.isRequired) {
                const val = submitData[String(field.id)];
                if (val === undefined || val === null || val === "") {
                    return NextResponse.json({
                        success: false,
                        error: `"${field.label}" 필드는 필수입니다.`,
                    }, { status: 400 });
                }
            }
        }

        // linkedFieldKey 기반으로 records.data 구성
        const recordData: Record<string, unknown> = {};
        for (const field of fields) {
            const val = submitData[String(field.id)];
            if (field.linkedFieldKey && val !== undefined && val !== null && val !== "") {
                recordData[field.linkedFieldKey] = val;
            }
        }

        // defaultValues 적용 (빈 필드만)
        if (form.defaultValues) {
            for (const dv of form.defaultValues) {
                if (dv.field && dv.value && !recordData[dv.field]) {
                    recordData[dv.field] = dv.value;
                }
            }
        }

        // 트랜잭션으로 통합코드 발번 + 레코드 생성
        const result = await db.transaction(async (tx) => {
            // 통합코드 생성
            const [org] = await tx
                .select()
                .from(organizations)
                .where(eq(organizations.id, form.orgId));

            const newSeq = org.integratedCodeSeq + 1;
            const integratedCode = `${org.integratedCodePrefix}-${String(newSeq).padStart(4, "0")}`;

            await tx
                .update(organizations)
                .set({ integratedCodeSeq: newSeq })
                .where(eq(organizations.id, org.id));

            // 분배순서 자동 할당
            let distributionOrder: number | null = null;
            let finalData = recordData;
            const distribution = await assignDistributionOrder(tx, form.partitionId);
            if (distribution) {
                distributionOrder = distribution.distributionOrder;
                finalData = { ...distribution.defaults };
                for (const [k, v] of Object.entries(recordData)) {
                    if (v !== undefined && v !== null && v !== "") finalData[k] = v;
                }
            }

            // 레코드 생성
            const [newRecord] = await tx
                .insert(records)
                .values({
                    orgId: form.orgId,
                    workspaceId: form.workspaceId,
                    partitionId: form.partitionId,
                    integratedCode,
                    distributionOrder,
                    data: finalData,
                })
                .returning();

            return newRecord;
        });

        // 자동 트리거 (fire-and-forget)
        processAutoTrigger({
            record: result,
            partitionId: form.partitionId,
            triggerType: "on_create",
            orgId: form.orgId,
        }).catch((err) => console.error("Auto trigger error:", err));

        processEmailAutoTrigger({
            record: result,
            partitionId: form.partitionId,
            triggerType: "on_create",
            orgId: form.orgId,
        }).catch((err) => console.error("Email auto trigger error:", err));

        // SSE broadcast
        broadcastToPartition(form.partitionId, "record:created", {
            partitionId: form.partitionId,
            recordId: result.id,
        });

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error) {
        console.error("Form submit error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
