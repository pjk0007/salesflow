import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody, visitorToken } from "@/lib/inbox/http";
import {
    applyMessengerHeaders,
    messengerHeaders,
} from "@/lib/customer-platform/messenger-http";
import {
    createCustomerConversation,
    customerConversationPage,
    markCustomerConversationRead,
} from "./repository";
type Context = { params: Promise<{ key: string; id?: string }> };
async function run(
    req: NextRequest,
    c: Context,
    action: (key: string, id?: string) => Promise<unknown>,
) {
    let headers: Record<string, string> = {};
    const result = await handleInbox(async () => {
        const { key, id } = await c.params;
        headers = await messengerHeaders(req, key);
        return action(key, id);
    });
    return applyMessengerHeaders(result, headers);
}
export const customerConversationHandlers = {
    GET: (req: NextRequest, c: Context) =>
        run(req, c, async (key) =>
            customerConversationPage(
                key,
                visitorToken(req),
                req.nextUrl.searchParams.has("before")
                    ? z
                          .string()
                          .max(256)
                          .parse(req.nextUrl.searchParams.get("before"))
                    : undefined,
            ),
        ),
    POST: (req: NextRequest, c: Context) =>
        run(req, c, async (key) =>
            createCustomerConversation(
                key,
                visitorToken(req),
                await jsonBody(req),
            ),
        ),
    OPTIONS: (req: NextRequest, c: Context) =>
        run(req, c, async () => ({ ready: true })),
};
export const customerConversationReadHandlers = {
    POST: (req: NextRequest, c: Context) =>
        run(req, c, async (key, id) =>
            markCustomerConversationRead(
                key,
                visitorToken(req),
                z.string().uuid().parse(id),
                await jsonBody(req),
            ),
        ),
    OPTIONS: customerConversationHandlers.OPTIONS,
};
