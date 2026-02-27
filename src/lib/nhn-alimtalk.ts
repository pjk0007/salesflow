import { db, alimtalkConfigs } from "@/lib/db";
import { and, eq } from "drizzle-orm";

// ============================================
// NHN Cloud API 공통 타입
// ============================================

// NHN Cloud API 응답: header + 데이터 필드가 루트 레벨에 존재
// 예: { header: {...}, senders: [...], totalCount: 3 }
export interface NhnApiHeader {
    resultCode: number;
    resultMessage: string;
    isSuccessful: boolean;
}

export interface NhnSenderProfile {
    plusFriendId: string;
    senderKey: string;
    categoryCode: string;
    status: string;
    statusName: string;
    kakaoStatus: string;
    kakaoStatusName: string;
    kakaoProfileStatus: string;
    alimtalk: boolean;
    friendtalk: boolean;
    createDate: string;
}

export interface NhnSenderCategory {
    parentCode: string;
    depth: number;
    code: string;
    name: string;
    subCategories: NhnSenderCategory[];
}

export interface NhnTemplate {
    senderKey: string;
    templateCode: string;
    templateName: string;
    templateMessageType: string;
    templateEmphasizeType: string;
    templateContent: string;
    templateUrl: string;
    templateStatus: string;
    templateStatusName: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateItem?: {
        list: Array<{ title: string; description: string }>;
        summary?: { title: string; description: string };
    };
    templateItemHighlight?: {
        title: string;
        description: string;
        imageUrl?: string;
    };
    templateRepresentLink?: {
        linkMo?: string;
        linkPc?: string;
        schemeIos?: string;
        schemeAndroid?: string;
    };
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: NhnTemplateButton[];
    quickReplies?: NhnTemplateQuickReply[];
    comments?: Array<{
        id: string;
        content: string;
        userName: string;
        createdAt: string;
        status: string;
    }>;
    createDate: string;
    updateDate: string;
}

export interface NhnTemplateButton {
    ordering: number;
    type: string;
    name: string;
    linkMo?: string;
    linkPc?: string;
    schemeIos?: string;
    schemeAndroid?: string;
    bizFormId?: number;
    pluginId?: string;
    telNumber?: string;
}

export interface NhnTemplateQuickReply {
    ordering: number;
    type: string;
    name: string;
    linkMo?: string;
    linkPc?: string;
    schemeIos?: string;
    schemeAndroid?: string;
    bizFormId?: number;
}

export interface NhnSendRequest {
    senderKey: string;
    templateCode: string;
    recipientList: Array<{
        recipientNo: string;
        templateParameter?: Record<string, string>;
    }>;
    requestDate?: string;
}

export interface NhnSendResponse {
    requestId: string;
    statusCode: string;
    sendResults: Array<{
        recipientNo: string;
        resultCode: number;
        resultMessage: string;
        recipientSeq: number;
    }>;
}

export interface NhnMessageResult {
    requestId: string;
    recipientSeq: number;
    plusFriendId: string;
    senderKey: string;
    templateCode: string;
    recipientNo: string;
    content: string;
    requestDate: string;
    receiveDate: string;
    createDate: string;
    resultCode: string;
    resultCodeName: string;
    buttons?: NhnTemplateButton[];
}

export interface NhnRegisterTemplateRequest {
    templateCode: string;
    templateName: string;
    templateContent: string;
    templateMessageType?: string;
    templateEmphasizeType?: string;
    templateExtra?: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateItem?: {
        list: Array<{ title: string; description: string }>;
        summary?: { title: string; description: string };
    };
    templateItemHighlight?: {
        title: string;
        description: string;
        imageUrl?: string;
    };
    templateRepresentLink?: {
        linkMo?: string;
        linkPc?: string;
        schemeIos?: string;
        schemeAndroid?: string;
    };
    templateImageName?: string;
    templateImageUrl?: string;
    securityFlag?: boolean;
    categoryCode?: string;
    buttons?: NhnTemplateButton[];
    quickReplies?: NhnTemplateQuickReply[];
}

export type NhnUpdateTemplateRequest = Omit<NhnRegisterTemplateRequest, "templateCode">;

export interface NhnTemplateCategory {
    code: string;
    name: string;
    groupName: string;
    inclusion: string;
    exclusion: string;
}

export interface NhnTemplateCategoryGroup {
    name: string;
    subCategories: NhnTemplateCategory[];
}

// ============================================
// NHN Cloud 알림톡 API 클라이언트
// ============================================

export class NhnAlimtalkClient {
    private baseUrl = "https://api-alimtalk.cloud.toast.com";
    private appKey: string;
    private secretKey: string;

    constructor(appKey: string, secretKey: string) {
        this.appKey = appKey;
        this.secretKey = secretKey;
    }

    private async request(
        method: string,
        path: string,
        body?: unknown
    ): Promise<Record<string, unknown> & { header: NhnApiHeader }> {
        const url = `${this.baseUrl}${path.replace("{appkey}", this.appKey)}`;
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
            };
        }
        return res.json();
    }

    // --- 발신프로필 ---

    async getSenderCategories() {
        const result = await this.request(
            "GET",
            "/alimtalk/v2.0/appkeys/{appkey}/sender/categories"
        );
        return {
            header: result.header,
            categories: (result.categories ?? []) as NhnSenderCategory[],
        };
    }

    async listSenders(params?: { pageNum?: number; pageSize?: number }) {
        const qs = new URLSearchParams();
        if (params?.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
        const query = qs.toString() ? `?${qs.toString()}` : "";
        const result = await this.request(
            "GET",
            `/alimtalk/v2.0/appkeys/{appkey}/senders${query}`
        );
        return {
            header: result.header,
            senders: (result.senders ?? []) as NhnSenderProfile[],
            totalCount: (result.totalCount ?? 0) as number,
        };
    }

    async getSender(senderKey: string) {
        const result = await this.request(
            "GET",
            `/alimtalk/v2.0/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}`
        );
        return result as unknown as { header: NhnApiHeader } & NhnSenderProfile;
    }

    async registerSender(data: { plusFriendId: string; phoneNo: string; categoryCode: string }) {
        return this.request(
            "POST",
            "/alimtalk/v2.0/appkeys/{appkey}/senders",
            data
        );
    }

    async authenticateSenderToken(data: { plusFriendId: string; token: string }) {
        return this.request(
            "POST",
            "/alimtalk/v2.0/appkeys/{appkey}/sender/token",
            data
        );
    }

    async deleteSender(senderKey: string) {
        return this.request(
            "DELETE",
            `/alimtalk/v2.0/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}`
        );
    }

    // --- 템플릿 카테고리 ---

    async getTemplateCategories() {
        const result = await this.request(
            "GET",
            "/alimtalk/v2.3/appkeys/{appkey}/template/categories"
        );
        // NHN API는 2-depth: categories[].subCategories[] 구조
        const groups = (result.categories ?? []) as NhnTemplateCategoryGroup[];
        return { header: result.header, categories: groups };
    }

    // --- 템플릿 ---

    async listTemplates(senderKey: string) {
        const result = await this.request(
            "GET",
            `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates`
        );
        return {
            header: result.header,
            templates: (result.templates ?? []) as NhnTemplate[],
            totalCount: (result.totalCount ?? 0) as number,
        };
    }

    async getTemplate(senderKey: string, templateCode: string) {
        const result = await this.request(
            "GET",
            `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates/${encodeURIComponent(templateCode)}`
        );
        return {
            header: result.header,
            template: (result.template ?? null) as NhnTemplate | null,
        };
    }

    async registerTemplate(senderKey: string, data: NhnRegisterTemplateRequest) {
        const result = await this.request(
            "POST",
            `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates`,
            data
        );
        return { header: result.header };
    }

    async updateTemplate(senderKey: string, templateCode: string, data: NhnUpdateTemplateRequest) {
        const result = await this.request(
            "PUT",
            `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates/${encodeURIComponent(templateCode)}`,
            data
        );
        return { header: result.header };
    }

    async deleteTemplate(senderKey: string, templateCode: string) {
        const result = await this.request(
            "DELETE",
            `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates/${encodeURIComponent(templateCode)}`
        );
        return { header: result.header };
    }

    async commentTemplate(senderKey: string, templateCode: string, comment: string) {
        const result = await this.request(
            "POST",
            `/alimtalk/v2.3/appkeys/{appkey}/senders/${encodeURIComponent(senderKey)}/templates/${encodeURIComponent(templateCode)}/comments`,
            { comment }
        );
        return { header: result.header };
    }

    // --- 발송 ---

    async sendMessages(data: NhnSendRequest) {
        const result = await this.request(
            "POST",
            "/alimtalk/v2.3/appkeys/{appkey}/messages",
            data
        );
        return {
            header: result.header,
            message: result.message as NhnSendResponse | undefined,
        };
    }

    async cancelMessage(requestId: string) {
        return this.request(
            "DELETE",
            `/alimtalk/v2.3/appkeys/{appkey}/messages/${encodeURIComponent(requestId)}`
        );
    }

    // --- 조회 ---

    async listMessages(params: {
        requestId?: string;
        startRequestDate?: string;
        endRequestDate?: string;
        pageNum?: number;
        pageSize?: number;
    }) {
        const qs = new URLSearchParams();
        if (params.requestId) qs.set("requestId", params.requestId);
        if (params.startRequestDate) qs.set("startRequestDate", params.startRequestDate);
        if (params.endRequestDate) qs.set("endRequestDate", params.endRequestDate);
        if (params.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params.pageSize) qs.set("pageSize", String(params.pageSize));
        const result = await this.request(
            "GET",
            `/alimtalk/v2.3/appkeys/{appkey}/messages?${qs.toString()}`
        );
        return {
            header: result.header,
            messages: (result.messages ?? []) as NhnMessageResult[],
            totalCount: (result.totalCount ?? 0) as number,
        };
    }

    async getMessage(requestId: string, recipientSeq: number) {
        const result = await this.request(
            "GET",
            `/alimtalk/v2.3/appkeys/{appkey}/messages/${encodeURIComponent(requestId)}/${recipientSeq}`
        );
        return {
            header: result.header,
            message: (result.message ?? null) as NhnMessageResult | null,
        };
    }

    async getMessageResults(params: {
        startUpdateDate: string;
        endUpdateDate: string;
        pageNum?: number;
        pageSize?: number;
    }) {
        const qs = new URLSearchParams();
        qs.set("startUpdateDate", params.startUpdateDate);
        qs.set("endUpdateDate", params.endUpdateDate);
        if (params.pageNum) qs.set("pageNum", String(params.pageNum));
        if (params.pageSize) qs.set("pageSize", String(params.pageSize));
        const result = await this.request(
            "GET",
            `/alimtalk/v2.3/appkeys/{appkey}/message-results?${qs.toString()}`
        );
        return {
            header: result.header,
            messageResults: (result.messageResults ?? []) as Array<{
                requestId: string;
                recipientSeq: number;
                resultCode: string;
                resultCodeName: string;
                receiveDate: string;
            }>,
        };
    }
}

// ============================================
// 헬퍼 함수
// ============================================

export async function getAlimtalkClient(orgId: string): Promise<NhnAlimtalkClient | null> {
    const [config] = await db
        .select()
        .from(alimtalkConfigs)
        .where(and(eq(alimtalkConfigs.orgId, orgId), eq(alimtalkConfigs.isActive, 1)))
        .limit(1);

    if (!config) return null;
    return new NhnAlimtalkClient(config.appKey, config.secretKey);
}

export function normalizePhoneNumber(phone: string): string {
    return phone.replace(/[^0-9]/g, "");
}

export function extractTemplateVariables(content: string): string[] {
    const matches = content.match(/#\{([^}]+)\}/g);
    if (!matches) return [];
    return [...new Set(matches)];
}
