import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompanySealName, normalizeMarkName, normalizeSealCenter, sealCells } from "./name-marks";
import { requireSealCharacters, sealCharacterScript } from "./seal-font-coverage";

test("names normalize decomposed Hangul, preserve signature spaces and remove seal spaces", () => {
    assert.equal(normalizeMarkName("  김  이삭  ", "seal"), "김이삭");
    assert.equal(normalizeMarkName("  Isaac   Kim  ", "signature"), "Isaac Kim");
    for (const name of ["", "김", "가나다라마바사아자", "김😀"]) assert.throws(() => normalizeMarkName(name, "seal"));
    for (const name of [" ", "가".repeat(31), "😀"]) assert.throws(() => normalizeMarkName(name, "signature"));
    assert.equal(normalizeMarkName("Jean-Luc O'Neil", "signature"), "Jean-Luc O'Neil");
});

test("company names and titles accept real business punctuation without silently inventing a company type", () => {
    assert.equal(normalizeCompanySealName(" ㈜ 매치스플랜 "), "(주)매치스플랜");
    assert.equal(normalizeCompanySealName("디자이너하이어"), "디자이너하이어");
    assert.equal(normalizeCompanySealName("A&B,Inc."), "A&B,Inc.");
    for (const name of ["", "가", "가".repeat(25), "<script>"]) assert.throws(() => normalizeCompanySealName(name));
    assert.equal(normalizeSealCenter("대표 이사 인"), "대표이사인");
    for (const title of ["", "가".repeat(9), "&"]) assert.throws(() => normalizeSealCenter(title));
});

test("seal coverage accepts all modern Hangul and verifies real Hanja coverage before rendering", () => {
    for (let code = 0xac00; code <= 0xd7a3; code++) {
        assert.equal(sealCharacterScript(String.fromCodePoint(code)), "design");
    }
    requireSealCharacters("(주)매치스플랜代表理事A&B");
    for (const character of "代表理事印金李國株式會社") assert.equal(sealCharacterScript(character), "hanja");
    for (const character of ["韓", "é", "サ", "😀", ""]) assert.equal(sealCharacterScript(character), undefined);
    assert.throws(() => requireSealCharacters("韓國"), /지원하지 않는 글자\(韓\)/);
    assert.throws(() => requireSealCharacters("Élodie"), /지원하지 않는 글자/);
});

test("seal lettering follows traditional columns and never loses a character for 2–8 letter names", () => {
    const three = sealCells("김이삭");
    assert.deepEqual(three.map(cell => [cell.character, cell.column, cell.row]), [["김", 1, 0], ["이", 1, 1], ["삭", 0, 0], ["인", 0, 1]]);
    for (let length = 2; length <= 8; length++) for (const oval of [false, true]) {
        const name = "가나다라마바사아".slice(0, length), cells = sealCells(name, oval);
        assert.equal(cells.slice(0, length).map(cell => cell.character).join(""), name);
        assert.equal(new Set(cells.map(cell => `${cell.column}/${cell.row}`)).size, cells.length);
        assert.ok(cells.every(cell => cell.column >= 0 && cell.column < cell.columns && cell.row >= 0 && cell.row < cell.rows));
    }
    assert.equal(sealCells("김이삭", true).length, 3);
});
