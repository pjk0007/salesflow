/** 발송 한 건의 클릭 신호. 발송 이력·통합 로그 API가 이메일 줄마다 준다 (MCP는 hasSiteAction 없이) */
export interface ClickSignal {
    /** 사람 클릭 수 (is_bot = false) */
    clickCount: number;
    /** 봇으로 판정된 클릭 수 (is_bot = true) */
    botClickCount: number;
    /** click_id로 이어진 같은 조직 사이트 세션에 CLICK·CUSTOM 이벤트가 있다. 봇 판정과 무관한 표시용 */
    hasSiteAction: boolean;
}

/** 클릭 칸이 받는 줄. 발송 이력 줄은 channel이 없다(= 이메일), 통합 로그 줄은 있다 */
export interface ClickCellSource extends Partial<ClickSignal> {
    channel?: string;
    status: string;
}

export type ClickCellTone = "human" | "humanAction" | "bot" | "botAction";

export type ClickCellView =
    | { kind: "empty" }                  // 발송 아님 → 빈칸
    | { kind: "dash" }                   // 클릭 없음 → "-"
    | {
          kind: "badge";
          tone: ClickCellTone;
          /** 보이는 글자: 사람 클릭이면 "N회"(기존 글자 그대로), 봇만이면 "" (아이콘만) */
          text: string;
          botIcon: boolean;
          actionIcon: boolean;
          /** 마우스를 올리면 보이는 툴팁 (title 속성) */
          title: string;
      };
