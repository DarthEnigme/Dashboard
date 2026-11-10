import { guardFor } from "@/lib/api";

export { bad, body } from "@/lib/api";

export const guard = guardFor("travel", "the travel log");
