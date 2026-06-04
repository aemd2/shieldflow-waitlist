export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="container-tight flex flex-col items-center justify-between gap-4 py-10 text-sm text-muted sm:flex-row">
        <p>© {new Date().getFullYear()} ShieldFlow. All rights reserved.</p>
        <div className="flex gap-6">
          <a href="/privacy" className="hover:text-ink">
            Privacy
          </a>
          <a href="mailto:aemd2donchev@gmail.com" className="hover:text-ink">
            aemd2donchev@gmail.com
          </a>
        </div>
      </div>
    </footer>
  );
}
