import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import ProductEditor from "@/components/products/ProductEditor";
import { useProducts } from "@/hooks/useProducts";
import { useRouter } from "next/router";
import { toast } from "sonner";

export default function NewProductPage() {
    const router = useRouter();
    const { createProduct } = useProducts();

    const handleSave = async (data: {
        name: string;
        summary?: string;
        description?: string;
        category?: string;
        price?: string;
        url?: string;
        imageUrl?: string;
    }) => {
        const result = await createProduct(data);
        if (result.success) {
            toast.success("제품이 추가되었습니다.");
            router.push("/products");
        }
        return result;
    };

    return (
        <WorkspaceLayout>
            <ProductEditor
                product={null}
                onSave={handleSave}
                onCancel={() => router.push("/products")}
            />
        </WorkspaceLayout>
    );
}
