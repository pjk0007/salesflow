import test from "node:test";
import assert from "node:assert/strict";
import { gmailInbound, gmailReplyRaw, type GmailInboxMessage } from "./gmail";
import { receiveGmailPage } from "./gmail";
import { clearGmailTokenCache } from "@/lib/gmail-client";
import type { SendbClient } from "../../../sdk/server";
import { inboundInput, ignoredEmail } from "./rules";
const message = (): GmailInboxMessage => ({
    id: "g1",
    threadId: "t1",
    internalDate: "1792022400000",
    payload: {
        mimeType: "text/plain",
        headers: [
            {
                name: "From",
                value: "=?UTF-8?B?6rCA7IOBIOqzoOqwnewgnA==?= <lead@example.test>",
            },
            { name: "To", value: "상담 <help@example.test>" },
            { name: "Subject", value: "=?UTF-8?B?7IOB64u0?=" },
            { name: "Message-ID", value: "<g1@example.test>" },
        ],
        body: {
            data: Buffer.from("안녕하세요. 상담 문의입니다.").toString(
                "base64url",
            ),
        },
    },
});
test("Gmail의 한글 제목·발신자·본문과 주소를 변환한다", () => {
    const result = gmailInbound(message());
    assert.equal(result.subject, "상담");
    assert.equal(result.from, "lead@example.test");
    assert.equal(result.to[0], "help@example.test");
    assert.ok(result.fromName.includes("가상"));
    assert.ok(result.body.includes("안녕하세요"));
});
test("HTML만 있는 메일을 텍스트로 변환하고 첨부 메일 본문은 섞지 않는다", () => {
    const m = message();
    m.payload.mimeType = "multipart/mixed";
    m.payload.body = {};
    m.payload.parts = [
        {
            mimeType: "text/html",
            body: {
                data: Buffer.from("<p>hello &amp; world</p>").toString(
                    "base64url",
                ),
            },
        },
        {
            mimeType: "message/rfc822",
            filename: "forwarded.eml",
            parts: [
                {
                    mimeType: "text/plain",
                    body: {
                        data: Buffer.from("첨부된 다른 메일").toString(
                            "base64url",
                        ),
                    },
                },
            ],
        },
    ];
    const result = gmailInbound(m);
    assert.equal(result.body, "hello & world");
    assert.equal(result.files[0].name, "forwarded.eml");
});
test("본문 외부 다운로드가 필요하면 빈 본문으로 성공 처리하지 않는다", () => {
    const m = message();
    m.payload.body = { attachmentId: "big-text", size: 300000 };
    assert.throws(() => gmailInbound(m), /별도 다운로드/);
});
test("charset을 적용하며 여러 발신자와 머리글 개행은 거부한다", () => {
    const m = message();
    m.payload.headers!.push({
        name: "Content-Type",
        value: "text/plain; charset=iso-8859-1",
    });
    m.payload.body = {
        data: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString("base64url"),
    };
    assert.equal(gmailInbound(m).body, "café");
    m.payload.headers![0].value = "a@example.test, b@example.test";
    assert.throws(() => gmailInbound(m), /단일 발신자/);
    const input = gmailInbound(message());
    assert.equal(
        inboundInput.safeParse({
            ...input,
            subject: "제목\r\nBcc: other@example.test",
        }).success,
        false,
    );
});
test("자동 회신·단체 메일·자기 발신은 응답 루프에서 제외한다", () => {
    const report = message();
    report.payload.mimeType = "multipart/report";
    assert.equal(
        ignoredEmail(gmailInbound(report), "help@example.test"),
        "automatic_message",
    );
    const input = gmailInbound(message());
    assert.equal(
        ignoredEmail(
            { ...input, autoSubmitted: "auto-replied" },
            "help@example.test",
        ),
        "automatic_message",
    );
    assert.equal(
        ignoredEmail({ ...input, precedence: "bulk" }, "help@example.test"),
        "bulk_message",
    );
    assert.equal(ignoredEmail(input, input.from), "mailbox_self");
    assert.equal(ignoredEmail(input, "help@example.test"), null);
});
test("Gmail 답장은 고정 Message-ID·참조·한글 MIME·원본 본문을 보존한다", () => {
    const item = {
        id: "delivery",
        mailboxId: "mailbox",
        messageId: 1,
        leaseToken: "lease",
        leaseUntil: "",
        recipient: "lead@example.test",
        subject: "상담 제목 ".repeat(30),
        providerThreadId: "t1",
        rfcMessageId: "<delivery@example.test>",
        inReplyTo: "<g1@example.test>",
        from: "help@example.test",
        fromName: "상담 팀",
        body: "반갑습니다.\n친절하게 안내드리겠습니다.",
        authorName: "상담원",
    };
    const raw = Buffer.from(
        gmailReplyRaw(item, new Date(0)),
        "base64url",
    ).toString();
    assert.ok(raw.includes("Message-ID: <delivery@example.test>"));
    assert.ok(raw.includes("References: <g1@example.test>"));
    assert.equal(
        Buffer.from(
            raw.split("\r\n\r\n")[1].replaceAll("\r\n", ""),
            "base64",
        ).toString(),
        item.body,
    );
    for (const match of raw.matchAll(/=\?UTF-8\?B\?[^?]+\?=/g))
        assert.ok(match[0].length <= 75);
    assert.throws(() =>
        gmailReplyRaw({
            ...item,
            recipient: "lead@example.test\r\nBcc:x@example.test",
        }),
    );
});
test("multipart 답장의 파일 바이트·긴 한글 이름·경계·누락/개수 제한", () => {
    const bytes = Buffer.from([0, 255, 1, 2, 3, 4, 0]),
        item = {
            id: "file-delivery",
            mailboxId: "box",
            messageId: 1,
            leaseToken: "lease",
            leaseUntil: "",
            recipient: "lead@example.test",
            subject: "자료 전달",
            providerThreadId: "t",
            rfcMessageId: "<file-delivery@example.test>",
            inReplyTo: "<source@example.test>",
            from: "help@example.test",
            fromName: "상담원",
            body: "안내 자료입니다.",
            authorName: "상담원",
            attachments: [
                {
                    id: "file",
                    fileName: "한글 문서 ".repeat(20) + ".bin",
                    contentType: "application/octet-stream",
                    size: bytes.length,
                    sha256: "test",
                },
            ],
        };
    const file = {
            fileName: item.attachments[0].fileName,
            contentType: "application/octet-stream",
            bytes,
        },
        raw = Buffer.from(
            gmailReplyRaw(item, new Date(0), [file]),
            "base64url",
        ).toString();
    assert.ok(raw.includes("multipart/mixed"));
    assert.ok(raw.includes("filename*0*=UTF-8''"));
    assert.ok(raw.replaceAll("\r\n", "").includes(bytes.toString("base64")));
    for (const line of raw.split("\r\n")) assert.ok(line.length < 998);
    assert.throws(() => gmailReplyRaw(item), /모두 확인/);
    assert.throws(
        () =>
            gmailReplyRaw(
                { ...item, attachments: undefined },
                new Date(),
                Array.from({ length: 6 }, () => file),
            ),
        /최대 5개/,
    );
    assert.throws(() =>
        gmailReplyRaw(item, new Date(), [
            { ...file, fileName: "ok\r\nBcc:x@example.test" },
        ]),
    );
});
test("이름 없는 바이너리·attachment disposition은 본문에 섞이지 않는다", () => {
    const m = message();
    m.payload.mimeType = "multipart/mixed";
    m.payload.body = {};
    m.payload.parts = [
        {
            mimeType: "text/plain",
            headers: [{ name: "Content-Disposition", value: "attachment" }],
            partId: "a",
            body: {
                size: 6,
                data: Buffer.from("secret").toString("base64url"),
            },
        },
        {
            mimeType: "image/png",
            partId: "b",
            body: {
                size: 3,
                data: Buffer.from([0, 1, 2]).toString("base64url"),
            },
        },
    ];
    const result = gmailInbound(m);
    assert.equal(result.files.length, 2);
    assert.equal(result.body, "(첨부 파일만 있는 메일)");
    assert.equal(result.files[0].providerId, "a");
});
test("읽기 요청의 401은 해당 토큰을 갱신해 한 번만 재시도한다", async () => {
    clearGmailTokenCache();
    let tokenCalls = 0,
        profiles = 0;
    const client = {
        emailMailboxes: async () => [
            {
                id: "box",
                workspaceId: 8,
                address: "help@example.test",
                enabled: true,
                name: "가상",
                version: 1,
            },
        ],
    } as unknown as SendbClient;
    const fetchImpl: typeof fetch = async (url) => {
        const path = String(url);
        if (path.includes("oauth2"))
            return Response.json({
                access_token: `fake-${++tokenCalls}`,
                expires_in: 3600,
            });
        if (path.endsWith("profile")) {
            profiles++;
            return profiles === 1
                ? new Response("unauthorized", { status: 401 })
                : Response.json({ emailAddress: "help@example.test" });
        }
        return Response.json({ messages: [] });
    };
    const result = await receiveGmailPage(
        client,
        { workspaceId: 8, mailboxId: "box", since: new Date(0) },
        {
            clientId: "unit-read",
            clientSecret: "unit-secret",
            refreshToken: "unit-refresh",
        },
        fetchImpl,
    );
    assert.equal(profiles, 2);
    assert.equal(tokenCalls, 2);
    assert.equal(result.results.length, 0);
});
