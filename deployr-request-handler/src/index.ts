
import express from "express";
import path from "path";
import {
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";

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

const accessKeyId = process.env.accessKeyId!;
const secretAccessKey = process.env.secretAccessKey!;
const endpoint = process.env.endpoint!;

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

const app = express();

app.get("/{*splat}", async (req, res) => {
  try {
    const host = req.hostname;
    const id = host.split(".")[0];
    const filePath = req.path === "/" ? "/index.html" : req.path;

    const command = new GetObjectCommand({
      Bucket: "deployr",
      Key: `dist/${id}${filePath}`,
    });

    const response = await s3.send(command);

    if (!response.Body) {
      return res.status(404).send("File not found");
    }

    // Prefer the extension-based type: objects uploaded without metadata come
    // back as application/octet-stream, which makes browsers download HTML
    // and refuse to execute module scripts.
    const inferredContentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];

    if (inferredContentType) {
      res.setHeader("Content-Type", inferredContentType);
    } else if (response.ContentType) {
      res.setHeader("Content-Type", response.ContentType);
    }

    if (response.ContentLength !== undefined) {
      res.setHeader("Content-Length", response.ContentLength);
    }

    const stream = response.Body as NodeJS.ReadableStream;

    stream.pipe(res);

    stream.on("error", (err) => {
      console.error("S3 stream error:", err);
      if (!res.headersSent) {
        res.status(500).send("Error streaming file");
      } else {
        res.destroy(err);
      }
    });

  } catch (error: any) {
    if (error.name === "NoSuchKey" || error.name === "NotFound") {
      return res.status(404).send("File not found");
    }

    console.error("File serving error:", error);
    res.status(500).send("Internal server error");
  }
});

app.listen(3001, "127.0.0.1", () => {
  console.log("Static server listening on port 3001");
});
