import { db } from "@/lib/db";
import { listAgents } from "@/lib/repos/agents";
import { getActiveSpaceId } from "../../active-space";
import { FlowForm } from "../flow-form";

export const dynamic = "force-dynamic";

export default async function NewFlowPage() {
  const database = db();
  const spaceId = await getActiveSpaceId(database);
  return <FlowForm flow={null} agents={listAgents(database, spaceId)} />;
}
