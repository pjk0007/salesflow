import { NextRequest } from "next/server";
import { getAiClient } from "@/lib/ai/client";
import { checkTokenQuota, logAiUsage, updateTokenUsage } from "@/lib/ai/quota";
import { CARD_IMAGE_MAX_BYTES, CARD_IMAGE_TYPES, scanBusinessCard } from "@/lib/relationship-care/ai";
import { fail, ok, salesHandler } from "@/lib/sales/http";

// POST: 명함 사진 글자 인식 (오늘의 인사 명함 등록과 같은 AI) — form-data "image"
export async function POST(req: NextRequest) {
    return salesHandler(req, async (user) => {
        const form = await req.formData();
        const file = form.get("image");
        if (!(file instanceof File)) return fail("명함 사진을 선택해주세요.");
        if (!CARD_IMAGE_TYPES.includes(file.type as (typeof CARD_IMAGE_TYPES)[number])) return fail("JPG·PNG·WEBP 사진만 읽을 수 있습니다.");
        if (file.size > CARD_IMAGE_MAX_BYTES) return fail("명함 사진은 5MB까지 올릴 수 있습니다.", 413);
        const quota = await checkTokenQuota(user.orgId);
        if (!quota.allowed) return fail("이번 달 AI 사용량을 모두 썼습니다. 직접 입력해주세요.", 429);
        const client = getAiClient();
        if (!client) return fail("AI 서비스를 사용할 수 없습니다. 직접 입력해주세요.", 503);
        try {
            const { fields, usage } = await scanBusinessCard(client, {
                mediaType: file.type as (typeof CARD_IMAGE_TYPES)[number],
                base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
            });
            await updateTokenUsage(user.orgId, usage.promptTokens + usage.completionTokens);
            await logAiUsage({ orgId: user.orgId, userId: user.userId, provider: client.provider, model: client.model, ...usage, purpose: "sales_business_card_scan" });
            return ok(fields);
        } catch (e) {
            const err = e as { message?: string; status?: number };
            return fail(err.message || "명함 글자를 읽지 못했습니다. 직접 입력해주세요.", err.status && err.status < 600 ? err.status : 502);
        }
    });
}
