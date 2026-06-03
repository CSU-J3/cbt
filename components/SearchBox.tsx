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
}: { basePath?: string; placeholder?: string } = {}) {
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
