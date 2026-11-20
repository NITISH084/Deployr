import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { uploadFile, getAllFiles } from "./cloud.js";
import { TEMP_ROOT } from "./paths.js";

export async function copyFinalDist(id: string): Promise<void> {
  const safeId = path.basename(id);
  const folderPath = path.join(TEMP_ROOT, safeId, "dist");

  if (!fs.existsSync(folderPath)) {
    throw new Error(
      `Build produced no output directory at ${folderPath}. ` +
        `The project must run "npm run build" and emit a "dist" folder.`
    );
  }

  const allFiles = getAllFiles(folderPath);

  await Promise.all(
    allFiles.map((file) => {
      const relativePath = path
        .relative(folderPath, file)
        .split(path.sep)
        .join("/");

      return uploadFile(`dist/${safeId}/${relativePath}`, file);
    })
  );

  console.log(`All build files uploaded for ${safeId}`);
}

export function buildProject(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const safeId = path.basename(id);
    const projectPath = path.join(TEMP_ROOT, safeId);

    console.log(`Building project: ${projectPath}`);

    if (!fs.existsSync(path.join(projectPath, "package.json"))) {
      reject(
        new Error(
          `No package.json found at ${projectPath}/package.json. ` +
            `The project sources were not downloaded properly.`
        )
      );
      return;
    }

    // Commands executed inside the Node.js Docker container.
    const buildScript = `
      set -e

      echo "================================"
      echo "Deployr Build Environment"
      echo "================================"

      echo "Architecture: $(node -p 'process.arch')"
      echo "Node version: $(node --version)"
      echo "npm version: $(npm --version)"
      echo "npm omit: $(npm config get omit)"

      echo ""
      echo "Installing dependencies..."

      npm install --include=optional

      echo ""
      echo "Installed top-level packages:"
      npm ls --depth=0 || true

      echo ""
      echo "Rollup package check:"
      npm ls rollup || true

      echo ""
      echo "Rollup native package check:"
      npm ls @rollup/rollup-linux-arm64-gnu || true

      echo ""
      echo "Starting project build..."

      npm run build

      echo ""
      echo "Build completed successfully!"
    `;

    const dockerArgs: string[] = [
      "run",
      "--rm",

      // Resource limits.
      "--memory=2g",
      "--cpus=1",

      // Mount downloaded project into the container.
      "-v",
      `${projectPath}:/app`,

      // Set container working directory.
      "-w",
      "/app",
    ];

    // Match host UID/GID so generated files remain accessible
    // to the service running on the VM.
    const uid = process.getuid?.();
    const gid = process.getgid?.();

    if (uid !== undefined && gid !== undefined) {
      dockerArgs.push(
        "--user",
        `${uid}:${gid}`,
        "-e",
        "HOME=/tmp",
        "-e",
        "npm_config_cache=/tmp/.npm"
      );
    }

    // Node image supports ARM64 and AMD64.
    const dockerImage = "node:22-bookworm-slim";

    dockerArgs.push(
      dockerImage,
      "sh",
      "-lc",
      buildScript
    );

    console.log(`Starting Docker build for ${safeId}`);

    const child = spawn("docker", dockerArgs);

    child.stdout?.on("data", (data: Buffer) => {
      console.log(`stdout [${safeId}]: ${data.toString()}`);
    });

    child.stderr?.on("data", (data: Buffer) => {
      console.error(`stderr [${safeId}]: ${data.toString()}`);
    });

    child.on("error", (err) => {
      reject(
        new Error(`Failed to start Docker process: ${err.message}`)
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`Docker build completed for ${safeId}`);
        resolve();
      } else {
        reject(
          new Error(`Docker process exited with code ${code}`)
        );
      }
    });
  });
}

