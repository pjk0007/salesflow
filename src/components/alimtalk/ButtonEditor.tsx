import type { NhnTemplateButton } from "@/lib/nhn-alimtalk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";

interface ButtonEditorProps {
    buttons: NhnTemplateButton[];
    onChange: (buttons: NhnTemplateButton[]) => void;
    messageType: string;
}

const BUTTON_TYPES = [
    { value: "WL", label: "웹링크" },
    { value: "AL", label: "앱링크" },
    { value: "DS", label: "배송조회" },
    { value: "BK", label: "봇키워드" },
    { value: "MD", label: "메시지전달" },
    { value: "BC", label: "상담톡전환" },
    { value: "BT", label: "봇전환" },
    { value: "AC", label: "채널추가" },
    { value: "BF", label: "비즈폼" },
    { value: "TN", label: "전화번호" },
];

function getEmptyButton(ordering: number): NhnTemplateButton {
    return { ordering, type: "WL", name: "" };
}

export default function ButtonEditor({ buttons, onChange, messageType }: ButtonEditorProps) {
    const isAdOrMi = messageType === "AD" || messageType === "MI";
    const hasAcButton = buttons.some((b) => b.type === "AC");

    // AD/MI 유형이면 첫 번째 버튼이 AC여야 함
    const ensureAcButton = (btns: NhnTemplateButton[]): NhnTemplateButton[] => {
        if (!isAdOrMi) return btns;
        if (btns.length === 0 || btns[0].type !== "AC") {
            const ac: NhnTemplateButton = { ordering: 1, type: "AC", name: "채널 추가" };
            return [ac, ...btns.map((b, i) => ({ ...b, ordering: i + 2 }))];
        }
        return btns;
    };

    const handleAdd = () => {
        if (buttons.length >= 5) return;
        const newButtons = [...buttons, getEmptyButton(buttons.length + 1)];
        onChange(ensureAcButton(newButtons));
    };

    const handleRemove = (index: number) => {
        // AD/MI 유형에서 AC 버튼(첫 번째)은 삭제 불가
        if (isAdOrMi && buttons[index].type === "AC") return;
        const newButtons = buttons
            .filter((_, i) => i !== index)
            .map((b, i) => ({ ...b, ordering: i + 1 }));
        onChange(newButtons);
    };

    const handleChange = (index: number, field: keyof NhnTemplateButton, value: string | number) => {
        const newButtons = buttons.map((b, i) => {
            if (i !== index) return b;
            const updated = { ...b, [field]: value };
            // AC 타입이면 이름 고정
            if (field === "type" && value === "AC") {
                updated.name = "채널 추가";
            }
            return updated;
        });
        onChange(ensureAcButton(newButtons));
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-sm font-medium">버튼 ({buttons.length}/5)</p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAdd}
                    disabled={buttons.length >= 5}
                >
                    <Plus className="h-3 w-3 mr-1" /> 추가
                </Button>
            </div>

            {buttons.map((btn, index) => {
                const isAcLocked = isAdOrMi && btn.type === "AC" && index === 0;

                return (
                    <div key={index} className="flex items-start gap-2 p-2 border rounded-md bg-muted/30">
                        <span className="text-xs text-muted-foreground mt-2 w-4 shrink-0">
                            {index + 1}
                        </span>

                        <Select
                            value={btn.type}
                            onValueChange={(v) => handleChange(index, "type", v)}
                            disabled={isAcLocked}
                        >
                            <SelectTrigger className="w-[110px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {BUTTON_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <div className="flex-1 space-y-1">
                            <Input
                                placeholder="버튼 이름"
                                value={btn.name}
                                onChange={(e) => handleChange(index, "name", e.target.value)}
                                disabled={isAcLocked}
                                className="h-8"
                            />

                            {/* WL: 웹링크 */}
                            {btn.type === "WL" && (
                                <div className="space-y-1">
                                    <Input
                                        placeholder="모바일 링크 (필수)"
                                        value={btn.linkMo || ""}
                                        onChange={(e) => handleChange(index, "linkMo", e.target.value)}
                                        className="h-8 text-xs"
                                    />
                                    <Input
                                        placeholder="PC 링크 (선택)"
                                        value={btn.linkPc || ""}
                                        onChange={(e) => handleChange(index, "linkPc", e.target.value)}
                                        className="h-8 text-xs"
                                    />
                                </div>
                            )}

                            {/* AL: 앱링크 */}
                            {btn.type === "AL" && (
                                <div className="space-y-1">
                                    <Input
                                        placeholder="iOS 스킴 (필수)"
                                        value={btn.schemeIos || ""}
                                        onChange={(e) => handleChange(index, "schemeIos", e.target.value)}
                                        className="h-8 text-xs"
                                    />
                                    <Input
                                        placeholder="Android 스킴 (필수)"
                                        value={btn.schemeAndroid || ""}
                                        onChange={(e) => handleChange(index, "schemeAndroid", e.target.value)}
                                        className="h-8 text-xs"
                                    />
                                </div>
                            )}

                            {/* BF: 비즈폼 */}
                            {btn.type === "BF" && (
                                <Input
                                    placeholder="비즈폼 ID (필수)"
                                    type="number"
                                    value={btn.bizFormId || ""}
                                    onChange={(e) => handleChange(index, "bizFormId", Number(e.target.value))}
                                    className="h-8 text-xs"
                                />
                            )}

                            {/* TN: 전화번호 */}
                            {btn.type === "TN" && (
                                <Input
                                    placeholder="전화번호 (필수)"
                                    value={btn.telNumber || ""}
                                    onChange={(e) => handleChange(index, "telNumber", e.target.value)}
                                    className="h-8 text-xs"
                                />
                            )}
                        </div>

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => handleRemove(index)}
                            disabled={isAcLocked}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </div>
                );
            })}

            {buttons.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                    버튼이 없습니다. 추가 버튼을 눌러 버튼을 추가하세요.
                </p>
            )}
        </div>
    );
}
