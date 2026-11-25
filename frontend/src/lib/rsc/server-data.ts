import { rscFetch } from "./pipeline";

export type DashboardWidgetData = {
  id: string;
  title: string;
  description: string;
  defaultSize: "small" | "medium" | "large";
  status: "loading" | "empty" | "error" | "success";
  value: string;
  detail: string;
};

export type DashboardServerData = {
  widgets: DashboardWidgetData[];
  lastUpdated: string;
};

const FALLBACK_WIDGETS: DashboardWidgetData[] = [
  {
    id: "volume",
    title: "Daily Volume",
    description: "Track total processed volume over the last 24h.",
    defaultSize: "large",
    status: "success",
    value: "$2.41M",
    detail: "+12.3% vs yesterday",
  },
  {
    id: "keeperHealth",
    title: "Keeper Health",
    description: "Heartbeat and execution reliability overview.",
    defaultSize: "medium",
    status: "success",
    value: "9/10",
    detail: "Healthy keepers online",
  },
  {
    id: "failedTasks",
    title: "Failed Tasks",
    description: "Tasks requiring intervention.",
    defaultSize: "small",
    status: "empty",
    value: "0",
    detail: "No failed tasks detected",
  },
  {
    id: "bridgeLatency",
    title: "Bridge Latency",
    description: "Cross-network median latency.",
    defaultSize: "small",
    status: "loading",
    value: "—",
    detail: "Measuring live latency",
  },
  {
    id: "alertFeed",
    title: "Alert Feed",
    description: "Recent critical incidents and warnings.",
    defaultSize: "medium",
    status: "error",
    value: "Unavailable",
    detail: "Alert stream temporarily offline",
  },
];

async function fetchDashboardFromSource(): Promise<DashboardServerData> {
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    widgets: FALLBACK_WIDGETS,
    lastUpdated: new Date().toISOString(),
  };
}

export async function getDashboardServerData(): Promise<DashboardServerData> {
  const result = await rscFetch(fetchDashboardFromSource, {
    cacheKey: "dashboard",
    fallbackData: { widgets: FALLBACK_WIDGETS, lastUpdated: new Date().toISOString() },
    maxRetries: 2,
  });

  return result.data;
}

export { FALLBACK_WIDGETS };
