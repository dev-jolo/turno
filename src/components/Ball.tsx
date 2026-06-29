import { cn } from "@/lib/utils";

/** The optic-yellow pickleball dot used in the wordmark, holes and all. */
export function Ball({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-block size-4 shrink-0 rounded-full bg-ball",
        "shadow-[inset_-3px_-3px_0_#00000022]",
        "after:absolute after:inset-1 after:rounded-full",
        "after:bg-[radial-gradient(circle_at_30%_35%,#16302c_1.1px,transparent_1.2px),radial-gradient(circle_at_70%_40%,#16302c_1.1px,transparent_1.2px),radial-gradient(circle_at_55%_70%,#16302c_1.1px,transparent_1.2px)]",
        className,
      )}
      aria-hidden
    />
  );
}
