"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import WorkspaceLayout, { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Package } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import ProductCard from "@/components/products/ProductCard";
import DeleteProductDialog from "@/components/products/DeleteProductDialog";
import { toast } from "sonner";
import type { Product } from "@/lib/db";
import { useSession } from "@/contexts/SessionContext";
import { canEditProducts, productCategoryOptions } from "@/components/products/utils/product-form";

export default function ProductsPage() {
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

    const { products, isLoading, deleteProduct, loadError, mutate } = useProducts({
        search: search || undefined,
        category: categoryFilter || undefined,
    });

    // 카테고리 선택지는 필터 없는 전체 목록(같은 SWR 키 /api/products)에서 만든다(UX-084)
    const { products: allProducts } = useProducts();
    const categories = useMemo(
        () => productCategoryOptions(allProducts, categoryFilter),
        [allProducts, categoryFilter],
    );
    const { user } = useSession();
    const canEdit = canEditProducts(user?.role);

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return;
        const result = await deleteProduct(deleteTarget.id);
        if (result.success) {
            toast.success("제품이 삭제되었습니다.");
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    }, [deleteTarget, deleteProduct]);

    if (loadError) return <WorkspaceLayout><QueryErrorState error={loadError} onRetry={() => mutate()} /></WorkspaceLayout>;

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="제품/서비스"
                    description="홍보할 제품과 서비스를 관리합니다. AI 이메일 작성 시 이 정보를 참고합니다."
                    actions={
                        canEdit ? (
                            <Button onClick={() => router.push("/products/new")}>
                                <Plus className="h-4 w-4 mr-1.5" />
                                제품 추가
                            </Button>
                        ) : (
                            <p className="text-sm text-muted-foreground">관리자만 편집할 수 있습니다.</p>
                        )
                    }
                />

                {/* 필터 영역 */}
                <div className="flex items-center gap-3">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="제품명, 소개, 카테고리 검색..."
                            className="pl-9"
                        />
                    </div>
                    {(categories.length > 0 || categoryFilter) && (
                        <Select
                            value={categoryFilter}
                            onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}
                        >
                            <SelectTrigger className="w-40">
                                <SelectValue placeholder="카테고리" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">전체</SelectItem>
                                {categories.map((cat) => (
                                    <SelectItem key={cat} value={cat}>
                                        {cat}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>

                {/* 본문 */}
                {isLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="rounded-xl border overflow-hidden">
                                <Skeleton className="aspect-2/1 w-full" />
                                <div className="p-4 space-y-2">
                                    <Skeleton className="h-5 w-3/4" />
                                    <Skeleton className="h-4 w-full" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : products.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Package className="h-12 w-12 text-muted-foreground/50 mb-4" />
                        <p className="text-lg font-medium text-muted-foreground mb-1">
                            {search || categoryFilter
                                ? "검색 결과가 없습니다."
                                : "등록된 제품이 없습니다."}
                        </p>
                        <p className="text-sm text-muted-foreground mb-4">
                            {search || categoryFilter
                                ? "다른 검색어로 시도해보세요."
                                : "홍보할 제품이나 서비스를 추가해보세요."}
                        </p>
                        {(search || categoryFilter) && (
                            <Button variant="outline" onClick={() => { setSearch(""); setCategoryFilter(""); }}>
                                검색 조건 초기화
                            </Button>
                        )}
                        {!search && !categoryFilter && canEdit && (
                            <Button onClick={() => router.push("/products/new")} variant="outline">
                                <Plus className="h-4 w-4 mr-1.5" />
                                첫 제품 추가하기
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {products.map((product) => (
                            <ProductCard
                                key={product.id}
                                product={product}
                                onEdit={(p) => router.push(`/products/${p.id}`)}
                                onDelete={setDeleteTarget}
                                canEdit={canEdit}
                            />
                        ))}
                    </div>
                )}
            </PageContainer>

            <DeleteProductDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                productName={deleteTarget?.name ?? ""}
                onConfirm={handleDelete}
            />
        </WorkspaceLayout>
    );
}
