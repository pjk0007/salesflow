import { inboxRequest, InboxRequestError } from "@/components/inbox/api";
export {
    inboxRequest as importRequest,
    inboxWrite as importWrite,
} from "@/components/inbox/api";
/** 미리보기·실행·파일 가져오기는 대량 검토·원본 다운로드로 상담용 15초를 넘길 수 있다. */
export const LONG_IMPORT_TIMEOUT_MS = 120000;
export function importLongWrite<T>(url: string, data: unknown) {
    return inboxRequest<T>(
        url,
        { method: "POST", body: JSON.stringify(data) },
        LONG_IMPORT_TIMEOUT_MS,
    );
}
/** 서버가 처리했는지 알 수 없는 실패(시간 초과·연결 끊김·응답 해석 실패). */
export function isUncertainImportWrite(error: unknown) {
    return (
        error instanceof InboxRequestError &&
        !error.fromServer &&
        (error.status === 0 || error.status === 408 || error.status >= 500)
    );
}
/** 상담용 '초안은 유지됩니다' 문구 대신 가져오기 화면에 맞는 안내로 바꾼다. */
export function importErrorMessage(error: unknown, uncertain: string) {
    return isUncertainImportWrite(error)
        ? uncertain
        : error instanceof Error
          ? error.message
          : uncertain;
}
