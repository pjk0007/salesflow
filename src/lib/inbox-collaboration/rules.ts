import { z } from "zod";
export const mentionIdsInput = z
    .array(z.uuid())
    .max(20, "한 메모에서 최대 20명에게 알릴 수 있습니다.")
    .refine(
        (ids) => new Set(ids).size === ids.length,
        "멘션할 팀원이 중복되었습니다.",
    );
export function sameMentionIds(a: string[], b: string[]) {
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
