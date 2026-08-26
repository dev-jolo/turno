import { Eyebrow, Segmented, Stepper } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Action, SessionState } from "@/engine";
import { MAX_COURTS, MIN_COURTS, canStart, playersPerCourt, startSummary } from "@/engine";
import { X } from "lucide-react";
import { useState } from "react";

interface SetupScreenProps {
  state: SessionState;
  dispatch: (action: Action) => void;
}

function splitNames(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SetupScreen({ state, dispatch }: SetupScreenProps) {
  const [draft, setDraft] = useState("");
  const per = playersPerCourt(state);
  const n = state.players.length;
  const ready = canStart(state);
  const summary = startSummary(state);

  const addFromDraft = () => {
    const names = splitNames(draft);
    if (names.length) dispatch({ type: "ADD_PLAYERS", names });
    setDraft("");
  };

  const pluralCourt = `${state.courtsCount} court${state.courtsCount === 1 ? "" : "s"}`;

  return (
    <>
      <section className="px-0.5 pb-2 pt-8">
        <h1 className="mb-2 text-[30px] font-extrabold leading-[1.08] tracking-tight">
          Run a fair <em className="not-italic text-ball">open play</em>.
        </h1>
        <p className="max-w-[42ch] text-[15px] text-sage">
          Add everyone who showed up, set your courts, and Turno randomizes who plays — mixing
          partners and keeping games even. No sign-in, works offline.
        </p>
      </section>

      <div className="mt-4 rounded-2xl border border-white/10 bg-surface p-4">
        <Field label="Courts reserved" hint={`${pluralCourt} running tonight`}>
          <Stepper
            value={state.courtsCount}
            min={MIN_COURTS}
            max={MAX_COURTS}
            label="courts"
            onChange={(count) => dispatch({ type: "SET_COURTS", count })}
          />
        </Field>
        <Field label="Format" hint={`${per} players per court`} divider>
          <Segmented
            ariaLabel="Format"
            value={state.format}
            onChange={(format) => dispatch({ type: "SET_FORMAT", format })}
            options={[
              { value: "doubles", label: "Doubles · 4" },
              { value: "singles", label: "Singles · 2" },
            ]}
          />
        </Field>
        <Field
          label="Game mode"
          hint={
            state.gameMode === "king"
              ? "Winners stay, losers rotate off"
              : state.gameMode === "winLose"
                ? "Every match pairs a winner with a loser"
                : "Courts rotate independently"
          }
          divider
        >
          <Segmented
            ariaLabel="Game mode"
            value={state.gameMode}
            onChange={(gameMode) => dispatch({ type: "SET_GAME_MODE", gameMode })}
            options={[
              { value: "rotating", label: "Rotating" },
              { value: "king", label: "King" },
              { value: "winLose", label: "Win/Lose" },
            ]}
          />
        </Field>
      </div>

      <Eyebrow title="Players" tag={String(n)} />
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addFromDraft();
          }}
          placeholder="Add a name — or paste a list"
          autoComplete="off"
          enterKeyHint="done"
          aria-label="Add player name"
        />
        <Button onClick={addFromDraft} className="px-5">
          Add
        </Button>
      </div>

      {n > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {state.players.map((p) => (
            <span
              key={p.id}
              className="flex items-center gap-2 rounded-full bg-white/10 py-2 pl-3.5 pr-2 text-sm font-semibold"
            >
              {p.name}
              <button
                type="button"
                onClick={() => dispatch({ type: "REMOVE_PLAYER", id: p.id })}
                aria-label={`Remove ${p.name}`}
                className="grid size-5 place-items-center rounded-full bg-white/10 text-sage transition-colors hover:bg-coral hover:text-[#10231d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="py-3.5 text-sm text-muted">
          No one yet. Add a few names to begin — you can paste a comma- or line-separated list too.
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-ink from-[38%] to-transparent px-4 pt-3 pb-safe-12">
        <div className="mx-auto max-w-[560px]">
          <Button
            size="lg"
            className="w-full"
            disabled={!ready}
            onClick={() => dispatch({ type: "START_SESSION" })}
          >
            {ready ? "Start session" : `Need ${per - n} more to fill a court`}
          </Button>
          {ready && (
            <p className="mt-2 text-center text-[12.5px] text-muted">
              {n} players · {pluralCourt} · {summary.onCourt} on court, {summary.waiting} waiting
            </p>
          )}
        </div>
      </div>
      {/* Spacer so the fixed CTA never covers the last chips. */}
      <div className="h-28" />
    </>
  );
}

function Field({
  label,
  hint,
  children,
  divider,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2.5 ${
        divider ? "border-t border-white/10" : ""
      }`}
    >
      <div className="font-bold">
        {label}
        <small className="block text-xs font-medium text-muted">{hint}</small>
      </div>
      {children}
    </div>
  );
}
