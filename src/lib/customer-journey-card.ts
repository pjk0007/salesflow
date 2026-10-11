/** 메일에서 유입된 고객의 한 방문을 구글 챗 카드로 요약한다. DB·외부 요청 없음. */
import { contactKindOf, evaluateSend, pathOf, STAGE_LABELS, type EventInput, type SessionInput } from "./deep-visitor-alert-rules";
import { chatSafe, clipChars } from "./chat-text";
import { formatKstShort } from "./kst";

export interface JourneyCardInput {
    recordId: number;
    integratedCode: string | null;
    businessName: string;
    recipientEmail: string;
    subject: string | null;
    sentAt: Date;
    clickedAt: Date;
    session: SessionInput;
    events: EventInput[];
    fields: { key: string; label: string; fieldType: string; value: string }[];
    labels: Record<string, string>;
    baseUrl: string;
}

export interface JourneyCardSummary {
    eligible: boolean;
    lastActivityAt: Date;
    company: string;
    person: string;
    stage: string;
    completed: boolean;
    totalSeconds: number | null;
    pages: { path: string; title: string; seconds: number | null }[];
    sections: { label: string; seconds: number }[];
    actions: string[];
    recommendation: string;
}

const SETTLE_MS = 10 * 60 * 1000;
const clean = (value: unknown, max = 160) => chatSafe(value, { max, defangUrls: true });
const html = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const durationLabel = (seconds: number | null): string => seconds === null ? "측정 없음" : seconds < 60 ? `${Math.round(seconds)}초` : `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`;

export function summarizeJourney(input: JourneyCardInput, now: Date): JourneyCardSummary {
    const s = input.session;
    const events = input.events.filter((e) => e.sessionId === s.id && e.occurredAt <= now && e.occurredAt >= s.startedAt)
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const verdict = evaluateSend({
        sendLogId: 0, recordId: input.recordId, sentAt: input.sentAt,
        clicks: [{ clickId: s.clickId, clickedAt: input.clickedAt }],
        foundSessions: [s], ownSiteId: s.siteId, visitorSessions: [s], visitorEvents: events,
        distinctClickedRecordsForVisitor: 1, alreadyInFunnel: false, unsubscribed: false,
    }, now);
    const lastActivityAt = verdict.lastActivityAt ?? s.startedAt;
    const contacts = { company: "", name: "" };
    for (const f of input.fields) {
        const kind = contactKindOf(f);
        if ((kind === "company" || kind === "name") && !contacts[kind]) contacts[kind] = clean(f.value, 90);
    }
    // 세션 종료/측정된 길이까지만 쓴다. now와의 차이를 마지막 페이지 체류로 계산하지 않는다.
    const measuredEnd = s.endedAt && s.endedAt <= now ? s.endedAt : s.duration !== null && s.duration >= 0
        ? new Date(Math.min(now.getTime(), s.startedAt.getTime() + s.duration * 1000)) : null;
    const views = events.filter((e) => e.eventType === "PAGE_VIEW");
    const pages: JourneyCardSummary["pages"] = [];
    for (let i = 0; i < views.length; i++) {
        const view = views[i];
        const end = views[i + 1]?.occurredAt ?? measuredEnd;
        const seconds = end && end >= view.occurredAt ? (end.getTime() - view.occurredAt.getTime()) / 1000 : null;
        const path = pathOf(view.pageUrl) || "/";
        pages.push({ path: clean(path, 120), title: clean(view.pageTitle || path, 90), seconds });
    }
    const sectionMap = new Map<string, number>();
    const actions: string[] = [];
    for (const e of events) {
        const raw = e.eventName ?? "";
        const label = clean(input.labels[`${e.eventType}:${raw}`] || (e.eventType === "CLICK" ? e.properties?.text : null) || raw, 100);
        const ms = e.properties?.dwell_ms;
        if (e.eventType === "SECTION_VIEW" && label && typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
            sectionMap.set(label, (sectionMap.get(label) ?? 0) + ms / 1000);
        }
        if ((e.eventType === "CLICK" || e.eventType === "CUSTOM") && label && !actions.includes(label)) actions.push(label);
    }
    const completed = verdict.submitted || events.some((e) => e.eventType === "PURCHASE");
    const stage = completed ? "신청·구독·구매 완료" : STAGE_LABELS[verdict.deepestStage];
    const recommendation = completed ? "완료 고객입니다. 신청·구매 내역을 확인하고 온보딩을 이어 주세요."
        : verdict.signupStart || verdict.aiStart || verdict.coupon ? "신청을 시작한 뒤 완료하지 않았습니다. 진행 중 막힌 부분이 있는지 확인해 주세요."
        : verdict.action ? "상담·체험 행동이 있었습니다. 요청 내역을 확인하고 다음 일정을 제안해 주세요."
        : verdict.sawPrice ? "가격을 확인했습니다. 기존 CRM 맥락을 확인한 뒤 요금·적용 사례를 안내해 주세요."
        : verdict.sawCases || verdict.sawDetail ? "사례·서비스 상세를 확인했습니다. 해당 회사와 관련된 사례로 후속 연락을 준비해 주세요."
        : "초기 방문입니다. 추가 방문·클릭이 있는지 고객 여정에서 확인해 주세요.";
    return {
        eligible: !verdict.machine && !!verdict.chosenSession && lastActivityAt.getTime() <= now.getTime() - SETTLE_MS,
        lastActivityAt, company: contacts.company || "회사 정보 없음", person: contacts.name || clean(input.recipientEmail, 120),
        stage, completed,
        totalSeconds: s.duration !== null && s.duration >= 0 ? s.duration : s.endedAt && s.endedAt <= now ? Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 1000) : null,
        pages, sections: [...sectionMap].map(([label, seconds]) => ({ label, seconds })).sort((a, b) => b.seconds - a.seconds),
        actions, recommendation,
    };
}

export function buildJourneyCard(input: JourneyCardInput, now: Date) {
    const summary = summarizeJourney(input, now);
    const exit = summary.pages.at(-1);
    const outcome = summary.completed ? `완료 · ${summary.stage}` : `이탈 추정 · ${summary.stage}`;
    const paragraph = (text: string) => ({ textParagraph: { text } });
    const lines = summary.pages.slice(-8).map((p) => `${html(p.title)} (${html(p.path)}) · ${durationLabel(p.seconds)}`).join("<br>") || "페이지 이동 기록 없음";
    const sections = summary.sections.slice(0, 6).map((s) => `${html(s.label)} · ${durationLabel(s.seconds)}`).join("<br>");
    const base = new URL(input.baseUrl);
    if (!["https:", "http:"].includes(base.protocol)) throw new Error("고객 여정 링크의 주소가 올바르지 않습니다.");
    const origin = base.origin;
    const text = `${summary.company} · ${summary.person} | ${outcome} | 체류 ${durationLabel(summary.totalSeconds)}`;
    return {
        text,
        cardsV2: [{
            cardId: `journey-${input.recordId}-${input.session.id}`,
            card: {
                header: { title: html(`${summary.company} · ${summary.person}`), subtitle: html(`${clean(input.businessName)} · ${outcome}`) },
                sections: [
                    { header: "누가 · 어떤 메일에서 왔나", widgets: [
                        paragraph(`${html(clean(input.recipientEmail))}<br>메일: ${html(clean(input.subject || "제목 없음"))}<br>링크 클릭 ${formatKstShort(input.clickedAt)} · 방문 ${formatKstShort(input.session.startedAt)}<br>메일 열람 여부: 수집하지 않음 · 링크 클릭 확인`),
                    ] },
                    { header: "여정과 마지막 도달 단계", widgets: [
                        paragraph(`<b>${html(outcome)}</b><br>체류 ${durationLabel(summary.totalSeconds)} · ${summary.pages.length}개 페이지 기록<br>마지막 페이지: ${html(exit?.title || "기록 없음")}<br>마지막 활동 ${formatKstShort(summary.lastActivityAt)} · 이후 10분 이상 추가 활동 없음`),
                        paragraph(lines),
                        ...(sections ? [paragraph(`<b>영역별 체류 (측정값)</b><br>${sections}`)] : []),
                        ...(summary.actions.length ? [paragraph(`<b>누른 버튼·행동</b><br>${summary.actions.slice(0, 8).map(html).join(" → ")}`)] : []),
                        paragraph("페이지별 시간은 이동 간격 기준 추정입니다. 영역별 시간은 서로 겹칠 수 있습니다. 이탈 이유는 확인되지 않았습니다."),
                    ] },
                    { header: "다음 연락", widgets: [paragraph(html(summary.recommendation)), { buttonList: { buttons: [
                        { text: "CRM 고객 열기", onClick: { openLink: { url: `${origin}/records?id=${input.recordId}` } } },
                        { text: "전체 고객 여정", onClick: { openLink: { url: `${origin}/records/${input.recordId}/journey` } } },
                    ] } }] },
                ],
            },
        }],
    };
}

export type JourneyCardMessage = ReturnType<typeof buildJourneyCard>;
export const journeyPreviewText = (input: JourneyCardInput, now: Date): string => {
    const s = summarizeJourney(input, now);
    return clipChars([`[샌드비 고객 여정 · 예시 / 가상 고객]`, `${s.company} · ${s.person}`, `사업: ${input.businessName}`,
        `상태: ${s.completed ? "완료" : "이탈 추정"} · ${s.stage}`, `체류: ${durationLabel(s.totalSeconds)}`,
        "", "방문 순서 (페이지 시간은 추정)", ...s.pages.map((p) => `• ${p.title} · ${durationLabel(p.seconds)}`),
        "", "관심 영역 (측정값)", ...s.sections.map((p) => `• ${p.label} · ${durationLabel(p.seconds)}`),
        "", `다음 연락: ${s.recommendation}`, "", "기준: 마지막 활동 후 10분간 추가 활동 없음. 이탈 이유는 미확인.",
        "메일 열람은 수집하지 않으며, 메일 링크 클릭과 사이트 방문을 기준으로 정리합니다."].join("\n"), 3500);
};
