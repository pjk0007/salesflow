import type { SendbClient } from "../../../sdk/server";
import type { SendbEmailClaim } from "../../../sdk/email-types";
import type { SendbEmailFile } from "../../../sdk/email-types";
import {
    GmailApiError,
    getAccessToken,
    type GmailCredentials,
    GMAIL_API_ORIGIN,
    invalidateGmailAccessToken,
    gmailResponseError,
} from "@/lib/gmail-client";
import {
    htmlToText,
    decodeMimeWords,
    decodePartData,
    parseContentType,
} from "@/lib/email-reply-rules";
import { googleAccountAddress, assertGoogleAlias, OtherMailboxRecipientError } from "./google-identity";
import { inboundInput, emailAddress, rfcId } from "./rules";
import { createHash } from "node:crypto";
import { MAX_FILE_BYTES, MAX_MESSAGE_FILES } from "@/lib/inbox/file-rules";
export type EmailTransportClient = Pick<
    SendbClient,
    | "emailMailboxes"
    | "receiveEmail"
    | "claimEmail"
    | "changeEmailDelivery"
    | "emailReceiptFiles"
    | "uploadEmailFile"
    | "failEmailFile"
    | "pendingEmailFiles"
    | "downloadEmailDeliveryFile"
>;
const wrap = (body: string) =>
    Buffer.from(body, "utf8")
        .toString("base64")
        .match(/.{1,76}/g)
        ?.join("\r\n") ?? "";
const encoded = (header: string) => {
    if (/[\r\n\x00-\x1f\x7f]/.test(header))
        throw new Error("메일 머리글이 잘못됐습니다.");
    // Split by Unicode codepoint so encoded words remain within RFC 2047's 75 octets.
    const chunks: string[] = [];
    let chunk = "";
    for (const c of header) {
        if (Buffer.byteLength(chunk + c) > 36) {
            chunks.push(chunk);
            chunk = "";
        }
        chunk += c;
    }
    if (chunk) chunks.push(chunk);
    return chunks
        .map((s) => `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`)
        .join("\r\n ");
};
export type GmailReplyFile = {
    fileName: string;
    contentType: string;
    bytes: Buffer;
};
function filenameParams(name: string) {
    if (/[\x00-\x1f\x7f]/.test(name))
        throw new Error("첨부 파일 이름을 확인해주세요.");
    const chunks: string[] = [];
    let chunk = "";
    for (const char of name) {
        const encoded = encodeURIComponent(char).replace(
            /[!'()*]/g,
            (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        if (chunk.length + encoded.length > 60) {
            chunks.push(chunk);
            chunk = "";
        }
        chunk += encoded;
    }
    if (chunk) chunks.push(chunk);
    return chunks
        .map((s, i) => `filename*${i}*=${i === 0 ? "UTF-8''" : ""}${s}`)
        .join(";\r\n ");
}
export function gmailReplyRaw(
    item: SendbEmailClaim,
    now = new Date(),
    files: GmailReplyFile[] = [],
) {
    emailAddress.parse(item.from);
    emailAddress.parse(item.recipient);
    const to = (item.recipientTo ?? [item.recipient]).map((s) =>
            emailAddress.parse(s),
        ),
        cc = (item.recipientCc ?? []).map((s) => emailAddress.parse(s));
    if (
        !to.length ||
        to[0] !== item.recipient ||
        to.length + cc.length > 30 ||
        new Set([...to, ...cc]).size !== to.length + cc.length ||
        [...to, ...cc].includes(item.from)
    )
        throw new Error("메일 받는 사람을 확인해주세요.");
    rfcId.parse(item.rfcMessageId);
    rfcId.parse(item.inReplyTo);
    if (
        files.length > MAX_MESSAGE_FILES ||
        files.reduce((sum, f) => sum + f.bytes.length, 0) > MAX_FILE_BYTES
    )
        throw new Error(
            "이메일 첨부는 최대 5개, 합계 20MB까지 보낼 수 있습니다.",
        );
    if (item.attachments && item.attachments.length !== files.length)
        throw new Error("발송 첨부를 모두 확인해주세요.");
    const headers = [
        `From: ${encoded(item.fromName)} <${item.from}>`,
        `To: ${to.join(",\r\n ")}`,
        ...(cc.length ? [`Cc: ${cc.join(",\r\n ")}`] : []),
        `Subject: ${encoded(item.subject)}`,
        `Date: ${now.toUTCString()}`,
        `Message-ID: ${item.rfcMessageId}`,
        `In-Reply-To: ${item.inReplyTo}`,
        `References: ${item.inReplyTo}`,
        "MIME-Version: 1.0",
    ];
    const text = [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        wrap(item.body),
        "",
    ];
    if (!files.length)
        return Buffer.from([...headers, ...text].join("\r\n"), "utf8").toString(
            "base64url",
        );
    const boundary = `sendb_${createHash("sha256").update(item.id).digest("hex").slice(0, 32)}`;
    const parts = [
        ...headers,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        ...text,
    ];
    for (const file of files) {
        if (
            !file.bytes.length ||
            !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.contentType)
        )
            throw new Error("첨부 파일 형식을 확인해주세요.");
        parts.push(
            `--${boundary}`,
            `Content-Type: ${file.contentType}`,
            `Content-Disposition: attachment; filename="attachment";\r\n ${filenameParams(file.fileName)}`,
            "Content-Transfer-Encoding: base64",
            "",
            file.bytes
                .toString("base64")
                .match(/.{1,76}/g)
                ?.join("\r\n") ?? "",
            "",
        );
    }
    parts.push(`--${boundary}--`, "");
    return Buffer.from(parts.join("\r\n"), "utf8").toString("base64url");
}
type Part = {
    mimeType?: string;
    filename?: string;
    partId?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string; size?: number; attachmentId?: string };
    parts?: Part[];
};
const isFilePart = (part: Part) =>
    !!part.filename ||
    part.mimeType === "message/rfc822" ||
    !!part.headers?.some(
        (h) =>
            h.name.toLowerCase() === "content-disposition" &&
            /^attachment\b/i.test(h.value),
    ) ||
    !!(
        (part.body?.attachmentId || part.body?.data) &&
        part.mimeType &&
        !part.mimeType.startsWith("multipart/") &&
        !["text/plain", "text/html"].includes(part.mimeType)
    );
export function gmailFileParts(root: Part) {
    const files: Part[] = [];
    const walk = (part: Part, depth = 0) => {
        if (depth > 25) throw new Error("메일 MIME 중첩이 너무 깊습니다.");
        if (isFilePart(part)) {
            files.push(part);
            return;
        }
        for (const child of part.parts ?? []) walk(child, depth + 1);
    };
    walk(root);
    return files;
}
export interface GmailInboxMessage {
    id: string;
    threadId: string;
    internalDate: string;
    payload: Part;
    labelIds?: string[];
}
function addresses(raw: string) {
    // Gmail full format supplies decoded headers. Accept ordinary address/angle-address lists, reject ambiguous forms.
    return [
        ...raw.matchAll(
            /(?:<([^<>\s]+@[^<>\s]+)>|(?:^|[,;]\s*)([^\s<>"(),;]+@[^\s<>"(),;]+))/g,
        ),
    ].map((m) => emailAddress.parse(m[1] || m[2]));
}
export function gmailInbound(message: GmailInboxMessage) {
    const header = (name: string) =>
        decodeMimeWords(
            message.payload.headers?.find(
                (h) => h.name.toLowerCase() === name.toLowerCase(),
            )?.value ?? "",
        ).replace(/\r?\n[ \t]+/g, " ");
    const senders = addresses(header("from"));
    if (senders.length !== 1)
        throw new Error("단일 발신자가 확인되는 메일만 연결할 수 있습니다.");
    const plain: string[] = [],
        html: string[] = [],
        files: {
            name: string;
            size: number;
            contentType: string;
            providerId: string;
        }[] = [];
    const walk = (part: Part, depth = 0) => {
        if (depth > 25) throw new Error("메일 MIME 중첩이 너무 깊습니다.");
        const charset = parseContentType(
            part.headers?.find((h) => h.name.toLowerCase() === "content-type")
                ?.value,
        ).params.charset;
        if (
            ["text/plain", "text/html"].includes(part.mimeType ?? "") &&
            part.body?.attachmentId &&
            !part.body.data &&
            !isFilePart(part)
        )
            throw new Error(
                "별도 다운로드가 필요한 큰 메일 본문은 아직 지원하지 않습니다. 원본 메일함에서 확인해주세요.",
            );
        if (isFilePart(part)) {
            files.push({
                name: decodeMimeWords(part.filename).trim() || "첨부 파일",
                size: part.body?.size ?? 0,
                contentType: part.mimeType ?? "application/octet-stream",
                providerId: part.body?.attachmentId || part.partId || "inline",
            });
            return;
        } else if (part.body?.data && part.mimeType === "text/plain")
            plain.push(decodePartData(part.body.data, charset));
        else if (part.body?.data && part.mimeType === "text/html")
            html.push(decodePartData(part.body.data, charset));
        for (const p of part.parts ?? []) walk(p, depth + 1);
    };
    walk(message.payload);
    const fromRaw = header("from"),
        fromName = fromRaw.includes("<")
            ? fromRaw
                  .slice(0, fromRaw.lastIndexOf("<"))
                  .trim()
                  .replace(/^"|"$/g, "")
            : "";
    return inboundInput.parse({
        providerMessageId: message.id,
        providerThreadId: message.threadId,
        rfcMessageId: header("message-id"),
        from: senders[0],
        fromName: fromName.slice(0, 100),
        to: addresses(header("to")),
        ...(header("delivered-to")
            ? { deliveredTo: addresses(header("delivered-to")) }
            : {}),
        cc: addresses(header("cc")),
        ...(header("reply-to")
            ? { replyTo: addresses(header("reply-to")) }
            : {}),
        subject: header("subject") || "(제목 없음)",
        body:
            (plain.join("\n") || htmlToText(html.join("\n"))).trim() ||
            (files.length ? "(첨부 파일만 있는 메일)" : "(본문 없음)"),
        receivedAt: new Date(Number(message.internalDate)).toISOString(),
        autoSubmitted:
            header("auto-submitted") ||
            (message.payload.mimeType === "multipart/report"
                ? "auto-generated"
                : "no"),
        precedence: header("precedence"),
        files,
    });
}
export async function deliverGmailReply(
    client: EmailTransportClient,
    mailboxId: string,
    credentials: GmailCredentials,
    fetchImpl: typeof fetch = fetch,
    beforeBegin?: () => void,
) {
    const accessToken = await getAccessToken(credentials, fetchImpl);
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
    };
    const profile = await fetchImpl(
        `${GMAIL_API_ORIGIN}/gmail/v1/users/me/profile`,
        { headers, signal: AbortSignal.timeout(15000) },
    );
    if (profile.status === 401) invalidateGmailAccessToken(credentials);
    if (!profile.ok)
        throw await gmailResponseError(
            profile,
            "상담 메일함 계정을 확인하지 못했습니다.",
        );
    const identity = (await profile.json()) as { emailAddress?: string };
    const item = await client.claimEmail(mailboxId);
    if (!item) return null;
    const account = googleAccountAddress({
        address: item.from,
        googleAccount: item.googleAccount,
    });
    if (identity.emailAddress?.toLowerCase() !== account) {
        await client.changeEmailDelivery(item.id, {
            action: "prepare_failed",
            leaseToken: item.leaseToken,
            errorCode: "mailbox_mismatch",
        });
        return { deliveryId: item.id, state: "failed" };
    }
    try {
        await assertGoogleAlias(item.from, account, accessToken, fetchImpl);
    } catch {
        await client.changeEmailDelivery(item.id, {
            action: "prepare_failed",
            leaseToken: item.leaseToken,
            errorCode: "alias_unverified",
        });
        return { deliveryId: item.id, state: "failed" };
    }
    const files: GmailReplyFile[] = [];
    let raw: string;
    let stage: "attachment" | "mime" = "attachment";
    try {
        for (const expected of item.attachments ?? []) {
            const file = await client.downloadEmailDeliveryFile(
                    item.id,
                    expected.id,
                    item.leaseToken,
                ),
                bytes = Buffer.from(file.bytes);
            if (
                bytes.length !== expected.size ||
                createHash("sha256").update(bytes).digest("hex") !==
                    expected.sha256
            )
                throw new Error("attachment_changed");
            files.push({
                fileName: expected.fileName,
                contentType: expected.contentType,
                bytes,
            });
        }
        stage = "mime";
        raw = gmailReplyRaw(item, new Date(), files);
    } catch (error) {
        // 받는 사람·머리글·첨부 수 검증 실패를 첨부 다운로드 실패로 잘못 안내하지 않는다.
        await client.changeEmailDelivery(item.id, {
            action: "prepare_failed",
            leaseToken: item.leaseToken,
            errorCode:
                stage === "mime"
                    ? "mime_invalid"
                    : error instanceof Error &&
                        error.message === "attachment_changed"
                      ? "attachment_changed"
                      : "attachment_download",
        });
        return { deliveryId: item.id, state: "failed" };
    }
    beforeBegin?.();
    await client.changeEmailDelivery(item.id, {
        action: "begin",
        leaseToken: item.leaseToken,
    });
    let outcome: Parameters<SendbClient["changeEmailDelivery"]>[1];
    try {
        // Exactly one provider POST. Unknown responses never trigger an automatic duplicate send.
        const response = await fetchImpl(
            `${GMAIL_API_ORIGIN}/gmail/v1/users/me/messages/send`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({ threadId: item.providerThreadId, raw }),
                signal: AbortSignal.timeout(30000),
            },
        );
        if (response.ok) {
            const data = (await response.json()) as { id?: string };
            outcome =
                data.id && /^[A-Za-z0-9_-]{1,200}$/.test(data.id)
                    ? {
                          action: "sent",
                          leaseToken: item.leaseToken,
                          providerMessageId: data.id,
                      }
                    : {
                          action: "uncertain",
                          leaseToken: item.leaseToken,
                          errorCode: "provider_unknown",
                      };
        } else if ([400, 401, 403, 404, 429].includes(response.status)) {
            if (response.status === 401)
                invalidateGmailAccessToken(credentials);
            outcome = {
                action: "failed",
                leaseToken: item.leaseToken,
                errorCode:
                    response.status === 401
                        ? "auth"
                        : response.status === 403
                          ? "scope"
                          : response.status === 429
                            ? "rate_limited"
                            : "provider_rejected",
            };
        } else
            outcome = {
                action: "uncertain",
                leaseToken: item.leaseToken,
                errorCode: "provider_unknown",
            };
    } catch {
        outcome = {
            action: "uncertain",
            leaseToken: item.leaseToken,
            errorCode: "network_unknown",
        };
    }
    // Result registration is idempotent; retrying this does not resend the email.
    for (let attempt = 0; ; attempt++) {
        try {
            await client.changeEmailDelivery(item.id, outcome);
            break;
        } catch (e) {
            if (attempt >= 2) throw e;
        }
    }
    return { deliveryId: item.id, state: outcome.action };
}
export async function gmailReader(
    credentials: GmailCredentials,
    fetchImpl: typeof fetch,
) {
    let token = await getAccessToken(credentials, fetchImpl);
    return async <T>(path: string, maxBytes = 40 * 1024 * 1024): Promise<T> => {
        let response = await fetchImpl(
            `${GMAIL_API_ORIGIN}/gmail/v1/users/me/${path}`,
            {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(15000),
            },
        );
        if (response.status === 401) {
            await response.body?.cancel();
            invalidateGmailAccessToken(credentials);
            token = await getAccessToken(credentials, fetchImpl);
            response = await fetchImpl(
                `${GMAIL_API_ORIGIN}/gmail/v1/users/me/${path}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: AbortSignal.timeout(15000),
                },
            );
            if (response.status === 401)
                invalidateGmailAccessToken(credentials);
        }
        if (!response.ok)
            throw await gmailResponseError(
                response,
                "상담 메일 원본을 확인하지 못했습니다.",
            );
        if (Number(response.headers.get("content-length")) > maxBytes) {
            await response.body?.cancel();
            throw new Error("메일 원본 응답이 너무 큽니다.");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("메일 원본 응답이 없습니다.");
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.length;
                if (length > maxBytes) {
                    await reader.cancel();
                    throw new Error("메일 원본 응답이 너무 큽니다.");
                }
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
    };
}
type GmailReader = Awaited<ReturnType<typeof gmailReader>>;
/**
 * 결과 확인 필요 답장이 실제로 보내졌는지 보낸 메일의 Message-ID로 찾는다.
 * 찾으면 Gmail 메시지 ID, 못 찾으면 null(보내지 않았다는 증거가 아니므로 상태를 바꾸지 않는다).
 */
export async function findSentGmailReply(
    get: GmailReader,
    rfcMessageId: string,
) {
    rfcId.parse(rfcMessageId);
    const query = new URLSearchParams({
        q: `rfc822msgid:${rfcMessageId.slice(1, -1)} in:sent`,
        maxResults: "1",
    });
    const page = await get<{ messages?: { id?: string }[] }>(
        `messages?${query}`,
        1024 * 1024,
    );
    const id = page.messages?.[0]?.id;
    return id && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
}
function partBytes(data: string | undefined, max: number) {
    if (
        typeof data !== "string" ||
        data.length > Math.ceil((max * 4) / 3) + 4 ||
        !/^[A-Za-z0-9_-]*={0,2}$/.test(data)
    )
        throw new Error("메일 파일 데이터를 확인해주세요.");
    const bytes = Buffer.from(data, "base64url");
    if (bytes.length > max) throw new Error("메일 파일이 너무 큽니다.");
    return bytes;
}
async function sourceBytes(
    get: GmailReader,
    messageId: string,
    part: Part,
    max: number,
) {
    if (
        !Number.isInteger(part.body?.size) ||
        part.body!.size! < 0 ||
        part.body!.size! > max
    )
        throw new Error("메일 파일의 크기를 확인해주세요.");
    const body = part.body?.attachmentId
        ? await get<{ data?: string; size?: number }>(
              `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
              Math.ceil((max * 4) / 3) + 65536,
          )
        : part.body;
    const bytes = partBytes(body?.data, max);
    if (bytes.length !== part.body?.size || body?.size !== bytes.length)
        throw new Error("size_mismatch");
    return bytes;
}
async function hydrateText(get: GmailReader, message: GmailInboxMessage) {
    const walk = async (part: Part, depth = 0): Promise<void> => {
        if (depth > 25) throw new Error("메일 MIME 중첩이 너무 깊습니다.");
        if (isFilePart(part)) return;
        if (
            part.body?.attachmentId &&
            ![undefined, ""].includes(part.mimeType) &&
            ["text/plain", "text/html"].includes(part.mimeType!)
        ) {
            part.body.data = (
                await sourceBytes(get, message.id, part, 400000)
            ).toString("base64url");
        }
        for (const child of part.parts ?? []) await walk(child, depth + 1);
    };
    await walk(message.payload);
}
async function syncSourceFiles(
    client: EmailTransportClient,
    get: GmailReader,
    message: GmailInboxMessage,
    files: SendbEmailFile[],
) {
    const source = gmailFileParts(message.payload),
        failures: { id: string; code: string }[] = [];
    for (const file of files) {
        if (["available", "blocked"].includes(file.state)) continue;
        let code: "download_failed" | "source_missing" | "size_mismatch" =
            "download_failed";
        try {
            const part = source[file.fileIndex];
            if (!part) {
                code = "source_missing";
                throw new Error("source_missing");
            }
            if (
                (part.body?.attachmentId || part.partId || "inline") !==
                    file.providerId ||
                (decodeMimeWords(part.filename).trim() || "첨부 파일") !==
                    file.name
            ) {
                code = "source_missing";
                throw new Error("source_missing");
            }
            const bytes = await sourceBytes(
                get,
                message.id,
                part,
                MAX_FILE_BYTES,
            );
            if (bytes.length !== file.size) {
                code = "size_mismatch";
                throw new Error("size_mismatch");
            }
            await client.uploadEmailFile(
                file.id,
                new Blob([new Uint8Array(bytes)]),
                file.name,
            );
        } catch (error) {
            if (error instanceof Error && error.message === "size_mismatch")
                code = "size_mismatch";
            if (error instanceof GmailApiError && error.code === "not_found")
                code = "source_missing";
            await client.failEmailFile(file.id, code);
            failures.push({ id: file.id, code });
        }
    }
    return failures;
}
/** Re-fetches known message IDs, including mail archived after initial intake. One cursor page per call. */
export async function retryGmailFiles(
    client: EmailTransportClient,
    options: { workspaceId: number; mailboxId: string; before?: string },
    credentials: GmailCredentials,
    fetchImpl: typeof fetch = fetch,
) {
    const mailbox = (await client.emailMailboxes(options.workspaceId)).find(
        (b) => b.id === options.mailboxId,
    );
    if (!mailbox?.enabled) throw new Error("활성 메일함을 선택해주세요.");
    const get = await gmailReader(credentials, fetchImpl),
        profile = await get<{ emailAddress?: string }>("profile");
    if (profile.emailAddress?.toLowerCase() !== googleAccountAddress(mailbox))
        throw new Error("메일함과 Gmail 계정 주소가 다릅니다.");
    const page = await client.pendingEmailFiles(mailbox.id, options.before),
        failures: { id: string; code: string }[] = [],
        grouped = new Map<string, SendbEmailFile[]>();
    for (const file of page.rows)
        grouped.set(file.providerMessageId, [
            ...(grouped.get(file.providerMessageId) ?? []),
            file,
        ]);
    for (const [id, files] of grouped) {
        let message: GmailInboxMessage;
        try {
            message = await get<GmailInboxMessage>(
                `messages/${encodeURIComponent(id)}?format=full`,
            );
        } catch (error) {
            const code =
                error instanceof GmailApiError && error.code === "not_found"
                    ? "source_missing"
                    : "download_failed";
            for (const file of files) {
                await client.failEmailFile(file.id, code);
                failures.push({ id: file.id, code });
            }
            continue;
        }
        failures.push(...(await syncSourceFiles(client, get, message, files)));
    }
    return {
        processed: page.rows.length,
        failures,
        nextCursor: page.hasMore ? page.rows.at(-1)?.id : null,
    };
}
/** One explicit page; retain nextPageToken until the fixed since window has been exhausted. No mark-read/delete/label mutations. */
export async function receiveGmailPage(
    client: EmailTransportClient,
    options: {
        workspaceId: number;
        mailboxId: string;
        since: Date;
        pageToken?: string;
    },
    credentials: GmailCredentials,
    fetchImpl: typeof fetch = fetch,
) {
    if (!Number.isFinite(options.since.getTime()))
        throw new Error("수신 시작일을 확인해주세요.");
    const mailbox = (await client.emailMailboxes(options.workspaceId)).find(
        (box) => box.id === options.mailboxId,
    );
    if (!mailbox?.enabled) throw new Error("활성 메일함을 선택해주세요.");
    const get = await gmailReader(credentials, fetchImpl);
    const profile = (await get("profile")) as { emailAddress?: string };
    if (profile.emailAddress?.toLowerCase() !== googleAccountAddress(mailbox))
        throw new Error("메일함과 Gmail 계정 주소가 다릅니다.");
    const query = new URLSearchParams({
        labelIds: "INBOX",
        q: `after:${Math.floor(options.since.getTime() / 1000)}`,
        maxResults: "50",
        ...(options.pageToken ? { pageToken: options.pageToken } : {}),
    });
    const page = (await get(`messages?${query}`)) as {
        messages?: { id: string }[];
        nextPageToken?: string;
    };
    const results = [],
        fileFailures: { id: string; code: string }[] = [];
    for (const item of page.messages ?? []) {
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(item.id))
            throw new Error("메일 원본 번호를 확인해주세요.");
        const message = (await get(
            `messages/${encodeURIComponent(item.id)}?format=full`,
        )) as GmailInboxMessage;
        await hydrateText(get, message);
        const input = gmailInbound(message),
            receipt = await client.receiveEmail(mailbox.id, input);
        results.push(receipt);
        if (input.files.length && !receipt.ignoredReason)
            fileFailures.push(
                ...(await syncSourceFiles(
                    client,
                    get,
                    message,
                    await client.emailReceiptFiles(receipt.receiptId),
                )),
            );
    }
    return { results, fileFailures, nextPageToken: page.nextPageToken ?? null };
}

/** Durable worker fetches one enumerated ID. Attachments are handled by their own persisted queue. */
export async function receiveGmailMessage(
    client: EmailTransportClient,
    options: {
        mailboxId: string;
        address: string;
        messageId: string;
        since: Date;
    },
    credentials: GmailCredentials,
    fetchImpl: typeof fetch = fetch,
) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(options.messageId))
        throw new Error("invalid_message_id");
    const get = await gmailReader(credentials, fetchImpl),
        message = await get<GmailInboxMessage>(
            `messages/${encodeURIComponent(options.messageId)}?format=full`,
        );
    if (message.id !== options.messageId) throw new Error("source_mismatch");
    if (
        message.labelIds?.some((label) =>
            ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label),
        )
    )
        return { skippedReason: "excluded_label" };
    const date = Number(message.internalDate);
    if (!Number.isFinite(date)) throw new Error("invalid_date");
    if (date < options.since.getTime())
        return { skippedReason: "before_window" };
    await hydrateText(get, message);
    const input = gmailInbound(message);
    if (
        ![...input.to, ...input.cc, ...(input.deliveredTo ?? [])].includes(
            options.address,
        )
    )
        return { skippedReason: "other_recipient" };
    try {
        const receipt = await client.receiveEmail(options.mailboxId, input);
        return { receipt };
    } catch (error) {
        if (error instanceof OtherMailboxRecipientError) return { skippedReason: "other_recipient" };
        throw error;
    }
}
