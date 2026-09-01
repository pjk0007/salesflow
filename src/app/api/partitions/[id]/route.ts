import { NextRequest, NextResponse } from "next/server";
import { db, partitions, records, fieldDefinitions, folders } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { normalizeScheduledConfig } from "@/lib/scheduled-registration";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId || isNaN(partitionId)) {
        return NextResponse.json({ success: false, error: "잘못된 파티션 ID입니다." }, { status: 400 });
    }

    try {
        const access = await requirePartitionAccess(user, partitionId, "read");
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        const [result] = await db
            .select({ count: count() })
            .from(records)
            .where(eq(records.partitionId, partitionId));

        return NextResponse.json({
            success: true,
            data: {
                ...access.partition,
                recordCount: result.count,
            },
        });
    } catch (error) {
        console.error("Partition stats error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
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
    const partitionId = Number(id);
    if (!partitionId || isNaN(partitionId)) {
        return NextResponse.json({ success: false, error: "잘못된 파티션 ID입니다." }, { status: 400 });
    }

    const { name, folderId, fieldTypeId, visibleFields, useDistributionOrder, maxDistributionOrder, distributionDefaults, duplicateConfig, scheduledRegistrationConfig } = await req.json();

    // name-only 업데이트가 아닌 경우에도 지원
    if (name !== undefined && (!name || !String(name).trim())) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
        const access = await requirePartitionAccess(user, partitionId, "update", { denyByDefault: true });
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (name !== undefined) {
            updateData.name = String(name).trim();
        }

        if (folderId !== undefined) {
            if (folderId === null) {
                updateData.folderId = null;
            } else {
                // 같은 워크스페이스의 폴더인지 확인한다. 검증을 빼면 member가 자기 파티션을
                // 자신이 권한을 가진 폴더로 옮겨 스스로 권한을 만들어낼 수 있다.
                const targetFolderId = Number(folderId);
                const [folder] = await db
                    .select({ id: folders.id })
                    .from(folders)
                    .where(
                        and(
                            eq(folders.id, targetFolderId),
                            eq(folders.workspaceId, access.partition.workspaceId)
                        )
                    );
                if (!folder) {
                    return NextResponse.json(
                        { success: false, error: "폴더를 찾을 수 없습니다." },
                        { status: 400 }
                    );
                }
                updateData.folderId = targetFolderId;
            }
        }

        if (fieldTypeId !== undefined) {
            const newFieldTypeId = fieldTypeId === null ? null : Number(fieldTypeId);
            updateData.fieldTypeId = newFieldTypeId;

            // 속성 타입 변경 시 visibleFields를 새 타입의 필드들로 동기화
            if (newFieldTypeId) {
                const typeFields = await db
                    .select({ key: fieldDefinitions.key })
                    .from(fieldDefinitions)
                    .where(eq(fieldDefinitions.fieldTypeId, newFieldTypeId))
                    .orderBy(fieldDefinitions.sortOrder);
                updateData.visibleFields = typeFields.map((f) => f.key);
            } else {
                // 타입 해제 시 워크스페이스 필드로 복원
                const wsFields = await db
                    .select({ key: fieldDefinitions.key })
                    .from(fieldDefinitions)
                    .where(eq(fieldDefinitions.workspaceId, access.partition.workspaceId))
                    .orderBy(fieldDefinitions.sortOrder);
                updateData.visibleFields = wsFields.map((f) => f.key);
            }
        }

        if (visibleFields !== undefined && Array.isArray(visibleFields)) {
            updateData.visibleFields = visibleFields;
        }

        if (useDistributionOrder !== undefined) {
            updateData.useDistributionOrder = useDistributionOrder ? 1 : 0;
        }

        if (maxDistributionOrder !== undefined) {
            const max = Number(maxDistributionOrder);
            if (max < 1 || max > 99) {
                return NextResponse.json({ success: false, error: "분배 순번은 1~99 범위여야 합니다." }, { status: 400 });
            }
            updateData.maxDistributionOrder = max;
            // lastAssignedOrder가 새 max를 초과하면 리셋
            if (access.partition.lastAssignedOrder > max) {
                updateData.lastAssignedOrder = 0;
            }
        }

        if (distributionDefaults !== undefined) {
            updateData.distributionDefaults = distributionDefaults;
        }

        if (duplicateConfig !== undefined) {
            updateData.duplicateConfig = duplicateConfig;
            // duplicateCheckField 동기화 (하위호환)
            updateData.duplicateCheckField = duplicateConfig?.field || null;
        }

        if (scheduledRegistrationConfig !== undefined) {
            if (scheduledRegistrationConfig === null) {
                updateData.scheduledRegistrationConfig = null;
            } else {
                const normalized = normalizeScheduledConfig(
                    scheduledRegistrationConfig,
                    access.partition.scheduledRegistrationConfig
                );
                if (!normalized.ok) {
                    return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
                }
                updateData.scheduledRegistrationConfig = normalized.config;
            }
        }

        const [updated] = await db
            .update(partitions)
            .set(updateData)
            .where(eq(partitions.id, partitionId))
            .returning();

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Partition update error:", error);
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
    const partitionId = Number(id);
    if (!partitionId || isNaN(partitionId)) {
        return NextResponse.json({ success: false, error: "잘못된 파티션 ID입니다." }, { status: 400 });
    }

    try {
        const access = await requirePartitionAccess(user, partitionId, "delete", { denyByDefault: true });
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        await db.delete(partitions).where(eq(partitions.id, partitionId));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Partition delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
