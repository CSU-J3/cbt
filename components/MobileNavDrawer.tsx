"use client";

import Link from "next/link";
import { useState } from "react";
import type { NavItem, NavItemKey } from "@/components/HeaderBar";

// HO 156 Phase 2 (spec 15a skeleton) — the single client island that owns
// the mobile nav. Hidden ≥700px (the inline header nav owns that band);
// below 700px the inline navs hide (CSS) and this hamburger + vertical
// drawer take over. Mounted in both HeaderBar and HomeHeader and fed the
// same NAV_ITEMS, so the drawer content is identical regardless of which
// header mounted it.
//
// Instant show/hide (conditional render === display toggle), NOT a slide.
// A tap-triggered disclosure reading instant is deliberate — it stays
// inside the static-below-1024 constraint and is not a motion exception.
//
// Dismiss (this pass only): tapping a nav item closes it (navigation
// dismisses) and tapping the hamburger again closes it. Tap-outside and an
// explicit in-drawer close glyph are deferred to 15c's global touch
// convention — the drawer's open/close convention must align with whatever
// 15c lands, so 15c shouldn't ship a conflicting pattern (SKILL.md flag).
export function MobileNavDrawer({
  items,
  active,
}: {
  items: readonly NavItem[];
  active: NavItemKey | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mobile-nav">
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label="Navigation menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>{open ? "✕" : "☰"}</span>
      </button>
      {open ? (
        <nav className="mobile-nav-drawer" aria-label="Primary navigation">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              title={item.tooltip}
              aria-label={item.tooltip}
              aria-current={active === item.key ? "page" : undefined}
              className="mobile-nav-link"
              onClick={() => setOpen(false)}
            >
              <span className="mobile-nav-icon" aria-hidden>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
