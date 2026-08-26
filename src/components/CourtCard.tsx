import { Button } from "@/components/ui/button";
import type { CourtView } from "@/engine";
import type { Format, GameMode, Player, Winner } from "@/engine";
import { cn } from "@/lib/utils";
import { Repeat } from "lucide-react";
import { useState } from "react";

interface CourtCardProps {
  court: CourtView;
  format: Format;
  gameMode: GameMode;
  perCourt: number;
  waitingPlayers: Player[];
  onFinish: (winner?: Winner) => void;
  onClear: () => void;
  onSubstitute: (outId: string, inId?: string) => void;
}

/** Which player's substitute control is expanded, and how far. */
type SubMenuState = { outId: string; mode: "menu" | "pick" } | null;

function SubstituteMenu({
  mode,
  waitingPlayers,
  onAutoSub,
  onOpenPicker,
  onPick,
  onCancel,
}: {
  mode: "menu" | "pick";
  waitingPlayers: Player[];
  onAutoSub: () => void;
  onOpenPicker: () => void;
  onPick: (inId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 flex flex-col gap-1 rounded-lg border border-white/10 bg-surface-2 p-1.5 text-left text-[13px] font-normal normal-case tracking-normal">
      {mode === "menu" ? (
        <>
          <button
            type="button"
            onClick={onAutoSub}
            className="rounded-md px-2 py-1.5 text-left hover:bg-white/10"
          >
            Auto-sub next fairest
          </button>
          <button
            type="button"
            onClick={onOpenPicker}
            className="rounded-md px-2 py-1.5 text-left hover:bg-white/10"
          >
            Pick someone…
          </button>
        </>
      ) : waitingPlayers.length > 0 ? (
        waitingPlayers.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onPick(w.id)}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-white/10"
          >
            <span className="truncate">{w.name}</span>
            <span className="font-mono text-[11px] text-muted">{w.games}g</span>
          </button>
        ))
      ) : (
        <p className="px-2 py-1.5 text-muted">No one waiting.</p>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-2 py-1.5 text-left text-muted hover:bg-white/10"
      >
        Cancel
      </button>
    </div>
  );
}

function PlayerLine({
  player,
  alignRight,
  canSubstitute,
  menu,
  waitingPlayers,
  onToggle,
  onAutoSub,
  onOpenPicker,
  onPick,
  onCancel,
}: {
  player: Player;
  alignRight?: boolean;
  canSubstitute: boolean;
  menu: SubMenuState;
  waitingPlayers: Player[];
  onToggle: () => void;
  onAutoSub: () => void;
  onOpenPicker: () => void;
  onPick: (inId: string) => void;
  onCancel: () => void;
}) {
  const games = <span className="font-mono text-[11px] text-muted">{player.games}g</span>;
  const isOpen = menu?.outId === player.id;
  return (
    <div className={cn("flex flex-col", alignRight && "items-end")}>
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
          onClick={onToggle}
          disabled={!canSubstitute}
          title={
            canSubstitute
              ? `Sub out ${player.name}`
              : "No one waiting to sub in — use Clear instead"
          }
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-line disabled:pointer-events-none disabled:opacity-40"
        >
          <Repeat className="size-3.5" />
        </button>
      </div>
      {isOpen && menu && (
        <SubstituteMenu
          mode={menu.mode}
          waitingPlayers={waitingPlayers}
          onAutoSub={onAutoSub}
          onOpenPicker={onOpenPicker}
          onPick={onPick}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

function TeamSide({
  label,
  players,
  alignRight,
  canSubstitute,
  waitingPlayers,
  menu,
  onToggle,
  onAutoSub,
  onOpenPicker,
  onPick,
  onCancel,
}: {
  label: string;
  players: Player[];
  alignRight?: boolean;
  canSubstitute: boolean;
  waitingPlayers: Player[];
  menu: SubMenuState;
  onToggle: (playerId: string) => void;
  onAutoSub: (playerId: string) => void;
  onOpenPicker: (playerId: string) => void;
  onPick: (outId: string, inId: string) => void;
  onCancel: () => void;
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
          menu={menu}
          waitingPlayers={waitingPlayers}
          onToggle={() => onToggle(p.id)}
          onAutoSub={() => onAutoSub(p.id)}
          onOpenPicker={() => onOpenPicker(p.id)}
          onPick={(inId) => onPick(p.id, inId)}
          onCancel={onCancel}
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
  waitingPlayers,
  onFinish,
  onClear,
  onSubstitute,
}: CourtCardProps) {
  const [menu, setMenu] = useState<SubMenuState>(null);
  const isSingles = format === "singles";
  const canSubstitute = waitingPlayers.length > 0;
  const sideLabel = isSingles ? ["Player", "Player"] : ["Team A", "Team B"];

  const toggle = (playerId: string) =>
    setMenu((cur) => (cur?.outId === playerId ? null : { outId: playerId, mode: "menu" }));
  const autoSub = (playerId: string) => {
    onSubstitute(playerId);
    setMenu(null);
  };
  const openPicker = (playerId: string) => setMenu({ outId: playerId, mode: "pick" });
  const pick = (outId: string, inId: string) => {
    onSubstitute(outId, inId);
    setMenu(null);
  };
  const cancel = () => setMenu(null);

  if (!court.occupied) {
    const filling = waitingPlayers.length >= perCourt;
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
                {waitingPlayers.length} ready.
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
          waitingPlayers={waitingPlayers}
          menu={menu}
          onToggle={toggle}
          onAutoSub={autoSub}
          onOpenPicker={openPicker}
          onPick={pick}
          onCancel={cancel}
        />
        <TeamSide
          label={sideLabel[1]}
          players={court.teamB}
          alignRight
          canSubstitute={canSubstitute}
          waitingPlayers={waitingPlayers}
          menu={menu}
          onToggle={toggle}
          onAutoSub={autoSub}
          onOpenPicker={openPicker}
          onPick={pick}
          onCancel={cancel}
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
