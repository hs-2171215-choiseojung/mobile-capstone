"use client";

export type StudentNotebookExitReason = "removed" | "deleted";

export interface StudentNotebookExitState {
  notebookId: string;
  title: string;
  reason: StudentNotebookExitReason;
  updatedAt: string;
}

const STORAGE_KEY = "student-notebook-exit-states";

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function readStudentNotebookExitStates(): StudentNotebookExitState[] {
  if (!canUseStorage()) return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is StudentNotebookExitState => {
      return (
        item &&
        typeof item === "object" &&
        typeof item.notebookId === "string" &&
        typeof item.title === "string" &&
        (item.reason === "removed" || item.reason === "deleted") &&
        typeof item.updatedAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeStudentNotebookExitStates(states: StudentNotebookExitState[]) {
  if (!canUseStorage()) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
  } catch {
    // ignore storage errors
  }
}

export function saveStudentNotebookExitState(
  notebookId: string,
  title: string,
  reason: StudentNotebookExitReason
) {
  if (!notebookId) return;

  const nextItem: StudentNotebookExitState = {
    notebookId,
    title: title.trim() || "노트북",
    reason,
    updatedAt: new Date().toISOString(),
  };

  const next = [
    nextItem,
    ...readStudentNotebookExitStates().filter((item) => item.notebookId !== notebookId),
  ].slice(0, 20);

  writeStudentNotebookExitStates(next);
}

export function removeStudentNotebookExitState(notebookId: string) {
  if (!notebookId) return;
  writeStudentNotebookExitStates(
    readStudentNotebookExitStates().filter((item) => item.notebookId !== notebookId)
  );
}

export function getStudentNotebookExitState(notebookId: string) {
  return readStudentNotebookExitStates().find((item) => item.notebookId === notebookId) ?? null;
}
