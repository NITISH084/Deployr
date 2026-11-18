import { Upload } from "@aws-sdk/lib-storage";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
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
})

export const getAllFiles = (folderPath: string) => {
  let response: string[] = [];

  const allFilesAndFolders = fs.readdirSync(folderPath);
  for(const file of allFilesAndFolders){
    const absolute = path.join(folderPath, file);
    if(fs.statSync(absolute).isDirectory()){
      response.push(...getAllFiles(absolute));
    }
    else{
      response.push(absolute);
    }
  }
  return response;
}

export const uploadFile = async (fileName: string, localFilePath: string) => {
  const fileContent = fs.readFileSync(localFilePath);
  const contentType = CONTENT_TYPES[path.extname(localFilePath).toLowerCase()];

  const response = await new Upload({
    client: s3,
    params: {
      Body: fileContent,
      Bucket: "deployr",
      Key: fileName,
      ...(contentType ? { ContentType: contentType } : {}),
    },
  }).done();
  console.log('Uploaded the build.', response);
}



export async function downloadS3Folder(id: string): Promise<number> {
  const safeId = path.basename(id);
  const prefix = `temp/${safeId}`;
  let continuationToken: string | undefined;

  const rootPath = path.join(TEMP_ROOT, safeId);

  // Remove files left over from a previous run so a stale directory can never
  // hide the fact that this build's sources were not uploaded.
  await fs.promises.rm(rootPath, { recursive: true, force: true });

  let totalListed = 0;
  let totalDownloaded = 0;
  let page = 0;

  do {
    page++;

    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: "deployr",
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
      })
    );

    const files = (result.Contents ?? []).filter(
      item => item.Key && !item.Key.endsWith("/")
    );

    totalListed += files.length;

    console.log(
      `Page ${page}: R2 returned ${files.length} objects`
    );

    // Process objects in small batches to avoid overwhelming the system.
    const batchSize = 20;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async ({ Key }) => {
          if (!Key) return;

          const relativePath = path.relative(prefix, Key);
          const outputPath = path.resolve(rootPath, relativePath);

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
              Bucket: "deployr",
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

