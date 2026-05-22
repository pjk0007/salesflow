import { NextRequest, NextResponse } from "next/server";
import { db, records, fieldDefinitions, partitions, workspaces, trackerVisitors } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { dispatchAutoTriggers } from "@/lib/automation-dispatch";
import { broadcastToPartition } from "@/lib/sse";
import { insertRecordEvent } from "@/lib/record-events";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const [record] = await db
        .select()
        .from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

    if (!record) {
        return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: record });
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    const { data: newData } = await req.json();
    if (!newData || typeof newData !== "object") {
        return NextResponse.json({ success: false, error: "수정할 데이터가 필요합니다." }, { status: 400 });
    }

    try {
        // 레코드 조회 + 조직 검증
        const [existing] = await db
            .select()
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
        }

        // 시스템 매핑 필드 key는 data에 저장하지 않음 (읽기 전용 — records의 시스템 컬럼이 단일 진실원천)
        const sanitized = { ...(newData as Record<string, unknown>) };
        for (const k of ["registeredAt", "createdAt", "updatedAt"]) {
            delete sanitized[k];
        }

        // 변경 이력 추적 대상 필드 조회 (track_history=1)
        // partition.fieldTypeId → 없으면 workspace.defaultFieldTypeId 폴백
        const [partition] = await db
            .select({ fieldTypeId: partitions.fieldTypeId, workspaceId: partitions.workspaceId })
            .from(partitions)
            .where(eq(partitions.id, existing.partitionId));
        let resolvedTypeId = partition?.fieldTypeId ?? null;
        if (!resolvedTypeId && partition) {
            const [ws] = await db
                .select({ defaultFieldTypeId: workspaces.defaultFieldTypeId })
                .from(workspaces)
                .where(eq(workspaces.id, partition.workspaceId));
            resolvedTypeId = ws?.defaultFieldTypeId ?? null;
        }
        const trackedFields = resolvedTypeId
            ? await db
                .select({ key: fieldDefinitions.key })
                .from(fieldDefinitions)
                .where(and(eq(fieldDefinitions.fieldTypeId, resolvedTypeId), eq(fieldDefinitions.trackHistory, 1)))
            : [];

        // 기존 data와 병합
        const before = existing.data as Record<string, unknown>;
        const mergedData = { ...before, ...sanitized };

        const updated = await db.transaction(async (tx) => {
            const [row] = await tx
                .update(records)
                .set({ data: mergedData, updatedAt: new Date() })
                .where(eq(records.id, recordId))
                .returning();

            // 추적 필드 중 값이 바뀐 것만 record_events에 기록
            for (const { key } of trackedFields) {
                if (!(key in sanitized)) continue;
                const fromVal = before[key];
                const toVal = sanitized[key];
                if (toVal === fromVal || toVal === undefined) continue;
                await insertRecordEvent(
                    {
                        orgId: existing.orgId,
                        recordId,
                        event: {
                            type: key,
                            label: String(toVal ?? ""),
                            occurredAt: new Date(),
                            meta: { field: key, from: fromVal ?? null, to: toVal ?? null, by: user.userId },
                        },
                    },
                    tx
                );
            }

            return row;
        });

        dispatchAutoTriggers({
            record: updated,
            partitionId: updated.partitionId,
            triggerType: "on_update",
            orgId: user.orgId,
        });

        broadcastToPartition(updated.partitionId, "record:updated", {
            partitionId: updated.partitionId,
            recordId: updated.id,
        }, req.headers.get("x-session-id") as string);

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Record update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "레코드 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [existing] = await db
            .select({ id: records.id, partitionId: records.partitionId })
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "레코드를 찾을 수 없습니다." }, { status: 404 });
        }

        // 트래커 visitor 연결 해제(익명으로 되돌림) — 방문 기록은 record와 수명이 다르므로 보존.
        // record_events / visitor_record_links / memos는 FK CASCADE로 자동 정리됨.
        await db
            .update(trackerVisitors)
            .set({ recordId: null })
            .where(and(eq(trackerVisitors.recordId, recordId), eq(trackerVisitors.orgId, user.orgId)));

        await db.delete(records).where(eq(records.id, recordId));

        broadcastToPartition(existing.partitionId, "record:deleted", {
            partitionId: existing.partitionId,
            recordId: existing.id,
        }, req.headers.get("x-session-id") as string);

        return NextResponse.json({ success: true, message: "레코드가 삭제되었습니다." });
    } catch (error) {
        console.error("Record delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
