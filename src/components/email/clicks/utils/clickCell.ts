import type { ClickCellSource, ClickCellView } from "../types";

/** 발송된 이메일만 표시한다. 봇만 있으면 숫자를 숨기며 사이트 행동은 표시만 강조한다. */
export function clickCellView(src: ClickCellSource): ClickCellView {
    if ((src.channel && src.channel !== "email") || src.status !== "sent") return { kind: "empty" };
    const human = src.clickCount ?? 0;
    const bot = src.botClickCount ?? 0;
    if (human <= 0 && bot <= 0) return { kind: "dash" };
    const action = src.hasSiteAction === true;
    const parts: string[] = [];
    if (human > 0) parts.push(`사람 클릭 ${human}회`);
    if (bot > 0) parts.push(`봇 클릭 ${bot}회`);
    if (human > 0 && bot > 0) parts.push(`전체 ${human + bot}회`);
    if (human === 0) parts.push("사람 클릭 없음");
    if (action) parts.push("사이트 행동 있음");
    const title = parts.join(" · ");
    if (human > 0) {
        return { kind: "badge", tone: action ? "humanAction" : "human", text: `${human}회`, botIcon: false, actionIcon: action, title };
    }
    return { kind: "badge", tone: action ? "botAction" : "bot", text: "", botIcon: true, actionIcon: action, title };
}
