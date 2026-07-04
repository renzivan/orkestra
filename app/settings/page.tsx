import { db } from "@/lib/db";
import { getSettings } from "@/lib/repos/settings";
import { listSpaces } from "@/lib/repos/spaces";
import { getActiveSpaceId } from "../active-space";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const database = db();
  const spaceId = await getActiveSpaceId(database);
  return (
    <SettingsClient
      // Remount when the active Space changes so the form's local state
      // re-initialises from the new Space's settings (a router.refresh alone
      // updates props but not useState).
      key={spaceId}
      settings={getSettings(database, spaceId)}
      spaces={listSpaces(database)}
      activeSpaceId={spaceId}
    />
  );
}
