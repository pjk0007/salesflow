/** 주소 모양만 판별한다. 앞뒤 공백은 무시하며 내부 공백·%는 정확 검색에서 제외한다. */
export function isExactEmailSearch(search: string): boolean {
    return /^[^\s%@]+@[^\s%@.]+(?:\.[^\s%@.]+)+$/.test(search.trim());
}
