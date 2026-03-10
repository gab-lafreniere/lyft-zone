import AppRouter from "./routes/AppRouter";
import { ManualProgramProvider } from "./context/ManualProgramContext";

export default function App() {
  return (
    <ManualProgramProvider>
      <AppRouter />
    </ManualProgramProvider>
  );
}
