import { createHash } from "node:crypto";

export interface ChatAlertMessage {
    id: number; conversationId: string; channelId: number;
    name: string; channelName: string; body: string; createdAt: Date;
    medium: string; status: string; attachments: string[];
}
const html = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Bound the encoded card rather than truncating the source message. Keep Unicode characters intact.
export function splitMessage(body: string, budget = 7000): string[] {
    const chunks: string[] = []; let chunk = "", bytes = 0;
    for (const char of body) {
        const size = Buffer.byteLength(html(char).replace(/\n/g, "<br>"));
        if (chunk && bytes + size > budget) { chunks.push(chunk); chunk = ""; bytes = 0; }
        chunk += char; bytes += size;
    }
    if (chunk || !chunks.length) chunks.push(chunk);
    return chunks;
}
export function conversationLink(message: Pick<ChatAlertMessage, "conversationId" | "channelId" | "id" | "status">, baseUrl: string) {
    const url = new URL("/inbox", baseUrl);
    url.search = new URLSearchParams({ channelId: String(message.channelId), conversation: message.conversationId, message: String(message.id), status: message.status }).toString();
    return url.href;
}
export function chatAlertMessages(message: ChatAlertMessage, baseUrl: string) {
    const url = conversationLink(message, baseUrl), chunks = splitMessage(message.body);
    return chunks.map((chunk, index) => ({
        text: `새 고객 메시지 · ${message.channelName} · ${message.name}${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ""}`,
        cardsV2: [{ cardId: `message-${message.id}-${index}`, card: {
            header: { title: html(message.name), subtitle: `${html(message.channelName)} · ${message.medium === "email" ? "이메일" : "웹 상담"}` },
            sections: [{ widgets: [
                { textParagraph: { text: html(chunk || "(첨부 파일 메시지)").replace(/\n/g, "<br>") } },
                ...(index === chunks.length - 1 && message.attachments.length ? [{ textParagraph: { text: `<b>첨부 ${message.attachments.length}개</b><br>${message.attachments.map(html).join("<br>")}<br>파일은 상담 화면에서 확인해 주세요.` } }] : []),
                { textParagraph: { text: message.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) } },
                { buttonList: { buttons: [{ text: "샌드비에서 상담 열기", onClick: { openLink: { url } } }] } },
            ] }],
        } }],
    }));
}
export const alertMessageId = (fingerprint: string, messageId: number, part: number) =>
    `client-inbox-${createHash("sha256").update(`${fingerprint}:${messageId}:${part}`).digest("hex").slice(0, 48)}`;
