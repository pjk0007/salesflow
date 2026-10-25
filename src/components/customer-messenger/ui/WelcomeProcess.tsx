"use client";
import { Phone, Clock3 } from "lucide-react";
import type { PublicMessengerSettings } from "../types";
import { supportHoursText, customerWelcome } from "../utils/presentation";
export function WelcomeProcess({
    settings,
    customerName,
    greeting,
    compact = false,
}: {
    settings?: PublicMessengerSettings;
    customerName?: string;
    greeting: string;
    compact?: boolean;
}) {
    if (!settings?.enabled)
        return (
            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">
                {greeting}
            </p>
        );
    return (
        <div className="space-y-4 text-sm leading-6 text-gray-600">
            <div>
                <p className="font-semibold text-gray-900">
                    {customerWelcome(customerName)}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{greeting}</p>
            </div>
            <div
                className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-6"
                aria-label="상담 운영시간"
            >
                <p className="flex items-center gap-1.5 font-medium text-gray-700">
                    <Clock3 size={13} />
                    운영시간
                </p>
                <p>고객센터 : {supportHoursText(settings.weekly)}</p>
                {settings.aiAvailable && <p>AI 상담 : 24시간 연중무휴</p>}
            </div>
            {!compact && settings.consultationUrl && (
                <a
                    href={settings.consultationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-violet-100 bg-violet-50/50 p-3 text-gray-700"
                >
                    <p className="font-medium">서비스 이용이 처음이신가요?</p>
                    <p className="mt-1 text-xs">
                        1:1 도입 상담으로 맞춤 안내를 받아보세요.
                    </p>
                    <span className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-violet-700">
                        <Phone size={13} />
                        1:1 도입 상담 신청하기 ↗
                    </span>
                </a>
            )}
        </div>
    );
}
