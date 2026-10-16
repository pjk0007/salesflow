import { createHmac, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { InboxError } from "@/lib/inbox/errors";
function identitySecret() {
    const base = process.env.INBOX_IDENTITY_SECRET || process.env.JWT_SECRET;
    if (!base) throw new InboxError("회원 상담 인증 설정이 필요합니다.", 503);
    // 직원 로그인 JWT와 별도 키 영역. 회원 토큰을 직원 인증에 재사용할 수 없다.
    return createHmac("sha256", base)
        .update("sendb.customer.identity.v1")
        .digest("hex");
}
export function issueCustomerIdentity(
    contactId: string,
    channelKey: string,
    now = new Date(),
) {
    const seconds = Math.floor(now.getTime() / 1000);
    const token = jwt.sign(
        { kind: "sendb-customer", v: 1, iat: seconds },
        identitySecret(),
        {
            algorithm: "HS256",
            issuer: "sendb-inbox",
            audience: `channel:${channelKey}`,
            subject: contactId,
            jwtid: randomUUID(),
            expiresIn: 900,
        },
    );
    return {
        identityToken: token,
        expiresAt: new Date((seconds + 900) * 1000).toISOString(),
    };
}
export function verifyCustomerIdentity(
    token: string,
    channelKey: string,
    now = new Date(),
) {
    try {
        const value = jwt.verify(token, identitySecret(), {
            algorithms: ["HS256"],
            issuer: "sendb-inbox",
            audience: `channel:${channelKey}`,
            clockTimestamp: Math.floor(now.getTime() / 1000),
            maxAge: "15m",
        });
        return z
            .object({
                kind: z.literal("sendb-customer"),
                v: z.literal(1),
                sub: z.string().uuid(),
                exp: z.number(),
                iat: z.number(),
            })
            .parse(value).sub;
    } catch {
        throw new InboxError(
            "회원 상담 인증이 만료되었거나 올바르지 않습니다. 다시 연결해주세요.",
            401,
        );
    }
}
