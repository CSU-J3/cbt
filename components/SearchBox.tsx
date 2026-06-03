"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// HO 129: SearchBox now decides where to route based on the current
// pathname, not the basePath prop:
//   - /bills and /members own a native ?q= filter on the same page;
//     stay inline so existing filter state is preserved.
//   - anywhere else, route to /search for the global tabbed search.
// `basePath` becomes the inline-stay destination (defaults to /bills) and
// is otherwise unused. /bills bookmarks (`/bills?q=…`) keep working
// unchanged because the receiving page hasn't moved.
function isInlinePath(pathname: string): boolean {
  return pathname.startsWith("/bills") || pathname.startsWith("/members");
}

export function SearchBox({
  basePath = "/bills",
  placeholder = "search bills...",
  compact = false,
}: { basePath?: string; placeholder?: string; compact?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    const current = (searchParams.get("q") ?? "").trim();
    if (trimmed === current) return;

    const handle = setTimeout(() => {
      const stayInline = isInlinePath(pathname);
      if (stayInline) {
        const params = new URLSearchParams(searchParams.toString());
        if (trimmed) params.set("q", trimmed);
        else params.delete("q");
        params.delete("expanded");
        params.delete("page");
        const qs = params.toString();
        router.push(qs ? `${basePath}?${qs}` : basePath);
      } else {
        const params = new URLSearchParams();
        if (trimmed) params.set("q", trimmed);
        // Preserve the active tab when typing while already on /search,
        // so a user mid-tab doesn't get bounced back to bills on each
        // keystroke. From any other page, tab defaults to bills.
        if (pathname.startsWith("/search")) {
          const tab = searchParams.get("tab");
          if (tab) params.set("tab", tab);
        }
        const qs = params.toString();
        router.push(qs ? `/search?${qs}` : "/search");
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [value, searchParams, router, basePath, pathname]);

  return (
    <div className="search-box-wrap relative">
      {/* HO 187: compact control-strip variant — a ⌕ glyph on the left and
          tighter padding/size, so the input reads as a terminal field at
          flex:1 ≤230px instead of the old 280px masthead box. */}
      {compact ? (
        <span
          aria-hidden
          className="absolute top-1/2 left-2 -translate-y-1/2 text-[13px] leading-none"
          style={{ color: "var(--text-dim)" }}
        >
          ⌕
        </span>
      ) : null}
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={`search-box w-full font-mono outline-none ${compact ? "text-[13px]" : "text-[14px]"}`}
        style={{
          backgroundColor: "var(--bg-base)",
          color: "var(--text-primary)",
          border: `0.5px solid ${focused ? "var(--accent-amber)" : "var(--border-strong)"}`,
          padding: compact ? "5px 26px 5px 26px" : "7px 30px 7px 12px",
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
