"use client";
import { useRef, useState } from "react";
import type { Prize, RoomView } from "@/lib/game";
import { api, notifyRoom, imageSource } from "@/lib/client";
export function prizeImageUrl(roomId: string, imageKey?: string) {
  if (!imageKey) return undefined;
  if (/^sample-(headphones|coffee|beef)$/.test(imageKey))
    return `/demo-prizes/${imageKey.slice(7)}.webp`;
  return /^[a-f0-9]{64}$/.test(imageKey)
    ? imageSource(roomId, imageKey)
    : undefined;
}
export function PrizePicture({
  roomId,
  prize,
  className = "",
}: {
  roomId: string;
  prize: Pick<Prize, "name" | "imageKey">;
  className?: string;
}) {
  const src = prizeImageUrl(roomId, prize.imageKey);
  const [failed, setFailed] = useState<string>();
  return (
    <div className={`prize-picture ${className}`}>
      {src && failed !== src ? (
        <img src={src} alt={prize.name} onError={() => setFailed(src)} />
      ) : (
        <div className="prize-placeholder" aria-label="景品の写真なし">
          <span aria-hidden="true">✦</span>
          <small>PRIZE</small>
        </div>
      )}
    </div>
  );
}
async function compress(file: File) {
  if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size > 12 * 1024 * 1024)
    throw new Error("JPEG・PNG・WebPの写真（12MB以内）を選んでください。");
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (bitmap.width * bitmap.height > 16_000_000)
      throw new Error(
        "写真が大きすぎます。1600万画素以内の写真を選んでください。",
      );
    const ratio = Math.min(1, 960 / bitmap.width, 720 / bitmap.height),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("写真を読み込めませんでした。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.78),
    );
    if (!blob || blob.size > 512 * 1024)
      throw new Error("写真を小さくしてから、もう一度お試しください。");
    return blob;
  } finally {
    bitmap.close();
  }
}
export function PrizePhotoUpload({
  view,
  prize,
  hostKey,
  disabled,
  onView,
}: {
  view: RoomView;
  prize: Prize;
  hostKey: string;
  disabled: boolean;
  onView: (room: RoomView) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="photo-upload">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`${prize.name}の写真`}
        disabled={disabled || busy}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          setBusy(true);
          setError("");
          try {
            const data = await api<{ room: RoomView }>(
              `/api/rooms/${view.id}/prize-image?prizeId=${encodeURIComponent(prize.id)}`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${hostKey}`,
                  "Content-Type": "image/jpeg",
                },
                body: await compress(file),
              },
            );
            onView(data.room);
            notifyRoom(view.id);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "写真を保存できませんでした。",
            );
          } finally {
            setBusy(false);
            if (input.current) input.current.value = "";
          }
        }}
      />
      <button
        type="button"
        className="text-link"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "写真を保存中…" : prize.imageKey ? "写真を変更" : "写真を追加"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error} 元の写真はそのままです。
        </p>
      )}
    </div>
  );
}
export function PrizeGallery({ view }: { view: RoomView }) {
  if (!view.prizes.length) return null;
  return (
    <details className="prize-gallery">
      <summary>
        今日の景品{" "}
        <span>{view.prizes.filter((p) => !p.playerId).length}個が抽選待ち</span>
      </summary>
      <div>
        {view.prizes.map((prize) => (
          <article key={prize.id}>
            <PrizePicture roomId={view.id} prize={prize} />
            <h3>{prize.name}</h3>
            <span>
              {prize.playerId
                ? "当選者決定"
                : view.featuredPrizeId === prize.id
                  ? "いま紹介中"
                  : "お楽しみに"}
            </span>
          </article>
        ))}
      </div>
    </details>
  );
}
