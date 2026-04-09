import type { NhnTemplateButton, NhnTemplateQuickReply } from "@/lib/nhn-alimtalk";

interface TemplatePreviewProps {
    templateContent: string;
    templateMessageType: string;
    templateEmphasizeType: string;
    templateTitle?: string;
    templateSubtitle?: string;
    templateHeader?: string;
    templateExtra?: string;
    buttons: NhnTemplateButton[];
    quickReplies: NhnTemplateQuickReply[];
    interactionType: "buttons" | "quickReplies";
    templateImageUrl?: string;
    templateImageName?: string;
    templateItemHighlight?: {
        title: string;
        description: string;
        imageUrl?: string;
    } | null;
    templateItem?: {
        list: Array<{ title: string; description: string }>;
        summary?: { title: string; description: string };
    } | null;
    templateRepresentLink?: {
        linkMo: string;
        linkPc: string;
        schemeIos: string;
        schemeAndroid: string;
    } | null;
}

function highlightVariables(content: string) {
    return content.replace(
        /#\{([^}]+)\}/g,
        '<span class="bg-yellow-200 text-yellow-800 px-1 rounded text-xs font-mono">#{$1}</span>'
    );
}

const BUTTON_TYPE_LABELS: Record<string, string> = {
    WL: "웹링크",
    AL: "앱링크",
    DS: "배송조회",
    BK: "봇키워드",
    MD: "메시지전달",
    BC: "상담톡전환",
    BT: "봇전환",
    AC: "채널추가",
    BF: "비즈폼",
    P1: "이미지보안전송",
    P2: "개인정보이용",
    P3: "원클릭결제",
    TN: "전화번호",
};

export default function TemplatePreview({
    templateContent,
    templateMessageType,
    templateEmphasizeType,
    templateTitle,
    templateSubtitle,
    templateHeader,
    templateExtra,
    buttons,
    quickReplies,
    interactionType,
    templateImageUrl,
    templateItemHighlight,
    templateItem,
    templateRepresentLink,
}: TemplatePreviewProps) {
    const showExtra = (templateMessageType === "EX" || templateMessageType === "MI") && templateExtra;
    const showEmphasize = templateEmphasizeType === "TEXT" && (templateTitle || templateSubtitle);
    const showImage = templateEmphasizeType === "IMAGE" && templateImageUrl;
    const showItemList = templateEmphasizeType === "ITEM_LIST";
    const hasRepresentLink = templateRepresentLink &&
        (templateRepresentLink.linkMo || templateRepresentLink.linkPc ||
         templateRepresentLink.schemeIos || templateRepresentLink.schemeAndroid);

    return (
        <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">미리보기</p>
            <div className="bg-[#B2C7D9] rounded-lg p-4 min-h-[300px]">
                <div className="bg-white rounded-lg p-3 shadow-sm max-w-[280px] mx-auto">
                    {/* 헤더 */}
                    {templateHeader && (
                        <>
                            <div className="text-sm font-bold" dangerouslySetInnerHTML={{ __html: highlightVariables(templateHeader) }} />
                            <div className="border-t my-2" />
                        </>
                    )}

                    {/* 강조 (TEXT 타입) */}
                    {showEmphasize && (
                        <>
                            <div className="mb-2">
                                {templateTitle && (
                                    <div className="text-base font-bold leading-tight" dangerouslySetInnerHTML={{ __html: highlightVariables(templateTitle) }} />
                                )}
                                {templateSubtitle && (
                                    <div className="text-xs text-muted-foreground mt-0.5" dangerouslySetInnerHTML={{ __html: highlightVariables(templateSubtitle) }} />
                                )}
                            </div>
                            <div className="border-t my-2" />
                        </>
                    )}

                    {/* 강조 (IMAGE 타입) */}
                    {showImage && (
                        <>
                            <div className="mb-2 rounded overflow-hidden bg-gray-100 aspect-2/1 flex items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={templateImageUrl}
                                    alt="강조 이미지"
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                        (e.target as HTMLImageElement).parentElement!.innerHTML =
                                            '<span class="text-xs text-muted-foreground">이미지 미리보기</span>';
                                    }}
                                />
                            </div>
                            <div className="border-t my-2" />
                        </>
                    )}

                    {/* 강조 (ITEM_LIST 타입) — 하이라이트 → 아이템 리스트 → 본문 순 */}
                    {showItemList && (templateItemHighlight?.title || templateItemHighlight?.description) && (
                        <>
                            <div className="mb-2 flex gap-2 items-start">
                                <div className="min-w-0 flex-1">
                                    {templateItemHighlight.title && (
                                        <div className="text-sm font-bold leading-tight truncate" dangerouslySetInnerHTML={{ __html: highlightVariables(templateItemHighlight.title) }} />
                                    )}
                                    {templateItemHighlight.description && (
                                        <div className="text-xs text-muted-foreground mt-0.5 truncate" dangerouslySetInnerHTML={{ __html: highlightVariables(templateItemHighlight.description) }} />
                                    )}
                                </div>
                                {templateItemHighlight.imageUrl && (
                                    <div className="w-10 h-10 rounded bg-gray-100 shrink-0 overflow-hidden">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={templateItemHighlight.imageUrl} alt="" className="w-full h-full object-cover" />
                                    </div>
                                )}
                            </div>
                            <div className="border-t my-2" />
                        </>
                    )}

                    {/* 아이템 리스트 */}
                    {showItemList && templateItem && templateItem.list.length > 0 && (
                        <>
                            <div className="space-y-1">
                                {templateItem.list.map((item, i) => (
                                    <div key={i} className="flex justify-between text-xs">
                                        <span className="text-muted-foreground truncate" dangerouslySetInnerHTML={{ __html: highlightVariables(item.title || `항목 ${i + 1}`) }} />
                                        <span className="font-medium truncate ml-2" dangerouslySetInnerHTML={{ __html: highlightVariables(item.description) }} />
                                    </div>
                                ))}
                                {templateItem.summary && (templateItem.summary.title || templateItem.summary.description) && (
                                    <>
                                        <div className="border-t my-1" />
                                        <div className="flex justify-between text-xs font-bold">
                                            <span dangerouslySetInnerHTML={{ __html: highlightVariables(templateItem.summary.title || "") }} />
                                            <span dangerouslySetInnerHTML={{ __html: highlightVariables(templateItem.summary.description || "") }} />
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="border-t my-2" />
                        </>
                    )}

                    {/* 본문 */}
                    <div
                        className="text-sm whitespace-pre-wrap leading-relaxed"
                        dangerouslySetInnerHTML={{
                            __html: highlightVariables(templateContent || "(본문을 입력하세요)"),
                        }}
                    />

                    {/* 부가정보 */}
                    {showExtra && (
                        <>
                            <div className="border-t my-2" />
                            <div className="text-xs text-muted-foreground whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: highlightVariables(templateExtra!) }} />
                        </>
                    )}

                    {/* 대표 링크 */}
                    {hasRepresentLink && (
                        <>
                            <div className="border-t my-2" />
                            <div className="text-xs text-blue-500 truncate">
                                {templateRepresentLink!.linkMo || templateRepresentLink!.linkPc || "링크"}
                            </div>
                        </>
                    )}

                    {/* 버튼 */}
                    {interactionType === "buttons" && buttons.length > 0 && (
                        <div className="mt-3 space-y-1">
                            {buttons.map((btn, i) => (
                                <div
                                    key={i}
                                    className="text-center text-sm py-2 border rounded bg-gray-50 text-blue-600"
                                >
                                    {btn.name || `버튼 ${i + 1}`}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 빠른 응답 (말풍선 바깥) */}
                {interactionType === "quickReplies" && quickReplies.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 max-w-[280px] mx-auto">
                        {quickReplies.map((qr, i) => (
                            <span
                                key={i}
                                className="text-xs px-3 py-1.5 bg-white rounded-full border text-blue-600 shadow-sm"
                            >
                                {qr.name || `응답 ${i + 1}`}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* 메시지 유형 / 강조 유형 표시 */}
            <div className="flex gap-2 text-xs text-muted-foreground">
                <span>메시지: {templateMessageType || "BA"}</span>
                <span>강조: {templateEmphasizeType || "NONE"}</span>
                {interactionType === "buttons" && buttons.length > 0 && (
                    <span>버튼: {buttons.length}/5</span>
                )}
                {interactionType === "quickReplies" && quickReplies.length > 0 && (
                    <span>빠른응답: {quickReplies.length}/5</span>
                )}
            </div>
        </div>
    );
}
