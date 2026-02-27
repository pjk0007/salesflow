import { NextRequest, NextResponse } from "next/server";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, and, or, ilike, sql, count } from "drizzle-orm";
import { getUserFromNextRequest, hashPassword } from "@/lib/auth";

export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증되지 않았습니다." }, { status: 401 });
    }

    if (user.role !== "owner" && user.role !== "admin") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const searchParams = req.nextUrl.searchParams;
        const page = Math.max(1, Number(searchParams.get("page")) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || 20));
        const search = searchParams.get("search") || undefined;

        const conditions = [eq(organizationMembers.organizationId, user.orgId)];
        if (search) {
            conditions.push(
                or(
                    ilike(users.name, `%${search}%`),
                    ilike(users.email, `%${search}%`)
                )!
            );
        }

        const whereClause = and(...conditions);

        const [totalResult] = await db
            .select({ count: count() })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(whereClause);

        const total = totalResult.count;
        const totalPages = Math.ceil(total / pageSize);
        const offset = (page - 1) * pageSize;

        const data = await db
            .select({
                id: users.id,
                orgId: organizationMembers.organizationId,
                email: users.email,
                name: users.name,
                role: organizationMembers.role,
                phone: users.phone,
                isActive: users.isActive,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
            })
            .from(organizationMembers)
            .innerJoin(users, eq(users.id, organizationMembers.userId))
            .where(whereClause)
            .orderBy(sql`${users.createdAt} desc`)
            .limit(pageSize)
            .offset(offset);

        return NextResponse.json({
            success: true,
            data,
            total,
            page,
            pageSize,
            totalPages,
        });
    } catch (error) {
        console.error("Users list error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증되지 않았습니다." }, { status: 401 });
    }

    if (user.role !== "owner" && user.role !== "admin") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    try {
        const { name, email, password, role, phone } = await req.json();

        if (!name || !email || !password) {
            return NextResponse.json({
                success: false,
                error: "이름, 이메일, 비밀번호를 입력해주세요.",
            }, { status: 400 });
        }

        if (password.length < 6) {
            return NextResponse.json({
                success: false,
                error: "비밀번호는 6자 이상이어야 합니다.",
            }, { status: 400 });
        }

        const targetRole = role || "member";

        // admin은 member만 생성 가능
        if (user.role === "admin" && targetRole !== "member") {
            return NextResponse.json({
                success: false,
                error: "admin은 member 역할만 생성할 수 있습니다.",
            }, { status: 403 });
        }

        // 이메일 중복 확인 (같은 조직 내)
        const [existing] = await db
            .select({ id: users.id })
            .from(users)
            .innerJoin(organizationMembers, and(
                eq(organizationMembers.userId, users.id),
                eq(organizationMembers.organizationId, user.orgId)
            ))
            .where(eq(users.email, email));

        if (existing) {
            return NextResponse.json({ success: false, error: "이미 등록된 이메일입니다." }, { status: 409 });
        }

        const hashedPassword = await hashPassword(password);

        const [created] = await db
            .insert(users)
            .values({
                orgId: user.orgId,
                email,
                password: hashedPassword,
                name,
                role: targetRole,
                phone: phone || null,
            })
            .returning({
                id: users.id,
                email: users.email,
                name: users.name,
                role: users.role,
            });

        // organizationMembers에도 추가
        await db.insert(organizationMembers).values({
            organizationId: user.orgId,
            userId: created.id,
            role: targetRole,
        });

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error) {
        console.error("User create error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
