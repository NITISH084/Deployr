
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import type { Readable } from "stream";
import { pipeline } from "node:stream/promises";

import { TEMP_ROOT } from "./paths.js";

dotenv.config();

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
};

const accessKeyId: string = process.env.accessKeyId!;
const secretAccessKey: string = process.env.secretAccessKey!;
const endpoint: string = process.env.endpoint!;

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

const BUCKET = "deployr";

export const getAllFiles = (folderPath: string): string[] => {
  const response: string[] = [];

  const allFilesAndFolders = fs.readdirSync(folderPath);

  for (const file of allFilesAndFolders) {
    if (file === ".git") continue;

    const absolute = path.join(folderPath, file);

    if (fs.statSync(absolute).isDirectory()) {
      response.push(...getAllFiles(absolute));
    } else {
      response.push(absolute);
    }
  }

  return response;
};

export const uploadFile = async (
  fileName: string,
  localFilePath: string
): Promise<void> => {
  const fileContent = fs.readFileSync(localFilePath);
  const contentType = CONTENT_TYPES[
    path.extname(localFilePath).toLowerCase()
  ];

  const response = await new Upload({
    client: s3,
    params: {
      Body: fileContent,
      Bucket: BUCKET,
      Key: fileName,
      ...(contentType ? { ContentType: contentType } : {}),
    },
  }).done();

  console.log("Uploaded file:", fileName, response);
};

export async function downloadS3Folder(id: string): Promise<number> {
  const safeId = path.basename(id);
  const prefix = `temp/${safeId}/`;

  const rootPath = path.join(TEMP_ROOT, safeId);

  // Remove files left over from a previous run.
  await fs.promises.rm(rootPath, {
    recursive: true,
    force: true,
  });

  let continuationToken: string | undefined;

  let totalListed = 0;
  let totalDownloaded = 0;
  let page = 0;

  do {
    page++;

    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const files = (result.Contents ?? []).filter(
      (item) => item.Key && !item.Key.endsWith("/")
    );

    totalListed += files.length;

    console.log(
      `Page ${page}: R2 returned ${files.length} objects`
    );

    const batchSize = 20;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async ({ Key }) => {
          if (!Key) return;

          const relativePath = Key.slice(prefix.length);

          const outputPath = path.resolve(
            rootPath,
            ...relativePath.split("/")
          );

          if (
            outputPath !== rootPath &&
            !outputPath.startsWith(rootPath + path.sep)
          ) {
            throw new Error(`Invalid S3 key: ${Key}`);
          }

          await fs.promises.mkdir(path.dirname(outputPath), {
            recursive: true,
          });

          const response = await s3.send(
            new GetObjectCommand({
              Bucket: BUCKET,
              Key,
            })
          );

          if (!response.Body) {
            throw new Error(`Empty S3 object: ${Key}`);
          }

          await pipeline(
            response.Body as Readable,
            fs.createWriteStream(outputPath)
          );

          totalDownloaded++;
        })
      );
    }

    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined;
  } while (continuationToken);

  console.log("Download summary:", {
    prefix,
    totalListed,
    totalDownloaded,
  });

  if (totalListed !== totalDownloaded) {
    throw new Error("Some S3 objects were not downloaded");
  }

  console.log(`Download completed: ${prefix}`);

  return totalDownloaded;
}

/**
 * Deletes all source files belonging to a deployment from R2.
 *
 * Only deletes temp/<deploymentId>/.
 * Never deletes dist/<deploymentId>/.
 */
export async function deleteS3TempFolder(
  id: string
): Promise<void> {
  const safeId = path.basename(id);
  const prefix = `temp/${safeId}/`;

  console.log(`Starting R2 cleanup: ${prefix}`);

  let continuationToken: string | undefined;
  let totalDeleted = 0;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (result.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));

    if (keys.length > 0) {
      // S3 DeleteObjects supports a maximum of 1000 objects per request.
      const batchSize = 1000;

      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);

        const deleteResult = await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true,
            },
          })
        );

        if (deleteResult.Errors?.length) {
          console.error("R2 deletion errors:", deleteResult.Errors);

          throw new Error(
            `Failed to delete ${deleteResult.Errors.length} R2 objects`
          );
        }

        totalDeleted += batch.length;

        console.log(
          `Deleted ${batch.length} objects from ${prefix}`
        );
      }
    }

    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined;
  } while (continuationToken);

  console.log(
    `R2 cleanup completed: ${prefix}. Total deleted: ${totalDeleted}`
  );
}
