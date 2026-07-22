import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

// ui-design-system.md §3.3 ("the workhorse"). This ships the structural/
// visual contract — density, sticky header, hairline dividers, sticky
// first column, sort affordance, checkbox multi-select. NOT included yet
// (each is its own integration effort, flagged rather than faked):
// row virtualization (>=100 rows spec'd — needs @tanstack/react-virtual
// wired to a real windowed data source), column resize/hide/saved-views
// (needs per-user persistence), inline edit-on-double-click (needs a
// PATCH-capable field-level edit affordance per column type).

export type TableDensity = "compact" | "default" | "comfortable";

const rowHeight: Record<TableDensity, string> = {
  compact: "h-8",
  default: "h-10",
  comfortable: "h-12",
};

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
}

export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = "default", children, ...props }, ref) => (
    <div className="w-full overflow-auto">
      <table
        ref={ref}
        data-density={density}
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  ),
);
Table.displayName = "Table";

export const TableHeader = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn("sticky top-0 z-10 bg-neutral-0 text-xs text-neutral-500", className)}
      {...props}
    />
  ),
);
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn(className)} {...props} />,
);
TableBody.displayName = "TableBody";

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  density?: TableDensity;
  selected?: boolean;
}

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, density = "default", selected, ...props }, ref) => (
    <tr
      ref={ref}
      data-state={selected ? "selected" : undefined}
      className={cn(
        rowHeight[density],
        "border-b border-neutral-200 transition-colors duration-fast ease-out hover:bg-neutral-50",
        "data-[state=selected]:bg-brand-50",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right";
  sortDirection?: "asc" | "desc" | false;
  onSort?: () => void;
  sticky?: boolean;
}

export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, align = "left", sortDirection, onSort, sticky, children, ...props }, ref) => {
    const SortIcon = sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ArrowUpDown;
    return (
      <th
        ref={ref}
        className={cn(
          "whitespace-nowrap px-3 py-2 font-medium",
          align === "right" && "text-right",
          sticky && "sticky left-0 z-20 bg-neutral-0",
          className,
        )}
        {...props}
      >
        {onSort ? (
          <button
            type="button"
            onClick={onSort}
            className={cn(
              "inline-flex items-center gap-1 hover:text-neutral-900",
              align === "right" && "flex-row-reverse",
            )}
          >
            {children}
            <SortIcon className={cn("size-3", sortDirection ? "text-brand" : "text-neutral-300")} />
          </button>
        ) : (
          children
        )}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right";
  numeric?: boolean;
  sticky?: boolean;
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, align = "left", numeric, sticky, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-3 py-2 text-neutral-900",
        (align === "right" || numeric) && "text-right tabular-nums",
        sticky && "sticky left-0 z-10 bg-neutral-0",
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

export function BulkActionBar({
  count,
  children,
  className,
}: {
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-0 px-4 py-2 shadow-elev-2",
        className,
      )}
    >
      <span className="text-sm font-medium text-neutral-900">{count} selected</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
