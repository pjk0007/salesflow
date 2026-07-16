import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Copy, Pencil, Trash2, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useEmailAssets } from "../hooks/useEmailAssets";
import AssetCard from "./AssetCard";
import AssetRenameDialog from "./AssetRenameDialog";
import type { EmailAsset } from "../types";

export default function AssetManager() {
    const [uploading, setUploading] = useState(false);
    const [renaming, setRenaming] = useState<EmailAsset | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const { assets, isLoading, upload, rename, remove } = useEmailAssets();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setUploading(true);
        try {
            const result = await upload(file);
            if (result.success) toast.success("에셋이 업로드되었습니다.");
            else toast.error(result.error || "업로드에 실패했습니다.");
        } finally {
            setUploading(false);
        }
    };

    const handleCopy = async (url: string) => {
        await navigator.clipboard.writeText(url);
        toast.success("URL이 복사되었습니다.");
    };

    const handleRename = async (id: number, name: string) => {
        const result = await rename(id, name);
        if (result.success) toast.success("이름이 수정되었습니다.");
        else toast.error(result.error || "수정에 실패했습니다.");
    };

    const handleDelete = async (asset: EmailAsset) => {
        if (!confirm(`"${asset.name}"을(를) 목록에서 삭제할까요? (이미 발송된 메일의 이미지는 유지됩니다)`)) return;
        const result = await remove(asset.id);
        if (result.success) toast.success("삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    이메일 본문에 넣을 이미지를 조직 전체에서 공유·재사용합니다.
                </p>
                <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                    이미지 업로드
                </Button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : assets.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                    <p className="text-sm">업로드된 에셋이 없습니다.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                    {assets.map((asset) => (
                        <AssetCard
                            key={asset.id}
                            asset={asset}
                            footer={
                                <div className="flex items-center gap-0.5 bg-background/90 shadow-sm p-0.5 backdrop-blur-sm" style={{ borderRadius: 8 }}>
                                    <Button variant="ghost" size="icon" className="size-6" onClick={() => handleCopy(asset.url)} title="URL 복사">
                                        <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="size-6" onClick={() => setRenaming(asset)} title="이름 수정">
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="size-6 text-destructive" onClick={() => handleDelete(asset)} title="삭제">
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            }
                        />
                    ))}
                </div>
            )}

            <AssetRenameDialog asset={renaming} onClose={() => setRenaming(null)} onSave={handleRename} />
        </div>
    );
}
