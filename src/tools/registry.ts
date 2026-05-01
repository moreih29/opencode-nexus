export interface TaskEntry {
  taskId: string;
  sessionId: string;
  parentSessionId: string;
  status: "running" | "idle" | "error";
  agent: string;
  description: string;
  result?: string;
  error?: string;
}

export class TaskRegistry {
  private map = new Map<string, TaskEntry>();
  private sessionIndex = new Map<string, string>(); // sessionId → taskId

  register(entry: Omit<TaskEntry, "status"> & { status?: TaskEntry["status"] }): void {
    const task: TaskEntry = {
      ...entry,
      status: entry.status ?? "running",
    };
    this.map.set(task.taskId, task);
    this.sessionIndex.set(task.sessionId, task.taskId);
  }

  getByTaskId(taskId: string): TaskEntry | undefined {
    return this.map.get(taskId);
  }

  getBySessionId(sessionId: string): TaskEntry | undefined {
    const taskId = this.sessionIndex.get(sessionId);
    if (!taskId) return undefined;
    return this.map.get(taskId);
  }

  setIdle(sessionId: string, result: string): void {
    const taskId = this.sessionIndex.get(sessionId);
    if (!taskId) return;
    const task = this.map.get(taskId);
    if (!task) return;
    task.status = "idle";
    task.result = result;
  }

  setError(sessionId: string, error: string): void {
    const taskId = this.sessionIndex.get(sessionId);
    if (!taskId) return;
    const task = this.map.get(taskId);
    if (!task) return;
    task.status = "error";
    task.error = error;
  }

  removeBySessionId(sessionId: string): void {
    const taskId = this.sessionIndex.get(sessionId);
    if (!taskId) return;
    this.map.delete(taskId);
    this.sessionIndex.delete(sessionId);
  }

  removeByParentSessionId(parentSessionId: string): void {
    const toRemove: string[] = [];
    for (const [taskId, task] of this.map) {
      if (task.parentSessionId === parentSessionId) {
        toRemove.push(taskId);
      }
    }
    for (const taskId of toRemove) {
      const task = this.map.get(taskId);
      if (task) {
        this.sessionIndex.delete(task.sessionId);
      }
      this.map.delete(taskId);
    }
  }

  getRunningByParent(parentSessionId: string): TaskEntry[] {
    const result: TaskEntry[] = [];
    for (const task of this.map.values()) {
      if (task.parentSessionId === parentSessionId && task.status === "running") {
        result.push(task);
      }
    }
    return result;
  }
}
