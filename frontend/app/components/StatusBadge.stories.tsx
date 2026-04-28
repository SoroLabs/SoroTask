import type { Meta, StoryObj } from "@storybook/react";
import { StatusBadge } from "./StatusBadge";

const meta: Meta<typeof StatusBadge> = {
  title: "Components/StatusBadge",
  component: StatusBadge,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Success: Story = { args: { status: "success" } };
export const Failed: Story = { args: { status: "failed" } };
export const Pending: Story = { args: { status: "pending" } };
