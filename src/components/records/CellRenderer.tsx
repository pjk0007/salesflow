import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { FieldDefinition } from "@/types";

interface CellRendererProps {
    field: FieldDefinition;
    value: unknown;
}

export default function CellRenderer({ field, value }: CellRendererProps) {
    if (value === null || value === undefined || value === "") {
        return <span className="text-muted-foreground">-</span>;
    }

    switch (field.fieldType) {
        case "phone":
            return <span>{String(value)}</span>;

        case "email":
            return (
                <a
                    href={`mailto:${value}`}
                    className="text-blue-600 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                >
                    {String(value)}
                </a>
            );

        case "date":
            try {
                return <span>{format(new Date(String(value)), "yyyy-MM-dd")}</span>;
            } catch {
                return <span>{String(value)}</span>;
            }

        case "datetime":
            try {
                return <span>{format(new Date(String(value)), "yyyy-MM-dd HH:mm")}</span>;
            } catch {
                return <span>{String(value)}</span>;
            }

        case "select":
            if (field.cellType === "selectWithStatusBg") {
                return (
                    <Badge variant="secondary">
                        {String(value)}
                    </Badge>
                );
            }
            return <span>{String(value)}</span>;

        case "number":
            return <span className="tabular-nums">{Number(value).toLocaleString()}</span>;

        case "currency":
            return (
                <span className="tabular-nums">
                    {Number(value).toLocaleString()}원
                </span>
            );

        case "checkbox":
            return (
                <Checkbox
                    checked={Boolean(value)}
                    disabled
                    className="pointer-events-none"
                />
            );

        case "formula":
            return (
                <span className="tabular-nums text-muted-foreground">
                    {typeof value === "number" ? value.toLocaleString() : String(value)}
                </span>
            );

        case "textarea":
            return (
                <span className="truncate block max-w-[200px]" title={String(value)}>
                    {String(value)}
                </span>
            );

        default:
            return <span>{String(value)}</span>;
    }
}
