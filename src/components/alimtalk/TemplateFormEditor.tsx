import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { useAlimtalkTemplateCategories } from "@/hooks/useAlimtalkTemplateCategories";
import ButtonEditor from "./ButtonEditor";
import QuickReplyEditor from "./QuickReplyEditor";
import ImageUpload from "./ImageUpload";
import { Plus, Trash2 } from "lucide-react";
import type { NhnTemplateButton, NhnTemplateQuickReply } from "@/lib/nhn-alimtalk";

export interface TemplateFormState {
    templateCode: string;
    templateName: string;
    templateContent: string;
    templateMessageType: string;
    templateEmphasizeType: string;
    templateExtra: string;
    templateTitle: string;
    templateSubtitle: string;
    templateHeader: string;
    securityFlag: boolean;
    categoryCode: string;
    buttons: NhnTemplateButton[];
    quickReplies: NhnTemplateQuickReply[];
    interactionType: "buttons" | "quickReplies";
    templateImageName: string;
    templateImageUrl: string;
    templateItem: {
        list: Array<{ title: string; description: string }>;
        summary?: { title: string; description: string };
    } | null;
    templateItemHighlight: {
        title: string;
        description: string;
        imageUrl?: string;
    } | null;
    templateRepresentLink: {
        linkMo: string;
        linkPc: string;
        schemeIos: string;
        schemeAndroid: string;
    } | null;
}

interface TemplateFormEditorProps {
    value: TemplateFormState;
    onChange: (state: TemplateFormState) => void;
    mode: "create" | "edit";
}

const MESSAGE_TYPES = [
    { value: "BA", label: "기본형 (BA)" },
    { value: "EX", label: "부가정보형 (EX)" },
    { value: "AD", label: "광고추가형 (AD)" },
    { value: "MI", label: "복합형 (MI)" },
];

const EMPHASIZE_TYPES = [
    { value: "NONE", label: "없음" },
    { value: "TEXT", label: "텍스트 강조" },
    { value: "IMAGE", label: "이미지 강조" },
    { value: "ITEM_LIST", label: "아이템 리스트" },
];

export default function TemplateFormEditor({ value, onChange, mode }: TemplateFormEditorProps) {
    const { categoryGroups } = useAlimtalkTemplateCategories();

    const update = (partial: Partial<TemplateFormState>) => {
        const next = { ...value, ...partial };

        // AD/MI 유형 변경 시 AC 버튼 자동 추가
        if (partial.templateMessageType === "AD" || partial.templateMessageType === "MI") {
            if (next.interactionType === "buttons") {
                if (next.buttons.length === 0 || next.buttons[0].type !== "AC") {
                    const ac: NhnTemplateButton = { ordering: 1, type: "AC", name: "채널 추가" };
                    next.buttons = [ac, ...next.buttons.map((b, i) => ({ ...b, ordering: i + 2 }))];
                }
            }
        }

        // 버튼 ↔ 빠른응답 전환 시 반대쪽 초기화
        if (partial.interactionType === "buttons") {
            next.quickReplies = [];
        } else if (partial.interactionType === "quickReplies") {
            next.buttons = [];
        }

        onChange(next);
    };

    const showExtra = value.templateMessageType === "EX" || value.templateMessageType === "MI";
    const showEmphasize = value.templateEmphasizeType === "TEXT";
    const showImage = value.templateEmphasizeType === "IMAGE";
    const showItemList = value.templateEmphasizeType === "ITEM_LIST";


    return (
        <div className="space-y-4 overflow-y-auto pr-1">
            {/* 템플릿 코드 */}
            <div className="space-y-1">
                <Label htmlFor="templateCode">템플릿 코드</Label>
                <Input
                    id="templateCode"
                    placeholder="영문, 숫자, _ 조합 (최대 20자)"
                    value={value.templateCode}
                    onChange={(e) => update({ templateCode: e.target.value })}
                    disabled={mode === "edit"}
                    maxLength={20}
                />
            </div>

            {/* 템플릿 이름 */}
            <div className="space-y-1">
                <Label htmlFor="templateName">템플릿 이름</Label>
                <Input
                    id="templateName"
                    placeholder="템플릿 이름 (최대 150자)"
                    value={value.templateName}
                    onChange={(e) => update({ templateName: e.target.value })}
                    maxLength={150}
                />
            </div>

            {/* 메시지 유형 */}
            <div className="space-y-1">
                <Label>메시지 유형</Label>
                <Select
                    value={value.templateMessageType}
                    onValueChange={(v) => update({ templateMessageType: v })}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {MESSAGE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                                {t.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 강조 유형 */}
            <div className="space-y-1">
                <Label>강조 유형</Label>
                <Select
                    value={value.templateEmphasizeType}
                    onValueChange={(v) => update({ templateEmphasizeType: v })}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {EMPHASIZE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                                {t.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* TEXT 강조 시 타이틀/서브타이틀 */}
            {showEmphasize && (
                <div className="space-y-2 pl-2 border-l-2 border-blue-200">
                    <div className="space-y-1">
                        <Label htmlFor="templateTitle">강조 타이틀</Label>
                        <Input
                            id="templateTitle"
                            placeholder="강조 타이틀 (최대 50자)"
                            value={value.templateTitle}
                            onChange={(e) => update({ templateTitle: e.target.value })}
                            maxLength={50}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="templateSubtitle">강조 서브타이틀</Label>
                        <Input
                            id="templateSubtitle"
                            placeholder="강조 서브타이틀 (최대 50자)"
                            value={value.templateSubtitle}
                            onChange={(e) => update({ templateSubtitle: e.target.value })}
                            maxLength={50}
                        />
                    </div>
                </div>
            )}

            {/* IMAGE 강조 시 이미지 업로드 */}
            {showImage && (
                <div className="space-y-2 pl-2 border-l-2 border-blue-200">
                    <Label>강조 이미지</Label>
                    <ImageUpload
                        value={value.templateImageUrl}
                        onChange={(url, fileName) =>
                            update({ templateImageUrl: url, templateImageName: fileName || "" })
                        }
                        hint="800×400px 권장 (2:1, 최대 10MB)"
                        aspect="aspect-[2/1]"
                        uploadUrl="/api/alimtalk/template-image"
                    />
                </div>
            )}

            {/* ITEM_LIST 강조 시 하이라이트 + 아이템 리스트 */}
            {showItemList && (
                <div className="space-y-3 pl-2 border-l-2 border-blue-200">
                    {/* 아이템 하이라이트 */}
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">아이템 하이라이트</Label>
                        <div className="space-y-1">
                            <Input
                                placeholder="제목 (최대 30자)"
                                value={value.templateItemHighlight?.title ?? ""}
                                onChange={(e) => update({
                                    templateItemHighlight: {
                                        title: e.target.value,
                                        description: value.templateItemHighlight?.description ?? "",
                                        imageUrl: value.templateItemHighlight?.imageUrl,
                                    },
                                })}
                                maxLength={30}
                            />
                        </div>
                        <div className="space-y-1">
                            <Input
                                placeholder="설명 (최대 19자)"
                                value={value.templateItemHighlight?.description ?? ""}
                                onChange={(e) => update({
                                    templateItemHighlight: {
                                        title: value.templateItemHighlight?.title ?? "",
                                        description: e.target.value,
                                        imageUrl: value.templateItemHighlight?.imageUrl,
                                    },
                                })}
                                maxLength={19}
                            />
                        </div>
                        <ImageUpload
                            value={value.templateItemHighlight?.imageUrl ?? ""}
                            onChange={(url) => update({
                                templateItemHighlight: {
                                    title: value.templateItemHighlight?.title ?? "",
                                    description: value.templateItemHighlight?.description ?? "",
                                    imageUrl: url || undefined,
                                },
                            })}
                            label="이미지 (선택)"
                            hint="JPG, PNG (최대 5MB)"
                            aspect="aspect-square w-28"
                            uploadUrl="/api/alimtalk/template-image?type=item-highlight"
                        />
                    </div>

                    {/* 아이템 리스트 */}
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">아이템 리스트</Label>
                        {(value.templateItem?.list ?? []).map((item, idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                                <Input
                                    placeholder="제목"
                                    value={item.title}
                                    onChange={(e) => {
                                        const list = [...(value.templateItem?.list ?? [])];
                                        list[idx] = { ...list[idx], title: e.target.value };
                                        update({ templateItem: { ...value.templateItem!, list } });
                                    }}
                                    className="flex-1"
                                />
                                <Input
                                    placeholder="설명"
                                    value={item.description}
                                    onChange={(e) => {
                                        const list = [...(value.templateItem?.list ?? [])];
                                        list[idx] = { ...list[idx], description: e.target.value };
                                        update({ templateItem: { ...value.templateItem!, list } });
                                    }}
                                    className="flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        const list = (value.templateItem?.list ?? []).filter((_, i) => i !== idx);
                                        if (list.length < 2) return;
                                        update({ templateItem: { ...value.templateItem!, list } });
                                    }}
                                    disabled={(value.templateItem?.list ?? []).length <= 2}
                                    className="shrink-0"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))}
                        {(value.templateItem?.list ?? []).length < 10 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    const list = [...(value.templateItem?.list ?? []), { title: "", description: "" }];
                                    update({ templateItem: { ...(value.templateItem ?? { list: [] }), list } });
                                }}
                            >
                                <Plus className="h-4 w-4 mr-1" />
                                항목 추가 ({(value.templateItem?.list ?? []).length}/10)
                            </Button>
                        )}

                        {/* 요약 */}
                        <div className="space-y-1 pt-2 border-t">
                            <Label className="text-xs text-muted-foreground">요약 (선택)</Label>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="요약 제목 (최대 6자)"
                                    value={value.templateItem?.summary?.title ?? ""}
                                    onChange={(e) => {
                                        const summary = {
                                            title: e.target.value,
                                            description: value.templateItem?.summary?.description ?? "",
                                        };
                                        update({ templateItem: { ...value.templateItem!, summary } });
                                    }}
                                    maxLength={6}
                                    className="flex-1"
                                />
                                <Input
                                    placeholder="요약 설명 (최대 14자)"
                                    value={value.templateItem?.summary?.description ?? ""}
                                    onChange={(e) => {
                                        const summary = {
                                            title: value.templateItem?.summary?.title ?? "",
                                            description: e.target.value,
                                        };
                                        update({ templateItem: { ...value.templateItem!, summary } });
                                    }}
                                    maxLength={14}
                                    className="flex-1"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 헤더 */}
            <div className="space-y-1">
                <Label htmlFor="templateHeader">헤더</Label>
                <Input
                    id="templateHeader"
                    placeholder="헤더 (최대 16자, 선택)"
                    value={value.templateHeader}
                    onChange={(e) => update({ templateHeader: e.target.value })}
                    maxLength={16}
                />
            </div>

            {/* 본문 */}
            <div className="space-y-1">
                <div className="flex items-center justify-between">
                    <Label htmlFor="templateContent">본문</Label>
                    <span className="text-xs text-muted-foreground">
                        {value.templateContent.length}/1300
                    </span>
                </div>
                <Textarea
                    id="templateContent"
                    placeholder="메시지 본문을 입력하세요.&#10;변수: #{변수명} 형식으로 입력"
                    value={value.templateContent}
                    onChange={(e) => update({ templateContent: e.target.value })}
                    maxLength={1300}
                    rows={6}
                />
            </div>

            {/* 부가정보 (EX/MI) */}
            {showExtra && (
                <div className="space-y-1">
                    <Label htmlFor="templateExtra">부가정보</Label>
                    <Textarea
                        id="templateExtra"
                        placeholder="부가정보를 입력하세요."
                        value={value.templateExtra}
                        onChange={(e) => update({ templateExtra: e.target.value })}
                        rows={3}
                    />
                </div>
            )}

            {/* 보안 템플릿 */}
            <div className="flex items-center gap-2">
                <Checkbox
                    id="securityFlag"
                    checked={value.securityFlag}
                    onCheckedChange={(checked) => update({ securityFlag: checked === true })}
                />
                <Label htmlFor="securityFlag" className="text-sm font-normal">
                    보안 템플릿 (OTP 등 민감 정보)
                </Label>
            </div>

            {/* 카테고리 */}
            <div className="space-y-1">
                <Label>카테고리</Label>
                <Select
                    value={value.categoryCode}
                    onValueChange={(v) => update({ categoryCode: v })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="카테고리 선택 (선택)" />
                    </SelectTrigger>
                    <SelectContent>
                        {categoryGroups.map((group) => (
                            <SelectGroup key={group.name}>
                                <SelectLabel>{group.name}</SelectLabel>
                                {group.subCategories.map((cat) => (
                                    <SelectItem key={cat.code} value={cat.code}>
                                        {cat.name}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 대표 링크 */}
            <div className="space-y-2">
                <Label className="text-sm font-medium">대표 링크 (선택)</Label>
                <div className="space-y-1">
                    <Input
                        placeholder="모바일 웹 링크"
                        value={value.templateRepresentLink?.linkMo ?? ""}
                        onChange={(e) => update({
                            templateRepresentLink: {
                                linkMo: e.target.value,
                                linkPc: value.templateRepresentLink?.linkPc ?? "",
                                schemeIos: value.templateRepresentLink?.schemeIos ?? "",
                                schemeAndroid: value.templateRepresentLink?.schemeAndroid ?? "",
                            },
                        })}
                    />
                    <Input
                        placeholder="PC 웹 링크"
                        value={value.templateRepresentLink?.linkPc ?? ""}
                        onChange={(e) => update({
                            templateRepresentLink: {
                                linkMo: value.templateRepresentLink?.linkMo ?? "",
                                linkPc: e.target.value,
                                schemeIos: value.templateRepresentLink?.schemeIos ?? "",
                                schemeAndroid: value.templateRepresentLink?.schemeAndroid ?? "",
                            },
                        })}
                    />
                    <Input
                        placeholder="iOS 앱 스킴"
                        value={value.templateRepresentLink?.schemeIos ?? ""}
                        onChange={(e) => update({
                            templateRepresentLink: {
                                linkMo: value.templateRepresentLink?.linkMo ?? "",
                                linkPc: value.templateRepresentLink?.linkPc ?? "",
                                schemeIos: e.target.value,
                                schemeAndroid: value.templateRepresentLink?.schemeAndroid ?? "",
                            },
                        })}
                    />
                    <Input
                        placeholder="Android 앱 스킴"
                        value={value.templateRepresentLink?.schemeAndroid ?? ""}
                        onChange={(e) => update({
                            templateRepresentLink: {
                                linkMo: value.templateRepresentLink?.linkMo ?? "",
                                linkPc: value.templateRepresentLink?.linkPc ?? "",
                                schemeIos: value.templateRepresentLink?.schemeIos ?? "",
                                schemeAndroid: e.target.value,
                            },
                        })}
                    />
                </div>
            </div>

            {/* 상호작용 타입 토글 */}
            <div className="space-y-2">
                <Label>상호작용</Label>
                <RadioGroup
                    value={value.interactionType}
                    onValueChange={(v) => update({ interactionType: v as "buttons" | "quickReplies" })}
                    className="flex gap-4"
                >
                    <div className="flex items-center gap-1.5">
                        <RadioGroupItem value="buttons" id="radio-buttons" />
                        <Label htmlFor="radio-buttons" className="text-sm font-normal">버튼</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <RadioGroupItem value="quickReplies" id="radio-qr" />
                        <Label htmlFor="radio-qr" className="text-sm font-normal">빠른 응답</Label>
                    </div>
                </RadioGroup>
            </div>

            {/* 버튼 / 빠른 응답 편집기 */}
            {value.interactionType === "buttons" ? (
                <ButtonEditor
                    buttons={value.buttons}
                    onChange={(buttons) => update({ buttons })}
                    messageType={value.templateMessageType}
                />
            ) : (
                <QuickReplyEditor
                    quickReplies={value.quickReplies}
                    onChange={(quickReplies) => update({ quickReplies })}
                />
            )}
        </div>
    );
}
