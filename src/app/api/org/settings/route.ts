import { NextRequest, NextResponse } from "next/server";
import { db, organizations, organizationMembers } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { setSessionCookie } from "@/lib/auth";
import { isForeignKeyViolation } from "@/lib/db/errors";
import { requireAdmin } from "@/lib/auth-admin";
import type { JWTPayload } from "@/types";

export async function GET(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const [org] = await db
            .select({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                branding: organizations.branding,
                integratedCodePrefix: organizations.integratedCodePrefix,
                settings: organizations.settings,
            })
            .from(organizations)
            .where(eq(organizations.id, user.orgId));

        if (!org) {
            return NextResponse.json({ success: false, error: "조직을 찾을 수 없습니다." }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: org });
    } catch (error) {
        console.error("Org settings fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        const { name, branding, settings, integratedCodePrefix } = await req.json();

        if (name !== undefined && !name.trim()) {
            return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
        }

        // 기존 데이터 조회
        const [existing] = await db
            .select()
            .from(organizations)
            .where(eq(organizations.id, user.orgId));

        if (!existing) {
            return NextResponse.json({ success: false, error: "조직을 찾을 수 없습니다." }, { status: 404 });
        }

        // 업데이트할 필드 구성
        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            updateData.name = name.trim();
        }

        if (branding !== undefined) {
            updateData.branding = { ...existing.branding, ...branding };
        }

        if (settings !== undefined) {
            updateData.settings = { ...existing.settings, ...settings };
        }

        if (integratedCodePrefix !== undefined && integratedCodePrefix.trim()) {
            updateData.integratedCodePrefix = integratedCodePrefix.trim();
        }

        const [updated] = await db
            .update(organizations)
            .set(updateData)
            .where(eq(organizations.id, user.orgId))
            .returning({
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
                branding: organizations.branding,
                integratedCodePrefix: organizations.integratedCodePrefix,
                settings: organizations.settings,
            });

        return NextResponse.json({ success: true, data: updated });
    } catch (error) {
        console.error("Org settings update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const auth = await requireAdmin(req, "owner");
    if (!auth.ok) {
        // owner 게이트에 걸린 경우만 문구를 구체화한다
        const error = auth.status === 403 ? "조직 삭제는 소유자만 가능합니다." : auth.error;
        return NextResponse.json({ success: false, error }, { status: auth.status });
    }
    const user = auth.user;

    try {
        // 사용자의 다른 조직 찾기
        const otherOrgs = await db
            .select({
                organizationId: organizationMembers.organizationId,
                role: organizationMembers.role,
                tokenVersion: organizationMembers.tokenVersion,
            })
            .from(organizationMembers)
            .where(
                and(
                    eq(organizationMembers.userId, user.userId),
                    // 현재 삭제할 조직 제외 — 삭제 전에 먼저 조회
                )
            );

        const nextOrg = otherOrgs.find((o) => o.organizationId !== user.orgId);

        await db.transaction(async (tx) => {
            // users.org_id는 ON DELETE CASCADE다. 이 조직을 기본 조직으로 둔 사용자 중 다른 조직에도 속한 사람은
            // 가장 최근 소속으로 먼저 옮겨, 조직 삭제가 그 계정과 다른 조직 멤버십까지 지우지 않게 한다.
            // 다른 소속이 없는 계정은 기존처럼 조직과 함께 정리된다.
            await tx.execute(sql`
                UPDATE users u SET org_id = other.organization_id, updated_at = now()
                FROM (
                    SELECT DISTINCT ON (m.user_id) m.user_id, m.organization_id
                    FROM organization_members m
                    WHERE m.organization_id <> ${user.orgId}
                    ORDER BY m.user_id, m.joined_at DESC
                ) other
                WHERE u.id = other.user_id AND u.org_id = ${user.orgId}
            `);
            await tx.delete(organizations).where(eq(organizations.id, user.orgId));
        });

        if (nextOrg) {
            // 다른 조직으로 JWT 전환
            const payload: JWTPayload = {
                userId: user.userId,
                email: user.email,
                name: user.name,
                orgId: nextOrg.organizationId,
                role: nextOrg.role as "owner" | "admin" | "member",
                tokenVersion: nextOrg.tokenVersion,
                ...(user.isSuperAdmin && { isSuperAdmin: true }),
            };
            const response = NextResponse.json({ success: true, switchedTo: nextOrg.organizationId });
            await setSessionCookie(response, payload);
            return response;
        } else {
            // 다른 조직 없음 — 쿠키 삭제
            const response = NextResponse.json({ success: true, noOrgsLeft: true });
            response.cookies.set("token", "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
            return response;
        }
    } catch (error) {
        // 발송 이력·상담 기록 등 아직 이 조직(또는 정리될 계정)을 참조하는 기록이 있으면 DB가 삭제를 막는다
        if (isForeignKeyViolation(error)) {
            return NextResponse.json({
                success: false,
                error: "발송·상담 기록 등 이 조직을 참조하는 기록이 남아 있어 삭제할 수 없습니다. 고객센터에 문의해주세요.",
            }, { status: 409 });
        }
        console.error("Org delete error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
