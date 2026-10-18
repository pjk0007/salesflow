export type NameMarkKind = "signature" | "seal";
export type SealCategory = "personal" | "company";
export type SealFont = "doan" | "jeonseo" | "gilsang";
export type SealOptions = { category: SealCategory; font: SealFont; centerText: string };
export type NameMarkStyle = { id: string; label: string };
export const SIGNATURE_STYLES: readonly NameMarkStyle[] = [
    { id: "pen", label: "자연스러운 펜글씨" },
    { id: "brush", label: "힘 있는 붓글씨" },
    { id: "classic", label: "단정한 손글씨" },
    { id: "light", label: "가벼운 손글씨" },
];
export const PERSONAL_SEAL_STYLES: readonly NameMarkStyle[] = [
    { id: "carved-square", label: "전통 사각 · 양각" },
    { id: "intaglio-square", label: "전통 사각 · 음각" },
    { id: "classic-round", label: "이중 원형 낙관" },
    { id: "slender-oval", label: "세로 타원 인장" },
    { id: "solid-round", label: "원형 · 음각" },
    { id: "single-round", label: "원형 · 양각" },
];
export const COMPANY_SEAL_STYLES: readonly NameMarkStyle[] = [
    { id: "company-round", label: "원형 직인 · 원" },
    { id: "company-star", label: "원형 직인 · 별" },
    { id: "company-diamond", label: "원형 직인 · 마름모" },
    { id: "company-triangle", label: "원형 직인 · 삼각" },
    { id: "company-square", label: "사각 회사 직인" },
    { id: "company-inverse", label: "음각 회사 직인" },
];
export const SEAL_STYLES = [...PERSONAL_SEAL_STYLES, ...COMPANY_SEAL_STYLES];
export const SEAL_FONTS = [
    { id: "doan", label: "둥근 도안체" },
    { id: "jeonseo", label: "전서 도안체" },
    { id: "gilsang", label: "길상 도안체" },
] as const;

export function normalizeMarkName(value: string, kind: NameMarkKind): string {
    const name = value.normalize("NFC").trim().replace(/\s+/g, kind === "seal" ? "" : " ");
    const length = [...name].length;
    if (kind === "seal" && (length < 2 || length > 8)) throw new Error("도장 이름은 공백을 빼고 2~8자로 입력해 주세요.");
    if (kind === "signature" && (length < 1 || length > 30)) throw new Error("서명 이름은 1~30자로 입력해 주세요.");
    if (!/^[\p{L}\p{M}\p{N} .'-]+$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) throw new Error("이름에는 한글·영문 등의 문자와 숫자, 공백, 마침표, 작은따옴표, 하이픈을 사용할 수 있습니다.");
    return name;
}

export function normalizeCompanySealName(value: string): string {
    const name = value.normalize("NFC").trim().replace(/\s+/g, "").replaceAll("㈜", "(주)");
    if ([...name].length < 2 || [...name].length > 24) throw new Error("회사명은 공백을 빼고 2~24자로 입력해 주세요.");
    if (!/^[\p{L}\p{M}\p{N}&().,'·-]+$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) throw new Error("회사명에 사용할 수 없는 기호가 있습니다.");
    return name;
}

export function normalizeSealCenter(value: string): string {
    const text = value.normalize("NFC").trim().replace(/\s+/g, "");
    if ([...text].length < 1 || [...text].length > 8 || !/^[\p{L}\p{M}\p{N}]+$/u.test(text)) throw new Error("가운데 글자는 한글·영문·숫자 1~8자로 입력해 주세요.");
    return text;
}

/** Traditional top-to-bottom, right-to-left name, balancing odd names with 인. */
export function sealCells(name: string, oval = false) {
    const characters = [...normalizeMarkName(name, "seal")];
    if (characters.length % 2 === 1 && !oval) characters.push("인");
    const columns = oval && characters.length <= 4 ? 1 : characters.length <= 2 ? 1 : 2;
    const rows = Math.ceil(characters.length / columns);
    return characters.map((character, index) => ({ character, column: columns - 1 - Math.floor(index / rows), row: index % rows, columns, rows }));
}
