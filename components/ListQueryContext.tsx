"use client";

// HO 767 — the one search box (CartogramShell's, line 1 of the controls) and
// the list it filters. The list arrives as a server-built slot, so the query
// reaches it through context rather than props. MAP keeps the box's submit-
// to-pin behavior; LIST filters as you type (mock-767 v18, LIST 1).
import { createContext } from "react";

export type ListQuery = {
  query: string;
  setQuery: (q: string) => void;
};

export const ListQueryContext = createContext<ListQuery>({ query: "", setQuery: () => {} });

// The calendar opening or folding moves everything under it; the list's box,
// whose height is measured from its top, listens for this and measures again.
export const ELECTORAL_LAYOUT_EVENT = "electoral:layout";
