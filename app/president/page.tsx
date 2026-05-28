// HO 151 — /president aliases into /feed?stage=president. The feed page
// detects stage=president as the sole active stage with no explicit
// ?sort and re-applies the legacy desk-time column + oldest-at-desk
// ordering, so existing bookmarks resolve to a coherent view rather
// than a stage-pinned-but-otherwise-default list.
import { redirect } from "next/navigation";

export default function PresidentAliasPage() {
  redirect("/feed?stage=president");
}
