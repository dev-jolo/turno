import { PickerPanel } from "@/components/controls";
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

/** Everything a player row needs to drive the substitute control — bundled so
 * it threads through TeamSide -> PlayerLine as one prop instead of several. */
interface SubControls {
  menu: SubMenuState;
  canSubstitute: boolean;
  waitingPlayers: Player[];
  onToggle: (outId: string) => void;
  onAutoSub: (outId: string) => void;
  onOpenPicker: (outId: string) => void;
  onPick: (outId: string, inId: string) => void;
  onCancel: () => void;
}

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
  const rows =
    mode === "menu"
      ? [
          { key: "auto", label: "Auto-sub next fairest", onClick: onAutoSub },
          { key: "pick", label: "Pick someone…", onClick: onOpenPicker },
        ]
      : waitingPlayers.map((w) => ({
          key: w.id,
          label: w.name,
          hint: <span className="font-mono text-[11px] text-muted">{w.games}g</span>,
          onClick: () => onPick(w.id),
        }));
  return <PickerPanel rows={rows} emptyText="No one waiting." onCancel={onCancel} />;
}

function PlayerLine({
  player,
  alignRight,
  controls,
}: {
  player: Player;
  alignRight?: boolean;
  controls: SubControls;
}) {
  const games = <span className="font-mono text-[11px] text-muted">{player.games}g</span>;
  const isOpen = controls.menu?.outId === player.id;
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
          onClick={() => controls.onToggle(player.id)}
          disabled={!controls.canSubstitute}
          title={
            controls.canSubstitute
              ? `Sub out ${player.name}`
              : "No one waiting to sub in — use Clear instead"
          }
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-line disabled:pointer-events-none disabled:opacity-40"
        >
          <Repeat className="size-3.5" />
        </button>
      </div>
      {isOpen && controls.menu && (
        <SubstituteMenu
          mode={controls.menu.mode}
          waitingPlayers={controls.waitingPlayers}
          onAutoSub={() => controls.onAutoSub(player.id)}
          onOpenPicker={() => controls.onOpenPicker(player.id)}
          onPick={(inId) => controls.onPick(player.id, inId)}
          onCancel={controls.onCancel}
        />
      )}
    </div>
  );
}

function TeamSide({
  label,
  players,
  alignRight,
  controls,
}: {
  label: string;
  players: Player[];
  alignRight?: boolean;
  controls: SubControls;
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
        <PlayerLine key={p.id} player={p} alignRight={alignRight} controls={controls} />
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

  const controls: SubControls = {
    menu,
    canSubstitute,
    waitingPlayers,
    onToggle: (outId) =>
      setMenu((cur) => (cur?.outId === outId ? null : { outId, mode: "menu" })),
    onAutoSub: (outId) => {
      onSubstitute(outId);
      setMenu(null);
    },
    onOpenPicker: (outId) => setMenu({ outId, mode: "pick" }),
    onPick: (outId, inId) => {
      onSubstitute(outId, inId);
      setMenu(null);
    },
    onCancel: () => setMenu(null),
  };

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
        <TeamSide label={sideLabel[0]} players={court.teamA} controls={controls} />
        <TeamSide label={sideLabel[1]} players={court.teamB} alignRight controls={controls} />
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
