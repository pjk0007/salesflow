import type { EmailMailbox } from "../types";
/** 상담함 상단 경고·'이메일 연결' 배지에 쓸 메일함 연결 상태 요약(요청한 사업의 목록만 받는다). */
export function mailboxAlert(boxes: EmailMailbox[] | undefined) {
    const reconnectCount = boxes?.filter((box) => box.connectionStatus === "reconnect").length ?? 0;
    const workerStopped = !!boxes?.some(
        (box) => box.connectionStatus === "connected" && box.enabled && box.workerEnabled === false,
    );
    return { reconnectCount, workerStopped };
}
