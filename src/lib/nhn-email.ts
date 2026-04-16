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
    isOpened?: boolean;
    openedDate?: string;
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

    // --- 기간 기반 발송 조회 (페이징 + totalCount) ---

    async queryMailsPaged(params: {
        startSendDate: string;
        endSendDate: string;
        pageNum: number;
        pageSize: number;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: NhnEmailQueryResult[] | null;
        totalCount: number;
    }> {
        const qs = new URLSearchParams();
        qs.set("startSendDate", params.startSendDate);
        qs.set("endSendDate", params.endSendDate);
        qs.set("pageNum", String(params.pageNum));
        qs.set("pageSize", String(params.pageSize));
        const url = `${this.baseUrl}/email/v2.1/appKeys/${this.appKey}/sender/mails?${qs.toString()}`;
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-Secret-Key": this.secretKey,
            },
        });
        if (!res.ok) {
            return {
                header: { resultCode: res.status, resultMessage: `HTTP ${res.status}`, isSuccessful: false },
                data: null,
                totalCount: 0,
            };
        }
        const json = await res.json();
        return {
            header: json.header,
            data: json.body?.data ?? null,
            totalCount: json.body?.totalCount ?? 0,
        };
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

// ============================================
// 이메일 서명
// ============================================

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

interface SignatureData {
    name?: string;
    title?: string;
    company?: string;
    phone?: string;
    email?: string;
    websites?: string[];
    extra?: string;
}

function renderSignatureHtml(data: SignatureData): string {
    const lines: string[] = [];

    // 이름 + 직책
    if (data.name || data.title) {
        const parts: string[] = [];
        if (data.name) parts.push(`<b>${escapeHtml(data.name)}</b>`);
        if (data.title) parts.push(escapeHtml(data.title));
        lines.push(parts.join(" | "));
    }

    if (data.company) lines.push(escapeHtml(data.company));
    if (data.phone) lines.push(`Tel: ${escapeHtml(data.phone)}`);
    if (data.email) lines.push(`Email: <a href="mailto:${escapeHtml(data.email)}" style="color:#0066cc; text-decoration:none;">${escapeHtml(data.email)}</a>`);
    if (data.websites?.length) {
        for (const url of data.websites) {
            if (url.trim()) lines.push(`<a href="${escapeHtml(url)}" style="color:#0066cc; text-decoration:none;">${escapeHtml(url)}</a>`);
        }
    }
    if (data.extra) lines.push(escapeHtml(data.extra));

    return lines.join("<br>");
}

export function appendSignature(htmlBody: string, signature: string): string {
    let sigContent: string;

    try {
        const parsed = JSON.parse(signature);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            sigContent = renderSignatureHtml(parsed as SignatureData);
        } else {
            sigContent = escapeHtml(signature);
        }
    } catch {
        // legacy plain text
        sigContent = `<span style="white-space:pre-line;">${escapeHtml(signature)}</span>`;
    }

    const sigHtml = `<div style="margin-top:24px; padding-top:16px; border-top:1px solid #e5e5e5; font-size:13px; color:#666; line-height:1.6;">${sigContent}</div>`;

    if (htmlBody.includes("</body>")) {
        return htmlBody.replace("</body>", sigHtml + "</body>");
    }
    return htmlBody + sigHtml;
}
