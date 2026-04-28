import type { Meta, StoryObj } from "@storybook/react";
import { TaskForm } from "./TaskForm";

const meta: Meta<typeof TaskForm> = {
  title: "Components/TaskForm",
  component: TaskForm,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TaskForm>;

export const Default: Story = {};

export const Submitting: Story = {
  args: { loading: true },
};
