import { redirect } from "next/navigation";

// The standalone agents list is gone — agents live in the sidebar now. Landing
// on /agents drops you into the new-agent form.
export default function AgentsPage() {
  redirect("/agents/new");
}
