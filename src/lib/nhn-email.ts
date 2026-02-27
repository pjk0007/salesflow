import { db, emailConfigs } from "@/lib/db";
import { and, eq } from "drizzle-orm";

// ============================================
// NHN Cloud Email API 타입
// ============================================

export interface NhnEmailApiHeader {
    resultCode: number;
    resultMessage: string;
    isSuccessful: boolean;
}

export interface NhnEmailSendRequest {
    senderAddress: string;
    senderName?: string;
    title: string;
    body: string;
    receiverList: Array<{
        receiveMailAddr: string;
        receiveType: "MRT0";
    }>;
}

export interface NhnEmailSendResult {
    requestId: string;
    results: Array<{
        receiveMailAddr: string;
        resultCode: number;
        resultMessage: string;
    }>;
}

export interface NhnEmailQueryResult {
    requestId: string;
    mailStatusCode: string;
    mailStatusName: string;
    resultCode: string;
    resultCodeName: string;
    receiveMailAddr: string;
    title: string;
    requestDate: string;
    resultDate: string;
}

// ============================================
// NHN Cloud Email API 클라이언트
// ============================================

export class NhnEmailClient {
    private baseUrl = "https://email.api.nhncloudservice.com";
    private appKey: string;
    private secretKey: string;

    constructor(appKey: string, secretKey: string) {
        this.appKey = appKey;
        this.secretKey = secretKey;
    }

    private async request<T = unknown>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<{ header: NhnEmailApiHeader; data: T | null }> {
        const url = `${this.baseUrl}${path.replace("{appKey}", this.appKey)}`;
        const res = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-Secret-Key": this.secretKey,
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            return {
                header: {
                    resultCode: res.status,
                    resultMessage: `HTTP ${res.status}: ${res.statusText}`,
                    isSuccessful: false,
                },
                data: null,
            };
        }
        const json = await res.json();
        // NHN Email API: { header, body: { data } }
        return {
            header: json.header,
            data: json.body?.data ?? null,
        };
    }

    // --- 개별 발송 ---

    async sendEachMail(data: NhnEmailSendRequest): Promise<{
        header: NhnEmailApiHeader;
        data: NhnEmailSendResult | null;
    }> {
        return this.request<NhnEmailSendResult>(
            "POST",
            "/email/v2.1/appKeys/{appKey}/sender/eachMail",
            data
        );
    }

    // --- 발송 조회 ---

    async queryMails(params: {
        requestId?: string;
        startSendDate?: string;
        endSendDate?: string;
        pageNum?: number;
        pageSize?: number;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: NhnEmailQueryResult[] | null;
    }> {
        const qs = new URLSearchParams();
        if (params.requestId) qs.set("requestId", params.requestId);
        if (params.startSendDate) qs.set("startSendDate", params.startSendDate);
        if (params.endSendDate) qs.set("endSendDate", params.endSendDate);
        if (params.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params.pageSize) qs.set("pageSize", String(params.pageSize));
        return this.request<NhnEmailQueryResult[]>(
            "GET",
            `/email/v2.1/appKeys/{appKey}/sender/mails?${qs.toString()}`
        );
    }

    // --- 카테고리 CRUD ---

    async listCategories(): Promise<{
        header: NhnEmailApiHeader;
        data: Array<{
            categoryId: number;
            categoryParentId: number;
            depth: number;
            categoryName: string;
            categoryDesc: string;
            useYn: string;
            createDate: string;
            updateDate: string;
        }> | null;
    }> {
        return this.request(
            "GET",
            "/email/v2.1/appKeys/{appKey}/categories?useYn=Y&pageSize=100"
        );
    }

    async createCategory(data: {
        categoryName: string;
        categoryDesc?: string;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: { categoryId: number } | null;
    }> {
        return this.request(
            "POST",
            "/email/v2.1/appKeys/{appKey}/categories",
            { ...data, useYn: "Y" }
        );
    }

    async updateCategory(categoryId: number, data: {
        categoryName?: string;
        categoryDesc?: string;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: null;
    }> {
        return this.request(
            "PUT",
            `/email/v2.1/appKeys/{appKey}/categories/${categoryId}`,
            data
        );
    }

    async deleteCategory(categoryId: number): Promise<{
        header: NhnEmailApiHeader;
        data: null;
    }> {
        return this.request(
            "DELETE",
            `/email/v2.1/appKeys/{appKey}/categories/${categoryId}`
        );
    }

    // --- 발송 상태 업데이트 조회 ---

    async queryUpdatedMails(params: {
        startUpdateDate: string;
        endUpdateDate: string;
        pageNum?: number;
        pageSize?: number;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: NhnEmailQueryResult[] | null;
    }> {
        const qs = new URLSearchParams();
        qs.set("startUpdateDate", params.startUpdateDate);
        qs.set("endUpdateDate", params.endUpdateDate);
        if (params.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params.pageSize) qs.set("pageSize", String(params.pageSize));
        return this.request<NhnEmailQueryResult[]>(
            "GET",
            `/email/v2.1/appKeys/{appKey}/sender/update-mails?${qs.toString()}`
        );
    }
}

// ============================================
// 헬퍼 함수
// ============================================

export async function getEmailClient(orgId: string): Promise<NhnEmailClient | null> {
    const [config] = await db
        .select()
        .from(emailConfigs)
        .where(and(eq(emailConfigs.orgId, orgId), eq(emailConfigs.isActive, 1)))
        .limit(1);

    if (!config) return null;
    return new NhnEmailClient(config.appKey, config.secretKey);
}

export async function getEmailConfig(orgId: string) {
    const [config] = await db
        .select()
        .from(emailConfigs)
        .where(and(eq(emailConfigs.orgId, orgId), eq(emailConfigs.isActive, 1)))
        .limit(1);
    return config ?? null;
}

export { extractEmailVariables, substituteVariables } from "./email-utils";
