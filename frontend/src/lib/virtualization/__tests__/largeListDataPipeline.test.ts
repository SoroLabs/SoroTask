import {
  createLargeListDataPipeline,
} from "../largeListDataPipeline";

describe("createLargeListDataPipeline", () => {
  it("returns false when hasMore is false", async () => {
    const onLoadMore = jest.fn();
    const pipeline = createLargeListDataPipeline({
      hasMore: false,
      isLoadingMore: false,
      onLoadMore,
    });

    await expect(pipeline.requestNextPage()).resolves.toBe(false);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("returns false while loading is already in flight", async () => {
    const onLoadMore = jest.fn();
    const pipeline = createLargeListDataPipeline({
      hasMore: true,
      isLoadingMore: true,
      onLoadMore,
    });

    await expect(pipeline.requestNextPage()).resolves.toBe(false);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("calls onLoadMore once on success", async () => {
    const onLoadMore = jest.fn(async () => undefined);
    const pipeline = createLargeListDataPipeline({
      hasMore: true,
      isLoadingMore: false,
      onLoadMore,
    });

    await expect(pipeline.requestNextPage()).resolves.toBe(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("retries failures and reports final error", async () => {
    const onLoadMore = jest.fn(async () => {
      throw new Error("network");
    });
    const onError = jest.fn();

    const pipeline = createLargeListDataPipeline({
      hasMore: true,
      isLoadingMore: false,
      onLoadMore,
      retryCount: 2,
      onError,
    });

    await expect(pipeline.requestNextPage()).resolves.toBe(false);
    expect(onLoadMore).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("normalizes non-Error failures", async () => {
    const onLoadMore = jest.fn(async () => {
      throw "boom";
    });
    const onError = jest.fn();

    const pipeline = createLargeListDataPipeline({
      hasMore: true,
      isLoadingMore: false,
      onLoadMore,
      retryCount: 0,
      onError,
    });

    await pipeline.requestNextPage();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toContain("boom");
  });
});
