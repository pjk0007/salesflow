import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Sparkles, ImageIcon, X } from "lucide-react";
import { useAiConfig } from "@/hooks/useAiConfig";
import AiProductPanel from "./AiProductPanel";
import { toast } from "sonner";
import type { Product } from "@/lib/db";

interface ProductEditorProps {
    product: Product | null;
    onSave: (data: {
        name: string;
        summary?: string;
        description?: string;
        category?: string;
        price?: string;
        url?: string;
        imageUrl?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    onCancel: () => void;
}

export default function ProductEditor({ product, onSave, onCancel }: ProductEditorProps) {
    const [name, setName] = useState("");
    const [summary, setSummary] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [price, setPrice] = useState("");
    const [url, setUrl] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [showAiPanel, setShowAiPanel] = useState(false);
    const { config: aiConfig } = useAiConfig();
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        if (product) {
            setName(product.name);
            setSummary(product.summary ?? "");
            setDescription(product.description ?? "");
            setCategory(product.category ?? "");
            setPrice(product.price ?? "");
            setUrl(product.url ?? "");
            setImageUrl(product.imageUrl ?? "");
        }
    }, [product]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            toast.error("제품명을 입력해주세요.");
            return;
        }
        setSaving(true);
        try {
            const result = await onSave({
                name: name.trim(),
                summary: summary.trim() || undefined,
                description: description.trim() || undefined,
                category: category.trim() || undefined,
                price: price.trim() || undefined,
                url: url.trim() || undefined,
                imageUrl: imageUrl.trim() || undefined,
            });
            if (!result.success) {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-theme(spacing.14))]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 h-14 border-b shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={onCancel}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-lg font-semibold">
                        {product ? "제품 수정" : "제품 추가"}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    {!product && aiConfig && (
                        <Button
                            variant={showAiPanel ? "default" : "outline"}
                            size="sm"
                            onClick={() => setShowAiPanel(!showAiPanel)}
                        >
                            <Sparkles className="h-4 w-4 mr-1" />
                            AI
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        취소
                    </Button>
                    <Button size="sm" onClick={handleSubmit} disabled={saving || !name.trim()}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {product ? "수정" : "추가"}
                    </Button>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto">
                <div className="max-w-2xl mx-auto p-6 space-y-6">
                    {/* AI 패널 */}
                    {showAiPanel && !product && (
                        <AiProductPanel
                            onGenerated={(result) => {
                                setName(result.name);
                                setSummary(result.summary);
                                setDescription(result.description);
                                setCategory(result.category);
                                setPrice(result.price);
                                setUrl(result.url ?? "");
                                setImageUrl(result.imageUrl ?? "");
                                toast.success("AI 결과가 적용되었습니다.");
                            }}
                        />
                    )}

                    <div className="space-y-1.5">
                        <Label>
                            제품/서비스명 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="예: SalesFlow Pro"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>한줄 소개</Label>
                        <Input
                            value={summary}
                            onChange={(e) => setSummary(e.target.value)}
                            placeholder="예: 영업 관리를 위한 올인원 솔루션"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>상세 설명</Label>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="제품/서비스의 특징, 장점, 대상 고객 등을 자세히 작성해주세요. AI 이메일 작성 시 이 내용을 참고합니다."
                            rows={8}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>카테고리</Label>
                            <Input
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="예: SaaS"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>가격</Label>
                            <Input
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="예: 월 9,900원"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label>사이트 URL</Label>
                        <Input
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://example.com"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>이미지 URL</Label>
                        <div className="flex gap-4">
                            <div className="relative w-24 h-24 rounded-lg border bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                                {imageUrl ? (
                                    <>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={imageUrl}
                                            alt="미리보기"
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                e.currentTarget.style.display = "none";
                                                e.currentTarget.nextElementSibling?.classList.remove("hidden");
                                            }}
                                        />
                                        <div className="hidden flex-col items-center justify-center absolute inset-0">
                                            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                                            <span className="text-[10px] text-muted-foreground/60 mt-1">로드 실패</span>
                                        </div>
                                        <button
                                            type="button"
                                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                                            onClick={() => setImageUrl("")}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </>
                                ) : (
                                    <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                                )}
                            </div>
                            <div className="flex-1 space-y-1.5">
                                <Input
                                    value={imageUrl}
                                    onChange={(e) => setImageUrl(e.target.value)}
                                    placeholder="https://example.com/product-image.png"
                                />
                                <p className="text-xs text-muted-foreground">
                                    AI 생성 시 사이트에서 자동으로 추출합니다
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
