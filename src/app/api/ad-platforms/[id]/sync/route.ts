import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms, adAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import type { MetaCredentials } from "@/types";
import { isMetaTokenError, markMetaPlatformExpired, metaErrorMessage, type MetaGraphError } from "@/lib/meta-graph";

/** 사용자에게 그대로 보여줄 한국어 동기화 실패 (UX-051). 그 밖의 예외는 500 고정 문구 */
class SyncFailure extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

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
    if (!accessToken) {
        throw new SyncFailure("Meta 인증이 아직 완료되지 않았습니다. '다시 연결'로 Meta 계정을 인증해주세요.", 409);
    }

    let response: Response;
    try {
        response = await fetch(
            `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${accessToken}&fields=id,name,account_status,currency,amount_spent`
        );
    } catch {
        throw new SyncFailure("Meta 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해주세요.", 502);
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: MetaGraphError } | null;
        console.error("[ad-platform sync] Meta 오류:", body?.error?.code, body?.error?.message);
        // 토큰 만료·취소면 상태를 '만료됨'으로 바꿔 다시 인증 안내가 보이게 한다 (UX-049)
        if (isMetaTokenError(body?.error)) {
            await markMetaPlatformExpired(platform.id);
            throw new SyncFailure(metaErrorMessage(body?.error), 409);
        }
        throw new SyncFailure(metaErrorMessage(body?.error), 502);
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
    const user = await getActiveUserFromNextRequest(req);
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
            // Google/Naver 동기화는 아직 없다 — 아무것도 하지 않고 '완료'라고 답하지 않는다 (UX-051)
            return NextResponse.json({ success: false, error: "아직 계정 동기화를 지원하지 않는 광고 플랫폼입니다." }, { status: 400 });
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
        if (error instanceof SyncFailure) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error("Ad platform sync error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
