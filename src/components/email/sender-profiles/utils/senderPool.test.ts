import { test } from "node:test";
import assert from "node:assert";
import { splitKnownSenderIds, formSenderIds, filterSenderProfiles, senderPoolSearchSelection } from "./senderPool";

// 규칙 복제 때 지워진 발신 프로필을 빼고 보낸다 (리뷰 SEC-4 — 지워진 id가 남은 규칙의 복제가 늘 400으로 실패했다)

test("지워진 프로필만 빼고 순서는 그대로 둔다", () => {
    assert.deepEqual(splitKnownSenderIds([5, 6, 7], [7, 5]), { kept: [5, 7], dropped: [6] });
});

test("다 지워졌으면 빈 묶음 — 기본 발신 프로필로 보낸다", () => {
    assert.deepEqual(splitKnownSenderIds([5], []), { kept: [], dropped: [5] });
});

test("빈 묶음은 빈 묶음이다", () => {
    assert.deepEqual(splitKnownSenderIds([], [1, 2]), { kept: [], dropped: [] });
});


test("formSenderIds: unedited uses saved pool or legacy single id (B22)", () => {
    assert.deepEqual(formSenderIds(null, { senderProfileId: 8, senderProfileIds: [8, 7] }), [8, 7]);
    assert.deepEqual(formSenderIds(null, { senderProfileId: 7, senderProfileIds: null }), [7]);
});

test("formSenderIds: edited selection including empty survives saved refresh (B22)", () => {
    for (const edited of [[7], []]) {
        assert.deepEqual(formSenderIds(edited, { senderProfileId: 8, senderProfileIds: [8] }), edited);
        assert.deepEqual(formSenderIds(edited, { senderProfileId: 9, senderProfileIds: [9] }), edited);
    }
});

test("formSenderIds: no saved pool starts empty (B21)", () => {
    for (const saved of [undefined, null, { senderProfileId: null, senderProfileIds: null }]) {
        assert.deepEqual(formSenderIds(null, saved), []);
    }
});


const searchProfiles = [
    { id: 3, name: "Sales Team", fromName: "Alice", fromEmail: "sales@example.com" },
    { id: 1, name: "지원", fromName: "Bob SUPPORT", fromEmail: "help@example.com" },
    { id: 2, name: "Marketing", fromName: "Carol", fromEmail: "News@Example.COM" },
];

test("filterSenderProfiles: empty and whitespace queries retain all profiles in original order", () => {
    for (const query of ["", "   ", "\t\n"]) {
        assert.deepEqual(filterSenderProfiles(searchProfiles, query), searchProfiles);
    }
});

test("filterSenderProfiles: trim and case-insensitive substring match across all three fields", () => {
    for (const [query, ids] of [["  aLeS  ", [3]], [" support ", [1]], [" NEWS@ ", [2]], ["지원", [1]]] as const) {
        assert.deepEqual(filterSenderProfiles(searchProfiles, query).map(p => p.id), ids);
    }
});

test("filterSenderProfiles: preserve order and input without duplicating multi-field matches", () => {
    const before = structuredClone(searchProfiles);
    assert.deepEqual(filterSenderProfiles(searchProfiles, "EXAMPLE").map(p => p.id), [3, 1, 2]);
    assert.deepEqual(filterSenderProfiles(searchProfiles, "sales").map(p => p.id), [3]);
    assert.deepEqual(searchProfiles, before);
});

test("filterSenderProfiles: unmatched queries and empty input yield no profiles", () => {
    assert.deepEqual(filterSenderProfiles(searchProfiles, "missing"), []);
    assert.deepEqual(filterSenderProfiles([], "sales"), []);
});


test("senderPoolSearchSelection: matching selected and unselected profiles define the switch", () => {
    const result = senderPoolSearchSelection(searchProfiles, [1, 3], "example");
    assert.deepEqual(result.filteredRest.map(p => p.id), [2]);
    assert.equal(result.isAllSelected, false);
    assert.deepEqual(result.selectAllIds, [1, 3, 2]);
    assert.deepEqual(result.clearAllIds, []);
    const selected = senderPoolSearchSelection(searchProfiles, [1, 3, 2], "example");
    assert.equal(selected.isAllSelected, true);
    assert.deepEqual(selected.filteredRest, []);
});

test("senderPoolSearchSelection: removing search matches preserves unrelated and missing selected ids", () => {
    const result = senderPoolSearchSelection(searchProfiles, [1, 99, 3], "  SALES ");
    assert.equal(result.isAllSelected, true);
    assert.deepEqual(result.clearAllIds, [1, 99]);
    assert.deepEqual(result.selectAllIds, [1, 99, 3]);
    assert.deepEqual(result.filteredRest, []);
});

test("senderPoolSearchSelection: empty result is unchecked and preserves selection", () => {
    const result = senderPoolSearchSelection(searchProfiles, [1, 99], "missing");
    assert.equal(result.isAllSelected, false);
    assert.deepEqual(result.filteredRest, []);
    assert.deepEqual(result.selectAllIds, [1, 99]);
    assert.deepEqual(result.clearAllIds, [1, 99]);
});

test("senderPoolSearchSelection: blank query keeps old select-all and clear-all behavior", () => {
    const value = [1, 99];
    const result = senderPoolSearchSelection(searchProfiles, value, "   ");
    assert.deepEqual(result.filteredRest.map(p => p.id), [3, 2]);
    assert.deepEqual(result.selectAllIds, [1, 99, 3, 2]);
    assert.deepEqual(result.clearAllIds, []);
    assert.deepEqual(value, [1, 99]);
    assert.equal(senderPoolSearchSelection([], [], "").isAllSelected, false);
});

test("senderPoolSearchSelection: fully selected search results do not show empty notice", () => {
    const result = senderPoolSearchSelection(searchProfiles, [1, 3, 2], "example");
    assert.deepEqual(result.filteredRest, []);
    assert.equal(result.isSearchEmpty, false);
});

test("senderPoolSearchSelection: empty notice requires a query and no matching profiles", () => {
    assert.equal(senderPoolSearchSelection(searchProfiles, [1], "missing").isSearchEmpty, true);
    assert.equal(senderPoolSearchSelection(searchProfiles, [], "sales").isSearchEmpty, false);
    assert.equal(senderPoolSearchSelection([], [], "   ").isSearchEmpty, false);
    assert.equal(senderPoolSearchSelection([], [], "sales").isSearchEmpty, true);
});
