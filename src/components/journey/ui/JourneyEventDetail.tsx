import { X } from "lucide-react";
import type { JourneyEvent } from "../types";
import { formatDateTime, channelStyle } from "../utils/format";

/**
 * L4 — 선택한 이벤트의 meta 전체 (전문가용 상세).
 */
export function JourneyEventDetail({
    event,
    onClose,
}: {
    event: JourneyEvent;
    onClose: () => void;
}) {
    const style = channelStyle(event.channel);
    return (
        <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                        <span className="text-xs text-muted-foreground">{event.channel}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{event.label}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(event.at)}</p>
                </div>
                <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {event.children && event.children.length > 0 && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">방문 페이지 ({event.children.length})</p>
                    <ul className="space-y-0.5">
                        {event.children.map((c, i) => (
                            <li key={i} className="text-xs text-muted-foreground truncate">
                                · {c.label}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {Object.keys(event.meta).length > 0 && (
                <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">상세</p>
                    <pre className="rounded-md bg-muted p-2 text-xs overflow-x-auto">
                        {JSON.stringify(event.meta, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}
