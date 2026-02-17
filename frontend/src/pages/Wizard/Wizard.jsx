import { Link } from "react-router-dom";

export default function Wizard() {
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-white">
      <div className="mx-auto w-full max-w-[420px] px-4 pt-6 pb-10">
        <div className="text-xs font-semibold text-white/60">Step 1 of 5</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Wizard</h1>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-4 shadow-soft backdrop-blur">
          <p className="text-sm text-white/75">
            Placeholder. On va construire les 5 steps, compact, premium, sans scroll.
          </p>

          <div className="mt-4 flex gap-2">
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white active:bg-white/15"
            >
              Quitter
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
