import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/repos/agents";
import { listFlows } from "@/lib/repos/flows";
import { listSkills } from "@/lib/repos/skills";
import { listProjects } from "@/lib/repos/projects";
import { countUnreadTasks } from "@/lib/repos/tasks";
import { Nav, type NavGroup } from "./nav";

export const metadata: Metadata = {
  title: "Orkestra",
  description: "Local agent orchestrator",
};

// The sidebar lists live records, so the layout reads them on each request.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const database = db();
  const named = <T extends { id: number; name: string }>(rows: T[]) =>
    rows.map((r) => ({ id: r.id, name: r.name }));
  const groups: NavGroup[] = [
    { title: "Projects", base: "/projects", items: named(listProjects(database)) },
    { title: "Flows", base: "/flows", items: named(listFlows(database)) },
    { title: "Agents", base: "/agents", items: named(listAgents(database)) },
    { title: "Skills", base: "/skills", items: named(listSkills(database)) },
  ];
  const unreadTasks = countUnreadTasks(database);
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/tasks" className="brand">
              <span className="dot" />
              Orkestra
            </Link>
            <Nav groups={groups} unreadTasks={unreadTasks} />
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
