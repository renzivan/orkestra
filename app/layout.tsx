import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "Orkestra",
  description: "Local agent orchestrator",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/tasks" className="brand">
              <span className="dot" />
              Orkestra
            </Link>
            <Nav />
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
