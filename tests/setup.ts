import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every test file gets its own config and data directories, so no test can touch the real
// ./config or ./data (modules read these paths when first imported).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "page-test-"));
process.env.HOMEPAGE_CONFIG_DIR = path.join(root, "config");
process.env.HOMEPAGE_DATA_DIR = path.join(root, "data");
process.env.HOMEPAGE_SECRET ??= "unit-test-secret-unit-test-secret";
