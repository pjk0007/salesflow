import { NextRequest, NextResponse } from "next/server";
import { authenticateExternalAlimtalk } from "@/lib/alimtalk/external-auth";
import {
    sendAlimtalkForOrg,
    type SendAlimtalkRecipientInput,
} from "@/lib/alimtalk/send-service";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface ExternalSendBody {
    templateCode?: unknown;
    senderKey?: unknown;
    recipients?: unknown;
    requestDate?: unknown;
    triggerType?: unknown;
}

function parseRecipients(raw: unknown): SendAlimtalkRecipientInput[] | null {
    if (!Array.isArray(raw)) return null;
    const out: SendAlimtalkRecipientInput[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") return null;
        const r = item as Record<string, unknown>;
        const phoneNumber = r.phoneNumber;
        if (typeof phoneNumber !== "string") return null;
        const tp = r.templateParameter;
        let templateParameter: Record<string, string> | undefined;
        if (tp !== undefined && tp !== null) {
            if (typeof tp !== "object") return null;
            templateParameter = {};
            for (const [k, v] of Object.entries(tp as Record<string, unknown>)) {
                templateParameter[k] = v == null ? "" : String(v);
            }
        }
        out.push({ phoneNumber, templateParameter });
    }
    return out;
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
    const tokenInfo = await authenticateExternalAlimtalk(req);
    if (!tokenInfo) {
        return NextResponse.json(
            { success: false, error: "유효하지 않은 API 토큰입니다." },
            { status: 401 },
        );
    }

    let body: ExternalSendBody;
    try {
        body = (await req.json()) as ExternalSendBody;
    } catch {
        return NextResponse.json(
            { success: false, error: "요청 본문이 유효한 JSON이 아닙니다." },
            { status: 400 },
        );
    }

    if (typeof body.templateCode !== "string" || !body.templateCode) {
        return NextResponse.json(
            { success: false, error: "templateCode는 필수입니다." },
            { status: 400 },
        );
    }

    const recipients = parseRecipients(body.recipients);
    if (!recipients) {
        return NextResponse.json(
            { success: false, error: "recipients 형식이 올바르지 않습니다." },
            { status: 400 },
        );
    }

    const senderKey =
        typeof body.senderKey === "string" && body.senderKey ? body.senderKey : undefined;
    const requestDate =
        typeof body.requestDate === "string" && body.requestDate ? body.requestDate : undefined;
    const triggerType =
        typeof body.triggerType === "string" && body.triggerType
            ? body.triggerType
            : "external_api";

    const result = await sendAlimtalkForOrg({
        orgId: tokenInfo.orgId,
        templateCode: body.templateCode,
        senderKey,
        recipients,
        requestDate,
        triggerType,
        sentBy: null,
    });

    if (!result.ok) {
        return NextResponse.json(
            {
                success: false,
                error: result.error,
                ...(result.errors ? { data: { errors: result.errors } } : {}),
            },
            { status: result.status },
        );
    }

    return NextResponse.json({ success: true, data: result.data });
}

export async function POST(req: NextRequest) {
    let res: NextResponse;
    try {
        res = await handlePost(req);
    } catch (error) {
        console.error("External alimtalk send error:", {
            message: error instanceof Error ? error.message : String(error),
        });
        res = NextResponse.json(
            { success: false, error: "발송에 실패했습니다." },
            { status: 500 },
        );
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.headers.set(k, v);
    }
    return res;
}
