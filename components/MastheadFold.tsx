"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NavItem, NavItemKey } from "@/components/HeaderBar";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { writePref } from "@/lib/prefs";

// HO 817 — THE MASTHEAD'S FOLD, RULED D. Corey on mock-817 v2, as it opened
// (hide D, fold and full screen, touch devices, button top right): "just make
// it stick out a lil more, its a bit hard to notice. other than that, send it",
// 3:36 PM MST 2026-11-13. v3 draws HIDE and SHOW in CT's amber; it is the ruled
// mock, kept under docs/design.
//
// Mounted by both mastheads (DashboardV2Header and HeaderBar) in the drawer's
// old place. It renders HIDE, which sits at the masthead's top right, and the
// folded STRIP: the page's name, the nav as a list (`MobileNavDrawer`, the HO 156
// drawer, unchanged), FULL where the browser allows full screen, and SHOW on the
// spot HIDE held. Every rule that draws any of it sits under `(pointer: coarse)`
// in app/globals.css, so with a fine pointer none of it is seen, even with the
// fold stored.
//
// HIDE folds (`html[data-masthead="folded"]`, the third row in `lib/prefs.ts`)
// and, where the browser allows it, asks for full screen. SHOW undoes both. A
// browser grants full screen only on a tap, so after a reload the masthead is
// still folded, the browser's bar is back, and the strip's FULL asks again.
//
// NO STORAGE, CLOCK OR `window` READ DURING RENDER (`lib/prefs.ts`' header). The
// visible state is CSS off the attribute, which the boot script in <head> sets
// before first paint. FULL renders only once an effect has read
// `document.fullscreenEnabled`, so the server and the first client render agree
// and an iPhone, which gives a page no full screen, never draws it.
export function MastheadFold({
  label,
  items,
  active,
}: {
  label: string;
  items: readonly NavItem[];
  active: NavItemKey | null;
}) {
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const [canFull, setCanFull] = useState(false);
  const [isFull, setIsFull] = useState(false);
  // HO 818 — THE MENU CLOSES ON SHOW AND ON HIDE. The drawer keeps its own open
  // state, and on Corey's Fold (Nov 15) SHOW unfolded a page with the menu open
  // and the next HIDE brought it back open. HIDE and SHOW each give the drawer a
  // new key, so it remounts and starts closed whichever way the strip went.
  // MobileNavDrawer's code doesn't change.
  const [menuKey, setMenuKey] = useState(0);

  useEffect(() => {
    if (!document.fullscreenEnabled) return;
    const sync = () => setIsFull(document.fullscreenElement !== null);
    setCanFull(true);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const askFull = () => {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }
  };
  const leaveFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  return (
    <>
      <button
        ref={hideRef}
        type="button"
        className="mh-hide"
        aria-label="Hide the top bar"
        onClick={() => {
          setMenuKey((k) => k + 1);
          writePref("masthead", "folded");
          askFull();
          showRef.current?.focus({ preventScroll: true });
        }}
      >
        <span className="mh-hide-word">HIDE</span>
        <i className="mh-caret" aria-hidden="true">
          ▴
        </i>
      </button>
      <div className="mh-strip">
        <span className="mh-path">
          <Link href="/" aria-label="Congressional Terminal — dashboard">
            CT<span className="prompt-accent">{":\\"}</span>
          </Link>
          <span className="mh-label">{label}</span>
          <span className="prompt-accent" aria-hidden="true">
            {">"}
          </span>
        </span>
        <span className="mh-btns">
          <MobileNavDrawer key={menuKey} items={items} active={active} />
          {canFull ? (
            <button
              type="button"
              className="mh-face"
              onClick={() => (isFull ? leaveFull() : askFull())}
            >
              {isFull ? "EXIT FULL" : "FULL"}
            </button>
          ) : null}
          <button
            ref={showRef}
            type="button"
            className="mh-show"
            aria-label="Show the top bar"
            onClick={() => {
              setMenuKey((k) => k + 1);
              writePref("masthead", "open");
              leaveFull();
              hideRef.current?.focus({ preventScroll: true });
            }}
          >
            SHOW{" "}
            <i className="mh-caret" aria-hidden="true">
              ▾
            </i>
          </button>
        </span>
      </div>
    </>
  );
}
