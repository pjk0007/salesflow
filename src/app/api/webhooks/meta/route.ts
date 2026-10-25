import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { MetaCredentials } from "@/types";
import { processMetaLead } from "@/lib/meta-lead-record";

// GET: Meta Webhook 검증
export async function GET(req: NextRequest) {
    const mode = req.nextUrl.searchParams.get("hub.mode");
    const token = req.nextUrl.searchParams.get("hub.verify_token");
    const challenge = req.nextUrl.searchParams.get("hub.challenge");

    if (mode !== "subscribe" || !token) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // DB에서 해당 verify token을 가진 플랫폼이 있는지 확인
    const allMetaPlatforms = await db
        .select({ credentials: adPlatforms.credentials })
        .from(adPlatforms)
        .where(and(eq(adPlatforms.platform, "meta"), eq(adPlatforms.status, "connected")));

    const matched = allMetaPlatforms.some((p) => {
        const creds = p.credentials as MetaCredentials;
        return creds.webhookVerifyToken === token;
    });

    if (matched) {
        return new Response(challenge || "", { status: 200 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST: Meta 리드 이벤트 수신
export async function POST(req: NextRequest) {
    const body = await req.json();

    // 즉시 200 응답 (Meta 타임아웃 방지)
    // 비동기로 리드 처리
    processMetaWebhook(body).catch((err) => {
        console.error("[Meta Webhook] processing error:", err);
    });

    return NextResponse.json({ success: true });
}

interface MetaWebhookBody {
    object: string;
    entry: Array<{
        id: string;
        time: number;
        changes: Array<{
            field: string;
            value: {
                leadgen_id: string;
                form_id: string;
                ad_id: string;
                page_id: string;
                created_time: number;
            };
        }>;
    }>;
}

async function processMetaWebhook(body: MetaWebhookBody) {
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== "leadgen") continue;

            const { leadgen_id, form_id, ad_id } = change.value;

            try {
                await processMetaLead(leadgen_id, form_id, ad_id);
            } catch (err) {
                console.error(`[Meta Webhook] lead ${leadgen_id} processing failed:`, err);
            }
        }
    }
}
