import { NextRequest, NextResponse } from "next/server";
import { getUserFromNextRequest } from "@/lib/auth";
import { db, organizations, organizationMembers, users, workspaces, subscriptions, plans, payments } from "@/lib/db";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const user = getUserFromNextRequest(req);
    if (!user?.isSuperAdmin) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const { id: orgId } = await params;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
        return NextResponse.json({ success: false, error: "조직을 찾을 수 없습니다." }, { status: 404 });
    }

    const members = await db
        .select({
            userId: users.id,
            email: users.email,
            name: users.name,
            role: organizationMembers.role,
            isActive: users.isActive,
            joinedAt: organizationMembers.joinedAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, orgId));

    const ws = await db
        .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
        .from(workspaces)
        .where(eq(workspaces.orgId, orgId));

    const subs = await db
        .select({
            id: subscriptions.id,
            planName: plans.name,
            status: subscriptions.status,
            currentPeriodStart: subscriptions.currentPeriodStart,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.orgId, orgId));

    const paymentHistory = await db
        .select()
        .from(payments)
        .where(eq(payments.orgId, orgId))
        .orderBy(payments.createdAt)
        .limit(20);

    return NextResponse.json({
        success: true,
        data: { organization: org, members, workspaces: ws, subscriptions: subs, payments: paymentHistory },
    });
}
