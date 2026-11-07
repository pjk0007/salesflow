import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, inboxActor, jsonBody } from "@/lib/inbox/http";
import { InboxError } from "@/lib/inbox/errors";
import { requireCustomerAccess } from "@/lib/customer-access/access";
import {
    checkTokenQuota,
    getAiClient,
    logAiUsage,
    updateTokenUsage,
} from "@/lib/ai";
import {
    applyCareAction,
    draftContext,
    getCare,
    registerBusinessCard,
    saveCare,
    todayCards,
} from "./repository";
import {
    CARD_IMAGE_MAX_BYTES,
    CARD_IMAGE_TYPES,
    generateRelationshipDraft,
    scanBusinessCard,
} from "./ai";
type Ctx = { params: Promise<{ contactId: string }> };
const workspaceParam = (req: NextRequest) =>
    z.coerce
        .number()
        .int()
        .positive()
        .parse(req.nextUrl.searchParams.get("workspaceId"));
const contactParam = async (ctx: Ctx) =>
    z.string().uuid().parse((await ctx.params).contactId);
export const getToday = (req: NextRequest) =>
    handleInbox(() =>
        todayCards(
            inboxActor(req),
            workspaceParam(req),
            req.nextUrl.searchParams.get("scope") === "all" ? "all" : "mine",
        ),
    );
export const getContactCare = (req: NextRequest, ctx: Ctx) =>
    handleInbox(async () =>
        getCare(inboxActor(req), workspaceParam(req), await contactParam(ctx)),
    );
export const putContactCare = (req: NextRequest, ctx: Ctx) =>
    handleInbox(async () =>
        saveCare(inboxActor(req), await contactParam(ctx), await jsonBody(req)),
    );
export const postCareAction = (req: NextRequest, ctx: Ctx) =>
    handleInbox(async () =>
        applyCareAction(inboxActor(req), await contactParam(ctx), await jsonBody(req)),
    );
export const postBusinessCard = (req: NextRequest) =>
    handleInbox(async () => registerBusinessCard(inboxActor(req), await jsonBody(req)));
/** AI 호출 공통: 월 사용량 확인 → 호출 → 사용량 기록 */
async function withAi<T extends { usage: { promptTokens: number; completionTokens: number } }>(
    orgId: string,
    userId: string,
    purpose: string,
    run: (client: NonNullable<ReturnType<typeof getAiClient>>) => Promise<T>,
) {
    const quota = await checkTokenQuota(orgId);
    if (!quota.allowed)
        throw new InboxError("이번 달 AI 사용량을 모두 썼습니다. 기본 초안을 고쳐 써 주세요.", 429);
    const client = getAiClient();
    if (!client) throw new InboxError("AI 서비스를 사용할 수 없습니다.", 503);
    const result = await run(client);
    await updateTokenUsage(orgId, result.usage.promptTokens + result.usage.completionTokens);
    await logAiUsage({
        orgId,
        userId,
        provider: client.provider,
        model: client.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        purpose,
    });
    const { usage, ...data } = result;
    void usage;
    return data;
}
const draftRequest = z
    .object({
        workspaceId: z.number().int().positive(),
        reason: z.enum(["welcome", "anniversary", "memory", "season", "dormant", "routine"]),
    })
    .strict();
export const postDraft = (req: NextRequest, ctx: Ctx) =>
    handleInbox(async () => {
        const actor = inboxActor(req),
            contactId = await contactParam(ctx),
            input = draftRequest.parse(await jsonBody(req));
        const context = await draftContext(actor, input.workspaceId, contactId, input.reason);
        return withAi(actor.orgId, actor.userId, "relationship_draft", (client) =>
            generateRelationshipDraft(client, context),
        );
    });
export const postCardScan = (req: NextRequest) =>
    handleInbox(async () => {
        const actor = inboxActor(req),
            workspaceId = workspaceParam(req);
        await requireCustomerAccess(actor, workspaceId, "respond");
        if (Number(req.headers.get("content-length") ?? 0) > CARD_IMAGE_MAX_BYTES * 1.4)
            throw new InboxError("명함 사진은 5MB까지 올릴 수 있습니다.", 413);
        const form = await req.formData();
        const file = form.get("image");
        if (!(file instanceof File)) throw new InboxError("명함 사진을 선택해주세요.");
        if (!CARD_IMAGE_TYPES.includes(file.type as (typeof CARD_IMAGE_TYPES)[number]))
            throw new InboxError("JPG·PNG·WEBP 사진만 읽을 수 있습니다.");
        if (file.size > CARD_IMAGE_MAX_BYTES)
            throw new InboxError("명함 사진은 5MB까지 올릴 수 있습니다.", 413);
        const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
        return withAi(actor.orgId, actor.userId, "business_card_scan", (client) =>
            scanBusinessCard(client, {
                mediaType: file.type as (typeof CARD_IMAGE_TYPES)[number],
                base64,
            }),
        );
    });
