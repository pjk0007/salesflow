import useSWR from "swr";
import { blockingError, defaultFetcher } from "@/lib/swr-fetcher";


export interface AutoPersonalizedLink {
    id: number;
    orgId: string;
    name: string | null;
    partitionId: number;
    productId: number | null;
    productName: string | null;
    recipientField: string;
    companyField: string;
    ctaUrl: string | null;
    prompt: string | null;
    tone: string | null;
    model: string | null;
    format: string;
    triggerType: string;
    triggerCondition: {
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    } | null;
    autoResearch: number;
    useSignaturePersona: number;
    useUnsubscribe: number;
    preventDuplicate: number;
    followupConfig: {
        delayDays: number;
        onClicked?: { prompt: string };
        onNotClicked?: { prompt: string };
    } | null;
    senderProfileId: number | null;
    /** 발신 주소 묶음 (순서 있음). null이면 senderProfileId 하나 (묶음 칸이 생기기 전 규칙) */
    senderProfileIds: number[] | null;
    signatureId: number | null;
    assetIds: number[] | null;
    isActive: number;
    isDraft?: number;
    createdAt: string;
    updatedAt: string;
}

interface CreateInput {
    name?: string;
    partitionId: number;
    productId?: number | null;
    // draft 상태에서는 비어있을 수 있음
    recipientField: string;
    companyField: string;
    ctaUrl?: string;
    prompt?: string;
    tone?: string;
    model?: string;
    format?: string;
    triggerType: "on_create" | "on_update";
    triggerCondition?: { field: string; operator: string; value: string } | null;
    autoResearch?: number;
    useSignaturePersona?: number;
    useUnsubscribe?: number;
    followupConfig?: {
        delayDays: number;
        onClicked?: { prompt: string };
        onNotClicked?: { prompt: string };
    } | null;
    isActive?: number;
    isDraft?: number;
    preventDuplicate?: number;
    senderProfileId?: number | null;
    /** 보내면 서버가 senderProfileId를 첫 원소로 맞춘다. 빈 배열 = 기본 발신 프로필 */
    senderProfileIds?: number[] | null;
    signatureId?: number | null;
    assetIds?: number[];
}

interface UpdateInput {
    name?: string;
    partitionId?: number;
    productId?: number | null;
    recipientField?: string;
    companyField?: string;
    ctaUrl?: string;
    prompt?: string;
    tone?: string;
    /** null = 모델 미지정(기본 모델) */
    model?: string | null;
    format?: string;
    triggerType?: string;
    triggerCondition?: { field: string; operator: string; value: string } | null;
    autoResearch?: number;
    useSignaturePersona?: number;
    useUnsubscribe?: number;
    followupConfig?: {
        delayDays: number;
        onClicked?: { prompt: string };
        onNotClicked?: { prompt: string };
    } | null;
    isActive?: number;
    isDraft?: number;
    preventDuplicate?: number;
    senderProfileId?: number | null;
    /** 보내면 서버가 senderProfileId를 첫 원소로 맞춘다. 빈 배열 = 기본 발신 프로필 */
    senderProfileIds?: number[] | null;
    signatureId?: number | null;
    assetIds?: number[];
    /** 진행 중 문구 실험이 무효화되는 변경임을 사용자가 확인했다 (없으면 서버가 409 experiment_impact로 멈춘다) */
    confirmExperimentImpact?: boolean;
}

/** 규칙 저장이 바꾸게 될 진행 중 문구 실험 (PUT 409 code=experiment_impact) */
export interface ImpactedExperiment {
    id: number;
    name: string;
    state: string;
}

export function useAutoPersonalizedEmail(partitionId: number | null | "all") {
    const { data, error, isLoading, mutate } = useSWR(
        partitionId === "all"
            ? "/api/email/auto-personalized"
            : partitionId
                ? `/api/email/auto-personalized?partitionId=${partitionId}`
                : null,
        defaultFetcher
    );

    const createLink = async (input: CreateInput) => {
        const res = await fetch("/api/email/auto-personalized", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateLink = async (id: number, input: UpdateInput) => {
        const res = await fetch(`/api/email/auto-personalized/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteLink = async (id: number) => {
        const res = await fetch(`/api/email/auto-personalized/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        links: (data?.data ?? []) as AutoPersonalizedLink[],
        isLoading,
        mutate,
        error,
        loadError: blockingError(data, error),
        createLink,
        updateLink,
        deleteLink,
    };
}
