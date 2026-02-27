import { useState } from "react";
import { useAiProduct } from "@/hooks/useAiProduct";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface AiProductPanelProps {
    onGenerated: (result: {
        name: string;
        summary: string;
        description: string;
        category: string;
        price: string;
        url?: string;
        imageUrl?: string;
        sources: Array<{ url: string; title: string }>;
    }) => void;
}

export default function AiProductPanel({ onGenerated }: AiProductPanelProps) {
    const { generateProduct, isGenerating } = useAiProduct();
    const [prompt, setPrompt] = useState("");
    const [sources, setSources] = useState<Array<{ url: string; title: string }>>([]);

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            toast.error("제품명 또는 URL을 입력해주세요.");
            return;
        }

        const result = await generateProduct({ prompt: prompt.trim() });

        if (result.success && result.data) {
            setSources(result.data.sources);
            onGenerated(result.data);
            toast.success("제품 정보가 생성되었습니다.");
        } else {
            toast.error(result.error || "AI 제품 생성에 실패했습니다.");
        }
    };

    return (
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-dashed">
            <div className="space-y-1.5">
                <Label>제품명, URL, 또는 키워드</Label>
                <Input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="예: Notion, https://notion.so, 프로젝트 관리 SaaS"
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !isGenerating) handleGenerate();
                    }}
                />
            </div>
            <p className="text-xs text-muted-foreground">
                AI가 웹을 검색하여 제품 정보를 자동으로 조사합니다
            </p>
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
                {isGenerating ? "웹 검색 중..." : "AI로 제품 정보 생성"}
            </Button>
            {sources.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1">
                    <span className="font-medium">출처:</span>
                    <ul className="list-disc list-inside space-y-0.5">
                        {sources.map((s, i) => (
                            <li key={i}>
                                <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline inline-flex items-center gap-1"
                                >
                                    {s.title}
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
