import { ImageResponse } from "next/og";

export const alt = "Phresh Mastery — Sports Betting Command Center";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#05070d",
          backgroundImage:
            "radial-gradient(900px 500px at 8% -10%, rgba(34,168,255,0.18), transparent 60%), radial-gradient(700px 500px at 100% 0%, rgba(34,168,255,0.12), transparent 60%)",
          color: "#e6efff",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial",
          padding: "64px 72px",
          position: "relative",
        }}
      >
        {/* subtle border line at top */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid #1a2540",
            borderRadius: 0,
          }}
        />

        {/* eyebrow */}
        <div
          style={{
            display: "flex",
            color: "#22a8ff",
            fontSize: 22,
            letterSpacing: 8,
            textTransform: "uppercase",
            fontWeight: 700,
            marginBottom: 24,
          }}
        >
          Phresh Mastery
        </div>

        {/* headline */}
        <div
          style={{
            display: "flex",
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
            marginBottom: 18,
          }}
        >
          Sports Betting
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -2,
            color: "#22a8ff",
            marginBottom: 28,
          }}
        >
          Command Center
        </div>

        {/* tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#a3b3d1",
            maxWidth: 880,
            lineHeight: 1.35,
          }}
        >
          Multiple systems, multiple cappers, deterministic scaling, and a fully
          synced daily journal.
        </div>

        {/* spacer */}
        <div style={{ flexGrow: 1 }} />

        {/* bottom row: stats + accent line */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 32,
          }}
        >
          <div style={{ display: "flex", gap: 56 }}>
            <Stat label="Systems" value="Multi" />
            <Stat label="Cappers" value="Multi" />
            <Stat label="Charts" value="Live" />
            <Stat label="Journal" value="Auto-sync" />
          </div>

          {/* mini chart icon */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              height: 72,
            }}
          >
            <div
              style={{
                width: 18,
                height: 28,
                background: "rgba(34,168,255,0.4)",
                borderRadius: 4,
              }}
            />
            <div
              style={{
                width: 18,
                height: 46,
                background: "rgba(34,168,255,0.6)",
                borderRadius: 4,
              }}
            />
            <div
              style={{
                width: 18,
                height: 72,
                background: "#22a8ff",
                borderRadius: 4,
              }}
            />
          </div>
        </div>

        {/* glowing accent line at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 4,
            background:
              "linear-gradient(90deg, transparent, #22a8ff 50%, transparent)",
          }}
        />
      </div>
    ),
    { ...size },
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        style={{
          color: "#7280a0",
          fontSize: 14,
          letterSpacing: 3,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "#e6efff",
          fontSize: 32,
          fontWeight: 700,
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}
