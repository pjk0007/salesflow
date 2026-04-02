import { format } from "date-fns";
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
                return (
                    <span className={field.cellClassName || ""}>
                        {format(new Date(String(value)), "yyyy-MM-dd HH:mm")}
                    </span>
                );
            } catch {
                return <span className={field.cellClassName || ""}>{String(value)}</span>;
            }

        case "select": {
            const strVal = String(value);
            const color = field.optionColors?.[strVal];
            const isSquare = field.optionStyle === "square";
            return (
                <span
                    className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${isSquare ? "rounded" : "rounded-full"}`}
                    style={{
                        backgroundColor: color || "#6b7280",
                        color: "#fff",
                    }}
                >
                    {strVal}
                </span>
            );
        }

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
