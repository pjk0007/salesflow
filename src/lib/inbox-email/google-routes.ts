import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { activeCustomerActor } from "@/lib/customer-access/access";
import { inboxActor, handleInbox, jsonBody } from "@/lib/inbox/http";
import { sameRequestOrigin } from "@/lib/inbox/rules";
import { InboxError } from "@/lib/inbox/errors";
import { googleMailConfig, googleHash } from "./google-config";
import {
    googleCookieName,
    googleConnectionStatus,
    beginGoogleConnection,
    finishGoogleConnection,
    disconnectGoogle,
    retryGoogleJobs,
} from "./google-connection";
type Context = { params: Promise<{ id: string }> };
export async function googleStatusGet(req: NextRequest, c: Context) {
    return handleInbox(async () =>
        googleConnectionStatus(inboxActor(req), await awaitId(c)),
    );
}
async function awaitId(c: Context) {
    return z
        .string()
        .uuid()
        .parse((await c.params).id);
}
async function admin(req: NextRequest) {
    return activeCustomerActor(inboxActor(req));
}
export async function googleControlPost(req: NextRequest, c: Context) {
    let cookie: { name: string; value: string; secure: boolean } | undefined;
    const response = await handleInbox(async () => {
        const actor = await admin(req),
            id = await awaitId(c),
            input = await jsonBody(req);
        if (input.action === "connect") {
            const cfg = googleMailConfig(),
                body = z
                    .object({
                        action: z.literal("connect"),
                        version: z.number().int().positive(),
                        lookbackDays: z.union([
                            z.literal(0),
                            z.literal(7),
                            z.literal(30),
                        ]),
                    })
                    .strict()
                    .parse(input);
            const started = await beginGoogleConnection(
                actor,
                id,
                { version: body.version, lookbackDays: body.lookbackDays },
                req.nextUrl.origin,
                undefined,
                cfg,
            );
            cookie = {
                name: started.cookieName,
                value: started.cookie,
                secure: new URL(cfg.redirectUri).protocol === "https:",
            };
            return { authorizationUrl: started.authorizationUrl };
        }
        if (input.action === "disconnect") {
            const body = z
                .object({
                    action: z.literal("disconnect"),
                    version: z.number().int().positive(),
                })
                .strict()
                .parse(input);
            return disconnectGoogle(actor, id, body.version);
        }
        z.object({ action: z.literal("retry") })
            .strict()
            .parse(input);
        return retryGoogleJobs(actor, id);
    });
    if (cookie)
        response.cookies.set(cookie.name, cookie.value, {
            httpOnly: true,
            sameSite: "lax",
            secure: cookie.secure,
            maxAge: 600,
            path: "/api/email-google/callback",
        });
    return response;
}
export async function googleCallbackGet(req: NextRequest) {
    const rawState = req.nextUrl.searchParams.get("state") ?? "";
    let target = "/inbox?emailConnection=failed",
        returnOrigin = req.nextUrl.origin;
    try {
        const cfg = googleMailConfig();
        if (
            !sameRequestOrigin(
                new URL(cfg.redirectUri).origin,
                req.nextUrl.origin,
            )
        )
            throw new InboxError("연결 주소를 확인해주세요.");
        returnOrigin = new URL(cfg.redirectUri).origin;
        const actor = await admin(req),
            result = await finishGoogleConnection(actor, {
                state: rawState,
                cookie:
                    req.cookies.get(googleCookieName(googleHash(rawState)))
                        ?.value ?? "",
                code: req.nextUrl.searchParams.get("code") ?? undefined,
                error: req.nextUrl.searchParams.get("error") ?? undefined,
            });
        target = `/inbox?channelId=${result.channelId}&emailConnection=${result.result}`;
    } catch {}
    const response = NextResponse.redirect(new URL(target, returnOrigin), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    if (rawState.length <= 100)
        response.cookies.set(googleCookieName(googleHash(rawState)), "", {
            httpOnly: true,
            sameSite: "lax",
            maxAge: 0,
            path: "/api/email-google/callback",
        });
    return response;
}
