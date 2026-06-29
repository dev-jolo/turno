import { Header } from "@/components/Header";
import { LiveScreen } from "@/components/LiveScreen";
import { SettingsSheet } from "@/components/SettingsSheet";
import { SetupScreen } from "@/components/SetupScreen";
import { useEngine } from "@/hooks/useEngine";
import { useState } from "react";

export default function App() {
  const { state, dispatch } = useEngine();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-dvh">
      <Header
        round={state.started ? state.round : null}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="mx-auto max-w-[560px] px-4">
        {state.started ? (
          <LiveScreen state={state} dispatch={dispatch} />
        ) : (
          <SetupScreen state={state} dispatch={dispatch} />
        )}
      </main>
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        state={state}
        dispatch={dispatch}
      />
    </div>
  );
}
