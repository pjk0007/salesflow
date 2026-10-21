import type { OpenCellSource, OpenCellView } from "../types";

export function openCellView(src: OpenCellSource): OpenCellView {
    if ((src.channel && src.channel !== "email") || src.status !== "sent" || src.openTracked !== true) return { kind: "empty" };
    const human = src.openCount ?? 0;
    const machine = src.machineOpenCount ?? 0;
    const clicks = src.clickCount ?? 0;
    if (human <= 0 && machine <= 0 && clicks <= 0) return { kind: "dash" };
    const parts: string[] = [];
    if (human > 0) parts.push(`사람 오픈 ${human}회`);
    if (human === 0 && clicks > 0) parts.push(`사람 클릭 ${clicks}회로 오픈 셈`);
    if (machine > 0) parts.push(`기계 오픈 ${machine}회`);
    if (human === 0 && clicks === 0) parts.push("사람 오픈 없음");
    const title = parts.join(" · ");
    if (human > 0) return { kind: "badge", tone: "human", text: `${human}회`, machineIcon: false, clickIcon: false, title };
    if (clicks > 0) return { kind: "badge", tone: "byClick", text: "", machineIcon: false, clickIcon: true, title };
    return { kind: "badge", tone: "machine", text: "", machineIcon: true, clickIcon: false, title };
}
