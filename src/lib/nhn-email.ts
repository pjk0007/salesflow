import { db, emailConfigs } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { createDroppedHeaderWarner, withSafeCustomHeaders } from "@/lib/nhn-email-headers";

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
    /**
     * 사용자 지정 헤더. List-Unsubscribe 등 (NHN Cloud Email API 지원).
     * NHN이 막는 이름(Reply-To·From 등)이나 형식이 틀린 헤더는 sendEachMail이 빼고 보낸다 (nhn-email-headers.ts) —
     * 하나라도 섞이면 NHN이 메일 전체를 거절하기 때문이다.
     */
    customHeaders?: Record<string, string>;
}

/** 뺀 헤더 경고는 (이름, 까닭)마다 프로세스에서 한 번만 (nhn-email-headers.ts) */
const warnDroppedHeaders = createDroppedHeaderWarner((message) => console.warn(message));

export interface NhnEmailSendResult {
    requestId: string;
    results: Array<{
        receiveMailAddr: string;
        resultCode: number;
        resultMessage: string;
    }>;
}

/**
 * "메일 발송 리스트 조회"(GET /sender/mails) 한 줄. NHN 문서의 칸은 dsnCode·dsnMessage다 —
 * 예전 코드가 읽던 resultCode·resultCodeName은 문서에 없어 선택 칸으로만 남긴다 (DESIGN-SND F3).
 */
export interface NhnEmailQueryResult {
    requestId: string;
    mailSeq?: number;
    mailStatusCode: string;
    mailStatusName: string;
    /** @deprecated 문서에 없는 칸. dsnCode·dsnMessage를 쓴다 */
    resultCode?: string;
    /** @deprecated 문서에 없는 칸. dsnCode·dsnMessage를 쓴다 */
    resultCodeName?: string;
    receiveMailAddr: string;
    senderAddress?: string;
    title: string;
    requestDate: string;
    resultDate: string;
    isOpened?: boolean;
    openedDate?: string;
    dsnCode?: string | null;
    dsnMessage?: string | null;
    mailStatusUpdatedDate?: string | null;
}

/**
 * "메일 발송 업데이트 완료 목록 조회"(GET /sender/update-mails) 한 줄. 받는 주소는 없다 — 샌드비 발송은 1통 1요청이라
 * 요청 번호로 짝짓는다 (DESIGN-SND F4·3-2). SST2는 "수신 완료 시간" 기준으로 잡힌다 (NHN 문서 주의).
 */
export interface NhnUpdatedMail {
    requestId: string;
    mailSeq?: number;
    mailStatusCode: string;
    mailStatusName?: string;
    requestDate?: string;
    resultDate?: string | null;
    mailStatusUpdatedDate?: string | null;
    dsnCode?: string | null;
    dsnMessage?: string | null;
}

/**
 * NHN Cloud Email API의 날짜 문자열을 Date로 파싱한다.
 * sentMail list 응답의 resultDate/openedDate는 타임존 정보 없는 KST 문자열
 * (예: "2026-05-18 18:59:00") 이므로, +09:00을 명시해 UTC로 정확히 변환한다.
 * 순수 시험이 DB 없이 읽도록 본문은 email-status-sync-rules.ts에 있다 (DESIGN-SND 3-1).
 */
export { parseNhnDate } from "@/lib/email-status-sync-rules";

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
            withSafeCustomHeaders(data, warnDroppedHeaders)
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

    // --- 발송 상태 업데이트 조회 (DESIGN-SND 3-2 커서의 본 장치) ---

    /**
     * 상태 코드가 바뀐 메일 목록. 쿼리 이름은 문서대로 startMailStatusUpdateDate·endMailStatusUpdateDate (KST "yyyy-MM-dd HH:mm:ss").
     * 쪽 끝까지 읽어야 커서를 옮기므로 totalCount를 함께 돌려준다. HTTP 오류면 header.resultCode에 HTTP 상태를 담는다.
     */
    async queryUpdatedMails(params: {
        startMailStatusUpdateDate: string;
        endMailStatusUpdateDate: string;
        pageNum?: number;
        pageSize?: number;
    }): Promise<{
        header: NhnEmailApiHeader;
        data: NhnUpdatedMail[] | null;
        totalCount: number;
        httpStatus: number;
    }> {
        const qs = new URLSearchParams();
        qs.set("startMailStatusUpdateDate", params.startMailStatusUpdateDate);
        qs.set("endMailStatusUpdateDate", params.endMailStatusUpdateDate);
        if (params.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params.pageSize) qs.set("pageSize", String(params.pageSize));
        const url = `${this.baseUrl}/email/v2.1/appKeys/${this.appKey}/sender/update-mails?${qs.toString()}`;
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-Secret-Key": this.secretKey,
            },
        });
        if (!res.ok) {
            // 본문을 읽어 연결을 돌려준다 (내용은 쓰지 않는다 — 키·주소가 섞일 수 있다)
            await res.text().catch(() => "");
            return {
                header: { resultCode: res.status, resultMessage: `HTTP ${res.status}`, isSuccessful: false },
                data: null,
                totalCount: 0,
                httpStatus: res.status,
            };
        }
        const json = await res.json();
        return {
            header: json.header,
            data: Array.isArray(json.body?.data) ? json.body.data : null,
            totalCount: Number(json.body?.totalCount ?? 0) || 0,
            httpStatus: res.status,
        };
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
