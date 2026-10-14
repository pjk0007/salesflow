import { test } from "node:test";
import assert from "node:assert/strict";
import {
    conditionValue,
    conditionSchema,
    matchesGroup,
    definitionSchema,
    matchesTriggerEvent,
    workflowFingerprint,
    emptyGroup,
    type WorkflowGroup,
} from "./rules";
const group = (
    path: string,
    op: WorkflowGroup["rules"][number]["op"],
    value: WorkflowGroup["rules"][number]["value"],
): WorkflowGroup => ({ mode: "all", rules: [{ path, op, value }] });
test("워크플로 조건은 숫자·문자·배열·값 없음과 all/any를 구분", () => {
    const c = {
        contact: { stage: "lead", score: 10 },
        event: { name: "요금제 조회", tags: ["관심"] },
    };
    assert.ok(matchesGroup(group("contact.score", "gte", 10), c));
    assert.ok(!matchesGroup(group("contact.score", "gte", 11), c));
    assert.ok(matchesGroup(group("event.tags", "contains", "관심"), c));
    assert.ok(matchesGroup(group("contact.email", "missing", null), c));
    assert.ok(!matchesGroup(group("contact.email", "neq", "customer"), c));
    assert.ok(matchesGroup(emptyGroup, c));
    assert.ok(
        matchesGroup(
            {
                mode: "any",
                rules: [
                    ...group("contact.score", "gte", 11).rules,
                    ...group("event.name", "contains", "요금").rules,
                ],
            },
            c,
        ),
    );
});
test("조건 경로는 객체 고유 속성만 조회·프로토타입과 함수 실행 없음", () => {
    assert.equal(conditionValue({ event: {} }, "event.constructor"), undefined);
    assert.equal(
        conditionValue({ event: { x: 1 } }, "event.x.toString"),
        undefined,
    );
    const bad = {
        trigger: {
            types: ["message.created"],
            eventName: "",
            when: group("event.__proto__.x", "eq", 1),
        },
        steps: [],
    };
    assert.equal(definitionSchema.safeParse(bad).success, false);
    assert.ok(
        matchesGroup(group("contact.attributes.분류", "eq", "핵심"), {
            contact: { attributes: { 분류: "핵심" } },
        }),
    );
    assert.ok(
        conditionSchema.safeParse({
            path: "contact.attributes.분류",
            op: "eq",
            value: "핵심",
        }).success,
    );
});
test("자동 안내는 메시지 트리거만 허용하고 단계 ID·길이를 검사", () => {
    const trigger = {
        types: ["message.created", "customer.event"] as const,
        eventName: "plan_viewed",
        when: emptyGroup,
    };
    const configured = { ...trigger, types: [...trigger.types] };
    assert.ok(
        matchesTriggerEvent(configured, {
            type: "message.created",
            data: { message: { kind: "customer" } },
        }),
    );
    assert.ok(
        matchesTriggerEvent(configured, {
            type: "customer.event",
            data: { event: { name: "plan_viewed" } },
        }),
    );
    assert.equal(
        matchesTriggerEvent(configured, {
            type: "customer.event",
            data: { event: { name: "other" } },
        }),
        false,
    );
    const step = {
        id: "00000000-0000-4000-8000-000000000001",
        label: "안내",
        when: emptyGroup,
        kind: "reply",
        body: "안녕하세요",
    };
    const def = {
        trigger: {
            types: ["message.created"],
            eventName: "",
            when: emptyGroup,
        },
        steps: [step],
    };
    assert.ok(definitionSchema.safeParse(def).success);
    assert.equal(
        definitionSchema.safeParse({
            ...def,
            trigger: { ...def.trigger, types: ["customer.event"] },
        }).success,
        false,
    );
    assert.equal(
        definitionSchema.safeParse({ ...def, steps: [step, step] }).success,
        false,
    );
});
test("워크플로 지문은 객체 키 순서에 무관하고 행동 변경을 감지", () => {
    assert.equal(
        workflowFingerprint({ a: 1, b: [2, 3] }),
        workflowFingerprint({ b: [2, 3], a: 1 }),
    );
    assert.notEqual(
        workflowFingerprint({ a: [2, 3] }),
        workflowFingerprint({ a: [3, 2] }),
    );
});
