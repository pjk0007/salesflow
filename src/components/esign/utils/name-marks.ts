export type NameMarkKind = "signature" | "seal";
export type NameMarkStyle = { id: string; label: string };
export const SIGNATURE_STYLES: readonly NameMarkStyle[] = [
    { id: "pen", label: "자연스러운 펜글씨" },
    { id: "brush", label: "힘 있는 붓글씨" },
    { id: "classic", label: "단정한 손글씨" },
    { id: "light", label: "가벼운 손글씨" },
];
export const SEAL_STYLES: readonly NameMarkStyle[] = [
    { id: "round", label: "원형 인장" },
    { id: "double-round", label: "이중 원형" },
    { id: "square", label: "사각 인장" },
    { id: "rounded-square", label: "둥근 사각" },
    { id: "oval", label: "세로 타원" },
    { id: "brush-round", label: "붓글씨 인장" },
];

export function normalizeMarkName(value: string, kind: NameMarkKind): string {
    const name = value.normalize("NFC").trim().replace(/\s+/g, kind === "seal" ? "" : " ");
    const length = [...name].length;
    if (kind === "seal" && (length < 2 || length > 8)) throw new Error("도장 이름은 공백을 빼고 2~8자로 입력해 주세요.");
    if (kind === "signature" && (length < 1 || length > 30)) throw new Error("서명 이름은 1~30자로 입력해 주세요.");
    if (!/^[\p{L}\p{M}\p{N} .'-]+$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) throw new Error("이름에는 한글·영문 등의 문자와 숫자, 공백, 마침표, 작은따옴표, 하이픈을 사용할 수 있습니다.");
    return name;
}

/** Conventional top-to-bottom, right-to-left personal seal. Three-letter names include 인. */
export function sealCells(name: string, oval = false) {
    const characters = [...normalizeMarkName(name, "seal")];
    if (characters.length === 3 && !oval) characters.push("인");
    const columns = oval && characters.length <= 4 ? 1 : characters.length <= 2 ? 1 : 2;
    const rows = Math.ceil(characters.length / columns);
    return characters.map((character, index) => ({ character, column: columns - 1 - Math.floor(index / rows), row: index % rows, columns, rows }));
}
