import type { FieldSpec } from "@/integrations/fields";

export const visibleField: FieldSpec = {
  key: "visible",
  label: "Who can see this",
  kind: "audience",
  help: "public = everyone who can open the page, users = signed-in people, admins = admins only, or members of the groups you pick.",
};
