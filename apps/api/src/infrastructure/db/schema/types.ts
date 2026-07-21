import { customType } from "drizzle-orm/pg-core";

// Case-insensitive text (database.md §7: "email citext"). Requires the
// citext extension (0000_bootstrap_extensions.sql).
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});
