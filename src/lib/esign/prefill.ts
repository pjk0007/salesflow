import { NAME_LABEL_RE } from "../deep-visitor-alert-rules";

export type PrefillFieldDefinition = { key: string; label: string; type: string };
export type PrefillContact = { name?: string | null; email?: string | null; phone?: string | null };

/** 레코드 속성에서 서명자 이름·이메일·휴대폰을 고른다. 이름 라벨은 리드 판정과 같은 NAME_LABEL_RE(+ 영문 name)를 쓴다. */
export function recordRecipientFields(definitions: readonly PrefillFieldDefinition[], data: Record<string, unknown>) {
    const pick = (match: (field: PrefillFieldDefinition) => boolean) => {
        for (const field of definitions.filter(match)) {
            const raw = data[field.key];
            if (typeof raw === "string" && raw.trim()) return raw.trim();
        }
        return undefined;
    };
    return {
        name: pick(field => NAME_LABEL_RE.test(field.label.trim()) || /^name$/i.test(field.label.trim())),
        email: pick(field => field.type === "email"),
        phone: pick(field => field.type === "phone"),
    };
}

/** CRM 고객 카드 값이 우선이고, 비어 있는 칸만 레코드 값으로 채운다. */
export function mergeContactPrefill(contact: PrefillContact, record: PrefillContact) {
    const name = contact.name?.trim() || record.name || "", email = contact.email?.trim() || record.email || undefined, phone = contact.phone?.trim() || record.phone || undefined;
    return { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}
