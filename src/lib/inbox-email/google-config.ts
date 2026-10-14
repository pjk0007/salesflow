import { createHash } from "node:crypto";
import { InboxError } from "@/lib/inbox/errors";
import { sealPrivateValue, openPrivateValue } from "@/lib/secret-box";
export const GOOGLE_MAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
] as const;
export interface GoogleMailConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    encryptionKey: string;
}
export function googleMailConfig(): GoogleMailConfig {
    const clientId = process.env.CUSTOMER_EMAIL_GOOGLE_CLIENT_ID,
        clientSecret = process.env.CUSTOMER_EMAIL_GOOGLE_CLIENT_SECRET,
        redirectUri = process.env.CUSTOMER_EMAIL_GOOGLE_REDIRECT_URI,
        encryptionKey =
            process.env.CUSTOMER_EMAIL_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!clientId || !clientSecret || !redirectUri || !encryptionKey)
        throw new InboxError(
            "관리자가 Google 메일 연결을 설정해야 합니다.",
            503,
        );
    const url = new URL(redirectUri);
    if (
        url.pathname !== "/api/email-google/callback" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        (url.protocol !== "https:" &&
            !(
                url.protocol === "http:" &&
                ["localhost", "127.0.0.1"].includes(url.hostname)
            ))
    )
        throw new InboxError("Google 메일 연결 주소를 확인해주세요.", 503);
    return {
        clientId,
        clientSecret,
        redirectUri: url.toString(),
        encryptionKey,
    };
}
export const googleMailWorkerEnabled = () =>
    process.env.NODE_ENV === "production" &&
    process.env.CUSTOMER_EMAIL_WORKER === "on";
export const googleHash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
const key = (cfg: GoogleMailConfig) =>
    createHash("sha256")
        .update("sendb-email-key-v1\0" + cfg.encryptionKey)
        .digest();
export const sealGoogleValue = (
    value: string,
    scope: string,
    cfg: GoogleMailConfig,
) => sealPrivateValue(value, scope, key(cfg));
export const openGoogleValue = (
    value: string,
    scope: string,
    cfg: GoogleMailConfig,
) => openPrivateValue(value, scope, key(cfg));
