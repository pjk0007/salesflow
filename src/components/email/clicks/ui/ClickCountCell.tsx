"use client";

import { Bot, MousePointerClick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ClickCellSource, ClickCellTone } from "../types";
import { clickCellView } from "../utils/clickCell";

const TONE: Record<ClickCellTone, { variant: "default" | "outline"; badge: string; action: string }> = {
    human: { variant: "default", badge: "bg-blue-600 text-xs", action: "" },
    humanAction: {
        variant: "default",
        badge: "bg-blue-600 text-xs font-bold ring-2 ring-blue-300 dark:ring-blue-400/60",
        action: "",
    },
    bot: { variant: "outline", badge: "border-dashed text-xs text-muted-foreground/70", action: "" },
    botAction: {
        variant: "outline",
        badge: "border-dashed border-blue-300 text-xs text-muted-foreground/70 dark:border-blue-400/60",
        action: "text-blue-600 dark:text-blue-400",
    },
};

export function ClickCountCell({ log }: { log: ClickCellSource }) {
    const view = clickCellView(log);
    if (view.kind === "empty") return null;
    if (view.kind === "dash") return <span className="text-xs text-muted-foreground">-</span>;
    return (
        <Badge variant={TONE[view.tone].variant} className={TONE[view.tone].badge} title={view.title}>
            {view.botIcon && <Bot />}
            {view.actionIcon && <MousePointerClick className={TONE[view.tone].action} />}
            {view.text}
        </Badge>
    );
}
