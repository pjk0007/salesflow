"use client";

import { useSearchParams } from "next/navigation";
import { useUnsubscribe } from "../hooks/useUnsubscribe";
import { UNSUBSCRIBE_REASONS, type UnsubscribeReason } from "../types";

// 공개 페이지 — 앱 테마(CSS 변수)가 걸리지 않으므로 색을 명시한다.
// shadcn Button/RadioGroup은 --border, --background에 의존해 흰 배경에서 사라진다.

function Spinner({ className = "" }: { className?: string }) {
    return (
        <svg
            className={`animate-spin ${className}`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
        >
            <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeOpacity="0.15"
            />
            <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
            />
        </svg>
    );
}

export function UnsubscribeCard() {
    const token = useSearchParams().get("token");
    const {
        status,
        isSubmitting,
        selectedReason,
        setSelectedReason,
        reasonDetail,
        setReasonDetail,
        reasonStatus,
        confirm,
        sendReason,
    } = useUnsubscribe(token);

    return (
        <main className="min-h-screen bg-[#faf9f7] px-5 py-16 flex items-start sm:items-center justify-center">
            <div className="w-full max-w-[420px] animate-[fadeUp_.4s_ease-out]">
                <style>{`
                    @keyframes fadeUp {
                        from { opacity: 0; transform: translateY(8px); }
                        to   { opacity: 1; transform: translateY(0); }
                    }
                `}</style>

                <div className="bg-white rounded-2xl border border-[#e8e5e0] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-12px_rgba(0,0,0,0.08)] p-8 sm:p-10">
                    {status.kind === "loading" && (
                        <div className="py-8 flex justify-center">
                            <Spinner className="w-6 h-6 text-[#8a8580]" />
                        </div>
                    )}

                    {status.kind === "invalid" && (
                        <div className="text-center">
                            <h1 className="text-[19px] font-semibold text-[#1c1b1a] tracking-[-0.01em]">
                                처리할 수 없습니다
                            </h1>
                            <p className="mt-2.5 text-[14px] leading-relaxed text-[#78736d]">
                                {status.message}
                            </p>
                        </div>
                    )}

                    {/* 확인 — 거부를 가로막는 것은 아무것도 두지 않는다. 버튼 하나뿐. */}
                    {status.kind === "confirm" && (
                        <div className="text-center">
                            <h1 className="text-[19px] font-semibold text-[#1c1b1a] tracking-[-0.01em]">
                                수신거부
                            </h1>

                            <p className="mt-5 text-[15px] font-medium text-[#1c1b1a] break-all">
                                {status.email}
                            </p>
                            <p className="mt-1.5 text-[14px] leading-relaxed text-[#78736d]">
                                앞으로 이 주소로 메일을 보내지 않습니다.
                            </p>

                            <button
                                type="button"
                                onClick={confirm}
                                disabled={isSubmitting}
                                className="mt-8 w-full h-11 rounded-xl bg-[#1c1b1a] text-white text-[14px] font-medium
                                           inline-flex items-center justify-center gap-2
                                           transition-colors duration-150
                                           hover:bg-[#333130] active:bg-[#0f0e0e]
                                           disabled:opacity-50 disabled:cursor-not-allowed
                                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1b1a] focus-visible:ring-offset-2"
                            >
                                {isSubmitting && <Spinner className="w-4 h-4" />}
                                수신거부하기
                            </button>
                        </div>
                    )}

                    {status.kind === "done" && (
                        <>
                            <div className="text-center">
                                <div className="mx-auto w-11 h-11 rounded-full bg-[#eef6f0] flex items-center justify-center">
                                    <svg
                                        className="w-[22px] h-[22px] text-[#2f7d4f]"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        aria-hidden="true"
                                    >
                                        <path
                                            d="M5 12.5l4.5 4.5L19 7.5"
                                            stroke="currentColor"
                                            strokeWidth="2.2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </div>

                                <h1 className="mt-5 text-[19px] font-semibold text-[#1c1b1a] tracking-[-0.01em]">
                                    수신거부되었습니다
                                </h1>
                                <p className="mt-4 text-[15px] font-medium text-[#1c1b1a] break-all">
                                    {status.email}
                                </p>
                                <p className="mt-1.5 text-[14px] leading-relaxed text-[#78736d]">
                                    앞으로 이 주소로 메일을 보내지 않습니다.
                                </p>
                            </div>

                            {/* 사유는 거부가 끝난 뒤에만 묻는다. 남기지 않고 떠나도 거부는 유효하다. */}
                            {reasonStatus === "submitted" ? (
                                <p className="mt-8 pt-6 border-t border-[#f0ede9] text-center text-[14px] text-[#78736d]">
                                    의견 감사합니다.
                                </p>
                            ) : (
                                <div className="mt-8 pt-7 border-t border-[#f0ede9]">
                                    <p className="text-[14px] text-[#57534e]">
                                        괜찮으시다면 이유를 알려주시겠어요?
                                        <span className="ml-1 text-[#a8a29b]">선택</span>
                                    </p>

                                    <div className="mt-4 space-y-1">
                                        {UNSUBSCRIBE_REASONS.map((item) => {
                                            const isSelected = selectedReason === item;
                                            return (
                                                <label
                                                    key={item}
                                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
                                                                border transition-colors duration-150
                                                                ${
                                                                    isSelected
                                                                        ? "border-[#1c1b1a] bg-[#faf9f7]"
                                                                        : "border-transparent hover:bg-[#faf9f7]"
                                                                }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="unsubscribe-reason"
                                                        value={item}
                                                        checked={isSelected}
                                                        onChange={() =>
                                                            setSelectedReason(item as UnsubscribeReason)
                                                        }
                                                        className="sr-only"
                                                    />
                                                    <span
                                                        className={`shrink-0 w-[17px] h-[17px] rounded-full border-[1.5px] flex items-center justify-center
                                                                    transition-colors duration-150
                                                                    ${
                                                                        isSelected
                                                                            ? "border-[#1c1b1a]"
                                                                            : "border-[#d6d1cb]"
                                                                    }`}
                                                    >
                                                        {isSelected && (
                                                            <span className="w-[7px] h-[7px] rounded-full bg-[#1c1b1a]" />
                                                        )}
                                                    </span>
                                                    <span className="text-[14px] text-[#3c3936] leading-none">
                                                        {item}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>

                                    {selectedReason === "기타" && (
                                        <input
                                            type="text"
                                            value={reasonDetail}
                                            onChange={(e) => setReasonDetail(e.target.value)}
                                            placeholder="사유를 입력해주세요"
                                            autoFocus
                                            className="mt-3 w-full h-10 px-3 rounded-lg border border-[#e0dcd7] bg-white
                                                       text-[14px] text-[#1c1b1a] placeholder:text-[#a8a29b]
                                                       transition-colors duration-150
                                                       focus:outline-none focus:border-[#1c1b1a]"
                                        />
                                    )}

                                    <button
                                        type="button"
                                        onClick={sendReason}
                                        disabled={!selectedReason || reasonStatus === "submitting"}
                                        className="mt-5 w-full h-10 rounded-xl border border-[#dcd8d2] bg-white
                                                   text-[14px] font-medium text-[#3c3936]
                                                   inline-flex items-center justify-center gap-2
                                                   transition-colors duration-150
                                                   hover:bg-[#faf9f7] hover:border-[#c9c4bd]
                                                   disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white
                                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1c1b1a] focus-visible:ring-offset-2"
                                    >
                                        {reasonStatus === "submitting" && <Spinner className="w-4 h-4" />}
                                        보내기
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}
