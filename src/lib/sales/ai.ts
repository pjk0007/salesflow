import { getAiClient, type AiClient } from "@/lib/ai/client";
import { callClaudeJson } from "@/lib/ai/claude";
import { extractJson } from "@/lib/ai/json-utils";
import { checkTokenQuota, logAiUsage, updateTokenUsage } from "@/lib/ai/quota";

export class SalesAiError extends Error {
    constructor(message: string, public status = 400) {
        super(message);
    }
}

type Usage = { promptTokens: number; completionTokens: number };

/** 월 사용량 확인 → 호출 → 사용량 기록 (relationship-care withAi와 같은 흐름) */
async function withAi<T>(orgId: string, userId: string, purpose: string, client: AiClient | null, run: (c: AiClient) => Promise<{ data: T; usage: Usage }>) {
    const quota = await checkTokenQuota(orgId);
    if (!quota.allowed) throw new SalesAiError("이번 달 AI 사용량을 모두 썼습니다.", 429);
    if (!client) throw new SalesAiError("AI 서비스를 사용할 수 없습니다.", 503);
    const { data, usage } = await run(client);
    await updateTokenUsage(orgId, usage.promptTokens + usage.completionTokens);
    await logAiUsage({ orgId, userId, provider: client.provider, model: client.model, ...usage, purpose });
    return data;
}

// ─── 녹음 전사 (Gemini — 음성을 직접 듣는다) ───────────────────────────
const GEMINI_AUDIO_MODEL = "gemini-3.5-flash-lite";
export const AUDIO_MAX_BYTES = 100 * 1024 * 1024;
export const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/aac", "audio/flac", "video/mp4"];

async function geminiUpload(apiKey: string, bytes: Buffer, mimeType: string, name: string) {
    // Files API (재개 가능 업로드) — 큰 녹음도 올릴 수 있다
    const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
        method: "POST",
        headers: {
            "x-goog-api-key": apiKey,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(bytes.length),
            "X-Goog-Upload-Header-Content-Type": mimeType,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: name.slice(0, 100) } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!start.ok || !uploadUrl) throw new SalesAiError("녹음 파일을 전사 서비스에 올리지 못했습니다.", 502);
    const done = await fetch(uploadUrl, {
        method: "POST",
        headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Length": String(bytes.length) },
        body: new Uint8Array(bytes),
    });
    const json = (await done.json()) as { file?: { uri: string; name: string; state?: string } };
    if (!done.ok || !json.file) throw new SalesAiError("녹음 파일을 전사 서비스에 올리지 못했습니다.", 502);
    // 음성은 처리 후 ACTIVE가 되어야 쓸 수 있다
    let file = json.file;
    for (let i = 0; i < 60 && file.state === "PROCESSING"; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { "x-goog-api-key": apiKey } });
        file = (await res.json()) as typeof file;
    }
    if (file.state && file.state !== "ACTIVE") throw new SalesAiError("녹음 파일을 처리하지 못했습니다.", 502);
    return file;
}

const TRANSCRIBE_PROMPT = `이 녹음은 B2B 영업 미팅 또는 통화입니다. 한국어로 빠짐없이 받아 적어 주세요.
- 화자가 바뀌면 줄을 바꾸고 "화자 1:", "화자 2:"처럼 구분합니다. 이름이 나오면 이름을 씁니다.
- 말한 내용만 적고, 요약하거나 덧붙이지 않습니다.
- 알아듣기 어려운 부분은 [불명확]으로 적습니다.`;

export async function transcribeAudio(orgId: string, userId: string, audio: { bytes: Buffer; mimeType: string; name: string }) {
    const client = getAiClient(GEMINI_AUDIO_MODEL);
    return withAi(orgId, userId, "sales_meeting_transcribe", client && client.provider === "gemini" ? client : null, async (c) => {
        const file = await geminiUpload(c.apiKey, audio.bytes, audio.mimeType, audio.name);
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": c.apiKey },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: TRANSCRIBE_PROMPT }, { file_data: { mime_type: audio.mimeType, file_uri: file.uri } }] }],
            }),
        });
        const json = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
        if (!res.ok || !text) throw new SalesAiError("녹음을 글로 바꾸지 못했습니다. 전사본을 직접 붙여넣어 주세요.", 502);
        return {
            data: { transcript: text },
            usage: { promptTokens: json.usageMetadata?.promptTokenCount ?? 0, completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0 },
        };
    });
}

// ─── 미팅 요약·액션플랜 (Claude) ─────────────────────────────────────
export interface MeetingAnalysis {
    summary: string;
    actionItems: Array<{ content: string; dueDate: string | null; ownerName: string | null }>;
}

const ANALYZE_SYSTEM = `당신은 B2B 영업팀의 미팅 기록을 정리하는 비서입니다.
미팅 전사본과 메모를 읽고 다음 JSON만 출력합니다.
{"summary": "핵심 요약(불릿 3~6개, 줄바꿈으로 구분, 각 줄은 '- '로 시작)",
 "actionItems": [{"content": "우리 쪽이 할 일 한 문장", "dueDate": "YYYY-MM-DD 또는 null", "ownerName": "담당자 이름 또는 null"}]}
규칙:
- 액션플랜은 우리 회사가 해야 할 다음 행동만 적습니다 (견적서 발송, 자료 전달, 후속 미팅 일정 잡기 등). 최대 6개.
- 기한은 반드시 주어진 "달력" 목록에서 골라 적습니다. 대화에 나온 요일과 같은 요일인 날짜를 고르고, 언급이 없으면 null.
  "이번 주 X요일"은 미팅 날짜와 같은 주(월~일), "다음 주 X요일"은 그다음 주(월~일), 그냥 "X요일"은 미팅 날짜 이후 가장 가까운 X요일입니다.
- 담당자는 주어진 팀원 이름 중에서만 고르고, 알 수 없으면 null.
- 지어내지 않습니다.`;

export async function analyzeMeeting(
    orgId: string,
    userId: string,
    input: { transcript: string; notes: string; meetingDate: string; today: string; members: string[] },
) {
    const client = getAiClient();
    return withAi<MeetingAnalysis>(orgId, userId, "sales_meeting_analyze", client, async (c) => {
        // 요일을 같이 줘야 "다음 주 화요일" 같은 말을 정확한 날짜로 바꾼다
        // 한국 시간 정오 = 같은 날 UTC 03시라 getUTCDay가 그 날의 요일
        const weekday = (d: string) => "일월화수목금토"[new Date(`${d}T12:00:00+09:00`).getUTCDay()];
        // AI가 요일 계산을 자주 틀려서 미팅 날짜부터 3주치 달력을 직접 준다
        const base = new Date(`${input.meetingDate}T12:00:00+09:00`).getTime();
        const calendar = Array.from({ length: 22 }, (_, i) => {
            const d = new Date(base + i * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
            return `${d}(${weekday(d)})`;
        }).join(", ");
        const prompt = `오늘: ${input.today} (${weekday(input.today)}요일)\n미팅 날짜: ${input.meetingDate} (${weekday(input.meetingDate)}요일)\n달력: ${calendar}\n팀원: ${input.members.join(", ") || "(없음)"}\n\n[메모]\n${input.notes || "(없음)"}\n\n[전사본]\n${input.transcript.slice(0, 60000)}`;
        const { content, usage } = await callClaudeJson(c, ANALYZE_SYSTEM, prompt);
        const parsed = extractJson(content, /\{[\s\S]*"summary"[\s\S]*\}/) as Partial<MeetingAnalysis>;
        const items = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
        return {
            data: {
                summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
                actionItems: items
                    .filter((i) => i && typeof i.content === "string" && i.content.trim())
                    .slice(0, 6)
                    .map((i) => ({
                        content: i.content.trim(),
                        dueDate: typeof i.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate) ? i.dueDate : null,
                        ownerName: typeof i.ownerName === "string" ? i.ownerName : null,
                    })),
            },
            usage,
        };
    });
}

// ─── 추천 연락 문구 (Claude) ─────────────────────────────────────────
const DRAFT_SYSTEM = `당신은 B2B 영업 담당자를 돕는 비서입니다. 고객에게 보낼 짧은 연락 문구(문자·카톡용) 초안을 씁니다.
- 3~5문장, 존댓말, 자연스럽고 부담 없는 톤. 과장·광고 문구 금지.
- 메모와 지난 미팅 내용 중 상대가 관심 가질 만한 것을 한 가지 자연스럽게 언급합니다(없으면 생략).
- 이름 자리에는 받는 분 이름과 직책을 씁니다. 보내는 사람 서명은 넣지 않습니다.
- 문구만 출력합니다.`;

export async function draftSuggestionMessage(
    orgId: string,
    userId: string,
    input: { action: string; reason: string; company: string; person: string; memo: string; lastMeeting: string },
) {
    const client = getAiClient();
    return withAi<string>(orgId, userId, "sales_suggestion_draft", client, async (c) => {
        const prompt = `할 일: ${input.action}\n이유: ${input.reason}\n기업: ${input.company}\n받는 분: ${input.person || "(이름 없음)"}\n메모: ${input.memo || "(없음)"}\n지난 미팅: ${input.lastMeeting || "(없음)"}`;
        const { content, usage } = await callClaudeJson(c, DRAFT_SYSTEM, prompt);
        return { data: content.trim(), usage };
    });
}
