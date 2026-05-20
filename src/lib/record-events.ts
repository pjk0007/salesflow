import { db, recordEvents } from "@/lib/db";

// 외부 API가 record 작업과 함께 보내는 비즈니스 이벤트 입력의 공용 검증/저장.
// POST /records, PUT /records/:id, POST /records/:id/events 가 공용으로 사용.

export interface ParsedEventInput {
    type: string;
    label: string;
    occurredAt: Date;
    meta: Record<string, unknown> | null;
}

export type ParseEventResult =
    | { ok: true; value: ParsedEventInput }
    | { ok: false; error: string };

/**
 * 외부에서 받은 event 페이로드를 검증·정규화한다.
 * type/label 필수, occurredAt 선택(기본 now), meta는 object만 허용.
 */
export function parseEventInput(raw: unknown): ParseEventResult {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { ok: false, error: "event must be an object." };
    }
    const e = raw as Record<string, unknown>;

    const type = typeof e.type === "string" ? e.type.trim() : "";
    const label = typeof e.label === "string" ? e.label.trim() : "";
    if (!type || type.length > 50) {
        return { ok: false, error: "event.type is required (max 50 chars)." };
    }
    if (!label || label.length > 100) {
        return { ok: false, error: "event.label is required (max 100 chars)." };
    }

    let occurredAt = new Date();
    if (e.occurredAt !== undefined && e.occurredAt !== null) {
        const parsed = new Date(e.occurredAt as string | number | Date);
        if (isNaN(parsed.getTime())) {
            return { ok: false, error: "event.occurredAt is invalid." };
        }
        occurredAt = parsed;
    }

    let meta: Record<string, unknown> | null = null;
    if (e.meta !== undefined && e.meta !== null) {
        if (typeof e.meta !== "object" || Array.isArray(e.meta)) {
            return { ok: false, error: "event.meta must be an object." };
        }
        meta = e.meta as Record<string, unknown>;
    }

    return { ok: true, value: { type, label, occurredAt, meta } };
}

/**
 * record_events에 한 줄 INSERT. tx를 넘기면 그 트랜잭션 안에서 실행.
 */
export async function insertRecordEvent(
    args: { orgId: string; recordId: number; event: ParsedEventInput },
    tx: Pick<typeof db, "insert"> = db
) {
    const [created] = await tx
        .insert(recordEvents)
        .values({
            orgId: args.orgId,
            recordId: args.recordId,
            type: args.event.type,
            label: args.event.label,
            occurredAt: args.event.occurredAt,
            meta: args.event.meta,
        })
        .returning();
    return created;
}
