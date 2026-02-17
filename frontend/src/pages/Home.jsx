import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-soft">
        <div className="text-xs font-semibold text-ink/60">Lyft-Zone</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Home</h1>
        <p className="mt-2 text-sm text-ink/70">
          Dashboard placeholder. Prochaine séance, cycle actif, alertes.
        </p>

        <div className="mt-4 flex gap-2">
          <Link
            to="/wizard"
            className="inline-flex items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white active:opacity-90"
          >
            Créer un cycle
          </Link>
          <Link
            to="/train"
            className="inline-flex items-center justify-center rounded-2xl bg-black/5 px-4 py-2 text-sm font-semibold text-ink active:bg-black/10"
          >
            Démarrer
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-soft">
        <div className="text-sm font-semibold">Aperçu</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-black/5 p-3">
            <div className="text-xs text-ink/60">Cycle</div>
            <div className="text-sm font-semibold">Semaine 1 sur 8</div>
          </div>
          <div className="rounded-2xl bg-black/5 p-3">
            <div className="text-xs text-ink/60">Prochaine séance</div>
            <div className="text-sm font-semibold">Push A</div>
          </div>
        </div>
      </div>
    </div>
  );
}
