import { db } from "@/lib/db";
import { listAgents } from "@/lib/repos/agents";
import { FlowForm } from "../flow-form";

export const dynamic = "force-dynamic";

export default function NewFlowPage() {
  return <FlowForm flow={null} agents={listAgents(db())} />;
}
