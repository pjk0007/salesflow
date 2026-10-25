import test from "node:test";
import assert from "node:assert/strict";
import { importDuplicatePolicy } from "./duplicate-policy";

const FIELDS = [{ key: "phone", label: "전화번호" }];

test("UX-070 가져오기 중복 안내: 4가지 정책별 문구, '거부'일 때만 건너뛰기/에러 선택, 내부 key 대신 이름", () => {
    const reject = importDuplicatePolicy({ duplicateConfig: { field: "phone", action: "reject" } }, FIELDS);
    assert.equal(reject.askSkipOrError, true);
    assert.equal(reject.fieldLabel, "전화번호");
    assert.match(reject.notice, /아래 선택대로/);

    const merge = importDuplicatePolicy({ duplicateConfig: { field: "phone", action: "merge" } }, FIELDS);
    assert.equal(merge.askSkipOrError, false);
    assert.match(merge.notice, /덮어씁니다\(병합\)/);

    const replace = importDuplicatePolicy({ duplicateConfig: { field: "phone", action: "delete_old" } }, FIELDS);
    assert.equal(replace.askSkipOrError, false);
    assert.match(replace.notice, /삭제하고 새로 만듭니다\(교체\).*메모·이력/);

    const allow = importDuplicatePolicy({ duplicateConfig: { field: "phone", action: "allow" } }, FIELDS);
    assert.equal(allow.askSkipOrError, false);
    assert.match(allow.notice, /중복을 허용/);
});

test("중복 기준 필드가 없으면 선택 없이 안내만, 예전 duplicateCheckField는 '거부'로 본다(서버와 같은 기본값)", () => {
    const none = importDuplicatePolicy({ duplicateConfig: null, duplicateCheckField: null }, FIELDS);
    assert.equal(none.askSkipOrError, false);
    assert.equal(none.fieldLabel, null);
    const legacy = importDuplicatePolicy({ duplicateConfig: null, duplicateCheckField: "phone" }, FIELDS);
    assert.equal(legacy.action, "reject");
    assert.equal(legacy.askSkipOrError, true);
    assert.equal(importDuplicatePolicy({ duplicateConfig: { field: "email", action: "merge" } }, FIELDS).fieldLabel, "email");
});
