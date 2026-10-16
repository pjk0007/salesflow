import { createHash, randomBytes } from "node:crypto";
import { sealPrivateValue, openPrivateValue } from "@/lib/secret-box";
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
    return sealPrivateValue(secret, scope, key());
}
export function openWebhookSecret(value: string, scope: string) {
    return openPrivateValue(value, scope, key());
}
