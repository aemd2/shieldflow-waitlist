import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, ...props },
  ref,
) {
  return (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input
        ref={ref}
        type="checkbox"
        className={cn("h-4 w-4 accent-[var(--brand-emerald)]", className)}
        {...props}
      />
      {label}
    </label>
  );
});
