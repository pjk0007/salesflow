"use client";
import { useState } from "react";
import { MessageCircle, Paperclip, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MessengerSettings } from "@/lib/customer-messenger/rules";
import { MessengerHome } from "./MessengerHome";
import { WelcomeProcess } from "./WelcomeProcess";

/**
 * 상담 설정 › 사이트 상담창 오른쪽 미리보기 — 저장 전 값으로 고객 상담창 홈·대화 화면을 그린다.
 * 사이트에 붙인 로고(data-brand-logo)는 사이트 설치 코드 쪽 설정이라 여기선 이름으로 보인다.
 */
export function MessengerPreview({
    name,
    greeting,
    color,
    settings,
}: {
    name: string;
    greeting: string;
    color: string;
    settings: MessengerSettings;
}) {
    const [tab, setTab] = useState<"home" | "chat">("home");
    const publicSettings = { ...settings, aiAvailable: false, weekly: [] };
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
                {(
                    [
                        ["home", "홈"],
                        ["chat", "대화"],
                    ] as const
                ).map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={cn("rounded-md py-1.5", tab === id ? "bg-background font-semibold" : "text-muted-foreground")}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="flex h-[600px] flex-col overflow-hidden rounded-lg border border-border/70 bg-white font-sans text-gray-900">
                {tab === "home" ? (
                    <MessengerHome
                        name={name || "고객 상담"}
                        greeting={greeting}
                        settings={publicSettings}
                        color={color}
                        busy={false}
                        loading={false}
                        returning={false}
                        unread={0}
                        hasConversations={false}
                        onStart={() => setTab("chat")}
                        onConversations={() => setTab("chat")}
                    />
                ) : (
                    <>
                        <header className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-4">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: color }}>
                                <MessageCircle size={20} aria-hidden="true" />
                            </span>
                            <span className="truncate font-semibold">{name || "고객 상담"}</span>
                        </header>
                        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                            <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-gray-100 px-4 py-3">
                                <WelcomeProcess settings={publicSettings} greeting={greeting} compact />
                            </div>
                            <p
                                className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md px-4 py-3 text-sm text-white"
                                style={{ backgroundColor: color }}
                            >
                                안녕하세요, 문의드려요.
                            </p>
                        </div>
                        <div className="shrink-0 p-3">
                            <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-3 text-sm text-gray-400">
                                <span className="flex-1">메시지를 입력하세요</span>
                                <Paperclip size={18} aria-hidden="true" />
                                <Send size={18} style={{ color }} aria-hidden="true" />
                            </div>
                        </div>
                    </>
                )}
            </div>
            <div className="flex justify-end">
                <span className="flex h-14 w-14 items-center justify-center rounded-full text-white" style={{ backgroundColor: color }}>
                    <MessageCircle size={26} aria-hidden="true" />
                </span>
            </div>
            <p className="text-xs text-muted-foreground">저장 전 내용으로 보여주는 미리보기예요. 사이트 로고는 설치 코드 쪽 설정이라 여기선 이름으로 보여요.</p>
        </div>
    );
}
