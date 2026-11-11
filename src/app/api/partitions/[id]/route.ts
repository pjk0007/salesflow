import { NextRequest, NextResponse } from "next/server";
import { db, partitions, records, folders, chatSpaces } from "@/lib/db";
import { eq, and, count } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requirePartitionAccess } from "@/lib/partition-access";
import { normalizeScheduledConfig } from "@/lib/scheduled-registration";
import { ensureLeadFieldType } from "@/lib/leads/lead-field-type";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getActiveUserFromNextRequest(req);
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
    const user = await getActiveUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId || isNaN(partitionId)) {
        return NextResponse.json({ success: false, error: "잘못된 파티션 ID입니다." }, { status: 400 });
    }

    const { name, folderId, fieldTypeId, visibleFields, useDistributionOrder, maxDistributionOrder, distributionDefaults, duplicateConfig, scheduledRegistrationConfig, chatSpaceId, category } = await req.json();

    // name-only 업데이트가 아닌 경우에도 지원
    if (name !== undefined && (!name || !String(name).trim())) {
        return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
    }

    try {
        const access = await requirePartitionAccess(user, partitionId, "update", { denyByDefault: true });
        if (!access.ok) {
            return NextResponse.json({ success: false, error: access.error }, { status: access.status });
        }

        let moveToLead = false;
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

            // 속성 타입을 바꾸거나 해제하면 새 속성 목록 전체 표시(null)로 되돌린다(UX-067)
            updateData.visibleFields = null;
        }

        // null 또는 빈 배열 = 전체 표시
        if (visibleFields === null || (Array.isArray(visibleFields) && visibleFields.every((k) => typeof k === "string"))) {
            updateData.visibleFields = visibleFields && visibleFields.length > 0 ? visibleFields : null;
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

        // 구글챗 알림 스페이스 — 고객 연락처가 나가는 곳이라 관리자만 바꾼다. 같은 조직의 스페이스만 고를 수 있다
        if (chatSpaceId !== undefined) {
            if (user.role === "member") {
                return NextResponse.json({ success: false, error: "구글챗 알림 설정은 관리자만 변경할 수 있습니다." }, { status: 403 });
            }
            if (chatSpaceId === null) {
                updateData.chatSpaceId = null;
            } else {
                const [space] = await db
                    .select({ id: chatSpaces.id })
                    .from(chatSpaces)
                    .where(and(eq(chatSpaces.id, Number(chatSpaceId)), eq(chatSpaces.orgId, user.orgId)));
                if (!space) {
                    return NextResponse.json({ success: false, error: "구글챗 스페이스를 찾을 수 없습니다." }, { status: 400 });
                }
                updateData.chatSpaceId = space.id;
            }
        }

        // 레코드(메일 발송용) ↔ 리드 관리 페이지 이동 — 어느 메뉴에 보일지가 바뀌므로 관리자만
        if (category !== undefined) {
            if (user.role === "member") {
                return NextResponse.json({ success: false, error: "레코드/리드관리 이동은 관리자만 할 수 있습니다." }, { status: 403 });
            }
            if (category !== "cold" && category !== "lead") {
                return NextResponse.json({ success: false, error: "잘못된 구분입니다." }, { status: 400 });
            }
            updateData.category = category;
            // 리드 관리로 옮기면 대응상태·연락처·이메일·요청사항·유입경로 칸이 없을 때 채운다
            if (category === "lead") {
                // 레코드와 같은 속성 타입이면 리드 전용 타입으로 옮긴다 — 저장(아래 update) 뒤에 실행
                moveToLead = true;
            }
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
        if (moveToLead) await ensureLeadFieldType(partitionId);

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
    const user = await getActiveUserFromNextRequest(req);
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
