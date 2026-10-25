import { isKnownEmailRejection } from "../nhn-submit-result";
import { EsignError, type DeliveryOutcome, type DeliveryPayload, type EsignChannel, type EsignJob } from "./types";
import { OTP_TTL_MS } from "./rules";
import type { EsignAlimtalkStatus } from "./alimtalk";
import { formatKstDateTime } from "../kst";
import { EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT } from "../email-send-guard";

export type MailSubmission = { senderAddress: string; senderName?: string; title: string; body: string; receiverList: { receiveMailAddr: string; receiveType: "MRT0" }[] };
export type EmailSender = { address: string; name?: string; submit(request: MailSubmission): Promise<{ header: { isSuccessful: boolean; resultCode: number; resultMessage?: string }; data: { requestId?: string; results?: { resultCode: number }[] } | null }> };
export type SmsConfig = { appKey: string; secretKey: string; sender: string };
export interface EsignDelivery {
    ready(channel: EsignChannel, orgId: string): Promise<boolean>;
    alimtalkStatus?(orgId: string): Promise<EsignAlimtalkStatus>;
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
    const plain = (value: unknown, max: number) => String(value ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, max);
    const documentTitle = plain(payload.title, 100) || "계약서", name = plain(payload.name, 50);
    // UX-262: 누가 보낸 요청인지와 서명 기한을 함께 알린다. 이전에 저장된 작업(필드 없음)은 해당 줄을 생략한다.
    const requester = plain(payload.orgName, 50), deadline = !completed && payload.expiresAt && Number.isFinite(Date.parse(payload.expiresAt)) ? `${formatKstDateTime(new Date(payload.expiresAt))}(한국 시간)까지` : "";
    const lines = [documentTitle, ...(requester ? [`요청: ${requester}`] : []), ...(deadline ? [`서명 기한: ${deadline}`] : [])];
    return { title: `[샌드비] ${title}`, text: `[샌드비] ${title}\n${lines.join("\n")}\n${link}`, html: `<p>${escapeHtml(name)}님, ${title}.</p>${lines.map(line => `<p>${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(link)}">${completed ? "완료 문서 확인" : "문서 확인 및 서명"}</a></p>` };
}

/** Transport never retries a timeout: the provider might already have accepted it. */
export function createEsignDelivery(options: { publicOrigin: string; emailSender(orgId: string): Promise<EmailSender | null>; sms?: SmsConfig; alimtalk?: { status(orgId: string): Promise<EsignAlimtalkStatus>; send(job: EsignJob, orgId: string, payload: DeliveryPayload): Promise<DeliveryOutcome> }; fetcher?: typeof fetch; timeoutMs?: number }): EsignDelivery {
    const fetcher = options.fetcher ?? fetch, timeoutMs = options.timeoutMs ?? 10_000;
    const smsReady = () => Boolean(options.sms?.appKey && options.sms.secretKey && /^0\d{7,11}$/.test(options.sms.sender));
    return {
        async ready(channel, orgId) { return channel === "alimtalk" ? Boolean((await options.alimtalk?.status(orgId))?.ready) : channel === "sms" ? smsReady() : Boolean(await options.emailSender(orgId)); },
        alimtalkStatus: orgId => options.alimtalk?.status(orgId) ?? Promise.resolve({ ready: false, reason: "전자서명 알림톡 연결이 필요합니다.", templates: [] }),
        async send(job, orgId, payload) {
            if (!job.channel) return { state: "failed", error: "발송 채널이 없습니다." };
            if (job.channel === "alimtalk") return options.alimtalk?.send(job, orgId, payload) ?? { state: "failed", error: "전자서명 알림톡 연결이 필요합니다." };
            let message: ReturnType<typeof esignMessage>;
            let sender: EmailSender | null = null;
            try {
                message = esignMessage(job, payload, options.publicOrigin);
                if (job.channel === "email") sender = await options.emailSender(orgId);
            } catch (error) {
                return { state: "failed", error: error instanceof EsignError ? error.message : "발송 설정을 확인하지 못해 보내지 않았습니다. 잠시 후 다시 확인해주세요." };
            }
            if (job.channel === "email") {
                if (!sender || !payload.email) return { state: "failed", error: "이메일 발신 설정을 확인해주세요." };
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    const result = await Promise.race([
                        sender.submit({ senderAddress: sender.address, senderName: sender.name, title: message.title, body: message.html, receiverList: [{ receiveMailAddr: payload.email, receiveType: "MRT0" }] }),
                        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("uncertain_delivery")), timeoutMs); }),
                    ]);
                    if (result.header.isSuccessful && result.data?.requestId && result.data.results?.length && result.data.results.every(r => r.resultCode === 0))
                        return { state: "accepted", providerId: result.data.requestId };
                    if ([EMAIL_SEND_BLOCKED, EMAIL_SEND_CHECK_FAILED, EMAIL_SEND_INVALID_CONTEXT].includes(result.header.resultCode))
                        return { state: "failed", error: result.header.resultMessage || "발송 전 확인에서 메일을 보내지 않았습니다." };
                    if (result.header.isSuccessful && (!result.data?.requestId || !result.data.results?.length || result.data.results.some(r => !Number.isFinite(r.resultCode))))
                        return { state: "unknown", providerId: result.data?.requestId, error: "이메일 수신자별 접수 결과를 확인해주세요. 중복 발송 전에 확인이 필요합니다." };
                    return { state: isKnownEmailRejection(result.header.resultCode) || (result.header.isSuccessful && result.data?.results?.every(r => isKnownEmailRejection(r.resultCode))) ? "failed" : "unknown", error: "이메일 접수 결과를 확인해주세요." };
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
