import {
  CommandItem,
  fuzzySearchCommands,
  evaluateElasticQuery,
  getSavedFilters,
  saveCustomFilter,
  deleteCustomFilter,
  SAVED_FILTERS_STORAGE_KEY,
} from "../fuzzySearch";

const testCommands: CommandItem[] = [
  {
    id: "1",
    title: "Batch Vault Harvester",
    category: "Tasks",
    status: "active",
    gas: 8,
    action: () => {},
  },
  {
    id: "2",
    title: "Switch to Mainnet",
    category: "Navigation",
    status: "active",
    gas: 15,
    action: () => {},
  },
  {
    id: "3",
    title: "Inspect Contract Logs",
    category: "Contracts",
    status: "paused",
    gas: 5,
    action: () => {},
  },
];

describe("Universal Command Palette Search & Elastic Query Engine", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns all items when query is empty", () => {
    const res = fuzzySearchCommands(testCommands, "");
    expect(res).toHaveLength(3);
  });

  it("filters items by matching title substring", () => {
    const res = fuzzySearchCommands(testCommands, "harvester");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("1");
  });

  it("filters items by matching category", () => {
    const res = fuzzySearchCommands(testCommands, "navigation");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("2");
  });

  it("evaluates boolean elastic queries with AND condition (status:active AND gas:<10)", () => {
    const res = fuzzySearchCommands(testCommands, "status:active AND gas:<10");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("1"); // only task 1 has status=active and gas=8 < 10
  });

  it("evaluates boolean elastic queries with OR condition", () => {
    const res = fuzzySearchCommands(testCommands, "status:paused OR gas:>10");
    expect(res).toHaveLength(2); // task 3 has status:paused, task 2 has gas:15
  });

  it("persists saved custom filter views in local storage", () => {
    expect(getSavedFilters()).toHaveLength(0);

    const saved = saveCustomFilter(
      "Low Gas Active",
      "status:active AND gas:<10",
    );
    expect(saved.name).toBe("Low Gas Active");
    expect(saved.query).toBe("status:active AND gas:<10");

    const retrieved = getSavedFilters();
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].name).toBe("Low Gas Active");

    deleteCustomFilter(saved.id);
    expect(getSavedFilters()).toHaveLength(0);
  });
});
