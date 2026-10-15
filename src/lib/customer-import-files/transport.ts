import { request } from "node:https";
import { resolveWebhookAddress } from "@/lib/customer-platform/webhook-transport";
import { MAX_FILE_BYTES } from "@/lib/inbox/file-rules";
import { sourceFileUrl } from "./rules";
export class FileFetchError extends Error {
    constructor(
        message: string,
        readonly needsSource = false,
    ) {
        super(message);
    }
}
export type ImportFileTransport = (url: string) => Promise<Buffer>;
export function createImportFileTransport(
    deps: {
        request?: typeof request;
        resolve?: typeof resolveWebhookAddress;
        timeoutMs?: number;
    } = {},
): ImportFileTransport {
    return async (raw) => {
        const signal = AbortSignal.timeout(deps.timeoutMs ?? 15000);
        let current = sourceFileUrl(raw);
        for (let hop = 0; hop <= 3; hop++) {
            signal.throwIfAborted();
            const url = new URL(current),
                address = await Promise.race([
                    (deps.resolve ?? resolveWebhookAddress)(url.hostname),
                    new Promise<never>((_, reject) =>
                        signal.addEventListener(
                            "abort",
                            () =>
                                reject(
                                    new FileFetchError(
                                        "파일 주소 확인 시간이 초과됐습니다.",
                                    ),
                                ),
                            { once: true },
                        ),
                    ),
                ]);
            signal.throwIfAborted();
            const response = await new Promise<{
                bytes?: Buffer;
                location?: string;
            }>((resolve, reject) => {
                const req = (deps.request ?? request)(
                    url,
                    {
                        method: "GET",
                        signal,
                        agent: false,
                        family: address.family,
                        lookup: (_host, _options, cb) =>
                            cb(null, address.address, address.family),
                        headers: {
                            "User-Agent": "Sendb-Import-Files/1",
                            "Accept-Encoding": "identity",
                        },
                    },
                    (res) => {
                        const status = res.statusCode ?? 0;
                        if ([301, 302, 303, 307, 308].includes(status)) {
                            const location = res.headers.location;
                            res.destroy();
                            if (!location)
                                reject(
                                    new FileFetchError(
                                        "파일 이동 주소가 없습니다.",
                                    ),
                                );
                            else resolve({ location });
                            return;
                        }
                        if (status !== 200) {
                            res.destroy();
                            reject(
                                new FileFetchError(
                                    `원본 파일 응답 ${status}. 새 주소를 확인해주세요.`,
                                    [401, 403, 404, 410].includes(status),
                                ),
                            );
                            return;
                        }
                        if (
                            Number(res.headers["content-length"]) >
                                MAX_FILE_BYTES ||
                            (res.headers["content-encoding"] &&
                                res.headers["content-encoding"] !== "identity")
                        ) {
                            res.destroy();
                            reject(
                                new FileFetchError(
                                    "파일 크기 또는 압축 형식을 확인해주세요.",
                                ),
                            );
                            return;
                        }
                        let size = 0;
                        const chunks: Buffer[] = [];
                        res.on("error", reject);
                        res.on("aborted", () =>
                            reject(
                                new FileFetchError(
                                    "파일 다운로드가 중단됐습니다.",
                                ),
                            ),
                        );
                        res.on("data", (chunk: Buffer) => {
                            size += chunk.length;
                            if (size > MAX_FILE_BYTES) {
                                res.destroy();
                                reject(
                                    new FileFetchError(
                                        "파일은 20MB까지 이전할 수 있습니다.",
                                    ),
                                );
                            } else chunks.push(chunk);
                        });
                        res.on("end", () =>
                            size
                                ? resolve({ bytes: Buffer.concat(chunks) })
                                : reject(
                                      new FileFetchError(
                                          "원본 파일이 비어 있습니다.",
                                      ),
                                  ),
                        );
                    },
                );
                req.on("error", () =>
                    reject(
                        new FileFetchError(
                            "파일에 연결하지 못했습니다. 주소와 네트워크를 확인해주세요.",
                        ),
                    ),
                );
                req.end();
            });
            if (response.bytes) return response.bytes;
            current = sourceFileUrl(new URL(response.location!, current).href);
        }
        throw new FileFetchError("파일 이동 횟수를 초과했습니다.");
    };
}
export const fetchImportFile = createImportFileTransport();
