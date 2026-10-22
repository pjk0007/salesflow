/**
 * 레코드 생성 구글챗 알림의 순수 규칙 (DB·네트워크 없음).
 *
 * 고객 행동(웹폼·외부 API·광고 리드)으로 레코드가 생기면 파티션이 고른 스페이스에 알린다.
 * 리드 1건 = 새 메시지 1개. 같은 리드가 다시 접수(중복 병합)되면 그 메시지의 스레드 답글로 붙는다.
 */

export type RecordAlertSource = "web_form" | "api" | "meta_ad";
export type RecordAlertKind = "created" | "merged";

export const SOURCE_LABELS: Record<RecordAlertSource, string> = {
    web_form: "웹폼",
    api: "외부 API",
    meta_ad: "메타 광고",
};

/** 알림에 싣는 필드 수와 값 길이 — 카드가 길어져 스페이스를 덮지 않게 */
export const MAX_ALERT_FIELDS = 8;
export const MAX_VALUE_LENGTH = 100;

export interface AlertFieldDef {
    key: string;
    label: string;
    fieldType: string;
    isSystem?: number | boolean | null;
}

/** 같은 레코드의 알림을 한 스레드로 모으는 키 */
export function recordThreadKey(recordId: number): string {
    return `sendb-record-${recordId}`;
}

function formatValue(value: unknown, fieldType: string): string | null {
    if (value === null || value === undefined) return null;
    if (fieldType === "checkbox" || typeof value === "boolean") {
        return value === true || value === "true" ? "예" : value === false || value === "false" ? null : String(value);
    }
    if (typeof value === "object") return null;
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text) return null;
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text;
}

/** 필드 정의 순서대로 값이 있는 필드만 고른다. 시스템 필드(등록일 등)와 정의에 없는 키는 뺀다 */
export function pickAlertFields(
    data: Record<string, unknown>,
    fields: AlertFieldDef[],
    max = MAX_ALERT_FIELDS
): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    for (const f of fields) {
        if (out.length >= max) break;
        if (f.isSystem) continue;
        const value = formatValue(data[f.key], f.fieldType);
        if (value) out.push({ label: f.label, value });
    }
    return out;
}

export function buildRecordAlertText(input: {
    kind: RecordAlertKind;
    source: RecordAlertSource;
    workspaceName: string;
    partitionName: string;
    integratedCode: string | null;
    fields: { label: string; value: string }[];
    recordUrl: string;
}): string {
    const head = input.kind === "merged" ? "재접수" : "신규 접수";
    const code = input.integratedCode ? ` · ${input.integratedCode}` : "";
    const lines = [
        `*[${input.workspaceName} > ${input.partitionName}] ${head}* · ${SOURCE_LABELS[input.source]}${code}`,
        ...input.fields.map((f) => `${f.label}: ${f.value}`),
        `<${input.recordUrl}|샌드비에서 보기>`,
    ];
    return lines.join("\n");
}

/**
 * 화면·API 응답용으로 웹훅 주소를 가린다. 주소의 key·token만 있으면 누구나 그 스페이스에 쓸 수 있어서
 * 등록 뒤에는 스페이스 ID 앞뒤 몇 글자만 보여준다.
 */
export function maskWebhookUrl(url: string): string {
    const m = /\/v1\/spaces\/([^/]+)\/messages/.exec(url);
    if (!m) return "알 수 없는 주소";
    const id = m[1];
    return id.length <= 6 ? `spaces/${id}` : `spaces/${id.slice(0, 4)}…${id.slice(-3)}`;
}
