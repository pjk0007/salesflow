import { Info } from "lucide-react";
import { OPEN_NOTICE_TITLE } from "../utils/openRate";

export function OpenColumnHead({ label = "오픈" }: { label?: string }) {
    return <span className="inline-flex items-center gap-1" title={OPEN_NOTICE_TITLE}>{label}<Info className="h-3 w-3 text-muted-foreground" aria-hidden /></span>;
}
