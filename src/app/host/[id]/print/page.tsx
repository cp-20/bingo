import { PrintCards } from "@/components/room";
export default async function PrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PrintCards id={(await params).id.toUpperCase()} />;
}
