"use client";

import { Bot, MousePointerClick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OpenCellSource, OpenCellTone } from "../types";
import { openCellView } from "../utils/openCell";

const TONE: Record<OpenCellTone, { variant: "default" | "outline"; badge: string }> = {
    human: { variant: "default", badge: "bg-teal-600 text-xs" },
    byClick: { variant: "outline", badge: "border-teal-500 text-xs text-teal-700 dark:text-teal-300" },
    machine: { variant: "outline", badge: "border-dashed text-xs text-muted-foreground/70" },
};

export function OpenCountCell({ log }: { log: OpenCellSource }) {
    const view = openCellView(log);
    if (view.kind === "empty") return null;
    if (view.kind === "dash") return <span className="text-xs text-muted-foreground">-</span>;
    return (
        <Badge variant={TONE[view.tone].variant} className={TONE[view.tone].badge} title={view.title}>
            {view.machineIcon && <Bot />}
            {view.clickIcon && <MousePointerClick />}
            {view.text}
        </Badge>
    );
}
