import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { AI_MODELS } from "@/lib/ai/models";
const input = z
    .object({
        provider: z.string(),
        model: z.string(),
        effectiveAt: z.iso.datetime(),
        inputPerMillion: z.number().nonnegative().max(1_000_000),
        outputPerMillion: z.number().nonnegative().max(1_000_000),
        currency: z.enum(["USD", "KRW"]),
        fxToKrw: z.number().positive().max(1_000_000).nullable(),
        fxDate: z.iso.date().nullable(),
        sourceUrl: z.url().refine((s) => /^https?:\/\//.test(s), "단가의 웹 근거를 입력해 주세요."),
    })
    .refine(
        (p) => AI_MODELS.some((m) => m.id === p.model && m.provider === p.provider),
        "공급자와 모델을 확인해 주세요.",
    )
    .refine(
        (p) => p.currency !== "USD" || (p.fxToKrw !== null && p.fxDate !== null),
        "달러 단가에는 원화 환율과 기준일이 필요합니다.",
    );
export const GET = (req: NextRequest) =>
    copyAdminApi(
        req,
        (conn, user) =>
            conn`SELECT * FROM ai_copy_price_versions WHERE org_id=${user.orgId} ORDER BY effective_at DESC LIMIT 100`,
    );
export const POST = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const p = input.parse(await req.json());
        const [price] =
            await conn`INSERT INTO ai_copy_price_versions(org_id,provider,model,effective_at,input_per_million,output_per_million,currency,fx_to_krw,fx_date,source_url,created_by)
        VALUES(${user.orgId},${p.provider},${p.model},${p.effectiveAt},${p.inputPerMillion},${p.outputPerMillion},${p.currency},${p.fxToKrw},${p.fxDate},${p.sourceUrl},${user.userId}) RETURNING *`;
        return price;
    });
