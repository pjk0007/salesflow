import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const MAX_ARCHIVE_FILE_BYTES = 1024 * 1024 * 1024;
export type ArchiveSource = {
    size: number;
    sha256: string;
    open: () => AsyncIterable<Uint8Array>;
};
export type ArchiveStore = {
    put: (key: string, source: ArchiveSource) => Promise<void>;
    get: (key: string) => Promise<{ size: number; body: AsyncIterable<Uint8Array> }>;
};

export function assertArchiveSource(source: Pick<ArchiveSource, "size" | "sha256">) {
    if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > MAX_ARCHIVE_FILE_BYTES || !/^[a-f0-9]{64}$/.test(source.sha256))
        throw new Error("보관 원본의 크기와 SHA-256을 확인해주세요.");
}
export async function* verifiedArchiveBytes(source: ArchiveSource) {
    assertArchiveSource(source);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of source.open()) {
        bytes += chunk.byteLength;
        if (bytes > source.size) throw new Error("보관 원본의 크기가 다릅니다.");
        hash.update(chunk);
        yield chunk;
    }
    if (bytes !== source.size || hash.digest("hex") !== source.sha256)
        throw new Error("보관 원본의 크기 또는 SHA-256이 다릅니다.");
}
export function createArchiveStore(client: S3Client, bucket: string): ArchiveStore {
    if (!bucket) throw new Error("비공개 상담 파일 저장소가 설정되지 않았습니다.");
    return {
        async put(key, source) {
            assertArchiveSource(source);
            await client.send(new PutObjectCommand({
                Bucket: bucket, Key: key,
                Body: Readable.from(verifiedArchiveBytes(source)),
                ContentLength: source.size,
                ContentType: "application/octet-stream",
                // Bucket policy must deny anonymous access; never set a public ACL.
            }));
        },
        async get(key) {
            const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            if (!result.Body || !Number.isSafeInteger(result.ContentLength) || result.ContentLength! < 1)
                throw new Error("보관 파일을 읽을 수 없습니다.");
            return { size: result.ContentLength!, body: result.Body as AsyncIterable<Uint8Array> };
        },
    };
}
let configured: ArchiveStore | undefined;
export function archiveStore(): ArchiveStore {
    if (configured) return configured;
    const endpoint = process.env.INBOX_ARCHIVE_S3_ENDPOINT,
        bucket = process.env.INBOX_ARCHIVE_S3_BUCKET,
        accessKeyId = process.env.INBOX_ARCHIVE_S3_ACCESS_KEY_ID,
        secretAccessKey = process.env.INBOX_ARCHIVE_S3_SECRET_ACCESS_KEY;
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || new URL(endpoint).protocol !== "https:")
        throw new Error("비공개 상담 파일 저장소가 설정되지 않았습니다.");
    configured = createArchiveStore(new S3Client({
        region: process.env.INBOX_ARCHIVE_S3_REGION || "auto",
        endpoint, credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
    }), bucket);
    return configured;
}
