import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileDescriptors } from "@/lib/customer-import-files/rules";
import { normalizeImport } from "@/lib/customer-imports/adapters";
import { fingerprint } from "@/lib/customer-imports/rules";
import { splitChannelBundle } from "@/lib/channel-source-export/chunks";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import { channelTransferDirectory, readChannelTransferFile } from "@/lib/channel-source-export/transfer-local";
import { assertArchiveSource, verifiedArchiveBytes, type ArchiveSource } from "./store";

export type ArchiveMigrationIdentity = { workspaceId: number; namespace: string; channelId: string; origin: string };
export type ArchiveMigrationSourceFile = {
    id: string; messageSourceId: string; sourceFingerprint: string; sourceKey: string; descriptorHash: string;
    name: string; size: number; sha256: string; kind: string;
    expectedSize: number | null; expectedSha256: string | null;
    locator: { originalId: string; key: string | null; index: number; conversationId: string; messageSourceId: string };
};
export class ArchiveMigrationError extends Error {
    constructor(readonly code: string) { super(`보관 첨부 이전을 확인하지 못했습니다 (${code}).`); this.name = "ArchiveMigrationError"; }
}
function fail(code: string): never { throw new ArchiveMigrationError(code); }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail("invalid_source");

/** Read through one checked descriptor. Byte changes, links and path substitutions fail closed. */
export function openArchiveSource(directory: string, identity: Pick<ArchiveMigrationSourceFile, "size" | "sha256">, signal?: AbortSignal): ArchiveSource {
    assertArchiveSource(identity);
    return { ...identity, open: async function*() {
        signal?.throwIfAborted();
        const root = await channelTransferDirectory(directory), parent = await channelTransferDirectory(path.join(root, "bytes"));
        const file = path.join(parent, identity.sha256 + ".bin"), before = await fs.lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.size !== identity.size) fail("source_file_changed");
        const handle = await fs.open(file, "r");
        try {
            const opened = await handle.stat();
            if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail("source_path_changed");
            for await (const chunk of handle.createReadStream({ autoClose: false, signal })) yield chunk as Buffer;
            const after = await fs.lstat(file), final = await handle.stat();
            await channelTransferDirectory(parent);
            if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs || final.ctimeMs !== opened.ctimeMs)
                fail("source_file_changed");
        } finally { await handle.close(); }
    } };
}

/** This proves the reviewed bundle's attachments, not provider-wide completeness or recovered identities. */
export async function loadArchiveMigrationSource(bundleFile: string, archiveDirectory: string, identity: ArchiveMigrationIdentity, signal?: AbortSignal) {
    const absolute = path.resolve(bundleFile), directory = await channelTransferDirectory(archiveDirectory);
    const assertClosed = async () => { try { await fs.lstat(path.join(directory, ".archive.lock")); fail("archive_busy"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };
    await assertClosed(); signal?.throwIfAborted();
    const bundleBytes = await readChannelTransferFile(path.dirname(absolute), path.basename(absolute));
    const manifestBytes = await readChannelTransferFile(directory, "manifest.json");
    let bundle: Record<string, unknown>, manifest: Record<string, unknown>;
    try { bundle = obj(JSON.parse(bundleBytes.toString("utf8"))); manifest = obj(JSON.parse(manifestBytes.toString("utf8"))); } catch { return fail("invalid_source"); }
    if (bundle.hasNext !== false || bundle.next || bundle.nextCursor || !Array.isArray(bundle.messages) || !Array.isArray(bundle.users) ||
        manifest.version !== 1 || manifest.channelId !== identity.channelId || manifest.scope !== "all-customer-attachment-originals" || manifest.messageSourceComplete !== true || !Array.isArray(manifest.files)) fail("source_scope");
    const chunks = splitChannelBundle(bundle, { workspaceId: identity.workspaceId, namespace: identity.namespace, allowUnavailableAuthorProfiles: true });
    const normalized = chunks.chunks.filter(c => c.phase === "messages").flatMap(c => normalizeImport(c.input).rows.filter(r => r.kind === "messages"));
    if (normalized.some(r => r.errors.length)) fail("invalid_source");
    const messages = new Map(normalized.map(r => [r.sourceId, r]));
    if (messages.size !== bundle.messages.length) fail("invalid_message_count");
    const archived = new Map<string, Record<string, unknown>>();
    for (const raw of manifest.files) {
        const row = obj(raw); if (typeof row.id !== "string" || archived.has(row.id)) fail("duplicate_archive"); archived.set(row.id, row);
    }
    const files: ArchiveMigrationSourceFile[] = [], seenMessages = new Set<string>();
    for (const raw of bundle.messages) {
        signal?.throwIfAborted();
        const message = obj(raw), sourceId = `${message.chatId}/${message.id}`, normalizedMessage = messages.get(sourceId);
        if (!normalizedMessage || seenMessages.has(sourceId) || typeof message.chatId !== "string" || typeof message.id !== "string") fail("invalid_message");
        if (message.files !== undefined && message.files !== null && !Array.isArray(message.files)) fail("invalid_source_files");
        seenMessages.add(sourceId);
        const descriptors = fileDescriptors(message.files), legacy = fileDescriptors(message.files, MAX_FILE_BYTES);
        for (const d of descriptors) {
            const id = fingerprint([message.chatId, message.id, d.sourceKey]), saved = archived.get(id);
            if (!saved || d.invalid || saved.state !== "saved" || saved.sourceKey !== d.sourceKey || saved.chatId !== message.chatId || saved.messageId !== message.id || saved.name !== d.name ||
                ![d.manifest, legacy[d.index].manifest].includes(String(saved.descriptorHash)) || saved.path !== `bytes/${saved.sha256}.bin` || saved.size !== d.size ||
                (d.size !== null && d.size !== saved.archivedSize) || (d.sha && d.sha !== saved.sha256)) fail("archive_relation_mismatch");
            const kind = String(normalizedMessage.data.messageKind);
            if (saved.visibility !== (kind === "note" ? "private" : "public")) fail("archive_visibility_mismatch");
            const file: ArchiveMigrationSourceFile = { id, messageSourceId: sourceId, sourceFingerprint: fingerprint({ data: normalizedMessage.data, original: normalizedMessage.original }), sourceKey: d.sourceKey, descriptorHash: d.manifest,
                name: d.name, size: Number(saved.archivedSize), sha256: String(saved.sha256), kind, expectedSize: d.size, expectedSha256: d.sha,
                locator: { ...d.locator, conversationId: String(message.chatId), messageSourceId: sourceId } };
            assertArchiveSource(file);
            for await (const chunk of verifiedArchiveBytes(openArchiveSource(directory, file, signal))) { signal?.throwIfAborted(); void chunk; }
            files.push(file);
        }
    }
    if (files.length !== archived.size) fail("archive_file_count");
    if (sha(await readChannelTransferFile(directory, "manifest.json")) !== sha(manifestBytes) || sha(await readChannelTransferFile(path.dirname(absolute), path.basename(absolute))) !== sha(bundleBytes)) fail("source_metadata_changed");
    await assertClosed();
    return { directory, files, snapshot: { bundleSha256: sha(bundleBytes), manifestSha256: sha(manifestBytes) },
        coverage: { scope: "reviewed-bundle-attachments" as const, sourceCollectionComplete: manifest.sourceComplete === true, messageSourceComplete: true,
            unavailableCustomerProfiles: bundle.users.filter(u => !!obj(u).sourceProfileUnavailable).length, unavailableAuthorProfiles: chunks.manifest.unavailableAuthorProfiles.length },
        limitations: ["이 실행은 검토한 묶음의 첨부 범위입니다. 공급자 전체 데이터 또는 조회 불가한 고객정보 복구를 증명하지 않습니다.", "고객 본인 이력 공개나 실제 사이트 채널 전환을 승인하지 않습니다."] };
}
