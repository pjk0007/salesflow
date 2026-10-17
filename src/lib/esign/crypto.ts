import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { EsignError } from "./types";
export function secretKey(secret: string): Buffer {
    if (Buffer.byteLength(secret) < 32) throw new EsignError("전자서명 암호화 키 설정이 필요합니다.", 503, "configuration");
    return createHash("sha256").update(secret).digest();
}
export function randomToken() { return randomBytes(32).toString("base64url"); }
export function randomOtp() { return String(randomInt(0, 1000000)).padStart(6, "0"); }
export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function otpHash(secret: string, recipientId: string, challenge: string, code: string) {
    return createHmac("sha256", secretKey(secret)).update(`otp:${recipientId}:${challenge}:${code}`).digest("hex");
}
export function equalHash(a: string, b: string) {
    if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
export function encryptPayload(secret: string, payload: unknown, binding: string) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secretKey(secret), iv);
    cipher.setAAD(Buffer.from(binding));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
export function decryptPayload<T>(secret: string, encrypted: string, binding: string): T {
    try {
        const [version, iv, tag, body, extra] = encrypted.split(".");
        if (version !== "v1" || !iv || !tag || !body || extra) throw new Error("format");
        const decipher = createDecipheriv("aes-256-gcm", secretKey(secret), Buffer.from(iv, "base64url"));
        decipher.setAAD(Buffer.from(binding));
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as T;
    } catch { throw new EsignError("발송 작업의 암호화 자료를 확인할 수 없습니다.", 503, "configuration"); }
}
