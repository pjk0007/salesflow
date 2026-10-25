import { InboxRequestError } from "../api";
/**
 * 고객 위젯 조회 오류 중 세션 만료·병합·권한 회수처럼 다시 시도해도 같은 결과인 것.
 * 이때만 '새 문의 시작'을 보이고, 그 밖(500·408·네트워크)은 자동 재시도하며 입력을 막지 않는다.
 */
export const isWidgetAccessDenied = (error: unknown) =>
    error instanceof InboxRequestError && [401, 403, 404].includes(error.status);
