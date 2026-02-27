import { useState } from "react";

interface GenerateProductInput {
    prompt: string;
}

interface GenerateProductResult {
    name: string;
    summary: string;
    description: string;
    category: string;
    price: string;
    url?: string;
    imageUrl?: string;
    sources: Array<{ url: string; title: string }>;
}

export function useAiProduct() {
    const [isGenerating, setIsGenerating] = useState(false);

    const generateProduct = async (input: GenerateProductInput): Promise<{
        success: boolean;
        data?: GenerateProductResult;
        error?: string;
    }> => {
        setIsGenerating(true);
        try {
            const res = await fetch("/api/ai/generate-product", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            return await res.json();
        } catch {
            return { success: false, error: "서버에 연결할 수 없습니다." };
        } finally {
            setIsGenerating(false);
        }
    };

    return { generateProduct, isGenerating };
}
