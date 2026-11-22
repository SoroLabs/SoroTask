import { TaskExecutionStreamClient, TaskExecutionEvent } from "../taskExecutionStreamClient";
import { createExecutionStore } from "../store/taskExecutionStore";

describe("Real-Time Execution Stream Hub", () => {
  it("subscribes and receives live execution events", () => {
    const client = new TaskExecutionStreamClient();
    client.connect();

    const received: TaskExecutionEvent[] = [];
    const unsubscribe = client.subscribe((event) => {
      received.push(event);
    });

    const event: TaskExecutionEvent = {
      taskId: "task-abc",
      txHash: "0x1234567890abcdef",
      status: "SUCCESS",
      timestamp: Date.now(),
      gasSpentStroops: 500_000,
    };

    client.emitEvent(event);
    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe("task-abc");

    unsubscribe();
    client.emitEvent(event);
    expect(received).toHaveLength(1);
  });

  it("stores executions and increments unread count in execution store", () => {
    const store = createExecutionStore();
    expect(store.getUnreadCount()).toBe(0);

    store.addExecution({
      taskId: "task-1",
      txHash: "0xabc",
      status: "SUCCESS",
      timestamp: Date.now(),
      gasSpentStroops: 100,
    });

    expect(store.getUnreadCount()).toBe(1);
    expect(store.getExecutions()).toHaveLength(1);

    store.clearUnread();
    expect(store.getUnreadCount()).toBe(0);
  });
});
