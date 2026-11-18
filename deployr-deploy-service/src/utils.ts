import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import {uploadFile, getAllFiles} from "./cloud.js";
import { TEMP_ROOT } from "./paths.js";


export async function copyFinalDist(id: string){
  const safeId = path.basename(id);
  const folderPath = path.join(TEMP_ROOT, safeId, "dist");

  if(!fs.existsSync(folderPath)){
    throw new Error(
      `Build produced no output directory at ${folderPath}. ` +
      `The project must run "npm run build" and emit a "dist" folder.`
    );
  }

  const allFiles = getAllFiles(folderPath);
  await Promise.all(
    allFiles.map(file => {
      const relativePath = path.relative(folderPath, file).split(path.sep).join("/");
      return uploadFile(`dist/${safeId}/${relativePath}`, file);
    })
  );

  console.log(`All build files uploaded for ${safeId}`);
}



export function buildProject(id: string): Promise<void>{
  return new Promise((resolve, reject) => {
    const safeId = path.basename(id);
    const projectPath = path.join(TEMP_ROOT, safeId);
    console.log(projectPath);

    if(!fs.existsSync(path.join(projectPath, "package.json"))){
      reject(new Error(
        `No package.json found at ${projectPath}/package.json. ` +
        `The project sources were not downloaded properly.`
      ));
      return;
    }

    // Run inside an ephemeral Node container with resource limits.
    // Match the host UID/GID so files the build writes into the mounted
    // directory stay owned by the user running this service.
    const dockerArgs = [
      "run",
      "--rm",                        // Remove container after build finishes
    ];

    const uid = process.getuid?.();
    const gid = process.getgid?.();

    if(uid !== undefined && gid !== undefined){
      dockerArgs.push(
        "--user", `${uid}:${gid}`,
        "-e", "HOME=/tmp",
        "-e", "npm_config_cache=/tmp/.npm"
      );
    }

    dockerArgs.push(
      "-v", `${projectPath}:/app`,   // Mount project directory
      "-w", "/app",                  // Set working directory
      "--memory", "1g",              // Prevent out-of-memory host crashes
      "--cpus", "1.0",               // Limit CPU usage
      "node:20-alpine",              // Lightweight Node image
      "sh", "-c", "npm install && npm run build"
    );

    const child = spawn("docker", dockerArgs);

    child.stdout?.on("data", (data)=>{
      console.log(`stdout [${safeId}]: ${data}`);
    })

    child.stderr?.on("data", (data) => {
      console.error(`stderr [${safeId}]: ${data}`);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start Docker process: ${err.message}`));
    });

    child.on("close", (code) => {
      if(code === 0){
        resolve();
      } else {
        reject(new Error(`Docker process exited with code ${code}`));
      }
    });
  })
}
