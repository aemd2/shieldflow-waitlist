export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-2xl font-bold tracking-tight text-foreground">ShieldFlow</div>
          <div className="text-sm text-muted-foreground">AI-powered GRC</div>
        </div>
        {children}
      </div>
    </div>
  );
}
