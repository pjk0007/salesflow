export interface ProductFormValues {
    name: string;
    summary: string;
    description: string;
    category: string;
    price: string;
    url: string;
    imageUrl: string;
}

export interface ProductPayload {
    name: string;
    summary?: string;
    description?: string;
    category?: string;
    price?: string;
    url?: string;
    imageUrl?: string;
}

const OPTIONAL_KEYS = ["summary", "description", "category", "price", "url", "imageUrl"] as const;

/**
 * 제품 저장 본문. 수정에서는 비운 항목을 ""로 보내 서버가 null로 지우게 한다 — undefined면 서버가 그 항목을
 * 건드리지 않아 옛 가격·URL이 AI 메일에 계속 쓰인다(UX-083). 추가에서는 빈 항목을 생략한다.
 */
export function productPayload(values: ProductFormValues, isEdit: boolean): ProductPayload {
    const payload: ProductPayload = { name: values.name.trim() };
    for (const key of OPTIONAL_KEYS) {
        const v = values[key].trim();
        if (v) payload[key] = v;
        else if (isEdit) payload[key] = "";
    }
    return payload;
}

/** 제품 추가·수정·삭제는 관리자만(API도 member를 403으로 막는다, UX-085) */
export function canEditProducts(role: string | null | undefined): boolean {
    return role === "owner" || role === "admin";
}

/** 카테고리 선택지 — 필터 없는 전체 목록에서 만들고, 걸려 있는 카테고리는 결과에 없어도 남긴다(UX-084) */
export function productCategoryOptions(products: { category: string | null }[], selected: string): string[] {
    const cats = new Set<string>();
    for (const p of products) if (p.category) cats.add(p.category);
    if (selected) cats.add(selected);
    return Array.from(cats).sort();
}
