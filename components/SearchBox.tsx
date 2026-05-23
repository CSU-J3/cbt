"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function SearchBox({
  basePath = "/feed",
  placeholder = "search bills...",
}: { basePath?: string; placeholder?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    const current = (searchParams.get("q") ?? "").trim();
    if (trimmed === current) return;

    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
      params.delete("expanded");
      params.delete("page");
      const qs = params.toString();
      router.push(qs ? `${basePath}?${qs}` : basePath);
    }, 250);
    return () => clearTimeout(handle);
  }, [value, searchParams, router, basePath]);

  return (
    <div className="search-box-wrap relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="search-box w-full font-mono text-[14px] outline-none"
        style={{
          backgroundColor: "var(--bg-base)",
          color: "var(--text-primary)",
          border: `0.5px solid ${focused ? "var(--accent-amber)" : "var(--border-strong)"}`,
          padding: "7px 30px 7px 12px",
        }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="search-box-clear absolute top-1/2 right-2 -translate-y-1/2 text-[16px] leading-none transition"
          style={{ color: "var(--text-dim)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--text-secondary)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-dim)")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
