import { cn } from "@/lib/utils";
import { Minus, Plus } from "lucide-react";

/** A small numeric stepper (used for courts). */
export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white/10 p-1">
      <button
        type="button"
        className="grid size-9 place-items-center rounded-lg text-sage transition-colors hover:bg-white/10 hover:text-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Fewer ${label}`}
      >
        <Minus className="size-4" />
      </button>
      <span className="min-w-[30px] text-center font-mono text-base font-bold" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="grid size-9 place-items-center rounded-lg text-sage transition-colors hover:bg-white/10 hover:text-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`More ${label}`}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

/** A segmented control (used for format and game mode). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled toggle group, not a form fieldset
    <div className="flex gap-1 rounded-xl bg-white/10 p-1" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg px-3.5 py-2 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-ball text-[#10231d]" : "text-muted hover:text-line",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** A section header ("eyebrow") with an optional trailing tag. */
export function Eyebrow({ title, tag }: { title: string; tag?: string }) {
  return (
    <div className="mb-3 mt-7 flex items-baseline gap-2.5 px-0.5">
      <h2 className="text-[13px] font-extrabold uppercase tracking-[0.16em]">{title}</h2>
      <span className="h-px flex-1 bg-white/10" />
      {tag != null && <span className="font-mono text-xs text-muted">{tag}</span>}
    </div>
  );
}
