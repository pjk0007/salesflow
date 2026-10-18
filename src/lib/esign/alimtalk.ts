import templates from "./alimtalk-templates.json";
import { EsignError, type DeliveryOutcome, type DeliveryPayload, type EsignJob } from "./types";

export type EsignAlimtalkKind = "invitation" | "otp" | "completed";
export type EsignAlimtalkStatus = {
    ready: boolean; channelName?: string; reason?: string;
    templates: { kind: string; code: string; label: string; state: string }[];
};
export type EsignAlimtalkConfig = { appKey: string; secretKey: string; senderKey: string };
type ProviderTemplate = { templateCode?: string; templateContent?: string; templateMessageType?: string; templateEmphasizeType?: string; securityFlag?: boolean; buttons?: { type: string; name: string; ordering: number; linkMo?: string; linkPc?: string }[]; status?: string; block?: boolean; dormant?: boolean };
const BASE = "https://kakaotalk-bizmessage.api.nhncloudservice.com";
const labels = { invitation: "서명 요청", otp: "인증 코드", completed: "완료 알림" };
const states: Record<string, string> = { TSC01: "심사 요청", TSC02: "심사 중", TSC03: "승인", TSC04: "반려" };
function usable(template: ProviderTemplate, expected: typeof templates[number]) {
    return template.status === "TSC03" && !template.block && !template.dormant
        && template.templateCode === expected.templateCode && template.templateContent === expected.templateContent
        && template.templateMessageType === expected.templateMessageType && template.templateEmphasizeType === expected.templateEmphasizeType
        && template.securityFlag === expected.securityFlag && (template.buttons ?? []).length === expected.buttons.length
        && expected.buttons.every(button => (template.buttons ?? []).some(actual => actual.ordering === button.ordering && actual.type === button.type && actual.name === button.name && actual.linkMo === button.linkMo && actual.linkPc === button.linkPc));
}
/** Uses the existing org account. A separate e-sign opt-in never changes old automations. */
export function createEsignAlimtalk(options: { enabled: boolean; config(orgId: string): Promise<EsignAlimtalkConfig | null>; publicOrigin: string; fetcher?: typeof fetch; timeoutMs?: number }) {
    const fetcher = options.fetcher ?? fetch, timeoutMs = options.timeoutMs ?? 10_000;
    async function get(config: EsignAlimtalkConfig, path: string) {
        const response = await fetcher(`${BASE}/alimtalk/${path.replace("{appkey}", encodeURIComponent(config.appKey)).replace("{senderKey}", encodeURIComponent(config.senderKey))}`, {
            method: "GET", redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { "X-Secret-Key": config.secretKey },
        });
        if (!response.ok) throw new Error("provider_status_unavailable");
        const data = await response.json();
        if (!data.header?.isSuccessful) throw new Error("provider_status_unavailable");
        return data;
    }
    async function inspect(config: EsignAlimtalkConfig, kinds: string[]) {
        const senderData = await get(config, "v2.0/appkeys/{appkey}/senders/{senderKey}");
        const sender = senderData.sender ?? senderData;
        const senderReady = sender.status === "YSC03" && sender.kakaoStatus === "A" && sender.kakaoProfileStatus === "A" && Boolean(sender.alimtalk);
        const results = await Promise.all(templates.filter(t => kinds.includes(t.kind)).map(async expected => {
            const data = await get(config, `v2.3/appkeys/{appkey}/senders/{senderKey}/templates/${expected.templateCode}`);
            const template: ProviderTemplate = data.templates ?? data.template ?? {};
            const ready = usable(template, expected);
            return { ready, kind: expected.kind, code: expected.templateCode, label: labels[expected.kind as EsignAlimtalkKind], state: template.block ? "차단" : template.dormant ? "휴면" : template.status === "TSC03" && !ready ? "내용 확인 필요" : states[template.status ?? ""] ?? "미등록/확인 필요" };
        }));
        return { senderReady, channelName: String(sender.plusFriendId ?? ""), results };
    }
    return {
        async status(orgId: string): Promise<EsignAlimtalkStatus> {
            if (!options.enabled) return { ready: false, reason: "전자서명 알림톡 연결이 꺼져 있습니다.", templates: [] };
            try {
                const config = await options.config(orgId);
                if (!config?.appKey || !config.secretKey || !config.senderKey) return { ready: false, reason: "기존 알림톡 계정과 기본 발신 채널을 설정해주세요.", templates: [] };
                const { senderReady, channelName, results } = await inspect(config, templates.map(t => t.kind));
                const ready = senderReady && results.length === 3 && results.every(t => t.ready);
                return { ready, channelName, templates: results.map(({ kind, code, label, state }) => ({ kind, code, label, state })), ...(!ready ? { reason: senderReady ? "전자서명 템플릿 3종 승인 후 알림톡을 사용할 수 있습니다." : "카카오 발신 채널 상태를 확인해주세요." } : {}) };
            } catch { return { ready: false, reason: "알림톡 템플릿 승인 상태를 확인하지 못했습니다. 잠시 후 새로고침해주세요.", templates: [] }; }
        },
        async send(job: EsignJob, orgId: string, payload: DeliveryPayload): Promise<DeliveryOutcome> {
            if (!options.enabled) return { state: "failed", error: "전자서명 알림톡 연결이 꺼져 있습니다." };
            const expected = templates.find(t => t.kind === job.kind);
            if (!expected || !/^01[016789]\d{7,8}$/.test(payload.phone ?? "")) return { state: "failed", error: "알림톡 수신자와 요청 종류를 확인해주세요." };
            // Validate before the POST. Failed status lookups have not sent a message.
            let config: EsignAlimtalkConfig | null, parameters: Record<string, string>;
            try {
                config = await options.config(orgId);
                if (!config) throw new Error("missing_config");
                const inspected = await inspect(config, [job.kind]);
                if (!inspected.senderReady || !inspected.results[0]?.ready) return { state: "failed", error: "알림톡 템플릿이 승인되지 않았거나 발신 채널을 사용할 수 없습니다." };
                parameters = esignAlimtalkParameters(job, payload, options.publicOrigin);
            } catch { return { state: "failed", error: "알림톡 설정과 템플릿 승인 상태를 확인해주세요. 발송하지 않았습니다." }; }
            try {
                const response = await fetcher(`${BASE}/alimtalk/v2.3/appkeys/${encodeURIComponent(config.appKey)}/${job.kind === "otp" ? "auth/" : ""}messages`, {
                    method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
                    headers: { "Content-Type": "application/json;charset=UTF-8", "X-Secret-Key": config.secretKey, "X-NC-API-IDEMPOTENCY-KEY": job.id },
                    body: JSON.stringify({ senderKey: config.senderKey, templateCode: expected.templateCode, senderGroupingKey: job.id, recipientList: [{ recipientNo: payload.phone, templateParameter: parameters, resendParameter: { isResend: false } }] }),
                });
                if (!response.ok) return { state: response.status >= 500 || response.status === 408 ? "unknown" : "failed", error: "알림톡 접수 결과를 확인해주세요." };
                const data = await response.json();
                if (data.header?.isSuccessful !== true) return { state: data.header?.isSuccessful === false ? "failed" : "unknown", error: "알림톡 요청 접수 결과를 확인해주세요." };
                const message = data.message, results = message?.sendResults;
                if (message?.requestId && Array.isArray(results) && results.length === 1 && results[0].recipientNo === payload.phone && results[0].resultCode === 0)
                    return { state: "accepted", providerId: message.requestId };
                if (Array.isArray(results) && results.length === 1 && results[0].recipientNo === payload.phone && typeof results[0].resultCode === "number" && results[0].resultCode !== 0)
                    return { state: "failed", error: "알림톡 수신자 요청이 접수되지 않았습니다." };
                return { state: "unknown", error: "알림톡 수신자별 접수 결과를 확인해주세요." };
            } catch { return { state: "unknown", error: "알림톡 접수 여부를 확인할 수 없습니다. 중복 발송 전에 확인해주세요." }; }
        },
    };
}
export function esignAlimtalkParameters(job: Pick<EsignJob, "kind">, payload: DeliveryPayload, publicOrigin: string): Record<string, string> {
    if (job.kind === "otp") {
        if (!/^\d{6}$/.test(payload.code ?? "")) throw new EsignError("인증 코드 형식을 확인해주세요.");
        return { 인증코드: payload.code! };
    }
    const origin = new URL(publicOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !/^[A-Za-z0-9_-]{40,128}$/.test(payload.token ?? "")) throw new EsignError("알림톡 서명 주소를 확인해주세요.");
    const plain = (value: string, max: number) => value.replace(/[\r\n\t]/g, " ").trim().slice(0, max);
    return { 이름: plain(payload.name || "고객", 50), 문서명: plain(payload.title || "계약서", 100), 서명주소: `${origin.host}/sign/${payload.token}` };
}
