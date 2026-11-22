import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const title = searchParams.get("title") || "Automated Soroban Task";
    const id = searchParams.get("id") || "task-preview";
    const status = (searchParams.get("status") || "active").toUpperCase();
    const executions = searchParams.get("executions") || "1,420";
    const contract = searchParams.get("contract") || "CCBD...72F1";
    const bounty = searchParams.get("bounty") || "25 XLM";

    const statusBg =
      status === "ACTIVE"
        ? "#10b981"
        : status === "COMPLETED"
        ? "#3b82f6"
        : status === "PAUSED"
        ? "#f59e0b"
        : "#ef4444";

    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            backgroundColor: "#090d16",
            backgroundImage:
              "radial-gradient(circle at 25px 25px, #1e293b 2%, transparent 0%), radial-gradient(circle at 75px 75px, #1e293b 2%, transparent 0%)",
            backgroundSize: "100px 100px",
            color: "#f8fafc",
            padding: "50px 60px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: "#ffffff",
                }}
              >
                ✦
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "28px", fontWeight: "800", letterSpacing: "-0.5px" }}>
                  SoroTask
                </span>
                <span style={{ fontSize: "14px", color: "#94a3b8" }}>
                  Autonomous Soroban Automation Protocol
                </span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "rgba(30, 41, 59, 0.8)",
                padding: "8px 18px",
                borderRadius: "9999px",
                border: "1px solid #334155",
                gap: "8px",
              }}
            >
              <div
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: statusBg,
                }}
              />
              <span style={{ fontSize: "16px", fontWeight: "700", color: statusBg }}>
                {status}
              </span>
            </div>
          </div>

          {/* Main Title / Body */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <span
              style={{
                fontSize: "16px",
                color: "#60a5fa",
                fontFamily: "monospace",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              ID: {id}
            </span>
            <div
              style={{
                fontSize: "52px",
                fontWeight: "900",
                lineHeight: "1.15",
                color: "#ffffff",
                display: "-webkit-box",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </div>
          </div>

          {/* Metrics Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              backgroundColor: "rgba(15, 23, 42, 0.9)",
              border: "1px solid #1e293b",
              borderRadius: "16px",
              padding: "24px 32px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "14px", color: "#94a3b8", textTransform: "uppercase" }}>
                Executions
              </span>
              <span style={{ fontSize: "28px", fontWeight: "800", color: "#38bdf8" }}>
                {executions}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "14px", color: "#94a3b8", textTransform: "uppercase" }}>
                Target Contract
              </span>
              <span
                style={{
                  fontSize: "24px",
                  fontWeight: "700",
                  fontFamily: "monospace",
                  color: "#cbd5e1",
                }}
              >
                {contract}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "14px", color: "#94a3b8", textTransform: "uppercase" }}>
                Bounty / Gas
              </span>
              <span style={{ fontSize: "28px", fontWeight: "800", color: "#a855f7" }}>
                {bounty}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "14px", color: "#94a3b8", textTransform: "uppercase" }}>
                Network
              </span>
              <span style={{ fontSize: "28px", fontWeight: "800", color: "#10b981" }}>
                Stellar Mainnet
              </span>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (e: any) {
    return new Response(`Failed to generate OG image: ${e.message}`, { status: 500 });
  }
}
