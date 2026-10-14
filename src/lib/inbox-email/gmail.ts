import type { SendbClient } from "../../../sdk/server";
import type { SendbEmailClaim } from "../../../sdk/email-types";
import {
    GmailApiError,
    getAccessToken,
    type GmailCredentials,
    GMAIL_API_ORIGIN,
} from "@/lib/gmail-client";
import {
    htmlToText,
    decodeMimeWords,
    decodePartData,
    parseContentType,
} from "@/lib/email-reply-rules";
import { inboundInput, emailAddress, rfcId } from "./rules";
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
export function gmailReplyRaw(item: SendbEmailClaim, now = new Date()) {
    emailAddress.parse(item.from);
    emailAddress.parse(item.recipient);
    rfcId.parse(item.rfcMessageId);
    rfcId.parse(item.inReplyTo);
    return Buffer.from(
        [
            `From: ${encoded(item.fromName)} <${item.from}>`,
            `To: ${item.recipient}`,
            `Subject: ${encoded(item.subject)}`,
            `Date: ${now.toUTCString()}`,
            `Message-ID: ${item.rfcMessageId}`,
            `In-Reply-To: ${item.inReplyTo}`,
            `References: ${item.inReplyTo}`,
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=UTF-8",
            "Content-Transfer-Encoding: base64",
            "",
            wrap(item.body),
            "",
        ].join("\r\n"),
        "utf8",
    ).toString("base64url");
}
type Part = {
    mimeType?: string;
    filename?: string;
    partId?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string; size?: number; attachmentId?: string };
    parts?: Part[];
};
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
            !part.filename
        )
            throw new Error(
                "별도 다운로드가 필요한 큰 메일 본문은 아직 지원하지 않습니다. 원본 메일함에서 확인해주세요.",
            );
        if (
            part.filename ||
            part.mimeType === "message/rfc822" ||
            (part.body?.attachmentId &&
                !["text/plain", "text/html"].includes(part.mimeType ?? ""))
        ) {
            files.push({
                name: part.filename || "첨부 파일",
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
        cc: addresses(header("cc")),
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
    client: SendbClient,
    mailboxId: string,
    credentials: GmailCredentials,
    fetchImpl: typeof fetch = fetch,
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
    if (!profile.ok)
        throw new GmailApiError(
            "auth",
            profile.status,
            "상담 메일함 계정을 확인하지 못했습니다.",
        );
    const identity = (await profile.json()) as { emailAddress?: string };
    const item = await client.claimEmail(mailboxId);
    if (!item) return null;
    if (identity.emailAddress?.toLowerCase() !== item.from)
        throw new Error(
            "연결 ID와 Gmail 계정 주소가 다릅니다. 발송을 시작하지 않았습니다.",
        );
    const raw = gmailReplyRaw(item);
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
        } else if ([400, 401, 403, 404, 429].includes(response.status))
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
        else
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
/** One explicit page; retain nextPageToken until the fixed since window has been exhausted. No mark-read/delete/label mutations. */
export async function receiveGmailPage(
    client: SendbClient,
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
    const token = await getAccessToken(credentials, fetchImpl);
    const get = async (path: string) => {
        const response = await fetchImpl(
            `${GMAIL_API_ORIGIN}/gmail/v1/users/me/${path}`,
            {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(15000),
            },
        );
        if (!response.ok)
            throw new GmailApiError(
                response.status === 401
                    ? "auth"
                    : response.status === 403
                      ? "scope"
                      : "transient",
                response.status,
                "상담 메일 수신을 확인하지 못했습니다.",
            );
        return response.json();
    };
    const profile = (await get("profile")) as { emailAddress?: string };
    if (profile.emailAddress?.toLowerCase() !== mailbox.address)
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
    const results = [];
    for (const item of page.messages ?? []) {
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(item.id))
            throw new Error("메일 원본 번호를 확인해주세요.");
        const message = (await get(
            `messages/${encodeURIComponent(item.id)}?format=full`,
        )) as GmailInboxMessage;
        results.push(
            await client.receiveEmail(mailbox.id, gmailInbound(message)),
        );
    }
    return { results, nextPageToken: page.nextPageToken ?? null };
}
