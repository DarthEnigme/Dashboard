import type { FieldSpec } from "@/integrations/fields";

export const visibleField: FieldSpec = {
  key: "visible",
  label: "Who can see this",
  kind: "select",
  options: ["public", "users", "admins"],
  help: "public = everyone who can open the page, users = signed-in people, admins = admins only.",
};
