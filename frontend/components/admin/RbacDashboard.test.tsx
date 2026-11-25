import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RbacDashboard } from "./RbacDashboard";

describe("RbacDashboard", () => {
  it("edits a role's permission bitmask and adds an audit event", () => {
    render(<RbacDashboard />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Sweep permission" }));
    expect(screen.getByText("Bitmask 0x0e")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply preview changes" }));

    expect(screen.getByRole("button", { name: /Operator.*0x0e/s })).toBeInTheDocument();
    expect(screen.getByText(/Operator permissions updated: Sweep/)).toBeInTheDocument();
  });

  it("assigns and revokes a role while recording both changes", () => {
    render(<RbacDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Assign role" }));

    fireEvent.change(screen.getByLabelText("Principal address"), {
      target: { value: "GNEW…ADDR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant preview role" }));

    const assignmentRow = screen.getByText("GNEW…ADDR").closest("tr");
    expect(assignmentRow).not.toBeNull();
    if (!assignmentRow) throw new Error("New role assignment row was not rendered");
    expect(within(assignmentRow).getByText("Operator")).toBeInTheDocument();
    expect(within(assignmentRow).getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Operator role assigned to GNEW…ADDR")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke role from GNEW…ADDR" }));

    expect(within(assignmentRow).getByText("revoked")).toBeInTheDocument();
    expect(screen.getByText("Operator role revoked from GNEW…ADDR")).toBeInTheDocument();
  });

  it("creates an expiring delegation ticket and supports multi-sig approval", () => {
    render(<RbacDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "New delegation" }));
    fireEvent.change(screen.getByLabelText("Principal address"), {
      target: { value: "GDELEGATE…KEY" },
    });
    fireEvent.change(screen.getByLabelText("Expires at"), {
      target: { value: "2027-01-01T12:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create preview ticket" }));

    expect(screen.getByText("GDELEGATE…KEY")).toBeInTheDocument();
    expect(screen.getAllByText("1/2 approvals")).toHaveLength(2);
    expect(screen.getByText("Operator delegation requested for GDELEGATE…KEY")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Approve delegation ticket-/ }));

    expect(screen.getAllByText("2/2 approvals")).toHaveLength(2);
    expect(screen.getByText("Operator delegation approved for GDELEGATE…KEY")).toBeInTheDocument();
  });

  it("filters the audit timeline by event type and search text", () => {
    render(<RbacDashboard />);
    fireEvent.change(screen.getByLabelText("Filter audit events"), {
      target: { value: "assignment" },
    });

    expect(screen.getByText("Treasury role assigned to GDF9…2JLA")).toBeInTheDocument();
    expect(screen.queryByText("Operator delegation issued to GCF2…7KLM")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search audit timeline"), {
      target: { value: "not present" },
    });
    expect(screen.getByText("No matching audit events.")).toBeInTheDocument();
  });
});
