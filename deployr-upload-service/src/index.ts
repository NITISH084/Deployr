import express from "express";
import cors from "cors";
import { simpleGit } from 'simple-git';
import { generate, getAllFiles } from "./utils.js";
import { uploadFile } from "./cloud.js"
import path from "path";
import { fileURLToPath } from "url";
import {createClient} from "redis"

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const publisher = createClient({
    url: "redis://127.0.0.1:6379",
    RESP: 2,
});

publisher.on("error", (err) => {
  console.error("Redis error:", err);
});

await publisher.connect();

const subscriber = createClient({
    url: "redis://127.0.0.1:6379",
    RESP: 2,
});

subscriber.on("error", (err) => {
  console.error("Redis error:", err);
});

await subscriber.connect();


console.log("Redis connected successfully!");

app.post("/deploy", async (req, res) => {
  const  repoURL  = req.body.repoURL;
  const id = generate();
  const projectPath = path.join(__dirname, `temp/${id}`);

  try {
    const git = simpleGit();
    await git.clone(repoURL, projectPath);

    const files = getAllFiles(projectPath);

    // Wait for every upload to finish before queueing the build, otherwise
    // the deploy service can pick up the job while the bucket is still empty.
    await Promise.all(
      files.map((file) => {
        const key = path.relative(__dirname, file).split(path.sep).join("/");
        return uploadFile(key, file);
      })
    );

    await publisher.lPush("build-queue", id);

    await publisher.hSet("build-status", id, "Uploaded");

    res.json({
      id: id
    });
  } catch (err) {
    console.error(`Failed to queue deployment ${id}:`, err);

    await publisher.hSet("build-status", id, "Failed");

    res.status(500).json({
      error: "Failed to queue deployment"
    });
  }
})

app.get("/status", async(req, res)=>{
  const id = req.query.id;
  const response = await subscriber.hGet("build-status", id as string);
  res.json({
    status: response
  })
})

app.listen(3000, "127.0.0.1", ()=>{
  console.log("Listening on port 3000");
});
