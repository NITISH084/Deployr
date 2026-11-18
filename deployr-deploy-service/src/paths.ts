import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root directory for source checkouts and build output.
 *
 * It lives next to dist/ (not inside it) so that:
 *  - rebuilding the service never touches build temp data, and
 *  - the directory is owned by the user running the service, not by an
 *    earlier `sudo` run.
 *
 * Override with DEPLOYR_TEMP_DIR if the default location is not writable.
 */
export const TEMP_ROOT = process.env.DEPLOYR_TEMP_DIR
  ? path.resolve(process.env.DEPLOYR_TEMP_DIR)
  : path.resolve(__dirname, "..", "temp");
