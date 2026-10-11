"use client";

import { ShieldAlert } from "lucide-react";
import { useSendHealth } from "../hooks/useSendHealth";
import { bannerText } from "../utils/labels";

/**
 * 이메일 첫 화면 맨 위 띠 (DESIGN-SND 10절): 보류·자동 멈춤이 있으면 "명단 1개 보류 · 주소 1개 자동 멈춤 — 자세히".
 * "자세히"는 아래 발신 건강 카드(#send-health)로 옮긴다. 보류·멈춤이 없거나 못 읽었으면 띠를 보이지 않는다.
 */
export default function SendHealthBanner() {
    const { view } = useSendHealth();
    const text = view ? bannerText(view.holds, view.senders) : null;
    if (!text) return null;
    return (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 flex-1">
                {text}{" "}
                <a
                    href="#send-health"
                    className="font-medium underline underline-offset-2"
                    onClick={(e) => {
                        const el = document.getElementById("send-health");
                        if (el) {
                            e.preventDefault();
                            el.scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                    }}
                >
                    자세히
                </a>
            </p>
        </div>
    );
}
