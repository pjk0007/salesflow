/** 한국어 Excel CSV와 UTF-8을 같은 규칙으로 해석한다. 대체문자 삽입으로 손상을 숨기지 않는다. */
export function decodeCsvText(bytes: ArrayBuffer | Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        try {
            return new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
        } catch {
            throw new Error("CSV 인코딩을 읽지 못했습니다. UTF-8 CSV로 저장한 뒤 다시 올려주세요.");
        }
    }
}
