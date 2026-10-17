import { EsignError, type DeliveryOutcome, type DeliveryPayload, type EsignChannel, type EsignJob } from "./types";
import { OTP_TTL_MS } from "./rules";

export type MailSubmission = { senderAddress: string; senderName?: string; title: string; body: string; receiverList: { receiveMailAddr: string; receiveType: "MRT0" }[] };
export type EmailSender = { address: string; name?: string; submit(request: MailSubmission): Promise<{ header: { isSuccessful: boolean; resultCode: number }; data: { requestId?: string; results?: { resultCode: number }[] } | null }> };
export type SmsConfig = { appKey: string; secretKey: string; sender: string };
export interface EsignDelivery {
    ready(channel: EsignChannel, orgId: string): Promise<boolean>;
    send(job: EsignJob, orgId: string, payload: DeliveryPayload): Promise<DeliveryOutcome>;
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function esignMessage(job: Pick<EsignJob, "kind">, payload: DeliveryPayload, publicOrigin: string) {
    const origin = new URL(publicOrigin);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))))
        throw new EsignError("전자서명 공개 주소를 확인해주세요.", 503);
    if (job.kind === "otp") {
        if (!/^\d{6}$/.test(payload.code ?? "")) throw new EsignError("확인 코드 형식을 확인해주세요.");
        const minutes = Math.floor(OTP_TTL_MS / 60_000);
        return { title: "샌드비 서명 확인 코드", text: `[샌드비] 서명 확인 코드 ${payload.code}\n${minutes}분 이내에 입력해주세요.`, html: `<p>서명 확인 코드: <strong>${payload.code}</strong></p><p>${minutes}분 이내에 입력해주세요.</p>` };
    }
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(payload.token ?? "")) throw new EsignError("서명 링크를 확인해주세요.");
    const link = `${origin.origin}/sign/${payload.token}`;
    const completed = job.kind === "completed", title = completed ? "서명 완료 문서를 확인해주세요" : "서명을 요청드립니다";
    const documentTitle = String(payload.title ?? "계약서").slice(0, 100), name = String(payload.name ?? "").slice(0, 50);
    return { title: `[샌드비] ${title}`, text: `[샌드비] ${title}\n${documentTitle}\n${link}`, html: `<p>${escapeHtml(name)}님, ${title}.</p><p>${escapeHtml(documentTitle)}</p><p><a href="${escapeHtml(link)}">${completed ? "완료 문서 확인" : "문서 확인 및 서명"}</a></p>` };
}

/** Transport never retries a timeout: the provider might already have accepted it. */
export function createEsignDelivery(options: { publicOrigin: string; emailSender(orgId: string): Promise<EmailSender | null>; sms?: SmsConfig; fetcher?: typeof fetch; timeoutMs?: number }): EsignDelivery {
    const fetcher = options.fetcher ?? fetch, timeoutMs = options.timeoutMs ?? 10_000;
    const smsReady = () => Boolean(options.sms?.appKey && options.sms.secretKey && /^0\d{7,11}$/.test(options.sms.sender));
    return {
        async ready(channel, orgId) { return channel === "sms" ? smsReady() : Boolean(await options.emailSender(orgId)); },
        async send(job, orgId, payload) {
            if (!job.channel) return { state: "failed", error: "발송 채널이 없습니다." };
            const message = esignMessage(job, payload, options.publicOrigin);
            if (job.channel === "email") {
                const sender = await options.emailSender(orgId);
                if (!sender || !payload.email) return { state: "failed", error: "이메일 발신 설정을 확인해주세요." };
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    const result = await Promise.race([
                        sender.submit({ senderAddress: sender.address, senderName: sender.name, title: message.title, body: message.html, receiverList: [{ receiveMailAddr: payload.email, receiveType: "MRT0" }] }),
                        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("uncertain_delivery")), timeoutMs); }),
                    ]);
                    if (result.header.isSuccessful && result.data?.requestId && result.data.results?.length && result.data.results.every(r => r.resultCode === 0))
                        return { state: "accepted", providerId: result.data.requestId };
                    return { state: result.header.resultCode >= 500 ? "unknown" : "failed", error: "이메일 접수 결과를 확인해주세요." };
                } catch { return { state: "unknown", error: "이메일 접수 여부를 확인할 수 없습니다. 중복 발송 전에 확인해주세요." }; }
                finally { if (timer) clearTimeout(timer); }
            }
            if (!smsReady() || !payload.phone) return { state: "failed", error: "SMS 계정과 등록 발신번호를 설정해주세요." };
            const sms = options.sms!, long = job.kind !== "otp";
            try {
                const response = await fetcher(`https://sms.api.nhncloudservice.com/sms/v3.0/appKeys/${encodeURIComponent(sms.appKey)}/sender/${long ? "mms" : "sms"}`, {
                    method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
                    headers: { "Content-Type": "application/json;charset=UTF-8", "X-Secret-Key": sms.secretKey },
                    body: JSON.stringify({ sendNo: sms.sender, ...(long ? { title: message.title } : {}), body: message.text, recipientList: [{ recipientNo: payload.phone }], userId: job.id }),
                });
                if (!response.ok) return { state: response.status >= 500 ? "unknown" : "failed", error: "SMS 접수 결과를 확인해주세요." };
                const result = await response.json() as { header?: { isSuccessful?: boolean }; body?: { data?: { requestId?: string; sendResultList?: { resultCode?: number }[] } } };
                const data = result.body?.data;
                if (result.header?.isSuccessful && data?.requestId && data.sendResultList?.length && data.sendResultList.every(r => r.resultCode === 0)) return { state: "accepted", providerId: data.requestId };
                if (result.header?.isSuccessful && (!data?.sendResultList?.length || data.sendResultList.some(r => r.resultCode === undefined))) return { state: "unknown", providerId: data?.requestId, error: "SMS 수신자별 접수 결과를 확인해주세요." };
                return { state: "failed", error: "SMS 요청이 접수되지 않았습니다." };
            } catch { return { state: "unknown", error: "SMS 접수 여부를 확인할 수 없습니다. 중복 발송 전에 확인해주세요." }; }
        },
    };
}
