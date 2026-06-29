import { Segmented, Stepper } from "@/components/controls";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { Action, SessionState } from "@/engine";
import { MAX_COURTS, MIN_COURTS, playersPerCourt } from "@/engine";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: SessionState;
  dispatch: (action: Action) => void;
}

export function SettingsSheet({ open, onOpenChange, state, dispatch }: SettingsSheetProps) {
  const per = playersPerCourt(state);

  const reset = () => {
    if (
      window.confirm("Reset the whole session? Players, courts and game counts will be cleared.")
    ) {
      dispatch({ type: "RESET" });
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetTitle className="mt-1 text-[13px] font-bold uppercase tracking-[0.16em] text-muted">
          Session
        </SheetTitle>
        <SheetDescription className="sr-only">
          Change courts, format and game mode, or reset the session.
        </SheetDescription>

        <div className="mt-2">
          <Row label="Courts reserved" hint="How many courts are running">
            <Stepper
              value={state.courtsCount}
              min={MIN_COURTS}
              max={MAX_COURTS}
              label="courts"
              onChange={(count) => dispatch({ type: "SET_COURTS", count })}
            />
          </Row>
          <Row label="Format" hint={`${per} players per court`} divider>
            <Segmented
              ariaLabel="Format"
              value={state.format}
              onChange={(format) => dispatch({ type: "SET_FORMAT", format })}
              options={[
                { value: "doubles", label: "Doubles · 4" },
                { value: "singles", label: "Singles · 2" },
              ]}
            />
          </Row>
          <Row
            label="Game mode"
            hint={
              state.gameMode === "king"
                ? "Winners stay, losers rotate off"
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
              ]}
            />
          </Row>
        </div>

        <Button variant="danger" className="mt-3.5 w-full py-3.5" onClick={reset}>
          Reset session
        </Button>
      </SheetContent>
    </Sheet>
  );
}

function Row({
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
      <div className="text-sm font-bold">
        {label}
        <small className="block text-xs font-medium text-muted">{hint}</small>
      </div>
      {children}
    </div>
  );
}
