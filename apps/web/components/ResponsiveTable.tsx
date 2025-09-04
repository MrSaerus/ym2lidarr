// /apps/web/components/ResponsiveTable.tsx
import React from 'react';

export function ResponsiveTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="min-w-[560px] sm:min-w-0">{children}</div>
    </div>
  );
}
