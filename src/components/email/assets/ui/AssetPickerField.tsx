import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, X } from "lucide-react";
import AssetPicker from "./AssetPicker";
import { useEmailAssets } from "../hooks/useEmailAssets";
import type { SelectedAsset } from "../types";

interface AssetPickerFieldProps {
    value: number[]; // 선택된 assetIds
    onChange: (assetIds: number[]) => void;
}

// AI 규칙 편집용 에셋 선택 필드. 버튼으로 피커 열기 + 선택된 썸네일 표시 + 개별 해제.
// 규칙 폼(new/[id]) 두 곳이 공용으로 쓴다.
export default function AssetPickerField({ value, onChange }: AssetPickerFieldProps) {
    const [open, setOpen] = useState(false);
    // 썸네일 표시를 위해 org 에셋 목록을 참조 (id → url 매핑)
    const { assets } = useEmailAssets();
    const byId = new Map(assets.map((a) => [a.id, a]));

    const handleConfirm = (selected: SelectedAsset[]) => {
        onChange(selected.map((s) => s.id));
    };

    const removeOne = (id: number) => {
        onChange(value.filter((x) => x !== id));
    };

    return (
        <div className="space-y-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
                <ImagePlus className="h-4 w-4 mr-2" />
                이미지 에셋 선택{value.length > 0 ? ` (${value.length})` : ""}
            </Button>

            {value.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {value.map((id) => {
                        const asset = byId.get(id);
                        return (
                            <div key={id} className="relative w-16 h-16 rounded border overflow-hidden group">
                                {asset ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                                        #{id}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeOne(id)}
                                    className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <AssetPicker
                open={open}
                initialSelectedIds={value}
                onClose={() => setOpen(false)}
                onConfirm={handleConfirm}
            />
        </div>
    );
}
