import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { EsignError, type EsignArtifact } from "./types";

const MAX_BYTES = 25 * 1024 * 1024;
const MAGIC = Buffer.from("SBE1");
export interface EsignBlobStore {
    putOnce(key: string, bytes: Uint8Array): Promise<boolean>;
    read(key: string): Promise<Uint8Array>;
}
export interface EsignStorage {
    put(key: string, bytes: Uint8Array, contentType: EsignArtifact["contentType"]): Promise<EsignArtifact>;
    get(artifact: EsignArtifact): Promise<Uint8Array>;
}
function checkedKey(key: string) {
    if (!/^esign\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(key) || key.split("/").some(p => p === "." || p === "..") || key.length > 400)
        throw new EsignError("계약 파일 경로가 올바르지 않습니다.", 400, "invalid_storage_key");
    return key;
}
export const artifactHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Encryption is mandatory even when a bucket is later misconfigured as public. */
export function createEsignStorage(raw: EsignBlobStore, secret: string): EsignStorage {
    if (secret.length < 32) throw new EsignError("전자서명 암호화 키를 설정해주세요.", 503, "storage_unconfigured");
    const key = createHash("sha256").update("sendb-esign-files-v1\0" + secret).digest();
    async function open(objectKey: string) {
        const encrypted = Buffer.from(await raw.read(checkedKey(objectKey)));
        if (encrypted.length < 33 || encrypted.length > MAX_BYTES + 32 || !encrypted.subarray(0, 4).equals(MAGIC))
            throw new EsignError("계약 파일을 확인할 수 없습니다.", 500, "artifact_invalid");
        try {
            const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(4, 16));
            decipher.setAAD(Buffer.from(objectKey));
            decipher.setAuthTag(encrypted.subarray(16, 32));
            return Buffer.concat([decipher.update(encrypted.subarray(32)), decipher.final()]);
        } catch { throw new EsignError("계약 파일의 무결성을 확인할 수 없습니다.", 500, "artifact_invalid"); }
    }
    return {
        async put(objectKey, bytes, contentType) {
            checkedKey(objectKey);
            if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new EsignError("계약 파일 크기를 확인해주세요.");
            const artifact: EsignArtifact = { key: objectKey, sha256: artifactHash(bytes), size: bytes.byteLength, contentType };
            const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
            cipher.setAAD(Buffer.from(objectKey));
            const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
            const sealed = Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body]);
            if (!await raw.putOnce(objectKey, sealed)) {
                const existing = await open(objectKey);
                if (existing.length !== artifact.size || artifactHash(existing) !== artifact.sha256)
                    throw new EsignError("이미 저장된 계약 파일을 덮어쓸 수 없습니다.", 409, "immutable_artifact");
            }
            return artifact;
        },
        async get(artifact) {
            const bytes = await open(artifact.key);
            if (bytes.length !== artifact.size || artifactHash(bytes) !== artifact.sha256)
                throw new EsignError("계약 파일의 크기 또는 해시가 다릅니다.", 500, "artifact_invalid");
            return bytes;
        },
    };
}

export function localEsignBlobStore(directory: string): EsignBlobStore {
    const root = path.resolve(directory);
    const filePath = (key: string) => {
        const file = path.resolve(root, checkedKey(key));
        if (!file.startsWith(root + path.sep)) throw new EsignError("계약 파일 경로가 올바르지 않습니다.");
        return file;
    };
    return {
        async putOnce(key, bytes) {
            const file = filePath(key);
            await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
            try { await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); return true; }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
        },
        async read(key) {
            const file = filePath(key), info = await stat(file);
            if (!info.isFile() || info.size > MAX_BYTES + 32) throw new EsignError("계약 파일 크기를 확인해주세요.");
            return readFile(file);
        },
    };
}

export function s3EsignBlobStore(client: S3Client, bucket: string): EsignBlobStore {
    if (!bucket) throw new EsignError("계약 파일 저장소를 설정해주세요.", 503);
    return {
        async putOnce(key, bytes) {
            try {
                await client.send(new PutObjectCommand({ Bucket: bucket, Key: checkedKey(key), Body: bytes, ContentType: "application/octet-stream", CacheControl: "no-store", IfNoneMatch: "*" }));
                return true;
            } catch (error) {
                if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) return false;
                throw error;
            }
        },
        async read(key) {
            const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: checkedKey(key) }));
            if (!result.Body || !result.ContentLength || result.ContentLength > MAX_BYTES + 32)
                throw new EsignError("계약 파일 크기를 확인해주세요.", 500);
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
                size += chunk.byteLength;
                if (size > MAX_BYTES + 32) throw new EsignError("계약 파일 크기를 확인해주세요.", 500);
                chunks.push(Buffer.from(chunk));
            }
            if (size !== result.ContentLength) throw new EsignError("계약 파일 전송이 완료되지 않았습니다.", 500);
            return Buffer.concat(chunks);
        },
    };
}
