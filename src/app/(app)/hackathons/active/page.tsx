import { redirect } from "next/navigation";
import { pageContext } from "@/lib/page-context";
import { listHackathons } from "@/lib/services/hackathons";

export default async function ActiveHackathon({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { workspaceId, active } = await pageContext();
  const { tab } = await searchParams;
  const target = active ?? (await listHackathons(workspaceId))[0];
  if (!target) redirect("/hackathons");
  redirect(`/hackathons/${target.id}${tab ? `?tab=${tab}` : ""}`);
}
