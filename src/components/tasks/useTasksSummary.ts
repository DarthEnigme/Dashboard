"use client";

import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/fetcher";
import type { TasksSummary } from "@/lib/tasks/types";

const URL = "/api/tasks/summary";

/** This person's open, overdue and due-soon tasks, for the bell and the dashboard widget. Errors (no permission) leave it empty. */
export const useTasksSummary = () => useSWR<TasksSummary>(URL, fetcher, { refreshInterval: 300_000, shouldRetryOnError: false });

/** Fetch it again: after a change to a board, what is due may have moved. */
export const refreshTasksSummary = () => void mutate(URL);
