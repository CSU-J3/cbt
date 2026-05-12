import { redirect } from "next/navigation";

export default function PassRateRedirect() {
  redirect("/sponsors?sort=passrate");
}

