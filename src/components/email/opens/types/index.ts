export interface OpenSignal {
    /** 사람 오픈으로 본 픽셀 요청 수 (is_machine = false, 발송당 20까지 저장) */
    openCount: number;
    /** 기계 오픈(발송 60초 안·검사기 UA)으로 본 수 */
    machineOpenCount: number;
    /** 본문에 픽셀을 넣어 보낸 발송 (0120 뒤). false면 오픈을 알 수 없다 */
    openTracked: boolean;
}
/** 오픈 칸이 받는 줄. 사람 클릭 수도 본다 — 이미지를 막아도 클릭했으면 오픈이다 */
export interface OpenCellSource extends Partial<OpenSignal> { channel?: string; status: string; clickCount?: number }
export type OpenCellTone = "human" | "byClick" | "machine";
export type OpenCellView =
    | { kind: "empty" }
    | { kind: "dash" }
    | { kind: "badge"; tone: OpenCellTone; text: string; machineIcon: boolean; clickIcon: boolean; title: string };
