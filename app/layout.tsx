import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/repos/agents";
import { listFlows } from "@/lib/repos/flows";
import { listSkills } from "@/lib/repos/skills";
import { listProjects } from "@/lib/repos/projects";
import { countUnreadTasks } from "@/lib/repos/tasks";
import { listSpaces } from "@/lib/repos/spaces";
import { getActiveSpaceId } from "./active-space";
import { Nav, type NavGroup } from "./nav";
import { Toaster } from "./toast";

export const metadata: Metadata = {
  title: "Orkestra",
  description: "Local agent orchestrator",
};

// The sidebar lists live records, so the layout reads them on each request.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const database = db();
  const spaceId = await getActiveSpaceId(database);
  const spaces = listSpaces(database).map((s) => ({ id: s.id, name: s.name }));
  const named = <T extends { id: number; name: string }>(rows: T[]) =>
    rows.map((r) => ({ id: r.id, name: r.name }));
  const groups: NavGroup[] = [
    { title: "Projects", base: "/projects", items: named(listProjects(database, spaceId)) },
    { title: "Flows", base: "/flows", items: named(listFlows(database, spaceId)) },
    { title: "Agents", base: "/agents", items: named(listAgents(database, spaceId)) },
    { title: "Skills", base: "/skills", items: named(listSkills(database, spaceId)) },
  ];
  const unreadTasks = countUnreadTasks(database, spaceId);
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/tasks" className="brand">
              <span className="dot" />
              Orkestra
            </Link>
            <Nav
              groups={groups}
              unreadTasks={unreadTasks}
              spaces={spaces}
              activeSpaceId={spaceId}
            />
          </aside>
          <main className="content">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
