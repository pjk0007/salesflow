import test from "node:test";
import assert from "node:assert/strict";
import { canEditProducts, productCategoryOptions, productPayload } from "./product-form";

const FILLED = { name: " 상품 ", summary: "", description: " 설명 ", category: "", price: "", url: "", imageUrl: "" };

test("UX-083 수정에서 비운 항목은 \"\"로 보내 서버가 지우고, 추가에서는 생략한다", () => {
    assert.deepEqual(productPayload(FILLED, true), {
        name: "상품",
        summary: "",
        description: "설명",
        category: "",
        price: "",
        url: "",
        imageUrl: "",
    });
    assert.deepEqual(productPayload(FILLED, false), { name: "상품", description: "설명" });
});

test("UX-085 owner·admin만 제품 편집", () => {
    assert.equal(canEditProducts("owner"), true);
    assert.equal(canEditProducts("admin"), true);
    assert.equal(canEditProducts("member"), false);
    assert.equal(canEditProducts(undefined), false);
});

test("UX-084 카테고리 선택지는 전체 목록 기준, 걸린 카테고리는 결과가 없어도 남는다", () => {
    const all = [{ category: "B" }, { category: "A" }, { category: null }, { category: "A" }];
    assert.deepEqual(productCategoryOptions(all, ""), ["A", "B"]);
    assert.deepEqual(productCategoryOptions([], "C"), ["C"]);
});
