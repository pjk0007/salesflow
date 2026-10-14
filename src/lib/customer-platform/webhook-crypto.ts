import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from "node:crypto";
import { InboxError } from "@/lib/inbox/errors";
function key() {
    const raw =
        process.env.CUSTOMER_WEBHOOK_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!raw) throw new InboxError("웹훅 암호화 키를 설정해주세요.", 503);
    return createHash("sha256")
        .update("sendb-webhook-key-v1\0" + raw)
        .digest();
}
export function newWebhookSecret() {
    return "whsec_" + randomBytes(32).toString("base64url");
}
export function secretHint(secret: string) {
    return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}
export function sealWebhookSecret(secret: string, scope: string) {
    const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key(), iv);
    cipher.setAAD(Buffer.from(scope));
    return [
        iv,
        Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]),
        cipher.getAuthTag(),
    ]
        .map((b) => b.toString("base64url"))
        .join(".");
}
export function openWebhookSecret(value: string, scope: string) {
    const [iv, body, tag] = value
            .split(".")
            .map((b) => Buffer.from(b, "base64url")),
        cipher = createDecipheriv("aes-256-gcm", key(), iv);
    cipher.setAAD(Buffer.from(scope));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(body), cipher.final()]).toString(
        "utf8",
    );
}
