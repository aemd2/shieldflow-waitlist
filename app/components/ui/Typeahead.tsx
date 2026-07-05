"use client";

import { useState } from "react";
import { Input, type InputProps } from "./Input";

export interface TypeaheadOption {
  value: string;
  label?: string;
  sublabel?: string;
}

/**
 * App-styled type-ahead: filters a small option list as you type (capped, not
 * a giant scrollable dump — matches this app's other suggestion dropdowns).
 * Selecting an option never blocks typing something else instead.
 */
export function Typeahead({
  value,
  onChange,
  onSelect,
  options,
  maxSuggestions = 6,
  ...inputProps
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (option: TypeaheadOption) => void;
  options: TypeaheadOption[];
  maxSuggestions?: number;
} & Omit<InputProps, "value" | "onChange" | "onSelect">) {
  const [open, setOpen] = useState(false);
  const query = value.trim().toLowerCase();
  const matches = (
    query
      ? options.filter(
          (o) => (o.label ?? o.value).toLowerCase().includes(query) || o.value.toLowerCase().includes(query),
        )
      : options
  ).slice(0, maxSuggestions);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        {...inputProps}
      />
      {open && matches.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-background shadow-md">
          {matches.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(o);
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-secondary"
              >
                <span className="font-medium text-foreground">{o.label ?? o.value}</span>
                {o.sublabel && <span className="text-xs text-muted-foreground">{o.sublabel}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
