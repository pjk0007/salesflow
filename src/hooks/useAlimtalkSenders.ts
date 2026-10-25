import useSWR from "swr";
import { useAlimtalkConfig } from "./useAlimtalkConfig";
import type { NhnSenderProfile } from "@/lib/nhn-alimtalk";
import { apiRequest, blockingError, defaultFetcher, requestErrorMessage } from "@/lib/swr-fetcher";

interface SendersResponse {
    success: boolean;
    data?: {
        senders: NhnSenderProfile[];
        totalCount: number;
    };
}


export function useAlimtalkSenders() {
    const { isConfigured } = useAlimtalkConfig();

    const { data, error, isLoading, mutate } = useSWR<SendersResponse>(
        isConfigured ? "/api/alimtalk/senders" : null,
        defaultFetcher
    );

    // 변경 요청은 연결 끊김도 success:false로 돌려 호출부의 처리 중 상태가 풀리게 한다(UX-180)
    const send = async (url: string, init: RequestInit, fallback: string): Promise<{ success: boolean; message?: string; error?: string }> => {
        try {
            const result = await apiRequest<{ success: boolean; message?: string }>(url, init);
            mutate();
            return result;
        } catch (error) {
            return { success: false, error: requestErrorMessage(error, fallback) };
        }
    };

    const registerSender = (senderData: {
        plusFriendId: string;
        phoneNo: string;
        categoryCode: string;
    }) => send("/api/alimtalk/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(senderData),
    }, "등록 요청 결과를 확인하지 못했습니다. 카카오톡으로 인증번호가 왔다면 목록의 '인증번호 입력'으로 이어가주세요.");

    const authenticateToken = (data: {
        plusFriendId: string;
        token: string;
    }) => send("/api/alimtalk/senders/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    }, "인증 결과를 확인하지 못했습니다. 목록에서 상태를 확인한 뒤 다시 시도해주세요.");

    const deleteSender = (senderKey: string) => send(`/api/alimtalk/senders/${encodeURIComponent(senderKey)}`, {
        method: "DELETE",
    }, "삭제 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해주세요.");

    return {
        senders: data?.data?.senders ?? [],
        totalCount: data?.data?.totalCount ?? 0,
        isLoading,
        error,
        loadError: blockingError(data, error),
        mutate,
        registerSender,
        authenticateToken,
        deleteSender,
    };
}
