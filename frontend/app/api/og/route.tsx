import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Extract dynamic milestone parameters
    const taskId = searchParams.get("taskId") || "task-def-001";
    const title = searchParams.get("title") || "Yield Compounding Automation";
    const runs = searchParams.get("runs") || "100";
    const volume = searchParams.get("volume") || "1,000 XLM";
    const gasSaved = searchParams.get("gasSaved") || "42.5 XLM";
    const date =
      searchParams.get("date") || new Date().toISOString().split("T")[0];

    return new ImageResponse(
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#090d16",
          backgroundImage:
            "radial-gradient(circle at 25% 25%, rgba(99, 102, 241, 0.15) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(16, 185, 129, 0.1) 0%, transparent 50%)",
          padding: "50px 60px",
          fontFamily: "sans-serif",
          color: "#ffffff",
        }}
      >
        {/* Top Brand Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "12px",
                backgroundColor: "#4f46e5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                fontWeight: "bold",
              }}
            >
              ⚡
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontSize: "24px",
                  fontWeight: "bold",
                  letterSpacing: "-0.5px",
                }}
              >
                SoroTask
              </span>
              <span
                style={{
                  fontSize: "12px",
                  color: "#9ca3af",
                  letterSpacing: "1px",
                }}
              >
                ON-CHAIN AUTOMATION PROTOCOL
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 18px",
              backgroundColor: "rgba(99, 102, 241, 0.15)",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              borderRadius: "9999px",
              color: "#a5b4fc",
              fontSize: "14px",
              fontWeight: "600",
            }}
          >
            <span>Verified Proof-of-Automation</span>
          </div>
        </div>

        {/* Main Content / Milestone */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <span
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: "#10b981",
              textTransform: "uppercase",
              letterSpacing: "1.5px",
            }}
          >
            Milestone Achievement Unlocked
          </span>
          <span
            style={{
              fontSize: "44px",
              fontWeight: "800",
              lineHeight: "1.15",
              color: "#f3f4f6",
              letterSpacing: "-1px",
            }}
          >
            {title}
          </span>
          <span style={{ fontSize: "16px", color: "#9ca3af" }}>
            Task ID: {taskId} • Recorded on Stellar Soroban Network
          </span>
        </div>

        {/* Metrics Grid */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            backgroundColor: "rgba(17, 24, 39, 0.75)",
            border: "1px solid rgba(55, 65, 81, 0.8)",
            borderRadius: "18px",
            padding: "24px 32px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span
              style={{
                fontSize: "13px",
                color: "#9ca3af",
                textTransform: "uppercase",
              }}
            >
              Total Executions
            </span>
            <span
              style={{ fontSize: "28px", fontWeight: "bold", color: "#818cf8" }}
            >
              {runs} runs
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span
              style={{
                fontSize: "13px",
                color: "#9ca3af",
                textTransform: "uppercase",
              }}
            >
              Volume Automated
            </span>
            <span
              style={{ fontSize: "28px", fontWeight: "bold", color: "#34d399" }}
            >
              {volume}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span
              style={{
                fontSize: "13px",
                color: "#9ca3af",
                textTransform: "uppercase",
              }}
            >
              Gas Optimized
            </span>
            <span
              style={{ fontSize: "28px", fontWeight: "bold", color: "#fbbf24" }}
            >
              {gasSaved}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span
              style={{
                fontSize: "13px",
                color: "#9ca3af",
                textTransform: "uppercase",
              }}
            >
              Date Verified
            </span>
            <span
              style={{ fontSize: "24px", fontWeight: "600", color: "#d1d5db" }}
            >
              {date}
            </span>
          </div>
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
      },
    );
  } catch (e: any) {
    return new Response(`Failed to generate the image: ${e.message}`, {
      status: 500,
    });
  }
}
