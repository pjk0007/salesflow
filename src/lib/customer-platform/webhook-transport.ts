import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { publicAddress, webhookUrl } from "./webhook-rules";
export type WebhookTransport = (
    url: string,
    body: string,
    headers: Record<string, string>,
) => Promise<{ status: number; retryAfter: string | null }>;
export async function resolveWebhookAddress(
    hostname: string,
    resolver: typeof lookup = lookup,
) {
    const addresses = await resolver(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new Error("수신 주소가 공개 네트워크를 가리키지 않습니다.");
    return addresses[0];
}
export const sendWebhook: WebhookTransport = async (raw, body, headers) => {
    const url = new URL(webhookUrl(raw)),
        signal = AbortSignal.timeout(10000);
    const address = await Promise.race([
        resolveWebhookAddress(url.hostname),
        new Promise<never>((_, reject) =>
            signal.addEventListener(
                "abort",
                () => reject(new Error("수신 주소 확인 시간 초과")),
                { once: true },
            ),
        ),
    ]);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const req = request(
            url,
            {
                method: "POST",
                headers: {
                    ...headers,
                    "Content-Type": "application/json",
                    "Content-Length": String(Buffer.byteLength(body)),
                    "User-Agent": "Sendb-Webhooks/1",
                },
                signal,
                agent: false,
                family: address.family,
                lookup: (_host, _options, cb) =>
                    cb(null, address.address, address.family),
            },
            (res) => {
                const value = {
                    status: res.statusCode ?? 0,
                    retryAfter: res.headers["retry-after"] ?? null,
                };
                res.destroy();
                resolve(value);
            },
        );
        req.on("error", reject);
        req.end(body);
    });
};
