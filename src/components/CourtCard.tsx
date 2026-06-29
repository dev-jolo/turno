import { Button } from "@/components/ui/button";
import type { CourtView } from "@/engine";
import type { Format, GameMode, Player, Winner } from "@/engine";
import { cn } from "@/lib/utils";

interface CourtCardProps {
  court: CourtView;
  format: Format;
  gameMode: GameMode;
  perCourt: number;
  waitingCount: number;
  onFinish: (winner?: Winner) => void;
  onClear: () => void;
}

function PlayerLine({ player, alignRight }: { player: Player; alignRight?: boolean }) {
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
    </div>
  );
}

function TeamSide({
  label,
  players,
  alignRight,
}: {
  label: string;
  players: Player[];
  alignRight?: boolean;
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
        <PlayerLine key={p.id} player={p} alignRight={alignRight} />
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
}: CourtCardProps) {
  const isSingles = format === "singles";
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
        <TeamSide label={sideLabel[0]} players={court.teamA} />
        <TeamSide label={sideLabel[1]} players={court.teamB} alignRight />
      </div>

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
