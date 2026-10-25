import { messengerApiUrl } from "@/components/customer-messenger/api-origin";
import { RequestError } from "@/lib/swr-fetcher";

/** JSON API와 달리 성공 응답은 Blob을 유지한다. 위젯의 쿠키·리다이렉트 격리도 같다. */
export async function loadInboxAttachment(url: string, headers?: Record<string, string>, signal?: AbortSignal, timeoutMs = 120000) {
    const target = messengerApiUrl(url);
    const timeout = AbortSignal.timeout(timeoutMs);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
        abort.throwIfAborted();
        const response = await fetch(target, { headers, cache: "no-store", signal: abort,
            ...(target !== url ? { credentials: "omit", redirect: "error" } : {}) });
        if (!response.ok) throw new RequestError(
            [401, 403].includes(response.status) ? "첨부파일 접근 권한을 확인해주세요."
                : response.status === 404 ? "첨부파일을 찾을 수 없습니다."
                  : "첨부파일을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", response.status);
        const blob = await response.blob();
        abort.throwIfAborted();
        return blob;
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (timeout.aborted) throw new RequestError("첨부파일 조회가 지연되고 있습니다. 다시 시도해주세요.", 408);
        if (error instanceof RequestError) throw error;
        throw new RequestError("서버에 연결할 수 없습니다. 첨부파일을 다시 불러와주세요.", 0);
    }
}
