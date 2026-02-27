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
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAiConfig } from "@/hooks/useAiConfig";
import AiProductPanel from "./AiProductPanel";
import type { Product } from "@/lib/db";

interface ProductDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    product?: Product | null;
    onSubmit: (data: {
        name: string;
        summary?: string;
        description?: string;
        category?: string;
        price?: string;
        url?: string;
        imageUrl?: string;
    }) => Promise<{ success: boolean; error?: string }>;
}

export default function ProductDialog({
    open,
    onOpenChange,
    product,
    onSubmit,
}: ProductDialogProps) {
    const isEdit = !!product;
    const [name, setName] = useState("");
    const [summary, setSummary] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");
    const [price, setPrice] = useState("");
    const [url, setUrl] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showAiPanel, setShowAiPanel] = useState(false);
    const { config: aiConfig } = useAiConfig();

    useEffect(() => {
        if (open && product) {
            setName(product.name);
            setSummary(product.summary ?? "");
            setDescription(product.description ?? "");
            setCategory(product.category ?? "");
            setPrice(product.price ?? "");
            setUrl(product.url ?? "");
            setImageUrl(product.imageUrl ?? "");
        } else if (open) {
            setName("");
            setSummary("");
            setDescription("");
            setCategory("");
            setPrice("");
            setUrl("");
            setImageUrl("");
        }
    }, [open, product]);

    const handleSubmit = async () => {
        if (!name.trim()) {
            toast.error("제품명을 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onSubmit({
                name: name.trim(),
                summary: summary.trim() || undefined,
                description: description.trim() || undefined,
                category: category.trim() || undefined,
                price: price.trim() || undefined,
                url: url.trim() || undefined,
                imageUrl: imageUrl.trim() || undefined,
            });

            if (result.success) {
                toast.success(isEdit ? "제품이 수정되었습니다." : "제품이 추가되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <DialogTitle>{isEdit ? "제품 수정" : "제품 추가"}</DialogTitle>
                        {!isEdit && aiConfig && (
                            <Button
                                variant={showAiPanel ? "default" : "outline"}
                                size="sm"
                                onClick={() => setShowAiPanel(!showAiPanel)}
                            >
                                <Sparkles className="h-4 w-4 mr-1" />
                                AI
                            </Button>
                        )}
                    </div>
                </DialogHeader>

                {showAiPanel && !isEdit && (
                    <AiProductPanel
                        onGenerated={(result) => {
                            setName(result.name);
                            setSummary(result.summary);
                            setDescription(result.description);
                            setCategory(result.category);
                            setPrice(result.price);
                            setUrl(result.url ?? "");
                            setImageUrl(result.imageUrl ?? "");
                        }}
                    />
                )}

                <div className="space-y-4">
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
                            rows={6}
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
                        <Input
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                            placeholder="https://example.com/product-image.png"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? "저장 중..." : isEdit ? "수정" : "추가"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
