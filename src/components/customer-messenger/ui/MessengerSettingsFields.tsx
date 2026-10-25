"use client";
import type { MessengerSettings } from "@/lib/customer-messenger/rules";
export function MessengerSettingsFields({
    value,
    onChange,
}: {
    value: MessengerSettings;
    onChange: (settings: MessengerSettings) => void;
}) {
    const update = (patch: Partial<MessengerSettings>) =>
        onChange({ ...value, ...patch });
    return (
        <fieldset className="space-y-4 rounded-xl border p-4 text-sm">
            <legend className="px-1 font-semibold">
                첫 상담 안내와 연락처
            </legend>
            <label className="flex items-center justify-between gap-3">
                첫 상담 프로세스 사용
                <input
                    aria-label="첫 상담 프로세스 사용"
                    type="checkbox"
                    checked={value.enabled}
                    onChange={(e) => update({ enabled: e.target.checked })}
                />
            </label>
            <label className="block space-y-2">
                브랜드 한 줄 소개
                <input
                    aria-label="브랜드 한 줄 소개"
                    className="w-full rounded-lg border px-3 py-2"
                    value={value.tagline}
                    onChange={(e) => update({ tagline: e.target.value })}
                    maxLength={120}
                    placeholder="고객에게 전할 서비스 소개를 입력해주세요"
                />
            </label>
            <label className="block space-y-2">
                1:1 도입 상담 링크
                <input
                    aria-label="도입 상담 링크"
                    type="url"
                    className="w-full rounded-lg border px-3 py-2"
                    value={value.consultationUrl}
                    onChange={(e) =>
                        update({ consultationUrl: e.target.value })
                    }
                    placeholder="https://example.com/consulting/"
                />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
                설치 도메인과 같은 사이트의 HTTPS 주소만 고객에게 보여줍니다.
                고객센터 운영시간은 ‘운영·성과’의 운영시간 설정을 사용합니다.
            </p>
            <label className="flex items-start gap-3 leading-5">
                <input
                    aria-label="고객 이메일 답변 알림 사용"
                    type="checkbox"
                    className="mt-1"
                    checked={value.emailNotifications}
                    onChange={(e) =>
                        update({ emailNotifications: e.target.checked })
                    }
                />
                고객 이메일 답변 알림 사용
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
                이메일 발신 설정과 알림 워커가 연결된 경우에만 고객에게
                노출합니다. 고객이 동의하고 주소를 인증한 뒤, 2분 동안 읽지 않은
                새 답변을 알립니다. 카카오톡·문자 알림은 포함하지 않습니다.
            </p>
        </fieldset>
    );
}
