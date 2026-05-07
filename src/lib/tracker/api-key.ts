import { nanoid } from "nanoid";

const API_KEY_PREFIX = "ak_";

/**
 * 트래커용 API 키 생성. 64자 제한 안에 들어가도록 설계.
 * 형태: ak_<48자 nanoid>
 */
export function generateApiKey(): string {
    return `${API_KEY_PREFIX}${nanoid(48)}`;
}
