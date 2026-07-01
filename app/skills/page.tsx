import { redirect } from "next/navigation";

// Skills live in the sidebar now; landing on /skills opens the new-skill form.
export default function SkillsPage() {
  redirect("/skills/new");
}
