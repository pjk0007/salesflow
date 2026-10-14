import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export function sealPrivateValue(value: string, scope: string, key: Buffer) {
    const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(scope));
    return [
        iv,
        Buffer.concat([cipher.update(value, "utf8"), cipher.final()]),
        cipher.getAuthTag(),
    ]
        .map((b) => b.toString("base64url"))
        .join(".");
}
export function openPrivateValue(value: string, scope: string, key: Buffer) {
    const [iv, body, tag] = value
            .split(".")
            .map((b) => Buffer.from(b, "base64url")),
        cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(scope));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(body), cipher.final()]).toString(
        "utf8",
    );
}
