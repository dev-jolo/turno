import { Ball } from "@/components/Ball";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

interface HeaderProps {
  round: number | null;
  onOpenSettings: () => void;
}

export function Header({ round, onOpenSettings }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/[0.86] pt-safe backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[560px] items-center justify-between px-4">
        <div className="flex items-center gap-2.5 font-extrabold tracking-wider">
          <Ball />
          <b className="text-[15px]">TURNO</b>
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
            Open&nbsp;play
          </span>
        </div>
        <div className="flex items-center gap-2">
          {round != null && (
            <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[13px] text-sage">
              Round {round}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Session settings"
            title="Settings"
          >
            <Settings className="size-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
