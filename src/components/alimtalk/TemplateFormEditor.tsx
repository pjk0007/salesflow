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
import { useAlimtalkTemplateCategories } from "@/hooks/useAlimtalkTemplateCategories";
import ButtonEditor from "./ButtonEditor";
import QuickReplyEditor from "./QuickReplyEditor";
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
