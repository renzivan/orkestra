import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { db } from "@/lib/db";
import { listAgents } from "@/lib/repos/agents";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "Orkestra",
  description: "Local agent orchestrator",
};

// The sidebar lists agents, so the layout reads them on each request.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const agents = listAgents(db()).map((a) => ({ id: a.id, name: a.name }));
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/tasks" className="brand">
              <span className="dot" />
              Orkestra
            </Link>
            <Nav agents={agents} />
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
