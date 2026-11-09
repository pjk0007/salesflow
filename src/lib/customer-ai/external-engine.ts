import { createHmac } from "node:crypto";
import { and, desc, eq, inArray, lt, or, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { crmContacts } from "@/lib/db/customer-platform-schema";
import {
    inboxConversations as chats,
    inboxMessages as messages,
} from "@/lib/db/inbox-schema";
import type { DbExec } from "@/lib/db/tx";

/**
 * 외부 AI 답변 엔진 연동 (designer-hire-chatbot `POST /v1/engine/reply`).
 *
 * 지정한 사업(workspace)만 sendb 의 지식 기반 답변 대신 엔진에 묻는다. 대화·상담원 배정은 그대로 sendb 가 한다.
 * 환경변수가 없거나 목록에 없는 사업은 기존 동작을 유지한다.
 *
 * - CUSTOMER_AI_ENGINE_URL: 엔진 주소 (경로 제외)
 * - CUSTOMER_AI_ENGINE_SECRET: 서명 비밀값. 엔진의 ENGINE_PLATFORMS 와 같은 값
 * - CUSTOMER_AI_ENGINE_WORKSPACES: 사업 ID 목록 (쉼표)
 *
 * subjectId 는 본인 인증으로 연결된 대화의 회원 외부 ID 만 보낸다(engineSubject). 입력한 이메일이나 트래커 식별은 쓰지 않는다.
 */
export const ENGINE_PLATFORM = "sendb";
const ENGINE_TIMEOUT_MS = 65000;
const MAX_TEXT = 4000;
const MAX_HISTORY = 20;

export type ExternalEngine = { url: string; secret: string };

export function externalEngineFor(
    workspaceId: number,
    env: Record<string, string | undefined> = process.env,
): ExternalEngine | null {
    const url = env.CUSTOMER_AI_ENGINE_URL?.trim();
    const secret = env.CUSTOMER_AI_ENGINE_SECRET?.trim();
    if (!url || !secret) return null;
    const enabled = (env.CUSTOMER_AI_ENGINE_WORKSPACES ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map(Number);
    if (!enabled.includes(workspaceId)) return null;
    return { url: url.replace(/\/+$/, ""), secret };
}

export function signEngineRequest(
    secret: string,
    timestamp: string,
    body: string,
) {
    return (
        "v1=" +
        createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
    );
}

const engineResponse = z.object({
    decision: z.enum(["answer", "handoff"]),
    text: z.string(),
    handoff: z.object({ reason: z.string(), summary: z.string() }).nullable(),
});

export type EngineRequest = {
    conversationId: string;
    message: string;
    history: { role: "user" | "assistant"; text: string }[];
} & ({ subjectId: string } | { visitorId: string });

export type EngineResult =
    | { answer: string; citations: [] }
    | { reason: string };

export async function callExternalEngine(
    engine: ExternalEngine,
    request: EngineRequest,
    options: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<EngineResult> {
    const body = JSON.stringify(request);
    const timestamp = String(
        Math.floor((options.now?.() ?? new Date()).getTime() / 1000),
    );
    const response = await (options.fetch ?? fetch)(
        `${engine.url}/v1/engine/reply`,
        {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-chatbot-platform": ENGINE_PLATFORM,
                "x-chatbot-timestamp": timestamp,
                "x-chatbot-signature": signEngineRequest(
                    engine.secret,
                    timestamp,
                    body,
                ),
            },
            body,
            signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
        },
    );
    if (!response.ok) throw new Error(`엔진 응답 오류 ${response.status}`);
    const result = engineResponse.parse(await response.json());
    if (result.decision === "handoff")
        return {
            reason: (
                result.handoff?.summary || "AI 엔진이 상담원 확인을 요청했습니다."
            ).slice(0, 300),
        };
    if (!result.text.trim()) throw new Error("엔진 답변이 비어 있습니다.");
    return { answer: result.text, citations: [] };
}

/** 이번 질문 이전의 고객 문의와 AI 답변만 이력으로 보낸다. 상담원 답변·시스템 안내는 넣지 않는다. */
export async function buildEngineRequest(
    job: {
        conversationId: string;
        sourceMessageId: number;
        context: { question: string };
    },
    exec: DbExec,
): Promise<EngineRequest> {
    const [identity] = await exec
        .select({ externalId: crmContacts.externalId })
        .from(chats)
        .leftJoin(crmContacts, eq(crmContacts.id, chats.contactId))
        .where(eq(chats.id, job.conversationId));
    const rows = await exec
        .select({ kind: messages.kind, body: messages.body })
        .from(messages)
        .where(
            and(
                eq(messages.conversationId, job.conversationId),
                lt(messages.id, job.sourceMessageId),
                inArray(messages.kind, ["customer", "reply"]),
                or(
                    eq(messages.kind, "customer"),
                    isNotNull(messages.aiDraftId),
                ),
            ),
        )
        .orderBy(desc(messages.id))
        .limit(MAX_HISTORY);
    const base = {
        conversationId: job.conversationId,
        message: job.context.question.slice(0, MAX_TEXT),
        history: rows.reverse().map((m) => ({
            role: m.kind === "customer" ? ("user" as const) : ("assistant" as const),
            text: m.body.slice(0, MAX_TEXT),
        })),
    };
    return { ...base, ...engineSubject(job.conversationId, identity?.externalId) };
}

/**
 * 웹 상담의 contactId 는 본인 인증(identity token)으로만 채워진다. 이 값이 있으면 회원이다.
 * identifiedAt 은 익명 대화를 회원에 합칠 때만 찍히므로 로그인 후 바로 시작한 대화에서는 비어 있다 —
 * 이것으로 판단하면 회원이 전부 방문자가 된다.
 * 이메일·과거 가져오기 대화는 queueSupportJob 이 받지 않아 여기까지 오지 않는다.
 */
export function engineSubject(
    conversationId: string,
    externalId: string | null | undefined,
): { subjectId: string } | { visitorId: string } {
    return externalId
        ? { subjectId: externalId }
        : { visitorId: conversationId };
}
