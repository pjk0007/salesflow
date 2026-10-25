import useSWR from "swr";
import { apiRequest, blockingError, defaultFetcher, requestErrorMessage } from "@/lib/swr-fetcher";

interface AlimtalkConfigData {
    id: number;
    appKey: string;
    secretKey: string;
    defaultSenderKey: string | null;
    isActive: number;
}

/** 변경 요청 결과. 연결 끊김·비JSON 응답도 throw 대신 success:false로 돌려 호출부의 처리 중 상태가 풀리게 한다(UX-180). */
interface MutationResult<T = undefined> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
}

interface ConfigResponse {
    success: boolean;
    data: AlimtalkConfigData | null;
}


export function useAlimtalkConfig() {
    const { data, error, isLoading, mutate } = useSWR<ConfigResponse>(
        "/api/alimtalk/config",
        defaultFetcher
    );

    const saveConfig = async (config: { appKey: string; secretKey: string }): Promise<MutationResult> => {
        try {
            const result = await apiRequest<MutationResult>("/api/alimtalk/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            mutate();
            return result;
        } catch (error) {
            return { success: false, error: requestErrorMessage(error, "저장 결과를 확인하지 못했습니다. 설정을 다시 불러와 확인한 뒤 시도해주세요.") };
        }
    };

    const testConnection = async (config: { appKey: string; secretKey: string }): Promise<MutationResult<{ senderCount: number }>> => {
        try {
            return await apiRequest<MutationResult<{ senderCount: number }>>("/api/alimtalk/config/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
        } catch (error) {
            return { success: false, error: requestErrorMessage(error, "연결 테스트를 완료하지 못했습니다. 잠시 후 다시 시도해주세요.") };
        }
    };

    const setDefaultSender = async (senderKey: string): Promise<MutationResult> => {
        try {
            const result = await apiRequest<MutationResult>("/api/alimtalk/config/default-sender", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ senderKey }),
            });
            mutate();
            return result;
        } catch (error) {
            return { success: false, error: requestErrorMessage(error, "기본 발신프로필 변경 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.") };
        }
    };

    return {
        config: data?.data ?? null,
        isConfigured: !!data?.data?.appKey,
        isLoading,
        error,
        loadError: blockingError(data, error),
        mutate,
        saveConfig,
        testConnection,
        setDefaultSender,
    };
}
