import { test } from "node:test";
import assert from "node:assert/strict";
import {
    measuredVisitSeconds,
    nextVisitAckBusinessTime,
    visitAckBody,
    visitAckConfig,
    visitAckScheduledAt,
} from "./email-visit-ack-rules";
import type { JourneyCardInput } from "./customer-journey-card";

const now = new Date("2026-10-13T05:00:00Z");
const env = {
    EMAIL_VISIT_ACK_MODE: "live",
    EMAIL_VISIT_ACK_WORKSPACE_IDS: "8,9",
    EMAIL_VISIT_ACK_START_AT: "2026-10-13T00:00:00Z",
    NEXT_PUBLIC_BASE_URL: "https://sendb.kr",
    NODE_ENV: "production",
};
const input = (duration: number | null, endedAt: Date | null = null) =>
    ({
        session: {
            duration,
            startedAt: new Date(now.getTime() - 10_000),
            endedAt,
        },
    }) as JourneyCardInput;

test("명시한 사업·시작 시각·운영 서버가 모두 있어야 live가 된다", () => {
    assert.equal(visitAckConfig(env).mode, "live");
    for (const overrides of [
        { EMAIL_VISIT_ACK_WORKSPACE_IDS: "" },
        { EMAIL_VISIT_ACK_START_AT: "" },
        { EMAIL_VISIT_ACK_START_AT: "2026-10-13T09:00:00" },
        { NEXT_PUBLIC_BASE_URL: "http://localhost:3000" },
        { EMAIL_VISIT_ACK_MODE: "bad" },
    ])
        assert.equal(visitAckConfig({ ...env, ...overrides }).mode, "off");
    assert.equal(
        visitAckConfig({ ...env, EMAIL_VISIT_ACK_MODE: "dry_run" }).mode,
        "dry_run",
    );
    assert.equal(visitAckConfig({}).mode, "off");
});
test("5초 경계와 측정 없음: 이동 간격이나 영역 합계로 대체하지 않는다", () => {
    for (const seconds of [0, 1, 4.999, 5, 5.001])
        assert.equal(
            (measuredVisitSeconds(input(seconds), now) ?? -1) >= 5,
            seconds >= 5,
        );
    assert.equal(measuredVisitSeconds(input(null), now), null);
    assert.equal(measuredVisitSeconds(input(NaN), now), null);
    assert.equal(
        measuredVisitSeconds(input(null, new Date(now.getTime() - 5000)), now),
        5,
    );
    assert.equal(
        measuredVisitSeconds(input(null, new Date(now.getTime() + 1000)), now),
        null,
    );
    assert.equal(measuredVisitSeconds(input(999), now), 10);
    assert.ok(
        (measuredVisitSeconds(input(5, new Date(now.getTime() - 5001)), now) ??
            0) < 5,
    );
});
test("업무시간 안에는 방문 확인 후 30~60분의 무작위 시각을 정한다", () => {
    assert.equal(
        visitAckScheduledAt(now, () => 0).toISOString(),
        "2026-10-13T05:30:00.000Z",
    );
    assert.equal(
        visitAckScheduledAt(now, () => 0.5).toISOString(),
        "2026-10-13T05:45:00.000Z",
    );
    assert.equal(
        visitAckScheduledAt(now, () => 1).toISOString(),
        "2026-10-13T06:00:00.000Z",
    );
});
test("18시 경계·금요일 저녁·주말은 다음 평일 09시 이후로 옮긴다", () => {
    assert.equal(
        visitAckScheduledAt(
            new Date("2026-10-13T08:30:00Z"),
            () => 0,
        ).toISOString(),
        "2026-10-14T00:00:00.000Z",
    );
    assert.equal(
        visitAckScheduledAt(
            new Date("2026-10-16T09:00:00Z"),
            () => 0.5,
        ).toISOString(),
        "2026-10-19T00:15:00.000Z",
    );
    assert.equal(
        nextVisitAckBusinessTime(
            new Date("2026-10-18T05:00:00Z"),
        ).toISOString(),
        "2026-10-19T00:00:00.000Z",
    );
    assert.equal(
        nextVisitAckBusinessTime(
            new Date("2026-10-13T00:00:00Z"),
        ).toISOString(),
        "2026-10-13T00:00:00.000Z",
    );
});
test("고정 감사 문구를 이름만 치환하고 이름이 없으면 자연스러운 인사를 쓴다", () => {
    const body = visitAckBody([
        {
            key: "contactName",
            label: "담당자",
            fieldType: "text",
            value: "류진모",
        },
    ]);
    assert.match(body, /안녕하세요, 류진모님/);
    assert.match(body, /다소 갑작스러운 메일에도 방문해 주셔서 감사합니다/);
    assert.match(body, /언제든지 전화나 답장/);
    assert.match(visitAckBody([]), /<p>안녕하세요\.<\/p>/);
    assert.doesNotMatch(
        visitAckBody([
            {
                key: "contactName",
                label: "담당자",
                fieldType: "text",
                value: "<script>test</script>",
            },
        ]),
        /<script>/,
    );
    assert.doesNotMatch(body, /체류|5초|열람|가격/);
});
