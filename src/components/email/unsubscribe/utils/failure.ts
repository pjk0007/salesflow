import { isPermanentRequestError, requestErrorMessage } from "@/lib/swr-fetcher";
import type { UnsubscribeStatus } from "../types";

/**
 * 조회·제출 실패를 화면 상태로 (UX-152).
 * 잘못된·만료된 링크(4xx)만 막다른 안내로 두고, 연결 끊김·시간 초과·서버 오류는 같은 요청을 다시 할 수 있게 한다.
 */
export function unsubscribeFailureStatus(error: unknown, stage: "load" | "submit", email?: string): UnsubscribeStatus {
    if (isPermanentRequestError(error)) {
        return { kind: "invalid", message: requestErrorMessage(error, "유효하지 않거나 만료된 링크입니다.") };
    }
    if (stage === "submit" && email) {
        return {
            kind: "error",
            retry: "submit",
            email,
            message: "수신거부 처리 결과를 확인하지 못했습니다. 다시 시도해주세요. 이미 처리되었다면 그대로 완료로 표시됩니다.",
        };
    }
    return { kind: "error", retry: "load", message: "수신거부 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." };
}
