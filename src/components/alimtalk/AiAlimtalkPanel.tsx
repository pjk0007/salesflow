import { useState } from "react";
import { useProducts } from "@/hooks/useProducts";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { NhnTemplateButton } from "@/lib/nhn-alimtalk";

const TONE_OPTIONS = [
    { value: "default", label: "기본" },
    { value: "formal", label: "공식적" },
    { value: "friendly", label: "친근한" },
    { value: "professional", label: "전문적" },
    { value: "concise", label: "간결한" },
];

interface AiAlimtalkPanelProps {
    onGenerated: (result: {
        templateName: string;
        templateContent: string;
        templateMessageType: string;
        buttons: NhnTemplateButton[];
    }) => void;
}

export default function AiAlimtalkPanel({ onGenerated }: AiAlimtalkPanelProps) {
    const { products } = useProducts({ activeOnly: true });
    const [prompt, setPrompt] = useState("");
    const [productId, setProductId] = useState<number | undefined>();
    const [tone, setTone] = useState("default");
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            toast.error("프롬프트를 입력해주세요.");
            return;
        }

        setIsGenerating(true);
        try {
            const res = await fetch("/api/ai/generate-alimtalk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    productId,
                    tone: tone === "default" ? undefined : tone,
                }),
            });
            const result = await res.json();

            if (result.success) {
                onGenerated(result.data);
                toast.success("AI 알림톡 템플릿이 생성되었습니다.");
            } else {
                toast.error(result.error || "AI 생성에 실패했습니다.");
            }
        } catch {
            toast.error("요청 중 오류가 발생했습니다.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-dashed">
            <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: 주문 완료 안내 알림톡 만들어줘"
                rows={3}
                className="resize-none"
            />
            <div className="grid grid-cols-2 gap-3">
                <Select
                    value={productId ? String(productId) : "none"}
                    onValueChange={(v) => setProductId(v === "none" ? undefined : Number(v))}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="제품 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">제품 없음</SelectItem>
                        {products.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger>
                        <SelectValue placeholder="톤 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        {TONE_OPTIONS.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                                {t.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
            >
                {isGenerating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                )}
                {isGenerating ? "생성 중..." : "AI로 생성"}
            </Button>
        </div>
    );
}
