import { NextRequest, NextResponse } from "next/server";
import { db, records } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getApiTokenFromNextRequest, resolveApiToken, checkTokenAccess } from "@/lib/auth";
import type { ApiTokenInfo } from "@/lib/auth";
import { processAutoTrigger } from "@/lib/alimtalk-automation";
import { processEmailAutoTrigger } from "@/lib/email-automation";
import { broadcastToPartition } from "@/lib/sse";

async function authenticateExternalRequest(req: NextRequest): Promise<ApiTokenInfo | null> {
    const tokenStr = getApiTokenFromNextRequest(req);
    if (!tokenStr) return null;
    return resolveApiToken(tokenStr);
}

// GET /api/v1/records/[id]
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const tokenInfo = await authenticateExternalRequest(req);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "Record ID is required." }, { status: 400 });
    }

    try {
        const [record] = await db
            .select()
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, tokenInfo.orgId)));

        if (!record) {
            return NextResponse.json({ success: false, error: "Record not found." }, { status: 404 });
        }

        const hasAccess = await checkTokenAccess(tokenInfo, record.partitionId, "read");
        if (!hasAccess) {
            return NextResponse.json({ success: false, error: "Access denied." }, { status: 403 });
        }

        return NextResponse.json({ success: true, data: record });
    } catch (error) {
        console.error("External record fetch error:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
}

// PUT /api/v1/records/[id]
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const tokenInfo = await authenticateExternalRequest(req);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "Record ID is required." }, { status: 400 });
    }

    try {
        const { data: newData } = await req.json();
        if (!newData || typeof newData !== "object") {
            return NextResponse.json({ success: false, error: "data is required." }, { status: 400 });
        }

        const [existing] = await db
            .select()
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, tokenInfo.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "Record not found." }, { status: 404 });
        }

        const hasAccess = await checkTokenAccess(tokenInfo, existing.partitionId, "update");
        if (!hasAccess) {
            return NextResponse.json({ success: false, error: "Access denied." }, { status: 403 });
        }

        const mergedData = { ...(existing.data as Record<string, unknown>), ...newData };

        const [updated] = await db
            .update(records)
            .set({ data: mergedData, updatedAt: new Date() })
            .where(eq(records.id, recordId))
            .returning();

        processAutoTrigger({
            record: updated,
            partitionId: updated.partitionId,
            triggerType: "on_update",
            orgId: tokenInfo.orgId,
        }).catch((err) => console.error("Auto trigger error:", err));

        processEmailAutoTrigger({
            record: updated,
            partitionId: updated.partitionId,
            triggerType: "on_update",
            orgId: tokenInfo.orgId,
        }).catch((err) => console.error("Email auto trigger error:", err));

        broadcastToPartition(updated.partitionId, "record:updated", {
            partitionId: updated.partitionId,
            recordId: updated.id,
        }, "");

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("External record update error:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
}

// DELETE /api/v1/records/[id]
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const tokenInfo = await authenticateExternalRequest(req);
    if (!tokenInfo) {
        return NextResponse.json({ success: false, error: "Invalid or missing API token." }, { status: 401 });
    }

    const { id } = await params;
    const recordId = Number(id);
    if (!recordId) {
        return NextResponse.json({ success: false, error: "Record ID is required." }, { status: 400 });
    }

    try {
        const [existing] = await db
            .select({ id: records.id, partitionId: records.partitionId })
            .from(records)
            .where(and(eq(records.id, recordId), eq(records.orgId, tokenInfo.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "Record not found." }, { status: 404 });
        }

        const hasAccess = await checkTokenAccess(tokenInfo, existing.partitionId, "delete");
        if (!hasAccess) {
            return NextResponse.json({ success: false, error: "Access denied." }, { status: 403 });
        }

        await db.delete(records).where(eq(records.id, recordId));

        broadcastToPartition(existing.partitionId, "record:deleted", {
            partitionId: existing.partitionId,
            recordId: existing.id,
        }, "");

        return NextResponse.json({ success: true, message: "Record deleted." });
    } catch (error) {
        console.error("External record delete error:", error);
        return NextResponse.json({ success: false, error: "Internal server error." }, { status: 500 });
    }
}
