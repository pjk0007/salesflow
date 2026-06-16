import { NextRequest, NextResponse } from "next/server";
import { db, partitions, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { insertImportedRecords, dispatchImportTriggers } from "@/lib/record-import";
import { broadcastToPartition } from "@/lib/sse";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    const body = await req.json();
    const { records: importRecords, duplicateAction = "skip" } = body as {
        records: Array<Record<string, unknown>>;
        duplicateAction: "skip" | "error";
    };

    if (!Array.isArray(importRecords) || importRecords.length === 0) {
        return NextResponse.json({ success: false, error: "가져올 레코드가 없습니다." }, { status: 400 });
    }
    if (importRecords.length > 3000) {
        return NextResponse.json({ success: false, error: "최대 3,000건까지 가져올 수 있습니다." }, { status: 400 });
    }

    try {
        // 파티션 접근 검증
        const [access] = await db
            .select({ partition: partitions, workspaceOrgId: workspaces.orgId })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));

        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }

        const partition = access.partition;

        // 진행률 스트리밍 응답 (NDJSON): progress… → done|error
        const encoder = new TextEncoder();
        const orgId = user.orgId;
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
                try {
                    const result = await db.transaction((tx) =>
                        insertImportedRecords(tx, {
                            orgId,
                            partition: {
                                id: partition.id,
                                workspaceId: partition.workspaceId,
                                duplicateConfig: partition.duplicateConfig as { field: string; action: string } | null,
                                duplicateCheckField: partition.duplicateCheckField,
                            },
                            dataRows: importRecords,
                            duplicateAction,
                            onProgress: (processed, total) => send({ type: "progress", processed, total }),
                        })
                    );

                    // 자동 트리거 (알림톡/이메일/보강/AI개인화) — 규칙 있을 때만, fire-and-forget
                    dispatchImportTriggers(result.insertedRecords, { partitionId, orgId })
                        .catch((e) => console.error("[bulk-import] dispatch triggers error:", e));
                    // SSE 브로드캐스트
                    broadcastToPartition(partitionId, "record:created", { partitionId });

                    send({
                        type: "done",
                        result: {
                            success: true,
                            totalCount: result.totalCount,
                            insertedCount: result.insertedCount,
                            skippedCount: result.skippedCount,
                            mergedCount: result.mergedCount,
                            errors: result.errors,
                        },
                    });
                } catch (err) {
                    console.error("Bulk import error:", err);
                    send({ type: "error", error: "서버 오류가 발생했습니다." });
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
            },
        });
    } catch (error) {
        console.error("Bulk import error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
