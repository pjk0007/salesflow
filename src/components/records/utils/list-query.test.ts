import test from "node:test";
import assert from "node:assert/strict";
import {
    INITIAL_RECORD_LIST_QUERY,
    hasRecordListConditions,
    recordListQueryReducer as reduce,
    recordsStorageKey,
    resolvePartitionSelection,
    resolveWorkspaceSelection,
    toggleAllSelection,
    type RecordListQuery,
} from "./list-query";
import type { FilterCondition } from "@/types";

const FILTER: FilterCondition = { field: "status", operator: "equals", value: "신규" };

function withSelection(q: RecordListQuery, ids: number[]): RecordListQuery {
    return reduce(q, { type: "select", ids: new Set(ids) });
}

test("UX-054·055 파티션·워크스페이스 전환(reset)은 분배순서·검색·필터·정렬·페이지·선택을 모두 초기화하고 툴바를 다시 그린다", () => {
    let q = INITIAL_RECORD_LIST_QUERY;
    q = reduce(q, { type: "distributionOrder", order: 3 });
    q = reduce(q, { type: "search", search: "홍길동" });
    q = reduce(q, { type: "filters", filters: [FILTER] });
    q = reduce(q, { type: "sort", field: "name", order: "asc" });
    q = reduce(q, { type: "page", page: 4 });
    q = withSelection(q, [1, 2]);
    const reset = reduce(q, { type: "reset" });
    assert.equal(reset.distributionOrder, undefined);
    assert.equal(reset.search, "");
    assert.deepEqual(reset.filters, []);
    assert.equal(reset.sortField, "registeredAt");
    assert.equal(reset.sortOrder, "desc");
    assert.equal(reset.page, 1);
    assert.equal(reset.selectedIds.size, 0);
    // 검색창은 자체 입력 상태가 있어 key(resetCount)로 다시 그려야 이전 검색어가 남지 않는다
    assert.equal(reset.resetCount, q.resetCount + 1);
});

test("UX-056 검색·필터·정렬·분배순서·페이지가 바뀌면 보이지 않게 된 레코드 선택이 일괄 작업 대상에 남지 않는다", () => {
    const base = withSelection(reduce(INITIAL_RECORD_LIST_QUERY, { type: "page", page: 2 }), [10, 11, 12]);
    const cases: [string, Parameters<typeof reduce>[1]][] = [
        ["검색", { type: "search", search: "김" }],
        ["필터", { type: "filters", filters: [FILTER] }],
        ["정렬", { type: "sort", field: "integratedCode", order: "asc" }],
        ["분배순서", { type: "distributionOrder", order: 2 }],
        ["페이지", { type: "page", page: 3 }],
        ["조건 초기화", { type: "clearConditions" }],
    ];
    for (const [name, action] of cases) {
        const next = reduce(base, action);
        assert.equal(next.selectedIds.size, 0, `${name} 뒤 선택 0건`);
        if (action.type !== "page") assert.equal(next.page, 1, `${name} 뒤 1페이지`);
    }
});

test("UX-056 디바운스가 같은 검색어를 다시 보내거나 같은 페이지를 다시 고르면 선택을 유지한다", () => {
    const q = withSelection(reduce(INITIAL_RECORD_LIST_QUERY, { type: "search", search: "김" }), [1]);
    assert.equal(reduce(q, { type: "search", search: "김" }), q);
    assert.equal(reduce(q, { type: "page", page: 1 }), q);
});

test("UX-056 그룹 하나의 전체 선택·해제는 다른 그룹 선택을 지우지 않는다", () => {
    const otherGroup = new Set([100, 101]);
    const selected = toggleAllSelection(otherGroup, [1, 2, 3]);
    assert.deepEqual([...selected].sort((a, b) => a - b), [1, 2, 3, 100, 101]);
    const cleared = toggleAllSelection(selected, [1, 2, 3]);
    assert.deepEqual([...cleared].sort((a, b) => a - b), [100, 101]);
    // 일부만 골라 둔 상태의 전체 선택은 나머지를 더한다
    assert.deepEqual([...toggleAllSelection(new Set([2]), [1, 2])].sort(), [1, 2]);
    assert.equal(toggleAllSelection(new Set([5]), []).size, 1);
});

test("UX-057 조건 유무 판정과 조건 초기화", () => {
    assert.equal(hasRecordListConditions(INITIAL_RECORD_LIST_QUERY), false);
    assert.equal(hasRecordListConditions({ ...INITIAL_RECORD_LIST_QUERY, search: "a" }), true);
    assert.equal(hasRecordListConditions({ ...INITIAL_RECORD_LIST_QUERY, distributionOrder: 1 }), true);
    assert.equal(hasRecordListConditions({ ...INITIAL_RECORD_LIST_QUERY, filters: [FILTER] }), true);
    let q = reduce(INITIAL_RECORD_LIST_QUERY, { type: "sort", field: "name", order: "asc" });
    q = reduce(q, { type: "search", search: "a" });
    q = reduce(q, { type: "filters", filters: [FILTER] });
    q = reduce(q, { type: "distributionOrder", order: 2 });
    const cleared = reduce(q, { type: "clearConditions" });
    assert.equal(hasRecordListConditions(cleared), false);
    // 정렬은 조건이 아니므로 유지
    assert.equal(cleared.sortField, "name");
    assert.equal(cleared.resetCount, q.resetCount + 1);
});

test("UX-082 저장된 파티션이 트리에 없으면(삭제·다른 조직) 첫 파티션, 트리가 비면 null", () => {
    const tree = { ungrouped: [{ id: 7 }], folders: [{ partitions: [{ id: 3 }, { id: 4 }] }] };
    assert.equal(resolvePartitionSelection(tree, 4), 4);
    assert.equal(resolvePartitionSelection(tree, 999), 7);
    assert.equal(resolvePartitionSelection(tree, null), 7);
    assert.equal(resolvePartitionSelection({ ungrouped: [], folders: [{ partitions: [{ id: 3 }] }] }, 999), 3);
    assert.equal(resolvePartitionSelection({ ungrouped: [], folders: [] }, 5), null);
});

test("UX-082 마지막 파티션 저장 키는 조직마다 다르다", () => {
    assert.notEqual(recordsStorageKey("partition", "org-a"), recordsStorageKey("partition", "org-b"));
    assert.notEqual(recordsStorageKey("partition", "org-a"), recordsStorageKey("workspace", "org-a"));
    assert.equal(recordsStorageKey("workspace", "org-a"), "records_last_workspace:org-a");
});

test("UI확인-R3 워크스페이스를 바꾼 적 없어 저장값이 없으면 첫 워크스페이스를 고르되 마지막 파티션은 유지한다", () => {
    assert.deepEqual(resolveWorkspaceSelection([1, 2], null), { workspaceId: 1, keepPartition: true });
});

test("UI확인-R3 저장된 워크스페이스가 무효면 첫 워크스페이스로 가고 파티션도 버린다, 유효하면 그대로", () => {
    assert.deepEqual(resolveWorkspaceSelection([1, 2], 9), { workspaceId: 1, keepPartition: false });
    assert.equal(resolveWorkspaceSelection([1, 2], 2), null);
    assert.equal(resolveWorkspaceSelection([], null), null);
});
