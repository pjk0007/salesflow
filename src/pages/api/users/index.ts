import type { NextApiRequest, NextApiResponse } from "next";
import { db, users, organizationMembers } from "@/lib/db";
import { eq, and, or, ilike, sql, count } from "drizzle-orm";
import { getUserFromRequest, hashPassword } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증되지 않았습니다." });
    }

    if (user.role !== "owner" && user.role !== "admin") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    if (req.method === "GET") {
        return handleGet(req, res, user.orgId);
    }
    if (req.method === "POST") {
        return handlePost(req, res, user.orgId, user.role);
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, orgId: string) {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
        const search = req.query.search ? String(req.query.search) : undefined;

        const conditions = [eq(organizationMembers.organizationId, orgId)];
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

        return res.status(200).json({
            success: true,
            data,
            total,
            page,
            pageSize,
            totalPages,
        });
    } catch (error) {
        console.error("Users list error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(
    req: NextApiRequest,
    res: NextApiResponse,
    orgId: string,
    currentRole: string
) {
    try {
        const { name, email, password, role, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: "이름, 이메일, 비밀번호를 입력해주세요.",
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: "비밀번호는 6자 이상이어야 합니다.",
            });
        }

        const targetRole = role || "member";

        // admin은 member만 생성 가능
        if (currentRole === "admin" && targetRole !== "member") {
            return res.status(403).json({
                success: false,
                error: "admin은 member 역할만 생성할 수 있습니다.",
            });
        }

        // 이메일 중복 확인 (같은 조직 내)
        const [existing] = await db
            .select({ id: users.id })
            .from(users)
            .innerJoin(organizationMembers, and(
                eq(organizationMembers.userId, users.id),
                eq(organizationMembers.organizationId, orgId)
            ))
            .where(eq(users.email, email));

        if (existing) {
            return res.status(409).json({ success: false, error: "이미 등록된 이메일입니다." });
        }

        const hashedPassword = await hashPassword(password);

        const [created] = await db
            .insert(users)
            .values({
                orgId,
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
            organizationId: orgId,
            userId: created.id,
            role: targetRole,
        });

        return res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error("User create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
