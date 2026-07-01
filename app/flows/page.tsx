import { db } from "@/lib/db";
import { listFlows } from "@/lib/repos/flows";
import { listAgents } from "@/lib/repos/agents";
import { FlowsClient } from "./flows-client";

export const dynamic = "force-dynamic";

export default function FlowsPage() {
  const database = db();
  return (
    <FlowsClient flows={listFlows(database)} agents={listAgents(database)} />
  );
}
