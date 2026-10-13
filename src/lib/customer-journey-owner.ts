import { chatWebhookProblem } from "./google-chat";

/** 사용자가 지정하고 스페이스의 실제 @멘션 선택기로 확인한 담당자. 고객 데이터로 라우팅하지 않는다. */
const OWNERS: Record<string, { name: string; userId: string }> = {
    "AAQASH-gyo4": { name: "이효정", userId: "110605666755540583322" },
    "AAQAbqhHk2A": { name: "양윤지", userId: "101302053528103792273" },
};
export function journeyOwner(webhook: string | undefined) {
    if (chatWebhookProblem(webhook)) return undefined;
    const space = new URL(webhook!).pathname.split("/")[3];
    return Object.hasOwn(OWNERS, space) ? OWNERS[space] : undefined;
}
