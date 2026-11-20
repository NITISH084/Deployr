
import fs from "fs";
import path from "path";

type Framework =
  | "vite"
  | "create-react-app"
  | "vue-cli"
  | "angular"
  | "next"
  | "astro"
  | "gatsby"
  | "nuxt"
  | "sveltekit"
  | "parcel"
  | "eleventy"
  | "unknown";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  deployr?: {
    outputDirectory?: string;
  };
}

interface FrameworkInfo {
  name: Framework;
  outputDirectories: string[];
  staticOnly: boolean;
}

function readPackageJson(projectPath: string): PackageJson {
  const packagePath = path.join(projectPath, "package.json");

  if (!fs.existsSync(packagePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(packagePath, "utf-8"));
}

function getDependencies(pkg: PackageJson): Record<string, string> {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
}

function getAngularOutputDirectories(
  projectPath: string
): string[] {
  const angularPath = path.join(projectPath, "angular.json");

  if (!fs.existsSync(angularPath)) {
    return [];
  }

  try {
    const angularConfig = JSON.parse(
      fs.readFileSync(angularPath, "utf-8")
    );

    const directories: string[] = [];

    for (const project of Object.values(
      angularConfig.projects ?? {}
    ) as any[]) {
      const outputPath =
        project.architect?.build?.options?.outputPath ??
        project.targets?.build?.options?.outputPath;

      if (typeof outputPath === "string") {
        directories.push(
          path.join(outputPath, "browser"),
          outputPath
        );
      } else if (outputPath && typeof outputPath === "object") {
        const base = outputPath.base ?? "dist";

        directories.push(
          path.join(base, outputPath.browser ?? "browser")
        );
      }
    }

    return directories;
  } catch {
    console.warn("Could not parse angular.json");
    return [];
  }
}

export function detectFramework(
  projectPath: string
): FrameworkInfo {
  const pkg = readPackageJson(projectPath);
  const deps = getDependencies(pkg);

  // Vite
  if (deps.vite) {
    return {
      name: "vite",
      outputDirectories: ["dist"],
      staticOnly: true,
    };
  }

  // Create React App
  if (deps["react-scripts"]) {
    return {
      name: "create-react-app",
      outputDirectories: ["build"],
      staticOnly: true,
    };
  }

  // Angular
  if (deps["@angular/cli"]) {
    return {
      name: "angular",
      outputDirectories: getAngularOutputDirectories(projectPath),
      staticOnly: true,
    };
  }

  // Next.js: only static export is supported by this uploader.
  if (deps.next) {
    return {
      name: "next",
      outputDirectories: ["out"],
      staticOnly: true,
    };
  }

  // Astro
  if (deps.astro) {
    return {
      name: "astro",
      outputDirectories: ["dist"],
      staticOnly: true,
    };
  }

  // Gatsby
  if (deps.gatsby) {
    return {
      name: "gatsby",
      outputDirectories: ["public"],
      staticOnly: true,
    };
  }

  // Nuxt
  if (deps.nuxt) {
    return {
      name: "nuxt",
      outputDirectories: [".output/public"],
      staticOnly: true,
    };
  }

  // SvelteKit
  if (deps["@sveltejs/kit"]) {
    return {
      name: "sveltekit",
      outputDirectories: ["build"],
      staticOnly: true,
    };
  }

  // Vue CLI
  if (deps["@vue/cli-service"]) {
    return {
      name: "vue-cli",
      outputDirectories: ["dist"],
      staticOnly: true,
    };
  }

  // Parcel
  if (deps.parcel || deps["@parcel/core"]) {
    return {
      name: "parcel",
      outputDirectories: ["dist"],
      staticOnly: true,
    };
  }

  // Eleventy
  if (deps["@11ty/eleventy"]) {
    return {
      name: "eleventy",
      outputDirectories: ["_site"],
      staticOnly: true,
    };
  }

  return {
    name: "unknown",
    outputDirectories: ["dist", "build"],
    staticOnly: true,
  };
}
