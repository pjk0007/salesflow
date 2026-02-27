"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import ProductEditor from "@/components/products/ProductEditor";
import { useProducts } from "@/hooks/useProducts";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function EditProductPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id;
    const { products, isLoading, updateProduct } = useProducts();
    const product = products.find((p) => p.id === Number(id)) ?? null;

    const handleSave = async (data: {
        name: string;
        summary?: string;
        description?: string;
        category?: string;
        price?: string;
        url?: string;
        imageUrl?: string;
    }) => {
        if (!product) return { success: false, error: "제품을 찾을 수 없습니다." };
        const result = await updateProduct(product.id, data);
        if (result.success) {
            toast.success("제품이 수정되었습니다.");
            router.push("/products");
        }
        return result;
    };

    if (isLoading) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </WorkspaceLayout>
        );
    }

    if (!product) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    제품을 찾을 수 없습니다.
                </div>
            </WorkspaceLayout>
        );
    }

    return (
        <WorkspaceLayout>
            <ProductEditor
                product={product}
                onSave={handleSave}
                onCancel={() => router.push("/products")}
            />
        </WorkspaceLayout>
    );
}
