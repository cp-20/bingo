import RoomClient from "@/components/room";
export default async function HostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <RoomClient id={(await params).id.toUpperCase()} role="host" />;
}
