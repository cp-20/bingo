import RoomClient from "@/components/room";
export default async function ScreenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <RoomClient id={(await params).id.toUpperCase()} role="screen" />;
}
