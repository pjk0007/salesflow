import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";

const payload = z.object({
    kind: z.literal("sendb-journey-context"),
    orgId: z.string().uuid(),
    workspaceId: z.number().int().positive(),
    siteId: z.number().int().positive(),
    visitorId: z.number().int().positive(),
    sessionId: z.number().int().positive(),
    origin: z.url(),
});
export type JourneyContext = z.infer<typeof payload>;
export type StoredJourneyContext = JourneyContext & { linkedAt: string };
function secret() {
    const base = process.env.JWT_SECRET;
    if (!base) throw new Error("경로 연결 인증 설정이 필요합니다.");
    return createHmac("sha256", base).update("sendb.journey.context.v1").digest("hex");
}
export function issueJourneyContext(value: Omit<JourneyContext, "kind">, now = new Date()) {
    if (!process.env.JWT_SECRET) return undefined;
    const data = payload.parse({ ...value, kind: "sendb-journey-context" });
    return jwt.sign({ ...data, iat: Math.floor(now.getTime() / 1000) }, secret(), {
        algorithm: "HS256", issuer: "sendb-tracker", audience: "sendb-inbox-journey", expiresIn: 1800,
    });
}
export function verifyJourneyContext(token: string, now = new Date()) {
    return payload.parse(jwt.verify(token, secret(), {
        algorithms: ["HS256"], issuer: "sendb-tracker", audience: "sendb-inbox-journey",
        clockTimestamp: Math.floor(now.getTime() / 1000), maxAge: "30m",
    }));
}
