import { db } from "@/lib/db";
import { listAdapters } from "@/lib/repos/adapters";
import { listSkills } from "@/lib/repos/skills";
import { listProjects } from "@/lib/repos/projects";
import { syncAdapters } from "@/lib/adapters/sync";
import { presetByName } from "@/lib/adapters/presets";
import type { AdapterChoice } from "./agent-form";

/** Load the adapter/skill/project choices an agent form needs. Adapters are
 *  built-in presets, available only when their CLI is installed. */
export function loadAgentChoices() {
  const database = db();
  syncAdapters(database);
  const adapters: AdapterChoice[] = listAdapters(database).map((a) => {
    const preset = presetByName(a.name);
    return {
      id: a.id,
      name: a.name,
      models: preset?.models ?? [],
      efforts: preset?.efforts ?? ["off"],
    };
  });
  return {
    adapters,
    skills: listSkills(database),
    projects: listProjects(database),
  };
}
