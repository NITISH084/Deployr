import {createClient} from "redis";
import {deleteS3TempFolder, downloadS3Folder} from "./cloud.js";
import { buildProject, copyFinalDist } from "./utils.js";
import path from "node:path";
import { rm } from "node:fs/promises";
import { TEMP_ROOT } from "./paths.js";

const subscriber = createClient({
  url: "redis://127.0.0.1:6379",
  RESP: 2,
});

subscriber.on("error", (err) => {
  console.error("Redis error:", err);
});

await subscriber.connect();

const publisher = createClient({
  url: "redis://127.0.0.1:6379",
  RESP: 2,
});

publisher.on("error", (err) => {
  console.error("Redis error:", err);
});

await publisher.connect();

console.log("Redis connected successfully!");


async function main() {
  while (true) {
    let key: string | undefined;

    try {
      // 1. Get the next deployment ID from Redis.
      const queueItem = await subscriber.blPop("build-queue", 0);
      key = queueItem?.element;

      if (!key) continue;

      // Validate the deployment ID before using it in a filesystem path.
      if (!/^[a-z0-9]{5}$/.test(key)) {
        throw new Error(`Invalid deployment ID: ${key}`);
      }

      console.log(`Processing deployment: ${key}`);

      // 2. Download source files from R2.
      const downloaded = await downloadS3Folder(key);

      if (downloaded === 0) {
        throw new Error(
          `No source files found in storage under "temp/${key}/".`
        );
      }

      await publisher.hSet("build-status", key, "Building");

      // 3. Build and publish the deployment.
      await buildProject(key);
      await copyFinalDist(key);

      await publisher.hSet("build-status", key, "Deployed");

      // Only delete source after the final output is uploaded.
      try {
        await deleteS3TempFolder(key);
      } catch (error) {
        // Cleanup failure should not invalidate an otherwise successful deployment.
        console.error(`R2 cleanup failed for ${key}:`, error);
      }

      console.log(`Deployment ${key} completed successfully.`);
    } catch (err) {
      console.error("Error processing queue item:", err);

      if (key) {
        try {
          await publisher.hSet("build-status", key, "Failed");
        } catch (statusError) {
          console.error("Failed to update deployment status:", statusError);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      // 4. Always remove the local downloaded source and build files.
      if (key && /^[a-z0-9]{5}$/.test(key)) {
        const projectPath = path.join(TEMP_ROOT, key);

        try {
          await rm(projectPath, {
            recursive: true,
            force: true,
          });

          console.log(`Cleaned up temporary files for ${key}`);
        } catch (cleanupError) {
          console.error(
            `Failed to clean up temporary files for ${key}:`,
            cleanupError
          );
        }
      }
    }
  }
}

main();
