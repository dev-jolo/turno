import { Button } from "@/components/ui/button";
import type { CourtView } from "@/engine";
import type { Format, GameMode, Player, Winner } from "@/engine";
import { cn } from "@/lib/utils";
import { Repeat } from "lucide-react";

interface CourtCardProps {
  court: CourtView;
  format: Format;
  gameMode: GameMode;
  perCourt: number;
  waitingCount: number;
  onFinish: (winner?: Winner) => void;
  onClear: () => void;
  onSubstitute: (playerId: string) => void;
}

function PlayerLine({
  player,
  alignRight,
  canSubstitute,
  onSubstitute,
}: {
  player: Player;
  alignRight?: boolean;
  canSubstitute: boolean;
  onSubstitute: () => void;
}) {
  const games = <span className="font-mono text-[11px] text-muted">{player.games}g</span>;
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-base font-[650]",
        alignRight && "flex-row-reverse",
      )}
    >
      <span className="truncate">{player.name}</span>
      {games}
      <button
        type="button"
        onClick={onSubstitute}
        disabled={!canSubstitute}
        title={
          canSubstitute
            ? `Sub out ${player.name} — bring on the next fairest waiting player`
            : "No one waiting to sub in — use Clear instead"
        }
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-line disabled:pointer-events-none disabled:opacity-40"
      >
        <Repeat className="size-3.5" />
      </button>
    </div>
  );
}

function TeamSide({
  label,
  players,
  alignRight,
  canSubstitute,
  onSubstitute,
}: {
  label: string;
  players: Player[];
  alignRight?: boolean;
  canSubstitute: boolean;
  onSubstitute: (playerId: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center gap-2 px-3.5 py-3",
        alignRight && "items-end text-right",
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</span>
      {players.map((p) => (
        <PlayerLine
          key={p.id}
          player={p}
          alignRight={alignRight}
          canSubstitute={canSubstitute}
          onSubstitute={() => onSubstitute(p.id)}
        />
      ))}
    </div>
  );
}

export function CourtCard({
  court,
  format,
  gameMode,
  perCourt,
  waitingCount,
  onFinish,
  onClear,
  onSubstitute,
}: CourtCardProps) {
  const isSingles = format === "singles";
  const canSubstitute = waitingCount > 0;
  const sideLabel = isSingles ? ["Player", "Player"] : ["Team A", "Team B"];

  if (!court.occupied) {
    const filling = waitingCount >= perCourt;
    return (
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-surface">
        <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
          <span className="text-[13px] font-extrabold uppercase tracking-wider">
            Court <em className="not-italic text-ball">{court.index + 1}</em>
          </span>
          <span className="font-mono text-[11px] text-muted">idle</span>
        </div>
        <div className="flex min-h-[96px] items-center justify-center bg-surface-2 px-4">
          <p className="max-w-[80%] py-4 text-center text-[13.5px] text-muted">
            {filling ? (
              "Filling…"
            ) : (
              <>
                <b className="text-sage">Open.</b> Needs {perCourt} waiting players to start —{" "}
                {waitingCount} ready.
              </>
            )}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-surface">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
        <span className="text-[13px] font-extrabold uppercase tracking-wider">
          Court <em className="not-italic text-ball">{court.index + 1}</em>
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          {gameMode === "king" && court.streak > 0 && (
            <span className="rounded-full bg-ball/15 px-2 py-0.5 font-bold text-ball">
              {court.streak}-win streak
            </span>
          )}
          <span className="size-[7px] rounded-full bg-ball" aria-hidden />
          on court
        </span>
      </div>

      <div className="court-net relative grid min-h-[118px] grid-cols-2 bg-surface-2">
        <TeamSide
          label={sideLabel[0]}
          players={court.teamA}
          canSubstitute={canSubstitute}
          onSubstitute={onSubstitute}
        />
        <TeamSide
          label={sideLabel[1]}
          players={court.teamB}
          alignRight
          canSubstitute={canSubstitute}
          onSubstitute={onSubstitute}
        />
      </div>

      {!canSubstitute && (
        <p className="border-t border-white/10 px-3.5 py-2 text-center text-[12px] text-muted">
          No one waiting to sub in — use <b className="text-line">Clear</b> instead.
        </p>
      )}

      <div className="flex gap-2 border-t border-white/10 p-3">
        {gameMode === "king" ? (
          <>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => onFinish("A")}
              title="Record team A as the winner"
            >
              {isSingles ? "Left won" : "Team A won"}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => onFinish("B")}
              title="Record team B as the winner"
            >
              {isSingles ? "Right won" : "Team B won"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" className="flex-1" onClick={() => onFinish()}>
              Game done · rotate
            </Button>
            <Button variant="ghost" onClick={onClear} title="Clear court without counting a game">
              Clear
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
