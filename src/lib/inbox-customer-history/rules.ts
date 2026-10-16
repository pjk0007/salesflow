import { z } from "zod";
import { messageInput } from "@/lib/inbox/rules";
export const customerThreadCreate = messageInput;
export const customerThreadRead = z
    .object({
        lastMessageId: z.number().int().positive(),
        readRevision: z.number().int().nonnegative().optional(),
    })
    .strict();
export function selectedConversation(params: URLSearchParams) {
    return params.has("conversationId")
        ? z.string().uuid().parse(params.get("conversationId"))
        : undefined;
}
export function customerFileSelection(params: URLSearchParams) {
    const conversationId = selectedConversation(params),
        newConversation = params.get("newConversation") === "1";
    if (conversationId && newConversation)
        return z.never().parse("ambiguous conversation selection");
    return { conversationId, newConversation };
}
const historyPosition = z.tuple([
    z.string().datetime({ offset: true }),
    z.string().uuid(),
]);
export function parseCustomerConversationCursor(raw: string) {
    z.string().max(256).parse(raw);
    if (!raw.startsWith("v1."))
        return { id: z.string().uuid().parse(raw), at: null };
    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(raw.slice(3), "base64url").toString());
    } catch {
        return z.never().parse(null);
    }
    const [at, id] = historyPosition.parse(value);
    return { id, at: new Date(at) };
}
export function customerConversationCursor(at: Date, id: string) {
    return (
        "v1." +
        Buffer.from(JSON.stringify([at.toISOString(), id])).toString("base64url")
    );
}
