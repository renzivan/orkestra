import { db } from "@/lib/db";
import { getSettings } from "@/lib/repos/settings";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsClient settings={getSettings(db())} />;
}
