"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect } from "react";

// HO 132.1 dashboard drawer client island. Stays mounted at all times
// so both the open (200ms ease-out) and close (150ms ease-in) CSS
// transitions get a chance to play — toggling data-open on the
// backdrop and panel triggers the transition in whichever direction.
//
// The bills list itself is a server component passed in as `children`
// — drawer doesn't fetch, doesn't know about the data shape, only
// manages dismiss + the data-open attribute.
//
// Dismiss (X / backdrop click / ESC) routes to "/" — clears BOTH
// params, which also clears the dashboard's existing click-to-filter
// narrowing. Deliberate: drawer dismiss is a full filter reset.
//
// Trade-off: when params clear, the server re-renders and `children`
// becomes null mid-close-animation; the panel slides out with an
// empty body for ~150ms. Acceptable since the user just clicked
// dismiss and isn't looking inside.
export function DashboardBillsDrawer({ children }: { children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const stage = params.get("stage");
  const topic = params.get("topics");
  const open = !!(stage || topic);

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

  function close() {
    router.push("/", { scroll: false });
  }

  const dataOpen = open ? "true" : "false";

  return (
    <>
      <div
        className="bills-drawer-backdrop"
        data-open={dataOpen}
        onClick={close}
        aria-hidden
      />
      <aside
        className="bills-drawer"
        data-open={dataOpen}
        role="dialog"
        aria-modal={open ? "true" : "false"}
        aria-hidden={open ? undefined : true}
        aria-label="Filtered bills"
      >
        <header className="bills-drawer-header">
          <div className="bills-drawer-header-top">
            <span className="bills-drawer-title">Filtered bills</span>
            <button
              type="button"
              className="bills-drawer-close"
              onClick={close}
              tabIndex={open ? 0 : -1}
              aria-label="Close drawer"
            >
              ×
            </button>
          </div>
        </header>
        <div className="bills-drawer-body">{children}</div>
      </aside>
    </>
  );
}
