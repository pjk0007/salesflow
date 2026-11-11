import { cn } from "@/lib/utils";

/** 팀원 프로필 동그라미 — 사진이 있으면 사진, 없으면 파란 동그라미에 샌드비 심볼(화살표) */
export function MemberAvatar({ imageUrl, name, className }: { imageUrl?: string | null; name?: string | null; className?: string }) {
    if (imageUrl) {
        // eslint-disable-next-line @next/next/no-img-element -- 외부 프로필 이미지
        return <img src={imageUrl} alt={name ?? ""} className={cn("size-5 shrink-0 rounded-full object-cover", className)} />;
    }
    return (
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full bg-primary", className)} aria-hidden>
            <svg viewBox="0 0 32 32" className="size-[62%]" fill="none">
                <path d="M9 23L16 7l7 16-7-3.5L9 23z" fill="white" />
            </svg>
        </span>
    );
}
