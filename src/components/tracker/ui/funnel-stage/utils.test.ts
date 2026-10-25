import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { incompleteStageIndex, showsManualEntry } from "./utils";
import { CustomEventSelector } from "./CustomEventSelector";
import { PageSelector } from "./PageSelector";
import { FieldValueSelector } from "./FieldValueSelector";

// UX-206 — 퍼널 단계 편집기의 직접 입력이 값의 비어 있음과 독립적으로 유지되는지 확인한다.

test("직접 입력칸 표시 규칙 — 옵션 없음·직접 입력 선택·값 지우기·기존 값 재편집·프리셋 복귀", () => {
    // [manual, 값 있음, 목록에 있음] → 입력칸
    const cases: Array<[string, boolean, boolean, boolean, boolean]> = [
        ["옵션이 없어도 직접 입력을 고르면 빈 값으로 입력칸", true, false, false, true],
        ["직접 입력 중 값을 전부 지워도 입력칸 유지", true, false, false, true],
        ["직접 입력으로 목록과 같은 값을 쳐도 입력칸 유지", true, true, true, true],
        ["저장된 사용자 값(목록에 없음) 재편집은 처음부터 입력칸", false, true, false, true],
        ["프리셋을 고르면 드롭다운만", false, true, true, false],
        ["새 단계(값 없음, 선택 전)는 드롭다운만", false, false, false, false],
    ];
    for (const [name, manual, hasValue, matches, expected] of cases) {
        assert.equal(showsManualEntry(manual, hasValue, matches), expected, name);
    }
});

test("저장 전 빈 매칭 값 단계 찾기 — 라벨 없는 단계는 저장에서 빠지므로 무시", () => {
    assert.equal(incompleteStageIndex([
        { label: "신청", match: { type: "record_field", field: "status", value: "신청완료" } },
        { label: "가격", match: { type: "page_url", pathPrefix: "  " } },
    ]), 1);
    assert.equal(incompleteStageIndex([
        { label: "", match: { type: "custom_event", eventName: "" } },
        { label: "구독", match: { type: "custom_event", eventName: "subscribe_step_2" } },
    ]), -1);
    assert.equal(incompleteStageIndex([{ label: "필드", match: { type: "record_field", field: "status", value: "" } }]), 0);
    assert.equal(incompleteStageIndex([{ label: "이벤트", match: { type: "custom_event", eventName: "" } }]), 0);
});

const noop = () => {};

test("기존 사용자 값 재편집 — 세 선택기 모두 저장된 값을 입력칸에 그대로 보여준다", () => {
    const custom = renderToStaticMarkup(createElement(CustomEventSelector, {
        customEvents: [{ eventName: "signup", label: "가입" }],
        current: { type: "custom_event", eventName: "my_new_event" },
        onChange: noop,
    }));
    assert.match(custom, /aria-label="직접 입력할 이벤트 이름"[^>]*value="my_new_event"|value="my_new_event"[^>]*aria-label="직접 입력할 이벤트 이름"/);

    const page = renderToStaticMarkup(createElement(PageSelector, {
        popularPaths: [],
        current: { type: "page_url", pathPrefix: "/new-landing" },
        onChange: noop,
    }));
    assert.match(page, /value="\/new-landing"/);

    const field = renderToStaticMarkup(createElement(FieldValueSelector, {
        eventTypes: [{ type: "status", labels: ["신청완료"] }],
        current: { type: "record_field", field: "grade", value: "VIP" },
        onChange: noop,
    } as Parameters<typeof FieldValueSelector>[0]));
    assert.match(field, /value="grade"/);
    assert.match(field, /value="VIP"/);
});

test("프리셋 값은 입력칸 없이 드롭다운으로 연다", () => {
    const html = renderToStaticMarkup(createElement(CustomEventSelector, {
        customEvents: [{ eventName: "signup", label: "가입" }],
        current: { type: "custom_event", eventName: "signup" },
        onChange: noop,
    }));
    assert.doesNotMatch(html, /직접 입력할 이벤트 이름/);
});
