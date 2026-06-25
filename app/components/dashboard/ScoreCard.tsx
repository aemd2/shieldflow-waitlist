export function ScoreCard({ score }: { score: number }) {
  return (
    <div className="card bg-gradient-to-br from-[var(--brand-navy)] to-[oklch(0.12_0.05_255)] text-white">
      <div className="text-sm opacity-80">Compliance score</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-4xl font-bold">{score}</span>
        <span className="text-xl opacity-80">%</span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full bg-[var(--brand-emerald)] transition-all"
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
