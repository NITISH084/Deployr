import {createClient} from "redis";
import {downloadS3Folder} from "./cloud.js";
import { buildProject, copyFinalDist } from "./utils.js";

const subscriber = createClient({
  url: "redis://127.0.0.1:6379",
});

subscriber.on("error", (err) => {
  console.error("Redis error:", err);
});

await subscriber.connect();

const publisher = createClient({
  url: "redis://127.0.0.1:6379",
});

publisher.on("error", (err) => {
  console.error("Redis error:", err);
});

await publisher.connect();

console.log("Redis connected successfully!");

async function main() {
  while(1) {
    let key: string | undefined;
    try {
      // 1. Pull the next key name from the Redis queue (blocks until available)
      const queueItem = await subscriber.blPop('build-queue', 0);
      key = queueItem?.element;

      if (!key) continue;

      // 2. use that key to fetch the actual value from Redis.
      const value = await subscriber.get(key);

      console.log(`Pulled key: "${key}" with value: "${value}"`);

      // 3. Download the folder from S3 and build it.
      const downloaded = await downloadS3Folder(key);

      if (downloaded === 0) {
        throw new Error(
          `No source files found in storage under "temp/${key}/". ` +
          `The upload likely had not finished before the build was queued.`
        );
      }

      await buildProject(key);
      await copyFinalDist(key);

      await publisher.hSet("build-status", key, "Deployed");
    } catch (err) {
      console.error('Error processing queue item:', err);

      if (key) {
        await publisher.hSet("build-status", key, "Failed");
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

main();