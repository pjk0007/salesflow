import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeContactPrefill, recordRecipientFields } from "./prefill";

const fields = (label: string) => [{ key: "n", label, type: "text" }, { key: "e", label: "메일", type: "email" }, { key: "p", label: "연락처", type: "phone" }];
const data = { n: " 홍길동 ", e: "fake@isolated.example.test", p: "01000000001" };

test("UX-267: 기존 라벨(이름·성명·name)과 흔한 라벨(고객 이름·성함·대표자명·신청자)을 모두 이름으로 인식한다", () => {
    for (const label of ["이름", "성명", "name", "Name", "담당자", "고객명", "고객 이름", "성함", "대표자명", "신청자", "신청자명"])
        assert.equal(recordRecipientFields(fields(label), data).name, "홍길동", label);
    assert.equal(recordRecipientFields(fields("회사명"), data).name, undefined);
    assert.deepEqual(recordRecipientFields(fields("이름"), data), { name: "홍길동", email: "fake@isolated.example.test", phone: "01000000001" });
    // 이름 칸이 여럿이면 값이 있는 첫 칸을 쓴다.
    assert.equal(recordRecipientFields([{ key: "a", label: "이름", type: "text" }, { key: "b", label: "성함", type: "text" }], { a: "", b: "김가상" }).name, "김가상");
});

test("UX-267: 고객 카드 값이 있으면 우선하고, 빈 이메일·휴대폰만 레코드 값으로 채운다", () => {
    assert.deepEqual(mergeContactPrefill({ name: "카드 이름", email: "card@isolated.example.test", phone: "01011112222" }, { name: "레코드", email: "rec@isolated.example.test", phone: "01000000001" }),
        { name: "카드 이름", email: "card@isolated.example.test", phone: "01011112222" });
    assert.deepEqual(mergeContactPrefill({ name: "카드 이름", email: null, phone: "" }, { name: "레코드", email: "rec@isolated.example.test", phone: "01000000001" }),
        { name: "카드 이름", email: "rec@isolated.example.test", phone: "01000000001" });
    assert.deepEqual(mergeContactPrefill({ name: "카드 이름" }, {}), { name: "카드 이름" });
});
