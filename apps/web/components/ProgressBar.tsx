type Props = {
    value: number;        // 0..1
    color?: 'primary' | 'accent' | 'ym';
    label?: string;
};

export default function ProgressBar({ value, color = 'accent', label }: Props) {
    const pct = Math.max(0, Math.min(1, value)) * 100;
    const colorCls = color === 'ym' ? 'bg-ym-yellow' : color === 'primary' ? 'bg-primary' : 'bg-accent';
    return (
        <div className="w-full">
            {label ? <div className="mb-1 text-xs text-gray-500">{label}</div> : null}
            <div className="h-2 w-full rounded bg-gray-200 dark:bg-white/10 overflow-hidden">
                <div className={`h-full ${colorCls}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}
