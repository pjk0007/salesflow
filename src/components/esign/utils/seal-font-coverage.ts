import hanjaCharacters from "../../../../public/esign/fonts/seal-hanja-coverage.json";

/** Explicit coverage avoids a system font silently appearing in a seal. */
export function sealCharacterScript(character: string): "design" | "hanja" | undefined {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x20 && code <= 0x7e)) return "design";
    if (hanjaCharacters.includes(character) && character.length > 0) return "hanja";
}

export function requireSealCharacters(text: string): void {
    const unsupported = [...new Set([...text].filter(character => !sealCharacterScript(character)))];
    if (unsupported.length) throw new Error(`도장 서체가 지원하지 않는 글자(${unsupported.join("·")})가 있습니다. 다른 글자를 입력하거나 본인 도장 PNG를 올려 주세요.`);
}
