import { db } from "@/lib/db";
import { listModels } from "@/lib/repos/models";
import { ModelsClient } from "./models-client";

export const dynamic = "force-dynamic";

export default function ModelsPage() {
  const models = listModels(db());
  return <ModelsClient models={models} />;
}
