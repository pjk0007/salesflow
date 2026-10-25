import type { EmailDelivery } from "../types";

/** 발송 상태별 사유 문구와 경고 표시. 서버 재시도 규칙(failed만 재시도)은 바꾸지 않는다. */
const reasons: Record<string, string> = {
    attachment_download:
        "첨부 파일을 모두 확인하지 못해 발송을 시작하지 않았습니다. 파일과 연결 상태를 확인한 뒤 재시도해주세요.",
    attachment_changed:
        "첨부 파일이 변경되어 발송을 시작하지 않았습니다. 첨부를 다시 확인한 뒤 재시도해주세요.",
    mime_invalid:
        "받는 사람·제목 등 메일 형식을 확인하지 못해 발송을 시작하지 않았습니다. 받는 사람을 확인해 다시 작성해주세요.",
    mailbox_mismatch:
        "연결된 메일 계정과 발신 주소가 다릅니다. 관리자에게 연결 설정을 확인해주세요.",
    alias_unverified:
        "사업 문의 주소가 Gmail에서 인증된 발신 주소인지 확인하지 못해 발송을 중단했습니다. Google 계정의 다른 주소에서 메일 보내기 설정을 확인한 뒤 재시도해주세요.",
    auth: "Google 연결 권한이 만료되어 보내지 못했습니다. 관리자에게 Google 재연결을 요청해주세요. 재연결 전에는 재시도해도 실패합니다.",
    scope: "Google 메일 발송 권한이 없어 보내지 못했습니다. 관리자에게 Google 재연결을 요청해주세요.",
    rate_limited:
        "메일 서비스의 발송 한도에 걸렸습니다. 잠시 후 재시도해주세요.",
    provider_rejected:
        "메일 서비스가 답장을 거절했습니다. 받는 사람과 내용을 확인한 뒤 재시도해주세요.",
    mailbox_changed:
        "메일함이 중지되거나 Google 연결이 바뀌어 보내지 않고 취소했습니다. 본문을 작성란에 다시 넣어 새로 보내주세요.",
    access_revoked:
        "작성자의 사업 응대 권한이 회수되어 보내지 않고 취소했습니다. 응대 권한이 있는 직원이 본문을 다시 넣어 보내주세요.",
    email_unsubscribed:
        "받는 사람·참조 중 조직 수신거부 목록에 등록된 주소가 있어 발송을 중단했습니다. 해당 주소를 빼고 다시 작성해주세요.",
};

export function deliveryReason(item: Pick<EmailDelivery, "state" | "errorCode">) {
    const text =
        item.state === "uncertain"
            ? "메일 서비스 응답을 받지 못했습니다. 보낸 편지함에서 자동으로 확인하고 있으며, 확인되면 '접수됨'으로 바뀝니다. 중복 발송을 막기 위해 자동 재전송하지 않습니다."
            : item.state === "sent"
              ? null
              : (reasons[item.errorCode ?? ""] ?? null);
    return {
        text,
        warn:
            ["failed", "uncertain"].includes(item.state) ||
            (item.state === "cancelled" && !!item.errorCode),
        /** 취소된 답장은 서버가 재시도를 막으므로 본문을 작성란에 다시 넣어 새 답장으로 보낸다. */
        canRewrite: item.state === "cancelled",
    };
}
