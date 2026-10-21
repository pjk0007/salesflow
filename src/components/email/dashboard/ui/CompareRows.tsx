import { TableCell, TableRow } from "@/components/ui/table";
import type { compareRowModel } from "../utils/compare";
export function CompareRows({ rows }: { rows: ReturnType<typeof compareRowModel>[] }) {
    return <>{rows.map(row => <TableRow key={row.key}>
        <TableCell className={row.deleted ? "text-muted-foreground" : "font-medium"}>
            {row.label}{row.sublabel && <p className="text-xs text-muted-foreground">{row.sublabel}</p>}
        </TableCell>
        {row.cells.map(cell => <TableCell key={cell.key} className="text-right tabular-nums" title={cell.tooltip}>{cell.text}</TableCell>)}
    </TableRow>)}</>;
}
