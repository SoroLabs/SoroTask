import React from 'react';

interface Column<T> {
  header: string;
  accessor: keyof T;
}

interface AccessibleDataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  data: T[];
}

export function AccessibleDataTable<T extends { id: string | number }>({
  caption,
  columns,
  data,
}: AccessibleDataTableProps<T>) {
  return (
    <div className="overflow-x-auto border rounded-lg shadow-sm">
      <table className="w-full text-left border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted text-muted-foreground uppercase text-xs font-semibold">
          <tr>
            {columns.map((col, idx) => (
              <th
                key={idx}
                scope="col"
                className="px-4 py-3 border-b focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.map((row) => (
            <tr key={row.id} className="hover:bg-muted/50 transition-colors">
              {columns.map((col, idx) => (
                <td key={idx} className="px-4 py-3">
                  {String(row[col.accessor])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}