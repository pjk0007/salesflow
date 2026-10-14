import { createHmac, timingSafeEqual } from "node:crypto";
/** Server only. Verify the original UTF-8 body before parsing; deduplicate event.id transactionally. */
export function signSendbWebhook(
    body: string,
    id: string,
    timestamp: string,
    secret: string,
) {
    if (!/^whsec_[a-zA-Z0-9_-]{43}$/.test(secret))
        throw new Error("웹훅 서명 키 형식을 확인해주세요.");
    return (
        "v1=" +
        createHmac("sha256", Buffer.from(secret.slice(6), "base64url"))
            .update(`${id}.${timestamp}.${body}`)
            .digest("hex")
    );
}
export function verifySendbWebhook(
    body: string,
    headers: { id: string; timestamp: string; signature: string },
    secret: string,
    now = new Date(),
) {
    try {
        if (
            !/^\d{1,12}$/.test(headers.timestamp) ||
            Math.abs(now.getTime() / 1000 - Number(headers.timestamp)) > 300 ||
            !/^v1=[a-f0-9]{64}$/.test(headers.signature)
        )
            return false;
        const expected = signSendbWebhook(
            body,
            headers.id,
            headers.timestamp,
            secret,
        );
        return (
            timingSafeEqual(
                Buffer.from(expected),
                Buffer.from(headers.signature),
            ) && JSON.parse(body).id === headers.id
        );
    } catch {
        return false;
    }
}
