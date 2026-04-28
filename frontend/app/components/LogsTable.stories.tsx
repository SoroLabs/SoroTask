import type { Meta, StoryObj } from "@storybook/react";
import { LogsTable } from "./LogsTable";

const meta: Meta<typeof LogsTable> = {
  title: "Components/LogsTable",
  component: LogsTable,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof LogsTable>;

export const Empty: Story = {};

export const Loading: Story = {
  args: { loading: true },
};

export const WithLogs: Story = {
  args: {
    logs: [
      {
        taskId: "#1024",
        target: "CC...A12B",
        keeper: "GA...99X",
        status: "success",
        timestamp: "2 mins ago",
      },
      {
        taskId: "#1023",
        target: "CC...B34C",
        keeper: "GA...77Z",
        status: "failed",
        timestamp: "10 mins ago",
      },
      {
        taskId: "#1022",
        target: "CC...D56E",
        keeper: "GA...55W",
        status: "pending",
        timestamp: "15 mins ago",
      },
    ],
  },
};

export const LongContent: Story = {
  args: {
    logs: Array.from({ length: 20 }, (_, i) => ({
      taskId: `#${1000 + i}`,
      target: `CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC${i}`,
      keeper: `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA${i}`,
      status: (["success", "failed", "pending"] as const)[i % 3],
      timestamp: `${i + 1} mins ago`,
    })),
  },
};
