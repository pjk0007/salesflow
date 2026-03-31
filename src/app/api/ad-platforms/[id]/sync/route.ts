import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms, adAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import type { MetaCredentials } from "@/types";

const META_ACCOUNT_STATUS_MAP: Record<number, string> = {
    1: "active",
    2: "disabled",
    3: "unsettled",
    7: "pending_risk_review",
    8: "pending_settlement",
    9: "in_grace_period",
    100: "pending_closure",
    101: "closed",
    201: "any_active",
    202: "any_closed",
};

function mapMetaAccountStatus(accountStatus: number): "active" | "paused" | "disabled" {
    if (accountStatus === 1) return "active";
    if (accountStatus === 2 || accountStatus === 101) return "disabled";
    return "paused";
}

async function syncMetaAccounts(platform: { id: number; credentials: unknown }) {
    const credentials = platform.credentials as MetaCredentials;
    const accessToken = credentials.accessToken;

    const response = await fetch(
        `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${accessToken}&fields=id,name,account_status,currency,amount_spent`
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Meta API 오류: ${error.error?.message || "알 수 없는 오류"}`);
    }

    const result = await response.json();
    const metaAccounts: Array<{
        id: string;
        name: string;
        account_status: number;
        currency: string;
        amount_spent: string;
    }> = result.data || [];

    let created = 0;
    let updated = 0;
    const accounts = [];

    for (const account of metaAccounts) {
        const externalAccountId = account.id;
        const name = account.name || externalAccountId;
        const currency = account.currency || null;
        const status = mapMetaAccountStatus(account.account_status);
        const metadata = {
            accountStatus: META_ACCOUNT_STATUS_MAP[account.account_status] || "unknown",
            amountSpent: account.amount_spent,
        };

        const [existing] = await db
            .select({ id: adAccounts.id })
            .from(adAccounts)
            .where(
                and(
                    eq(adAccounts.adPlatformId, platform.id),
                    eq(adAccounts.externalAccountId, externalAccountId)
                )
            );

        if (existing) {
            await db
                .update(adAccounts)
                .set({
                    name,
                    currency,
                    status,
                    metadata,
                    lastSyncAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(adAccounts.id, existing.id));
            updated++;
            accounts.push({ id: existing.id, externalAccountId, name, status, action: "updated" });
        } else {
            const [inserted] = await db
                .insert(adAccounts)
                .values({
                    adPlatformId: platform.id,
                    externalAccountId,
                    name,
                    currency,
                    status,
                    metadata,
                    lastSyncAt: new Date(),
                })
                .returning({ id: adAccounts.id });
            created++;
            accounts.push({ id: inserted.id, externalAccountId, name, status, action: "created" });
        }
    }

    return { synced: metaAccounts.length, created, updated, accounts };
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }
    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const platformId = Number(id);
    if (!platformId) {
        return NextResponse.json({ success: false, error: "플랫폼 ID가 필요합니다." }, { status: 400 });
    }

    try {
        const [platform] = await db
            .select()
            .from(adPlatforms)
            .where(and(eq(adPlatforms.id, platformId), eq(adPlatforms.orgId, user.orgId)));

        if (!platform) {
            return NextResponse.json({ success: false, error: "플랫폼을 찾을 수 없습니다." }, { status: 404 });
        }

        let syncResult;

        if (platform.platform === "meta") {
            syncResult = await syncMetaAccounts(platform);
        } else {
            // Google/Naver 플랫폼은 추후 구현
            syncResult = { synced: 0, created: 0, updated: 0, accounts: [] };
        }

        await db
            .update(adPlatforms)
            .set({ lastSyncAt: new Date(), updatedAt: new Date() })
            .where(eq(adPlatforms.id, platformId));

        return NextResponse.json({
            success: true,
            data: {
                message: "동기화가 완료되었습니다.",
                syncedAt: new Date().toISOString(),
                ...syncResult,
            },
        });
    } catch (error) {
        console.error("Ad platform sync error:", error);
        const message = error instanceof Error ? error.message : "서버 오류가 발생했습니다.";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
