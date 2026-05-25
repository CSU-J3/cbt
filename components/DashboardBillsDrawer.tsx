"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect } from "react";

// HO 132.1 dashboard drawer client island. Renders a fixed-position
// slide panel from the right when `?stage=` or `?topics=` is present
// in the URL. The bills list itself is a server component passed in
// as `children` — drawer doesn't fetch, doesn't know about the data
// shape, only manages open/close presentation + dismiss handlers.
//
// Dismiss (X / backdrop click / ESC) routes to "/" with scroll
// preserved. That clears BOTH params, which also clears the
// dashboard's existing click-to-filter narrowing — drawer dismiss is
// a full filter reset by design.
export function DashboardBillsDrawer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const stage = params.get("stage");
  const topic = params.get("topics");
  const open = !!(stage || topic);

  // ESC closes the drawer when it's open. Bound on the window so the
  // user doesn't need to click into the drawer for focus first.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        router.push("/", { scroll: false });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router]);

  if (!open) return null;

  function close() {
    router.push("/", { scroll: false });
  }

  return (
    <>
      <div
        className="bills-drawer-backdrop"
        onClick={close}
        aria-hidden
      />
      <aside
        className="bills-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Filtered bills"
      >
        <header className="bills-drawer-header">
          <div className="bills-drawer-header-top">
            <span className="bills-drawer-title">Filtered bills</span>
            <button
              type="button"
              className="bills-drawer-close"
              onClick={close}
              aria-label="Close drawer"
            >
              ×
            </button>
          </div>
          {/* Chip row + meta + list all live inside `children`; they
              depend on the server-resolved stage/topic so the parent
              is the right place to render them. The header above
              carries only presentation concerns the client owns. */}
        </header>
        <div className="bills-drawer-body">{children}</div>
      </aside>
    </>
  );
}
