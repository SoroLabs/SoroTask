import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { children: "Register Task", variant: "primary" },
};

export const Secondary: Story = {
  args: { children: "Connect Wallet", variant: "secondary" },
};

export const Loading: Story = {
  args: { children: "Register Task", variant: "primary", loading: true },
};

export const Disabled: Story = {
  args: { children: "Register Task", variant: "primary", disabled: true },
};

export const FullWidth: Story = {
  args: { children: "Register Task", variant: "primary", fullWidth: true },
};
