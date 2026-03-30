import AppRouter from "./routes/AppRouter";
import { ManualProgramProvider } from "./context/ManualProgramContext";
import { MultiWeekProgramProvider } from "./context/MultiWeekProgramContext";

export default function App() {
  return (
    <ManualProgramProvider>
      <MultiWeekProgramProvider>
        <AppRouter />
      </MultiWeekProgramProvider>
    </ManualProgramProvider>
  );
}
