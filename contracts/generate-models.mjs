import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const contract = "contracts/asyncapi.yaml";
const modelContract = "contracts/models.asyncapi.yaml";
const targets = {
  kotlin: {
    generator: "kotlin",
    packageName: "com.andrewtinyakov.fileupload.asset.messaging",
    clean: "api/src/generated/asyncapi/kotlin",
    output:
      "api/src/generated/asyncapi/kotlin/com/andrewtinyakov/fileupload/asset/messaging",
  },
  go: {
    generator: "golang",
    packageName: "messaging",
    clean: "workers/internal/generated/messaging",
    output: "workers/internal/generated/messaging",
  },
};

const language = process.argv[2];
const target = targets[language];

if (!target) {
  console.error("Usage: node contracts/generate-models.mjs <kotlin|go>");
  process.exit(2);
}

const asyncApi = join(
  repositoryRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "asyncapi.cmd" : "asyncapi",
);
const gradle = join(
  repositoryRoot,
  "api",
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);
const run = (command, args) =>
  execFileSync(command, args, { cwd: repositoryRoot, stdio: "inherit" });

function strictGoEnumDecoder(source) {
  const enumName = source.match(/^type (\w+) uint$/m)?.[1];
  if (!enumName) return source;

  const decoder = new RegExp(
    `func \\(op \\*${enumName}\\) UnmarshalJSON\\(raw \\[]byte\\) error \\{[\\s\\S]*?\\n\\}`,
  );
  if (!decoder.test(source) || !source.includes('"encoding/json"')) {
    throw new Error(`Unsupported generated enum decoder: ${enumName}`);
  }

  return source.replace('"encoding/json"', '"encoding/json"\n"fmt"').replace(
    decoder,
    `func (op *${enumName}) UnmarshalJSON(raw []byte) error {
    var value *string
    if err := json.Unmarshal(raw, &value); err != nil {
        return err
    }
    if value == nil {
        return fmt.Errorf("${enumName} must be a string")
    }
    decoded, ok := ValuesTo${enumName}[*value]
    if !ok {
        return fmt.Errorf("invalid ${enumName}: %q", *value)
    }
    *op = decoded
    return nil
}`,
  );
}

run(asyncApi, ["validate", contract]);
run(asyncApi, ["validate", modelContract]);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "file-upload-asyncapi-"));
const bundledContract = join(temporaryDirectory, "asyncapi.yaml");

try {
  run(asyncApi, ["bundle", modelContract, "--output", bundledContract]);
  rmSync(join(repositoryRoot, target.clean), { recursive: true, force: true });

  const generatorArgs = [
    "generate",
    "models",
    target.generator,
    bundledContract,
    "--packageName",
    target.packageName,
    "--output",
    target.output,
    "--no-interactive",
  ];

  if (language === "go") generatorArgs.push("--goIncludeTags");
  run(asyncApi, generatorArgs);

  if (language === "kotlin") {
    for (const file of readdirSync(join(repositoryRoot, target.output))) {
      if (!file.endsWith(".kt")) continue;
      const group = file.includes("Command") ? "command" : "event";
      const sourcePath = join(repositoryRoot, target.output, file);
      const destination = join(repositoryRoot, target.output, group);
      mkdirSync(destination, { recursive: true });
      const source = readFileSync(sourcePath, "utf8").replace(
        `package ${target.packageName}`,
        `package ${target.packageName}.${group}`,
      );
      writeFileSync(sourcePath, source.replace(/^(data class|enum class)/m, '@javax.annotation.processing.Generated("contracts/generate-models.mjs")\n$1').trimEnd() + "\n");
      renameSync(sourcePath, join(destination, file));
    }
    run(gradle, ["-p", "api", "ktlintFormat", "--no-daemon"]);
  }

  if (language === "go") {
    for (const file of readdirSync(join(repositoryRoot, target.output))) {
      if (!file.endsWith(".go")) continue;
      const path = join(repositoryRoot, target.output, file);
      const source = readFileSync(path, "utf8");
      writeFileSync(
        path,
        strictGoEnumDecoder(
          source.replace(/^[\t ]*\/\/(?!go:| \+build).*\r?\n/gm, ""),
        ),
      );
    }
    run("go", ["-C", "workers", "fmt", "./internal/generated/messaging"]);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
