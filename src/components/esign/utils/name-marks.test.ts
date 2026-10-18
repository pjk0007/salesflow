import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarkName, sealCells } from "./name-marks";

test("names normalize decomposed Hangul, preserve signature spaces and remove seal spaces", () => {
    assert.equal(normalizeMarkName("  김  이삭  ", "seal"), "김이삭");
    assert.equal(normalizeMarkName("  Isaac   Kim  ", "signature"), "Isaac Kim");
    for (const name of ["", "김", "가나다라마바사아자", "김😀"]) assert.throws(() => normalizeMarkName(name, "seal"));
    for (const name of [" ", "가".repeat(31), "😀"]) assert.throws(() => normalizeMarkName(name, "signature"));
    assert.equal(normalizeMarkName("Jean-Luc O'Neil", "signature"), "Jean-Luc O'Neil");
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
