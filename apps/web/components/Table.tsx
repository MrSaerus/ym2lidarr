import React from 'react';
import type { PropsWithChildren } from 'react';


type TProps = PropsWithChildren<{ className?: string }>;

export function Table({ children, className = '' }: TProps) {
    return (
        <table className={`w-full border-collapse text-sm text-slate-200 table-like-logs ${className}`}>
            {children}
        </table>
    );
}

export function Th({ children, className = '' }: TProps) {
    return (
        <th
            className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 bg-slate-900 sticky top-0 ${className}`}
        >
            {children}
        </th>
    );
}

export function Td({
                       children,
                       className = '',
                       colSpan,
                   }: PropsWithChildren<{ className?: string; colSpan?: number }>) {
    return (
        <td className={`px-3 py-2 align-middle ${className}`} colSpan={colSpan}>
            {children}
        </td>
    );
}
