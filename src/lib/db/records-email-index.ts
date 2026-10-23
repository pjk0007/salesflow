// 식을 바꾸면 인덱스 이름도 바꿔야 한다 — IF NOT EXISTS가 같은 이름의 옛 인덱스를 남기기 때문이다.
export const RECORD_EMAIL_KEY = "email";
/** PG에서 평가하면 EMAIL_TRIM_CHARS와 같다. 역슬래시·$가 없어 태그 템플릿에서도 같은 SQL이다. */
export const EMAIL_TRIM_SQL = "chr(32)||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160)||chr(12288)||chr(65279)||chr(8203)";
export const RECORD_EMAIL_PREFIX = 200;

/** records_workspace_email_norm_idx 둘째 열과 같은 식을 반환한다. 결과는 sql.raw·DDL로 가므로 data는 리터럴만 받는다. */
export function recordEmailIndexKeySql(data: '"data"' | "rm.data"): string {
    return `left(lower(btrim(${data}->>'${RECORD_EMAIL_KEY}', ${EMAIL_TRIM_SQL})), ${RECORD_EMAIL_PREFIX})`;
}

/** others에는 'email'과 중복이 없다. indexed면 'email'을 더한 집합이 keys 집합과 같다. */
export function splitEmailKeys(keys: readonly string[]): { indexed: boolean; others: string[] } {
    return { indexed: keys.includes(RECORD_EMAIL_KEY), others: [...new Set(keys.filter(key => key !== RECORD_EMAIL_KEY))] };
}
