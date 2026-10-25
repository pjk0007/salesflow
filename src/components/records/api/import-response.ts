import type { ImportResult } from "@/types";
import { RequestError } from "@/lib/swr-fetcher";

type Result = ImportResult & { mergedCount?: number; error?: string };
const UNCONFIRMED = "가져오기 결과를 확인하지 못했습니다. 목록에서 반영 여부를 확인한 뒤 다시 시도해주세요.";

function failure(error: unknown, status: number): never {
    const message = typeof error === "string" && /[가-힣]/.test(error) &&
        !/(?:SQLSTATE|Failed query|node_modules|postgres|drizzle)/i.test(error) ? error : UNCONFIRMED;
    throw new RequestError(message, status, message !== UNCONFIRMED);
}

function checkedResult(value: unknown): Result {
    if (!value || typeof value !== "object") failure(undefined, 0);
    const result = value as Result;
    if (result.success !== true) failure(result.error, 400);
    if (![result.totalCount, result.insertedCount, result.skippedCount].every((n) => Number.isInteger(n) && n >= 0) || !Array.isArray(result.errors)) {
        failure(undefined, 0);
    }
    return result;
}

/** 적재 완료 프레임을 받은 경우에만 성공이다. 끊긴 스트림은 자동 재전송하지 않는다. */
async function readResponse(
    response: Response,
    onProgress: ((progress: { processed: number; total: number }) => void) | undefined,
    scheduled: boolean,
): Promise<Result> {
    if (!response.ok || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
        const json = await response.json();
        if (!response.ok) failure(json?.error, response.status);
        return checkedResult(json);
    }
    if (!response.body) failure(undefined, 0);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal: Result | undefined;
    const consume = (line: string) => {
        if (!line.trim() || terminal) return;
        const message = JSON.parse(line);
        if (message.type === "start") onProgress?.({ processed: 0, total: message.total });
        if (message.type === "progress") onProgress?.({ processed: message.processed, total: message.total });
        if (message.type === "error") failure(message.error, 400);
        if (message.type === "done") terminal = checkedResult(scheduled ? { success: true, totalCount: message.inserted, insertedCount: message.inserted, skippedCount: 0, errors: [] } : message.result);
    };
    try {
        while (!terminal) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) consume(line);
            if (done) { consume(buffer); break; }
        }
        if (!terminal) failure(undefined, 0);
        return terminal;
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

export function readImportResponse(response: Response, onProgress?: (progress: { processed: number; total: number }) => void) {
    return readResponse(response, onProgress, false);
}

export async function readScheduledUploadResponse(response: Response, onProgress?: (progress: { processed: number; total: number }) => void) {
    return (await readResponse(response, onProgress, true)).insertedCount;
}
