type Props = { rows?: number };
export default function Skeleton({ rows = 3 }: Props) {
    return (
        <div className="space-y-2">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
            ))}
        </div>
    );
}
