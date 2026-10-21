import { OPEN_NOTICE_LINES } from "../utils/openRate";

export function OpenRateNotice() {
    return (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
            {OPEN_NOTICE_LINES.map(line => <li key={line}>{line}</li>)}
        </ul>
    );
}
