import { NextRequest } from "next/server";
import { failure } from "@/lib/http";
import { prizeImage } from "@/lib/prize-images";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; imageKey: string }> },
) {
  try {
    const { id, imageKey } = await params;
    const data = await prizeImage(id, imageKey);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
