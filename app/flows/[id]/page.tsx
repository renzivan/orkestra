import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getFlow } from "@/lib/repos/flows";
import { listAgents } from "@/lib/repos/agents";
import { FlowForm } from "../flow-form";

export const dynamic = "force-dynamic";

export default async function FlowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const database = db();
  const flow = getFlow(database, Number(id));
  if (!flow) notFound();
  return <FlowForm flow={flow} agents={listAgents(database)} />;
}
