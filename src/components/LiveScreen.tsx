import { CourtCard } from "@/components/CourtCard";
import { Eyebrow } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Action, SessionState, Winner } from "@/engine";
import { courtsView, onHold, playersPerCourt, playingCount, waitingQueue } from "@/engine";
import { Pause } from "lucide-react";
import { useState } from "react";

interface LiveScreenProps {
  state: SessionState;
  dispatch: (action: Action) => void;
}

function splitNames(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function LiveScreen({ state, dispatch }: LiveScreenProps) {
  const [late, setLate] = useState("");
  const courts = courtsView(state);
  const queue = waitingQueue(state);
  const bench = onHold(state);
  const per = playersPerCourt(state);
  const playing = playingCount(state);
  const anyCourtActive = courts.some((c) => c.occupied);

  const addLate = () => {
    const names = splitNames(late);
    if (names.length) dispatch({ type: "ADD_PLAYERS", names });
    setLate("");
  };

  const finish = (index: number, winner?: Winner) =>
    dispatch({ type: "FINISH_COURT", court: index, winner });

  return (
    <>
      <Eyebrow title="Courts" tag={`${playing} playing`} />
      <div className="grid gap-3.5">
        {courts.map((court) => (
          <CourtCard
            key={court.index}
            court={court}
            format={state.format}
            gameMode={state.gameMode}
            perCourt={per}
            waitingCount={queue.length}
            onFinish={(winner) => finish(court.index, winner)}
            onClear={() => dispatch({ type: "CLEAR_COURT", court: court.index })}
          />
        ))}
      </div>

      {anyCourtActive && (
        <Button
          variant="ghost"
          className="mt-3 w-full py-3.5"
          onClick={() => dispatch({ type: "MIX_ALL" })}
          title="Count current games and re-randomize everyone across all courts"
        >
          Mix all courts · fresh round
        </Button>
      )}

      <Eyebrow title="Up next" tag={`${queue.length} waiting`} />
      {queue.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {queue.map((p, idx) => {
            const next = idx < per;
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface px-3 py-2.5"
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-md font-mono text-xs font-bold text-[#0f1b1a] ${
                    next ? "bg-ball" : "bg-sage"
                  }`}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] font-[650]">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted">
                    {p.games} game{p.games === 1 ? "" : "s"} played
                  </div>
                </div>
                <Button
                  variant="warm"
                  size="sm"
                  onClick={() => dispatch({ type: "HOLD_PLAYER", id: p.id })}
                >
                  Hold
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-0.5 py-3.5 text-sm text-muted">Everyone's either on court or on hold.</p>
      )}

      {bench.length > 0 && (
        <>
          <Eyebrow title="On hold" tag={String(bench.length)} />
          <ul className="flex flex-col gap-2">
            {bench.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-dashed border-white/20 bg-[#1b2c28] px-3 py-2.5 opacity-95"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-coral text-[#0f1b1a]">
                  <Pause className="size-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] font-[650] text-sage">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted">
                    stepped out · {p.games} played
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => dispatch({ type: "RETURN_PLAYER", id: p.id })}
                >
                  Add back
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dispatch({ type: "REMOVE_PLAYER", id: p.id })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Eyebrow title="Add player" />
      <div className="flex gap-2">
        <Input
          value={late}
          onChange={(e) => setLate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addLate();
          }}
          placeholder="Latecomer's name"
          autoComplete="off"
          enterKeyHint="done"
          aria-label="Add latecomer name"
        />
        <Button onClick={addLate} className="px-5">
          Add
        </Button>
      </div>
      <p className="mt-2 px-0.5 text-[12.5px] text-muted">
        New players join at the current game count so they catch up fairly.
      </p>
      <div className="h-6" />
    </>
  );
}
