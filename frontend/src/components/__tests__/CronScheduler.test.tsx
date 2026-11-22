import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CronScheduler } from "../CronScheduler";

describe("CronScheduler", () => {
  it("renders visual scheduler with presets and world clock", () => {
    render(<CronScheduler />);

    expect(
      screen.getByText("Interactive Time-Window Scheduler"),
    ).toBeInTheDocument();
    expect(screen.getByText("hourly")).toBeInTheDocument();
    expect(screen.getByText("daily")).toBeInTheDocument();
    expect(screen.getByText("weekly")).toBeInTheDocument();
    expect(screen.getByText("monthly")).toBeInTheDocument();

    expect(
      screen.getByText("World Clock & Timezone Offset Resolver"),
    ).toBeInTheDocument();
    expect(screen.getByText("UTC")).toBeInTheDocument();
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("Tokyo")).toBeInTheDocument();
    expect(screen.getByText("London")).toBeInTheDocument();
  });

  it("updates cron expression when preset changes", () => {
    const handleChange = jest.fn();
    render(<CronScheduler onChange={handleChange} />);

    const hourlyBtn = screen.getByText("hourly");
    fireEvent.click(hourlyBtn);

    const input = screen.getByPlaceholderText("* * * * *") as HTMLInputElement;
    expect(input.value).toBe("0 * * * *");
  });
});
