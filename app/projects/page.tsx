import { redirect } from "next/navigation";

// Projects live in the sidebar now; /projects opens the new-project form.
export default function ProjectsPage() {
  redirect("/projects/new");
}
