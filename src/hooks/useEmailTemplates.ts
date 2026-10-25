import useSWR, { useSWRConfig } from "swr";
import type { EmailTemplate } from "@/lib/db";
import { blockingError, defaultFetcher } from "@/lib/swr-fetcher";

interface TemplatesResponse {
    success: boolean;
    data?: EmailTemplate[];
    totalCount?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
}

export interface EmailTemplateQuery {
    page?: number;
    pageSize?: number;
    /** 이름·제목 검색 */
    q?: string;
    /** 카테고리 id 또는 "none"(미분류) */
    categoryId?: number | "none";
    status?: "draft" | "published";
    /** 특정 템플릿만(선택칸에 이미 고른 값 표시용) */
    ids?: number[];
}

/** 선택칸이 한 번에 받는 최대 건수(서버 상한). 넘으면 검색으로 좁힌다 */
export const TEMPLATE_OPTION_LIMIT = 100;

const TEMPLATES_KEY = "/api/email/templates";

export function emailTemplatesKey(query: EmailTemplateQuery = {}) {
    const params = new URLSearchParams();
    if (query.page && query.page > 1) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    if (query.q?.trim()) params.set("q", query.q.trim());
    if (query.categoryId !== undefined) params.set("categoryId", String(query.categoryId));
    if (query.status) params.set("status", query.status);
    if (query.ids) params.set("ids", query.ids.join(","));
    const qs = params.toString();
    return qs ? `${TEMPLATES_KEY}?${qs}` : TEMPLATES_KEY;
}

/** 연결이 쓰는 템플릿 id 전부(본 템플릿 + 후속 단계 템플릿) — 선택지에 반드시 보이게 한다 */
export function linkTemplateIds(emailTemplateId: number | null, followupConfig: unknown): number[] {
    const steps = Array.isArray(followupConfig) ? followupConfig : followupConfig ? [followupConfig] : [];
    const ids = [emailTemplateId];
    for (const step of steps as { onClicked?: { templateId?: number }; onNotClicked?: { templateId?: number } }[]) {
        ids.push(step?.onClicked?.templateId ?? null, step?.onNotClicked?.templateId ?? null);
    }
    return ids.filter((id): id is number => typeof id === "number" && id > 0);
}

/** 템플릿 단건 (조직 확인 포함 GET /api/email/templates/[id]) — 목록 페이지 밖 템플릿도 편집할 수 있다 */
export function useEmailTemplate(id: number | null) {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data?: EmailTemplate }>(
        id ? `${TEMPLATES_KEY}/${id}` : null,
        defaultFetcher
    );
    return {
        template: data?.data ?? null,
        isLoading,
        error,
        loadError: blockingError(data, error),
        mutate,
    };
}

/**
 * 연결 화면 선택지: 발행 템플릿을 검색어로 최대 100건 + 이미 고른 템플릿(목록 밖·초안이어도)을 합친다.
 * truncated면 화면이 "검색으로 좁혀 주세요"를 안내한다.
 */
export function useEmailTemplateOptions(q: string, selectedIds: (number | null | undefined)[]) {
    const { data, error, isLoading } = useSWR<TemplatesResponse>(
        emailTemplatesKey({ status: "published", pageSize: TEMPLATE_OPTION_LIMIT, q }),
        defaultFetcher
    );
    const listed = data?.data ?? [];
    const missing = [...new Set(selectedIds.filter((id): id is number => !!id))]
        .filter((id) => !listed.some((t) => t.id === id))
        .sort((a, b) => a - b);
    const { data: selectedData } = useSWR<TemplatesResponse>(
        data && missing.length > 0 ? emailTemplatesKey({ ids: missing, pageSize: TEMPLATE_OPTION_LIMIT }) : null,
        defaultFetcher
    );
    const extra = (selectedData?.data ?? []).filter((t) => !listed.some((l) => l.id === t.id));
    const total = data?.totalCount ?? 0;
    return {
        templates: [...extra, ...listed],
        total,
        truncated: total > listed.length,
        isLoading,
        error,
        loadError: blockingError(data, error),
    };
}

export function useEmailTemplates(query: EmailTemplateQuery = {}) {
    const { mutate: mutateGlobal } = useSWRConfig();
    const { data, error, isLoading, mutate } = useSWR<TemplatesResponse>(
        emailTemplatesKey(query),
        defaultFetcher,
        { keepPreviousData: true }
    );
    // 목록·검색·선택지·단건 키를 모두 다시 읽는다
    const refreshAll = () => mutateGlobal((key) => typeof key === "string" && key.startsWith(TEMPLATES_KEY));

    const createTemplate = async (templateData: {
        name: string;
        subject: string;
        htmlBody: string;
        templateType?: string;
        status?: "draft" | "published";
        categoryId?: number | null;
    }) => {
        const res = await fetch("/api/email/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(templateData),
        });
        const result = await res.json();
        if (result.success) void refreshAll();
        return result;
    };

    const updateTemplate = async (
        id: number,
        templateData: {
            name?: string;
            subject?: string;
            htmlBody?: string;
            templateType?: string;
            isActive?: number;
            status?: "draft" | "published";
            categoryId?: number | null;
        }
    ) => {
        const res = await fetch(`/api/email/templates/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(templateData),
        });
        const result = await res.json();
        if (result.success) void refreshAll();
        return result;
    };

    const deleteTemplate = async (id: number) => {
        const res = await fetch(`/api/email/templates/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) void refreshAll();
        return result;
    };

    return {
        templates: data?.data ?? [],
        totalCount: data?.totalCount ?? 0,
        page: data?.page ?? 1,
        totalPages: data?.totalPages ?? 0,
        isLoading,
        error,
        loadError: blockingError(data, error),
        mutate,
        createTemplate,
        updateTemplate,
        deleteTemplate,
    };
}
