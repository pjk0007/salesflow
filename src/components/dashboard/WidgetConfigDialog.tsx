import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import type { FieldDefinition } from "@/types";

const WIDGET_TYPES = [
    { value: "scorecard", label: "스코어카드" },
    { value: "bar", label: "막대 차트" },
    { value: "bar_horizontal", label: "가로 막대" },
    { value: "bar_stacked", label: "누적 막대" },
    { value: "line", label: "라인 차트" },
    { value: "donut", label: "도넛 차트" },
];

const AGGREGATIONS = [
    { value: "count", label: "건수(COUNT)" },
    { value: "sum", label: "합계(SUM)" },
    { value: "avg", label: "평균(AVG)" },
];

const SYSTEM_FIELDS = [
    { key: "_sys:registeredAt", label: "등록일시" },
    { key: "_sys:createdAt", label: "생성일시" },
    { key: "_sys:updatedAt", label: "수정일시" },
];

interface WidgetConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fields: FieldDefinition[];
    onSubmit: (config: {
        title: string;
        widgetType: string;
        dataColumn: string;
        aggregation: string;
        groupByColumn: string;
        stackByColumn: string;
    }) => void;
    initial?: {
        title: string;
        widgetType: string;
        dataColumn: string;
        aggregation: string;
        groupByColumn: string;
        stackByColumn: string;
    };
}

export default function WidgetConfigDialog({
    open,
    onOpenChange,
    fields,
    onSubmit,
    initial,
}: WidgetConfigDialogProps) {
    const [title, setTitle] = useState("");
    const [widgetType, setWidgetType] = useState("scorecard");
    const [dataColumn, setDataColumn] = useState("");
    const [aggregation, setAggregation] = useState("count");
    const [groupByColumn, setGroupByColumn] = useState("");
    const [stackByColumn, setStackByColumn] = useState("");

    // AI 도우미
    const [aiPrompt, setAiPrompt] = useState("");
    const [aiLoading, setAiLoading] = useState(false);

    // Dialog가 열릴 때 initial 값으로 state 동기화
    useEffect(() => {
        if (open) {
            setTitle(initial?.title ?? "");
            setWidgetType(initial?.widgetType ?? "scorecard");
            setDataColumn(initial?.dataColumn ?? "");
            setAggregation(initial?.aggregation ?? "count");
            setGroupByColumn(initial?.groupByColumn ?? "");
            setStackByColumn(initial?.stackByColumn ?? "");
            setAiPrompt("");
        }
    }, [open, initial]);

    const needsGroupBy = widgetType !== "scorecard";

    const handleAiSuggest = async () => {
        if (!aiPrompt.trim()) return;
        setAiLoading(true);
        try {
            const res = await fetch("/api/ai/generate-widget", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: aiPrompt.trim(),
                    workspaceFields: fields.map((f) => ({
                        key: f.key,
                        label: f.label,
                        fieldType: f.fieldType,
                    })),
                }),
            });
            const json = await res.json();
            if (json.success) {
                const d = json.data;
                setTitle(d.title);
                setWidgetType(d.widgetType);
                setDataColumn(d.dataColumn);
                setAggregation(d.aggregation);
                setGroupByColumn(d.groupByColumn || "");
                setStackByColumn(d.stackByColumn || "");
                toast.success("AI가 위젯 설정을 추천했습니다.");
            } else {
                toast.error(json.error || "AI 추천에 실패했습니다.");
            }
        } catch {
            toast.error("AI 추천 중 오류가 발생했습니다.");
        }
        setAiLoading(false);
    };

    const handleSubmit = () => {
        if (!title || !dataColumn) return;
        onSubmit({
            title,
            widgetType,
            dataColumn,
            aggregation,
            groupByColumn,
            stackByColumn,
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {initial ? "위젯 설정" : "위젯 추가"}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    {/* AI 도우미 */}
                    <div className="space-y-2 rounded-lg border border-dashed p-3 bg-muted/30">
                        <Label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Sparkles className="h-3 w-3" /> AI 도우미
                        </Label>
                        <div className="flex gap-2">
                            <Input
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                placeholder="예: 월별 영업 건수를 막대 차트로"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !aiLoading) handleAiSuggest();
                                }}
                                disabled={aiLoading}
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleAiSuggest}
                                disabled={aiLoading || !aiPrompt.trim()}
                                className="shrink-0"
                            >
                                {aiLoading ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                    "추천"
                                )}
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>제목</Label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="위젯 제목"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>타입</Label>
                        <Select value={widgetType} onValueChange={setWidgetType}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {WIDGET_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                        {t.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>데이터 컬럼</Label>
                        <Select value={dataColumn} onValueChange={setDataColumn}>
                            <SelectTrigger>
                                <SelectValue placeholder="필드 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {fields.map((f) => (
                                    <SelectItem key={f.key} value={f.key}>
                                        {f.label} ({f.key})
                                    </SelectItem>
                                ))}
                                {SYSTEM_FIELDS.map((f) => (
                                    <SelectItem key={f.key} value={f.key}>
                                        {f.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>집계</Label>
                        <Select value={aggregation} onValueChange={setAggregation}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {AGGREGATIONS.map((a) => (
                                    <SelectItem key={a.value} value={a.value}>
                                        {a.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {needsGroupBy && (
                        <div className="space-y-2">
                            <Label>그룹 기준</Label>
                            <Select
                                value={groupByColumn || "_none"}
                                onValueChange={(v) =>
                                    setGroupByColumn(v === "_none" ? "" : v)
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="그룹 필드 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="_none">없음</SelectItem>
                                    {fields.map((f) => (
                                        <SelectItem key={f.key} value={f.key}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                    {SYSTEM_FIELDS.map((f) => (
                                        <SelectItem key={f.key} value={f.key}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {widgetType === "bar_stacked" && (
                        <div className="space-y-2">
                            <Label>스택 기준</Label>
                            <Select
                                value={stackByColumn || "_none"}
                                onValueChange={(v) =>
                                    setStackByColumn(v === "_none" ? "" : v)
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="스택 필드 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="_none">없음</SelectItem>
                                    {fields.map((f) => (
                                        <SelectItem key={f.key} value={f.key}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                    {SYSTEM_FIELDS.map((f) => (
                                        <SelectItem key={f.key} value={f.key}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={!title || !dataColumn}>
                        {initial ? "저장" : "추가"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
