import React from 'react';
import type { PropsWithChildren } from 'react';


type TProps = PropsWithChildren<{ className?: string }>;

export function Table({ children, className = '' }: TProps) {
    return (
        <table className={`table table-default ${className}`}>
            {children}
        </table>
    );
}

export function Th({children, className = '' }: TProps) {
    return (
        <th className={`text-xs font-semibold uppercase tracking-wide ${className}`}>
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
        <td className={`${className}`} colSpan={colSpan}>
            {children}
        </td>
    );
}
