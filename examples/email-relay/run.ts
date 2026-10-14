/** Explicit standalone relay. Never reads production dotenv files or legacy marketing credentials. */
import { SendbClient } from "../../sdk/server";
import {
    deliverGmailReply,
    receiveGmailPage,
} from "../../src/lib/inbox-email/gmail";
const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} 설정이 필요합니다.`);
    return value;
};
async function main() {
    const mode = process.argv[2];
    if (!["receive", "send"].includes(mode))
        throw new Error("receive 또는 send 모드를 지정해주세요.");
    if (required("SENDB_EMAIL_RELAY_ENABLED") !== "on")
        throw new Error("메일 연결 실행이 꺼져 있습니다.");
    const client = new SendbClient({
        apiBase: required("SENDB_EMAIL_API_BASE"),
        apiToken: required("SENDB_EMAIL_API_TOKEN"),
    });
    const mailboxId = required("SENDB_EMAIL_MAILBOX_ID");
    const credentials = {
        clientId: required("SENDB_EMAIL_GOOGLE_CLIENT_ID"),
        clientSecret: required("SENDB_EMAIL_GOOGLE_CLIENT_SECRET"),
        refreshToken: required("SENDB_EMAIL_GOOGLE_REFRESH_TOKEN"),
    };
    if (mode === "send") {
        const result = await deliverGmailReply(client, mailboxId, credentials);
        console.log(
            result
                ? `메일 발송 처리: ${result.state}`
                : "발송 대기 메일이 없습니다.",
        );
        return;
    }
    const workspaceId = Number(required("SENDB_EMAIL_WORKSPACE_ID")),
        since = new Date(required("SENDB_EMAIL_RECEIVE_SINCE"));
    if (!Number.isInteger(workspaceId) || workspaceId <= 0)
        throw new Error("사업 번호를 확인해주세요.");
    let pageToken: string | undefined,
        count = 0;
    do {
        const page = await receiveGmailPage(
            client,
            { workspaceId, mailboxId, since, pageToken },
            credentials,
        );
        count += page.results.length;
        pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    console.log(`메일 수신 처리 ${count}건 (중복 수신은 기존 기록 재사용)`);
}
main().catch(() => {
    console.error(
        "메일 연결 처리를 완료하지 못했습니다. 설정·권한과 샌드비의 발송 상태를 확인해주세요. 메일 본문과 인증 정보는 출력하지 않습니다.",
    );
    process.exitCode = 1;
});
