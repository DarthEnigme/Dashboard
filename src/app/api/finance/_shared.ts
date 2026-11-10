import { guardFor } from "@/lib/api";

export { bad } from "@/lib/api";
export { isDate } from "@/lib/clean";

/** Finance is personal: every route needs a signed-in user with the finance permission; changes must also be same-origin. */
export const guard = guardFor("finance");
