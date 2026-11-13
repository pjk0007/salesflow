"use client";
import { cn } from "@/lib/utils";
import type { InboxMacro } from "../types";

/** 입력창 위에 뜨는 매크로 목록 — 왼쪽 #이름, 오른쪽 고른 매크로 미리보기 */
export function MacroPicker({
    items,
    active,
    onHover,
    onPick,
}: {
    items: InboxMacro[];
    active: number;
    onHover: (i: number) => void;
    onPick: (i: number) => void;
}) {
    const current = items[active];
    return (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 flex h-72 overflow-hidden rounded-lg border border-border/70 bg-background">
            <ul role="listbox" aria-label="매크로" className="w-56 shrink-0 overflow-y-auto border-r border-border/40 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {items.map((m, i) => (
                    <li
                        key={m.id}
                        role="option"
                        aria-selected={i === active}
                        ref={(el) => {
                            if (i === active) el?.scrollIntoView({ block: "nearest" });
                        }}
                        onMouseEnter={() => onHover(i)}
                        // 입력창 포커스를 잃지 않도록 mousedown에서 넣는다
                        onMouseDown={(e) => {
                            e.preventDefault();
                            onPick(i);
                        }}
                        className={cn(
                            "cursor-pointer truncate rounded-md px-3 py-2 text-sm font-medium",
                            i === active ? "bg-violet-50 text-violet-900" : "hover:bg-muted",
                        )}
                    >
                        #{m.name}
                    </li>
                ))}
                {!items.length && <li className="px-3 py-2 text-sm text-muted-foreground">맞는 매크로가 없어요.</li>}
            </ul>
            <div className="min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-4 text-sm text-foreground/80">
                {current?.body}
            </div>
        </div>
    );
}
