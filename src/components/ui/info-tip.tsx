"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 지표 설명 — i 아이콘(또는 children)에 마우스를 올리면 툴팁. 줄바꿈(\n)은 그대로 보인다 */
export function InfoTip({ text, children, className }: { text: string; children?: React.ReactNode; className?: string }) {
    if (!text) return <>{children}</>;
    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>
                    {children ? (
                        <span className={cn("cursor-help", className)}>{children}</span>
                    ) : (
                        <span className={cn("inline-flex cursor-help text-muted-foreground/70 hover:text-foreground", className)} aria-label="설명">
                            <Info className="h-3.5 w-3.5" />
                        </span>
                    )}
                </TooltipTrigger>
                <TooltipContent sideOffset={4} className="max-w-xs whitespace-pre-line text-left leading-relaxed">
                    {text}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
