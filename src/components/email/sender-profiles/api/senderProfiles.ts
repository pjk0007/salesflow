import type {
    ApiResult,
    SenderProfile,
    SenderProfileCreate,
    SenderProfileUpdate,
} from "../types";

export const SENDER_PROFILES_KEY = "/api/email/sender-profiles";
export const SENDER_USAGE_KEY = "/api/email/sender-profiles/usage";

// 네트워크가 끊기거나 서버가 JSON이 아닌 오류 화면을 주면 res.json()이 던진다.
// 호출부가 저장 중 표시를 풀 수 있게 실패 결과로 바꿔 돌려준다.
async function request<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
    let res: Response;
    try {
        res = await fetch(url, init);
    } catch {
        return { success: false, error: "요청에 실패했습니다. 네트워크를 확인해주세요." };
    }
    try {
        return (await res.json()) as ApiResult<T>;
    } catch {
        return { success: false, error: "서버 응답을 읽지 못했습니다." };
    }
}

function jsonInit(method: string, body: unknown): RequestInit {
    return {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    };
}

export function createSenderProfile(input: SenderProfileCreate): Promise<ApiResult<SenderProfile>> {
    return request(SENDER_PROFILES_KEY, jsonInit("POST", input));
}

export function updateSenderProfile(id: number, patch: SenderProfileUpdate): Promise<ApiResult<SenderProfile>> {
    return request(`${SENDER_PROFILES_KEY}/${id}`, jsonInit("PUT", patch));
}

export function deleteSenderProfile(id: number): Promise<ApiResult<never>> {
    return request(`${SENDER_PROFILES_KEY}/${id}`, { method: "DELETE" });
}

/** NHN에 등록된 발신 주소인지 그 주소로 확인 메일을 보내 본다 */
export function verifySenderEmail(input: { fromEmail: string; fromName: string }): Promise<ApiResult<never>> {
    return request(`${SENDER_PROFILES_KEY}/verify`, jsonInit("POST", input));
}
