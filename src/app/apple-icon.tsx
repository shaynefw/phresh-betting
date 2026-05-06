import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 50% 0%, rgba(34,168,255,0.35), #05070d 70%)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          padding: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 10,
            height: 110,
          }}
        >
          <div
            style={{
              width: 24,
              height: 38,
              background: "rgba(34,168,255,0.45)",
              borderRadius: 6,
            }}
          />
          <div
            style={{
              width: 24,
              height: 72,
              background: "rgba(34,168,255,0.7)",
              borderRadius: 6,
            }}
          />
          <div
            style={{
              width: 24,
              height: 110,
              background: "#22a8ff",
              borderRadius: 6,
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
