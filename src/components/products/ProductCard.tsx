import { MoreHorizontal, Pencil, Trash2, ExternalLink, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Product } from "@/lib/db";

interface ProductCardProps {
    product: Product;
    onEdit: (product: Product) => void;
    onDelete: (product: Product) => void;
}

export default function ProductCard({ product, onEdit, onDelete }: ProductCardProps) {
    return (
        <div
            className="group relative flex flex-col rounded-xl border bg-card overflow-hidden cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
            onClick={() => onEdit(product)}
        >
            {/* Image / Placeholder */}
            <div className="relative aspect-2/1 bg-muted overflow-hidden">
                {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                            e.currentTarget.style.display = "none";
                            e.currentTarget.nextElementSibling?.classList.remove("hidden");
                        }}
                    />
                ) : null}
                <div className={`absolute inset-0 flex items-center justify-center ${product.imageUrl ? "hidden" : ""}`}>
                    <Package className="h-10 w-10 text-muted-foreground/30" />
                </div>

                {/* Overlay badges */}
                <div className="absolute top-2 left-2 flex items-center gap-1.5">
                    {product.category && (
                        <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm text-xs">
                            {product.category}
                        </Badge>
                    )}
                </div>

                {/* Menu */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="secondary"
                                size="icon"
                                className="h-7 w-7 bg-background/80 backdrop-blur-sm"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(product); }}>
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                수정
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="text-destructive"
                                onClick={(e) => { e.stopPropagation(); onDelete(product); }}
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                삭제
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Content */}
            <div className="flex flex-col flex-1 p-4 gap-2">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-tight line-clamp-1">{product.name}</h3>
                    {product.price && (
                        <span className="text-sm font-medium text-primary shrink-0">{product.price}</span>
                    )}
                </div>

                {product.summary && (
                    <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{product.summary}</p>
                )}

                <div className="flex items-center justify-between mt-auto pt-1">
                    <Badge
                        variant={product.isActive ? "default" : "outline"}
                        className="text-xs"
                    >
                        {product.isActive ? "활성" : "비활성"}
                    </Badge>
                    {product.url && (
                        <a
                            href={product.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ExternalLink className="h-3 w-3" />
                            사이트
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
