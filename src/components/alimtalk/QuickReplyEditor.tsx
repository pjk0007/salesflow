import type { NhnTemplateQuickReply } from "@/lib/nhn-alimtalk";
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

interface QuickReplyEditorProps {
    quickReplies: NhnTemplateQuickReply[];
    onChange: (quickReplies: NhnTemplateQuickReply[]) => void;
}

const QR_TYPES = [
    { value: "WL", label: "웹링크" },
    { value: "AL", label: "앱링크" },
    { value: "BK", label: "봇키워드" },
    { value: "BC", label: "상담톡전환" },
    { value: "BT", label: "봇전환" },
    { value: "BF", label: "비즈폼" },
];

export default function QuickReplyEditor({ quickReplies, onChange }: QuickReplyEditorProps) {
    const handleAdd = () => {
        if (quickReplies.length >= 5) return;
        onChange([
            ...quickReplies,
            { ordering: quickReplies.length + 1, type: "BK", name: "" },
        ]);
    };

    const handleRemove = (index: number) => {
        const updated = quickReplies
            .filter((_, i) => i !== index)
            .map((qr, i) => ({ ...qr, ordering: i + 1 }));
        onChange(updated);
    };

    const handleChange = (index: number, field: keyof NhnTemplateQuickReply, value: string | number) => {
        onChange(
            quickReplies.map((qr, i) =>
                i === index ? { ...qr, [field]: value } : qr
            )
        );
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-sm font-medium">빠른 응답 ({quickReplies.length}/5)</p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAdd}
                    disabled={quickReplies.length >= 5}
                >
                    <Plus className="h-3 w-3 mr-1" /> 추가
                </Button>
            </div>

            {quickReplies.map((qr, index) => (
                <div key={index} className="flex items-start gap-2 p-2 border rounded-md bg-muted/30">
                    <span className="text-xs text-muted-foreground mt-2 w-4 shrink-0">
                        {index + 1}
                    </span>

                    <Select
                        value={qr.type}
                        onValueChange={(v) => handleChange(index, "type", v)}
                    >
                        <SelectTrigger className="w-[110px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {QR_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                    {t.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <div className="flex-1 space-y-1">
                        <Input
                            placeholder="응답 이름"
                            value={qr.name}
                            onChange={(e) => handleChange(index, "name", e.target.value)}
                            className="h-8"
                        />

                        {/* WL: 웹링크 */}
                        {qr.type === "WL" && (
                            <div className="space-y-1">
                                <Input
                                    placeholder="모바일 링크 (필수)"
                                    value={qr.linkMo || ""}
                                    onChange={(e) => handleChange(index, "linkMo", e.target.value)}
                                    className="h-8 text-xs"
                                />
                                <Input
                                    placeholder="PC 링크 (선택)"
                                    value={qr.linkPc || ""}
                                    onChange={(e) => handleChange(index, "linkPc", e.target.value)}
                                    className="h-8 text-xs"
                                />
                            </div>
                        )}

                        {/* AL: 앱링크 */}
                        {qr.type === "AL" && (
                            <div className="space-y-1">
                                <Input
                                    placeholder="iOS 스킴"
                                    value={qr.schemeIos || ""}
                                    onChange={(e) => handleChange(index, "schemeIos", e.target.value)}
                                    className="h-8 text-xs"
                                />
                                <Input
                                    placeholder="Android 스킴"
                                    value={qr.schemeAndroid || ""}
                                    onChange={(e) => handleChange(index, "schemeAndroid", e.target.value)}
                                    className="h-8 text-xs"
                                />
                            </div>
                        )}

                        {/* BF: 비즈폼 */}
                        {qr.type === "BF" && (
                            <Input
                                placeholder="비즈폼 ID (필수)"
                                type="number"
                                value={qr.bizFormId || ""}
                                onChange={(e) => handleChange(index, "bizFormId", Number(e.target.value))}
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
                    >
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            ))}

            {quickReplies.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                    빠른 응답이 없습니다. 추가 버튼을 눌러 빠른 응답을 추가하세요.
                </p>
            )}
        </div>
    );
}
