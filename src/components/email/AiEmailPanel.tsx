import { useState, useEffect } from "react";
import { useAiEmail } from "@/hooks/useAiEmail";
import { EMAIL_GENERATION_CANCELLED } from "@/components/email/api/ai-email";
import { useProducts } from "@/hooks/useProducts";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, Square, Link } from "lucide-react";
import { toast } from "sonner";
import { AI_MODELS, DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { useSession } from "@/contexts/SessionContext";

const TONE_OPTIONS = [
    { value: "default", label: "기본" },
    { value: "formal", label: "공식적" },
    { value: "friendly", label: "친근한" },
    { value: "professional", label: "전문적" },
    { value: "concise", label: "간결한" },
];

interface AiEmailPanelProps {
    onGenerated: (result: { subject: string; htmlBody: string }) => void;
    onStream?: (fullText: string) => void;
    /** 생성이 끝날 때 한 번(성공은 onGenerated 뒤). 중지·실패 시 받은 중간 결과를 버리는 데 쓴다 */
    onSettled?: (outcome: "success" | "failed" | "cancelled") => void;
    recordId?: number;
    defaultProductId?: number;
}

export default function AiEmailPanel({ onGenerated, onStream, onSettled, recordId, defaultProductId }: AiEmailPanelProps) {
    const { user, sessionEpoch, isSessionChanging, subscribeInvalidation } = useSession();
    const { generateEmailStream, isGenerating, cancelStream } = useAiEmail(`${user?.orgId}:${user?.id}:${sessionEpoch}:${recordId}`, subscribeInvalidation);
    const { products } = useProducts({ activeOnly: true });
    const [prompt, setPrompt] = useState("");
    const [productId, setProductId] = useState<number | undefined>(defaultProductId);
    const [tone, setTone] = useState("default");
    const [model, setModel] = useState(DEFAULT_MODEL_ID);
    const [ctaUrl, setCtaUrl] = useState("");

    // 제품 선택 시 사이트 URL 자동 채움
    useEffect(() => {
        if (!productId) return;
        const product = products.find((p) => p.id === productId);
        if (product?.url && !ctaUrl) {
            setCtaUrl(product.url);
        }
    }, [productId, products, ctaUrl]);

    const handleProductChange = (v: string) => {
        const newId = v === "none" ? undefined : Number(v);
        setProductId(newId);
        if (newId) {
            const product = products.find((p) => p.id === newId);
            if (product?.url) setCtaUrl(product.url);
        }
    };

    const handleGenerate = async () => {
        if (isSessionChanging) return;
        if (!prompt.trim()) {
            toast.error("프롬프트를 입력해주세요.");
            return;
        }

        let result;
        try {
            result = await generateEmailStream(
                {
                    prompt: prompt.trim(),
                    productId,
                    recordId,
                    tone: tone === "default" ? undefined : tone,
                    ctaUrl: ctaUrl.trim() || undefined,
                    model,
                },
                (fullText) => {
                    onStream?.(fullText);
                },
            );
        } catch {
            result = { success: false, error: "AI 이메일 생성에 실패했습니다." };
        }

        if (result.success && result.data) {
            onGenerated(result.data);
            onSettled?.("success");
            toast.success("AI 이메일이 생성되었습니다.");
        } else if (result.error === EMAIL_GENERATION_CANCELLED) {
            onSettled?.("cancelled");
        } else {
            onSettled?.("failed");
            toast.error(result.error || "AI 이메일 생성에 실패했습니다.");
        }
    };

    return (
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-dashed">
            <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: 신규 고객에게 제품 소개 이메일을 작성해줘"
                rows={3}
                className="resize-none"
            />
            <div className="grid grid-cols-2 gap-3">
                <Select
                    value={productId ? String(productId) : "none"}
                    onValueChange={handleProductChange}
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
            <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">AI 모델</Label>
                <Select value={model} onValueChange={setModel}>
                    <SelectTrigger>
                        <SelectValue placeholder="모델 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        {AI_MODELS.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                                {m.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Link className="h-3 w-3" />
                    CTA 링크 URL
                </Label>
                <Input
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="https://example.com/?utm_source=owned&utm_medium=email&utm_campaign=cold"
                    className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                    이메일 내 버튼 링크에 입력한 URL이 그대로 사용됩니다 (UTM 자동 부착 없음). UTM 파라미터는 직접 작성하세요. 제품 선택 시 제품 URL이 채워집니다.
                </p>
            </div>
            <div className="flex gap-2">
                <Button
                    className="flex-1"
                    onClick={handleGenerate}
                    disabled={isGenerating || isSessionChanging || !prompt.trim()}
                >
                    {isGenerating ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    {isGenerating ? "생성 중..." : "AI로 생성"}
                </Button>
                {isGenerating && (
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={cancelStream}
                        title="생성 중지"
                    >
                        <Square className="h-4 w-4" />
                    </Button>
                )}
            </div>
        </div>
    );
}
