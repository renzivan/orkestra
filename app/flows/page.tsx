import { redirect } from "next/navigation";

// Flows live in the sidebar now; /flows opens the new-flow form.
export default function FlowsPage() {
  redirect("/flows/new");
}
