import Crew from "@/components/crew";
export default async function CrewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Crew id={(await params).id.toUpperCase()} />;
}
