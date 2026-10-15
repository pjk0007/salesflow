import { NextRequest } from "next/server";
import { attachmentPost } from "@/lib/inbox/file-http";
import { handleInbox, visitorToken } from "@/lib/inbox/http";
import { visitorFileScope } from "@/lib/inbox/repository";
import { customerFileSelection } from "@/lib/inbox-customer-history/rules";
import {
    applyMessengerHeaders,
    messengerHeaders,
} from "@/lib/customer-platform/messenger-http";
type C = { params: Promise<{ key: string }> };
export async function POST(req: NextRequest, c: C) {
    let headers: Record<string, string> = {};
    const response = await attachmentPost(req, async () => {
        const { key } = await c.params;
        headers = await messengerHeaders(req, key);
        return visitorFileScope(key, visitorToken(req), undefined, customerFileSelection(req.nextUrl.searchParams));
    });
    return applyMessengerHeaders(response, headers);
}
export async function OPTIONS(req: NextRequest, c: C) {
    let headers: Record<string, string> = {};
    const r = await handleInbox(async () => {
        headers = await messengerHeaders(req, (await c.params).key);
        return { ready: true };
    });
    return applyMessengerHeaders(r, headers);
}
