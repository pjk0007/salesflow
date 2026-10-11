"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkWebhooks } from "../api/sendHealthApi";
import type { ChatDeliveryRow, WebhookCheckResult } from "../types";
import { formatKst } from "../utils/labels";

/**
 * 구글 챗 알림 전달 상태 (WPN-5): 받는 곳(사업 스페이스·운영 스페이스)마다 마지막 성공, 지금 문제(풀어 쓴 한국어),
 * 기다리는 알림 수. "연결 확인 보내기"는 받는 곳마다 확인 글 한 통을 보내 고장 난 웹훅을 미리 찾는다 (WPN-11).
 * 관리자에게만 보인다 (환경 변수 이름이 들어 있다).
 */
export default function ChatDeliverySection({ rows }: { rows: ChatDeliveryRow[] }) {
    const [checking, setChecking] = useState(false);
    const [results, setResults] = useState<WebhookCheckResult[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const onCheck = async () => {
        setChecking(true);
        setError(null);
        const r = await checkWebhooks();
        setChecking(false);
        if (r.success && r.data) setResults(r.data.results);
        else setError(r.error ?? "연결 확인을 하지 못했습니다.");
    };

    const problems = rows.filter((r) => r.kind);
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <p className="font-medium">알림 전달 (구글 챗)</p>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={checking} onClick={onCheck}>
                    <Send className="mr-1 h-3.5 w-3.5" />
                    {checking ? "확인 중…" : "연결 확인 보내기"}
                </Button>
            </div>
            {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">아직 보낸 알림이 없습니다. 연결 확인으로 웹훅을 미리 확인할 수 있습니다.</p>
            ) : (
                <ul className="divide-y rounded-md border text-xs">
                    {rows.map((r) => {
                        const waiting = r.waiting.deep + r.waiting.reply + r.waiting.health;
                        return (
                            <li key={r.source} className="space-y-0.5 px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    {r.kind ? (
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                                    ) : (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                    )}
                                    <span className="font-medium">{r.label}</span>
                                    <span className="font-mono text-[11px] text-muted-foreground">{r.source}</span>
                                </div>
                                {r.kind ? (
                                    <p className="text-amber-700">
                                        {r.problemText}
                                        {r.problemSince ? ` · ${formatKst(r.problemSince)}부터` : ""}
                                        {waiting > 0 ? ` · 기다리는 알림 ${waiting}건 (24시간 지나면 버려짐)` : ""}
                                    </p>
                                ) : (
                                    <p className="text-muted-foreground">정상 · 마지막 성공 {r.lastOkAt ? formatKst(r.lastOkAt) : "-"}</p>
                                )}
                                {r.kind && r.lastError ? <p className="text-muted-foreground">{r.lastError}</p> : null}
                            </li>
                        );
                    })}
                </ul>
            )}
            {problems.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    고치는 법: 그 스페이스 관리자에게 새 웹훅 주소를 받아 위 환경 변수를 바꾸고 배포해 주세요 (개발 담당에게 요청).
                </p>
            )}
            {error && <p className="text-xs text-red-700">{error}</p>}
            {results && (
                <ul className="space-y-0.5 text-xs">
                    {results.map((r) => (
                        <li key={r.source} className={r.ok ? "text-emerald-700" : "text-amber-700"}>
                            {r.ok ? "✓" : "✗"} {r.label} ({r.source}) — {r.message}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
