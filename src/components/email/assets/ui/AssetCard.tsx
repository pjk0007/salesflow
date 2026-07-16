import { Check } from "lucide-react";
import type { EmailAsset } from "../types";

interface AssetCardProps {
    asset: EmailAsset;
    selected?: boolean;
    onClick?: () => void;
    footer?: React.ReactNode;
}

// 정사각 썸네일 카드. 이미지가 주인공, 선택은 오버레이+체크, 이름은 hover/선택 시에만.
// AssetManager(관리)·AssetPicker(선택) 공용. radius는 10px 고정.
export default function AssetCard({ asset, selected, onClick, footer }: AssetCardProps) {
    return (
        <div
            className={`group relative aspect-square overflow-hidden bg-muted border transition-shadow ${
                onClick ? "cursor-pointer hover:shadow-sm" : ""
            } ${selected ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border"}`}
            style={{ borderRadius: 10 }}
            onClick={onClick}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.url} alt={asset.name} className="absolute inset-0 w-full h-full object-cover" />

            {/* 선택 딤 오버레이 */}
            <div
                className={`absolute inset-0 transition-colors ${selected ? "bg-black/10" : "bg-transparent"}`}
            />

            {/* 선택 체크 (선택 UI가 있을 때만) */}
            {onClick && (
                <div
                    className={`absolute top-1.5 right-1.5 flex items-center justify-center h-5 w-5 rounded-full border-2 transition-all ${
                        selected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "bg-black/15 border-white/90 text-transparent opacity-0 group-hover:opacity-100"
                    }`}
                >
                    <Check className="h-3 w-3" strokeWidth={3.5} />
                </div>
            )}

            {/* 이름 캡션 — 평소 숨김, hover/선택 시 하단 그라데이션 위로 */}
            <div
                className={`absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent px-2 pt-6 pb-1.5 transition-opacity ${
                    selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
            >
                <p className="text-[11px] font-medium text-white truncate leading-tight" title={asset.name}>
                    {asset.name}
                </p>
            </div>

            {/* 액션 버튼 (관리 화면) — hover 시 좌상단 */}
            {footer && (
                <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {footer}
                </div>
            )}
        </div>
    );
}
