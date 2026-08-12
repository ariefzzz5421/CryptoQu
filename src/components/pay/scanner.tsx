"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Reads a QRIS code from the camera or an uploaded photo.
 *
 * Camera decoding prefers the browser's native BarcodeDetector where it exists
 * — it is faster and does not pull every frame through JavaScript — and falls
 * back to jsQR on a canvas everywhere else. Uploaded images always go through
 * jsQR, which handles the screenshot-of-a-QR case people actually do.
 */

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

export function Scanner({
  onDetected,
  onClose,
}: {
  onDetected: (payload: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let detector: BarcodeDetectorLike | undefined;

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          let value: string | undefined;

          if (detector) {
            try {
              value = (await detector.detect(canvas))[0]?.rawValue;
            } catch {
              // A detector that throws mid-stream is treated as absent from here on.
              detector = undefined;
            }
          }
          if (!value) {
            const image = context.getImageData(0, 0, canvas.width, canvas.height);
            value = jsQR(image.data, image.width, image.height)?.data;
          }
          if (value) {
            cancelled = true;
            stop();
            onDetected(value.trim());
            return;
          }
        }
      }
      raf = requestAnimationFrame(() => void tick());
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser cannot open a camera. Upload a photo instead.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (window.BarcodeDetector) {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        }
        setScanning(true);
        void tick();
      } catch (err) {
        setError((err as Error).message);
      }
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stop();
    };
  }, [onDetected, stop]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
        <span className="flex items-center gap-2 text-sm">
          {scanning && <span className="live-dot" aria-hidden />}
          {scanning ? "Point at a QRIS code" : "Opening camera…"}
        </span>
        <button type="button" onClick={onClose} className="btn btn-ghost px-3 py-1 text-xs">
          Cancel
        </button>
      </div>

      {error ? (
        <p className="p-6 text-sm text-[var(--color-rose-bad)]">{error}</p>
      ) : (
        <div className="relative aspect-[4/3] bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-48 w-48 rounded-xl border-2 border-[var(--color-mint-400)] opacity-80">
              <div className="scan-sweep absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-[rgba(0,229,176,0.45)] to-transparent" />
            </div>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

/** Decodes a QR from a still image the user picked from disk. */
export async function decodeImageFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not read the image.");

  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(image.data, image.width, image.height);
  if (!result) throw new Error("No QR code found in that image.");
  return result.data.trim();
}
