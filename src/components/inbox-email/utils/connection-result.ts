/** Google 승인 후 돌아온 `emailConnection` 코드별 안내. 모르는 값은 일반 실패 문구로 본다. */
const messages: Record<string, string> = {
    connected:
        "Google 계정이 연결됐습니다. 메일함의 수신·발송 켜기를 눌러주세요.",
    cancelled: "Google 연결 승인을 취소했습니다.",
    expired:
        "연결 요청이 만료됐거나 다른 브라우저에서 시작됐습니다. 이 브라우저에서 10분 안에 다시 연결해주세요.",
    scope: "메일 읽기와 답장 발송 권한을 모두 체크해야 연결됩니다. 다시 연결하면서 권한을 모두 승인해주세요.",
    account:
        "등록한 Google 로그인 계정과 다른 계정을 선택했습니다. 메일함에 적힌 로그인 계정을 선택해주세요.",
    alias: "문의 주소가 Google 계정의 인증된 발신 주소가 아닙니다. Gmail 설정의 '다른 주소에서 메일 보내기'에 등록·인증한 뒤 다시 연결해주세요.",
    permission:
        "이 사업의 메일 연결을 관리할 권한이 없습니다. 사업 관리자에게 연결을 요청해주세요.",
    failed: "Google 연결을 완료하지 못했습니다. 잠시 후 다시 연결해주세요.",
};
export function connectionResultMessage(code: string) {
    return messages[code] ?? messages.failed;
}
export const connectionSucceeded = (code: string) =>
    code === "connected" || code === "cancelled";
