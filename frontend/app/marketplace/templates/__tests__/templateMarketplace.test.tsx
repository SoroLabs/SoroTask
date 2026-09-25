/**
 * Template marketplace UI (#1243).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { TemplateMarketplace } from "../components/TemplateMarketplace";
import { TemplateForkModal } from "../components/TemplateForkModal";
import { TemplateMarketplacePage } from "../TemplateMarketplacePage";
import { COMMUNITY_TEMPLATES, type TaskTemplate } from "@/src/lib/templates";

const TEMPLATE_STORAGE_KEY = "sorotask.templates";

beforeEach(() => {
  localStorage.clear();
});

describe("TemplateMarketplace", () => {
  it("lists every starter template", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    // Counted by card, not by <li>: the tag chips are <li> elements too, so a
    // listitem count would include them.
    const grid = within(screen.getByTestId("template-grid"));
    expect(grid.getAllByRole("article")).toHaveLength(
      COMMUNITY_TEMPLATES.length,
    );
  });

  it("names the two recipes from the acceptance criteria", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    expect(screen.getByText("Daily Yield Harvest")).toBeInTheDocument();
    expect(screen.getByText("Balance Sweep")).toBeInTheDocument();
  });

  it("filters as the user types, without a reload", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);

    fireEvent.change(screen.getByTestId("template-search"), {
      target: { value: "harvest" },
    });

    expect(
      screen.getByTestId("template-card-yield-harvest-daily"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("template-card-balance-sweep")).toBeNull();
  });

  it("matches a query against tags as well as names", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    fireEvent.change(screen.getByTestId("template-search"), {
      target: { value: "governance" },
    });
    expect(
      screen.getByTestId("template-card-governance-vote"),
    ).toBeInTheDocument();
  });

  it("filters by category", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    fireEvent.change(screen.getByTestId("template-category"), {
      target: { value: "governance" },
    });

    expect(
      screen.getByTestId("template-card-governance-vote"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("template-card-balance-sweep")).toBeNull();
  });

  it("shows an empty state rather than a blank page when nothing matches", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    fireEvent.change(screen.getByTestId("template-search"), {
      target: { value: "zzzzzz" },
    });

    expect(screen.getByTestId("template-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("template-grid")).toBeNull();
  });

  it("announces the result count politely", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    const count = screen.getByTestId("template-count");
    expect(count).toHaveAttribute("aria-live", "polite");
    expect(count.textContent).toContain(String(COMMUNITY_TEMPLATES.length));
  });

  it("says when there are no matches at all", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    fireEvent.change(screen.getByTestId("template-search"), {
      target: { value: "zzzzzz" },
    });
    expect(screen.getByTestId("template-count").textContent).toMatch(
      /No templates/,
    );
  });

  it("reports the chosen template to the caller", () => {
    const onUseTemplate = jest.fn();
    render(<TemplateMarketplace onUseTemplate={onUseTemplate} />);

    fireEvent.click(screen.getByTestId("use-template-balance-sweep"));

    expect(onUseTemplate).toHaveBeenCalledTimes(1);
    expect(onUseTemplate.mock.calls[0][0].id).toBe("balance-sweep");
  });

  it("shows a trust badge per template", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    expect(
      screen.getByTestId("template-trust-yield-harvest-daily"),
    ).toHaveTextContent("Verified");
    expect(
      screen.getByTestId("template-trust-governance-vote"),
    ).toHaveTextContent("Experimental");
  });

  it("surfaces the cost preview on the card before any click", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    const card = screen.getByTestId("template-card-balance-sweep");
    expect(card.textContent).toContain("XLM");
    expect(card.textContent).toContain("1 transaction");
  });

  it("labels the filter controls for assistive technology", () => {
    render(<TemplateMarketplace onUseTemplate={jest.fn()} />);
    expect(screen.getByLabelText("Search templates")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Trust tier")).toBeInTheDocument();
  });

  it("accepts an injected template list", () => {
    const custom: TaskTemplate[] = [COMMUNITY_TEMPLATES[0]];
    render(
      <TemplateMarketplace templates={custom} onUseTemplate={jest.fn()} />,
    );
    const grid = within(screen.getByTestId("template-grid"));
    expect(grid.getAllByRole("article")).toHaveLength(1);
  });
});

describe("TemplateForkModal", () => {
  // Every required parameter has a default, so this one deploys with no input.
  const noConfig = COMMUNITY_TEMPLATES.find((t) => t.id === "governance-vote")!;
  // `to` has no default, so this one blocks until the user supplies it.
  const needsInput = COMMUNITY_TEMPLATES.find(
    (t) => t.id === "yield-harvest-daily",
  )!;

  it("opens as a modal dialog", () => {
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={jest.fn()}
        onDeploy={jest.fn()}
      />,
    );
    const dialog = screen.getByTestId("template-fork-modal");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("lists every step the template will run", () => {
    render(
      <TemplateForkModal
        template={needsInput}
        onClose={jest.fn()}
        onDeploy={jest.fn()}
      />,
    );
    const steps = screen.getByTestId("fork-steps");
    expect(steps.textContent).toContain("Harvest Yield");
    expect(steps.textContent).toContain("Sweep Proceeds");
  });

  it("shows a cost preview before the user commits anything", () => {
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={jest.fn()}
        onDeploy={jest.fn()}
      />,
    );
    const preview = screen.getByTestId("fork-gas-preview");
    expect(preview.textContent).toContain("XLM");
    expect(screen.getByTestId("fork-gas-total").textContent).toMatch(/XLM$/);
  });

  it("blocks deployment until every required parameter is supplied", async () => {
    const onDeploy = jest.fn().mockResolvedValue(undefined);
    render(
      <TemplateForkModal
        template={needsInput}
        onClose={jest.fn()}
        onDeploy={onDeploy}
      />,
    );

    // `to` has no default, so the button starts disabled.
    const deploy = screen.getByTestId("fork-deploy");
    await waitFor(() => expect(deploy).toBeDisabled());

    fireEvent.change(screen.getByTestId("fork-input-to"), {
      target: { value: "GDESTINATIONADDRESS" },
    });

    await waitFor(() => expect(deploy).not.toBeDisabled());
  });

  it("deploys in one click once the form is complete", async () => {
    const onDeploy = jest.fn().mockResolvedValue(undefined);
    render(
      <TemplateForkModal
        template={needsInput}
        onClose={jest.fn()}
        onDeploy={onDeploy}
      />,
    );

    fireEvent.change(screen.getByTestId("fork-input-to"), {
      target: { value: "GDESTINATIONADDRESS" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("fork-deploy")).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByTestId("fork-deploy"));

    await waitFor(() => expect(onDeploy).toHaveBeenCalledTimes(1));
    // The fork must carry the supplied value and fresh block ids.
    const [forked] = onDeploy.mock.calls[0];
    expect(forked.forkedFrom).toBe("yield-harvest-daily");
    const sweep = forked.template.blocks.find(
      (b: { label: string }) => b.label === "Sweep Proceeds",
    );
    expect(sweep.args.to).toBe("GDESTINATIONADDRESS");
  });

  it("is ready to deploy with no input when every required parameter has a default", async () => {
    const onDeploy = jest.fn().mockResolvedValue(undefined);
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={jest.fn()}
        onDeploy={onDeploy}
      />,
    );

    // No parameter inputs are rendered, because there is nothing to ask for.
    expect(screen.queryByTestId("fork-input-to")).toBeNull();
    expect(screen.getByTestId("fork-deploy")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("fork-deploy"));
    await waitFor(() => expect(onDeploy).toHaveBeenCalled());
  });

  it("shows a failure without closing, so the user can retry", async () => {
    const onDeploy = jest.fn().mockRejectedValue(new Error("keeper offline"));
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={jest.fn()}
        onDeploy={onDeploy}
      />,
    );

    fireEvent.click(screen.getByTestId("fork-deploy"));

    const alert = await screen.findByTestId("fork-error");
    expect(alert).toHaveTextContent("keeper offline");
    expect(screen.getByTestId("template-fork-modal")).toBeInTheDocument();
  });

  it("reports success after deploying", async () => {
    const onDeploy = jest.fn().mockResolvedValue(undefined);
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={jest.fn()}
        onDeploy={onDeploy}
      />,
    );

    fireEvent.click(screen.getByTestId("fork-deploy"));

    await waitFor(() =>
      expect(screen.getByTestId("fork-success")).toBeInTheDocument(),
    );
  });

  it("disables the deploy button while a deployment is in flight", async () => {
    let release: () => void = () => {};
    const onDeploy = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={jest.fn()}
        onDeploy={onDeploy}
      />,
    );

    fireEvent.click(screen.getByTestId("fork-deploy"));
    await waitFor(() =>
      expect(screen.getByTestId("fork-deploy")).toBeDisabled(),
    );
    expect(screen.getByTestId("fork-deploy").textContent).toContain(
      "Deploying",
    );

    release();
    await waitFor(() =>
      expect(screen.getByTestId("fork-success")).toBeInTheDocument(),
    );
  });

  it("closes on Escape but not mid-deployment", async () => {
    let release: () => void = () => {};
    const onDeploy = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const onClose = jest.fn();
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={onClose}
        onDeploy={onDeploy}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("fork-deploy"));
    await waitFor(() =>
      expect(screen.getByTestId("fork-deploy")).toBeDisabled(),
    );
    onClose.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    release();
    await waitFor(() =>
      expect(screen.getByTestId("fork-success")).toBeInTheDocument(),
    );
  });

  it("closes via the close button", () => {
    const onClose = jest.fn();
    render(
      <TemplateForkModal
        template={noConfig}
        onClose={onClose}
        onDeploy={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("fork-modal-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("marks a missing required field for assistive technology", async () => {
    render(
      <TemplateForkModal
        template={needsInput}
        onClose={jest.fn()}
        onDeploy={jest.fn()}
      />,
    );
    const input = screen.getByTestId("fork-input-to");
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
  });
});

describe("TemplateMarketplacePage", () => {
  it("renders the gallery with no modal open initially", () => {
    render(<TemplateMarketplacePage />);
    expect(screen.getByTestId("template-marketplace")).toBeInTheDocument();
    expect(screen.queryByTestId("template-fork-modal")).toBeNull();
  });

  it("opens the fork modal from a card and closes it again", async () => {
    render(<TemplateMarketplacePage />);

    fireEvent.click(screen.getByTestId("use-template-balance-sweep"));
    await waitFor(() =>
      expect(screen.getByTestId("template-fork-modal")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("fork-modal-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("template-fork-modal")).toBeNull(),
    );
  });

  it("persists a completed fork so it appears in Saved Templates", async () => {
    render(<TemplateMarketplacePage />);

    fireEvent.click(screen.getByTestId("use-template-balance-sweep"));
    await waitFor(() =>
      expect(screen.getByTestId("template-fork-modal")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId("fork-input-to"), {
      target: { value: "GDESTINATIONADDRESS" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("fork-deploy")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("fork-deploy"));

    await waitFor(() =>
      expect(screen.getByTestId("fork-success")).toBeInTheDocument(),
    );

    const stored = JSON.parse(
      localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? "[]",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toContain("fork");
    expect(stored[0].blocks.length).toBeGreaterThan(0);
  });

  it("appends to an existing saved-templates list rather than replacing it", async () => {
    const existing = [
      { id: "mine", name: "My Template", blocks: [], createdAt: "x" },
    ];
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(existing));

    render(<TemplateMarketplacePage />);
    fireEvent.click(screen.getByTestId("use-template-balance-sweep"));
    await waitFor(() =>
      expect(screen.getByTestId("template-fork-modal")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId("fork-input-to"), {
      target: { value: "GDESTINATIONADDRESS" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("fork-deploy")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("fork-deploy"));

    await waitFor(() =>
      expect(screen.getByTestId("fork-success")).toBeInTheDocument(),
    );
    const stored = JSON.parse(
      localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? "[]",
    );
    expect(stored.map((t: { id: string }) => t.id)).toContain("mine");
    expect(stored).toHaveLength(2);
  });

  it("replaces a corrupt saved-templates store rather than failing to deploy", async () => {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, "not json");

    render(<TemplateMarketplacePage />);
    fireEvent.click(screen.getByTestId("use-template-balance-sweep"));
    await waitFor(() =>
      expect(screen.getByTestId("template-fork-modal")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId("fork-input-to"), {
      target: { value: "GDESTINATIONADDRESS" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("fork-deploy")).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("fork-deploy"));

    await waitFor(() =>
      expect(screen.getByTestId("fork-success")).toBeInTheDocument(),
    );
    const stored = JSON.parse(
      localStorage.getItem(TEMPLATE_STORAGE_KEY) ?? "[]",
    );
    expect(stored).toHaveLength(1);
  });
});
