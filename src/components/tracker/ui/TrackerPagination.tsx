"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * 미니멀 페이지네이션 — "← 1 / 3 →" (records 톤과 동일).
 */
export function TrackerPagination({
    page,
    totalPages,
    onChange,
}: {
    page: number;
    totalPages: number;
    onChange: (p: number) => void;
}) {
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center gap-1">
            <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1}
                onClick={() => onChange(page - 1)}
            >
                <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 text-sm tabular-nums">
                {page} / {totalPages}
            </span>
            <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages}
                onClick={() => onChange(page + 1)}
            >
                <ChevronRight className="h-4 w-4" />
            </Button>
        </div>
    );
}
