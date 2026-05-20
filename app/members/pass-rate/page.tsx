import { redirect } from "next/navigation";

export default function PassRateRedirect() {
  redirect("/members?sort=passrate");
}

