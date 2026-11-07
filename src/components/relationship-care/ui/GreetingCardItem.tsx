"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
    Sparkles,
    Send,
    CheckCheck,
    CalendarClock,
    SkipForward,
} from "lucide-react";
import { aiDraft, careAction } from "../api";
import type { Channel, GreetingCard } from "../types";
import { lastTouchText, mailtoLink, smsLink } from "../utils/links";
const STATUS_STYLE: Record<GreetingCard["status"], string> = {
    overdue: "bg-red-50 text-red-700",
    dormant: "bg-amber-50 text-amber-800",
    welcome: "bg-violet-100 text-violet-800",
    soon: "bg-sky-50 text-sky-800",
    ok: "bg-muted text-muted-foreground",
};
const LOG_CHANNELS: { id: Channel; label: string }[] = [
    { id: "sms", label: "문자" },
    { id: "kakao", label: "카카오톡" },
    { id: "email", label: "메일" },
    { id: "call", label: "통화" },
    { id: "meeting", label: "만남" },
];
export function GreetingCardItem({
    card,
    workspaceId,
    showOwner,
    canRespond,
    onDone,
}: {
    card: GreetingCard;
    workspaceId: number;
    showOwner: boolean;
    canRespond: boolean;
    onDone: () => Promise<unknown>;
}) {
    const [channel, setChannel] = useState<"sms" | "kakao" | "email">(
        card.phone ? "sms" : card.email ? "email" : "kakao",
    );
    const [sms, setSms] = useState(card.draft.sms);
    const [subject, setSubject] = useState(card.draft.emailSubject);
    const [body, setBody] = useState(card.draft.emailBody);
    const [basis, setBasis] = useState<string[] | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [awaitingConfirm, setAwaitingConfirm] = useState(false);
    const [logChannel, setLogChannel] = useState<Channel>("sms");
    const text = channel === "email" ? body : sms;
    async function run(
        label: string,
        action: () => Promise<unknown>,
        done?: string,
    ) {
        if (busy) return;
        setBusy(label);
        try {
            await action();
            if (done) toast.success(done);
            await onDone();
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(null);
        }
    }
    async function copy(value: string) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            return false;
        }
    }
    async function send() {
        const copied = await copy(
            channel === "email" ? `${subject}\n\n${body}` : sms,
        );
        if (channel === "sms" && card.phone)
            window.location.href = smsLink(card.phone, sms);
        else if (channel === "email" && card.email)
            // 새 탭을 열면 빈 탭이 남는다. 같은 창에서 메일 앱으로 넘기면 페이지는 그대로 있다.
            window.location.href = mailtoLink(card.email, subject, body);
        else if (!copied) {
            toast.error("초안을 복사하지 못했습니다. 직접 선택해 복사해주세요.");
            return;
        }
        if (copied)
            toast.message("초안을 복사했습니다. 보낸 뒤 [보냈어요]를 눌러 주세요.");
        setAwaitingConfirm(true);
    }
    const sendDisabled =
        !canRespond ||
        !text.trim() ||
        (channel === "sms" && !card.phone) ||
        (channel === "email" && !card.email);
    return (
        <article
            className="rounded-xl border bg-background p-4 shadow-sm"
            aria-label={`${card.name} 인사 카드`}
        >
            <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="font-semibold">
                        {card.name}
                        {(card.companyName || card.title) && (
                            <span className="ml-2 text-sm font-normal text-muted-foreground">
                                {[card.companyName, card.title].filter(Boolean).join(" · ")}
                            </span>
                        )}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                        {lastTouchText(card.daysSinceTouch)}
                        {card.welcomeDeadline &&
                            ` · 첫 인사 기한 ${new Date(card.welcomeDeadline).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric" })}`}
                        {showOwner && ` · 담당 ${card.ownerName ?? "없음"}`}
                    </p>
                </div>
                <div className="flex gap-1 text-xs">
                    <span className="rounded-full border px-2 py-0.5">
                        {card.tierLabel}
                    </span>
                    <span
                        className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[card.status]}`}
                    >
                        {card.statusLabel}
                    </span>
                </div>
            </header>
            <p className="mt-3 text-sm">
                <span className="text-muted-foreground">연락 계기 · </span>
                {card.reasonLabel}
            </p>
            {card.memoryNote.trim() && (
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                    기억 메모: {card.memoryNote}
                </p>
            )}
            <div
                className="mt-3 flex gap-2 text-xs"
                role="tablist"
                aria-label="보낼 방법"
            >
                {(["sms", "kakao", "email"] as const).map((c) => (
                    <button
                        key={c}
                        role="tab"
                        aria-selected={channel === c}
                        className={`rounded-lg px-3 py-1.5 ${channel === c ? "bg-violet-100 font-medium text-violet-800" : "border text-muted-foreground"}`}
                        onClick={() => {
                            setChannel(c);
                            setAwaitingConfirm(false);
                        }}
                    >
                        {{ sms: "문자", kakao: "카카오톡", email: "메일" }[c]}
                    </button>
                ))}
            </div>
            {channel === "email" ? (
                <div className="mt-2 space-y-2">
                    <input
                        aria-label="메일 제목"
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                        value={subject}
                        maxLength={100}
                        onChange={(e) => setSubject(e.target.value)}
                    />
                    <textarea
                        aria-label="메일 본문"
                        className="h-40 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                        value={body}
                        maxLength={2000}
                        onChange={(e) => setBody(e.target.value)}
                    />
                </div>
            ) : (
                <textarea
                    aria-label={channel === "sms" ? "문자 초안" : "카카오톡 초안"}
                    className="mt-2 h-24 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    value={sms}
                    maxLength={300}
                    onChange={(e) => setSms(e.target.value)}
                />
            )}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                    {channel === "sms" &&
                        !card.phone &&
                        "전화번호가 없어 문자 앱을 열 수 없습니다. "}
                    {channel === "email" &&
                        !card.email &&
                        "메일 주소가 없어 메일 앱을 열 수 없습니다. "}
                    {channel === "kakao" &&
                        "카카오톡은 초안을 복사한 뒤 직접 붙여 넣어 보냅니다. "}
                    {basis &&
                        (basis.length
                            ? `AI가 반영한 정보: ${basis.join(", ")}`
                            : "AI가 입력 정보 없이 일반 안부로 썼습니다.")}
                </span>
                <button
                    className="flex items-center gap-1 text-violet-700 disabled:opacity-50"
                    disabled={!canRespond || !!busy}
                    onClick={() =>
                        void run("ai", async () => {
                            const d = await aiDraft(workspaceId, card.contactId, card.reason);
                            setSms(d.sms);
                            setSubject(d.emailSubject);
                            setBody(d.emailBody);
                            setBasis(d.basis);
                        })
                    }
                >
                    <Sparkles size={14} />
                    {busy === "ai" ? "AI가 쓰는 중…" : "AI로 다시 쓰기"}
                </button>
            </div>
            {awaitingConfirm ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 p-3 text-sm">
                    <span className="mr-auto">보내셨나요? 보낸 경우에만 기록됩니다.</span>
                    <button
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-white disabled:opacity-50"
                        disabled={!!busy}
                        onClick={() =>
                            void run(
                                "sent",
                                () =>
                                    careAction(workspaceId, card.contactId, "sent", {
                                        channel,
                                        reason: card.reason,
                                    }),
                                `${card.name}님 인사를 기록했습니다.`,
                            )
                        }
                    >
                        보냈어요
                    </button>
                    <button
                        className="rounded-lg border px-3 py-1.5"
                        onClick={() => setAwaitingConfirm(false)}
                    >
                        안 보냈어요
                    </button>
                </div>
            ) : (
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <button
                        className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-white disabled:opacity-50"
                        disabled={sendDisabled || !!busy}
                        onClick={() => void send()}
                    >
                        <Send size={14} />
                        {channel === "kakao" ? "복사하기" : "보내기"}
                    </button>
                    <span className="flex items-center gap-1 rounded-lg border px-1">
                        <select
                            aria-label="이미 연락한 방법"
                            className="bg-transparent py-1.5 text-sm"
                            value={logChannel}
                            onChange={(e) => setLogChannel(e.target.value as Channel)}
                        >
                            {LOG_CHANNELS.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                        <button
                            className="flex items-center gap-1 px-2 py-1.5 disabled:opacity-50"
                            disabled={!canRespond || !!busy}
                            onClick={() =>
                                void run(
                                    "logged",
                                    () =>
                                        careAction(workspaceId, card.contactId, "logged", {
                                            channel: logChannel,
                                            reason: card.reason,
                                        }),
                                    "연락을 기록했습니다.",
                                )
                            }
                        >
                            <CheckCheck size={14} />
                            보냈음 기록
                        </button>
                    </span>
                    <button
                        className="flex items-center gap-1 rounded-lg border px-3 py-1.5 disabled:opacity-50"
                        disabled={!canRespond || !!busy}
                        onClick={() =>
                            void run(
                                "snooze",
                                () =>
                                    careAction(workspaceId, card.contactId, "snooze", {
                                        reason: card.reason,
                                    }),
                                "다음 주에 다시 보여드립니다.",
                            )
                        }
                    >
                        <CalendarClock size={14} />
                        다음 주로
                    </button>
                    {card.status !== "welcome" && (
                        <button
                            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-muted-foreground disabled:opacity-50"
                            disabled={!canRespond || !!busy}
                            onClick={() =>
                                void run(
                                    "skip",
                                    () =>
                                        careAction(workspaceId, card.contactId, "skip", {
                                            reason: card.reason,
                                        }),
                                    "이번 주기는 건너뛰었습니다.",
                                )
                            }
                        >
                            <SkipForward size={14} />
                            이번 주기 건너뛰기
                        </button>
                    )}
                </div>
            )}
        </article>
    );
}
