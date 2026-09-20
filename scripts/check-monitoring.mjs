import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const prometheusConfiguration = join(repositoryRoot, "infra/prometheus");
const alertmanagerConfiguration = join(repositoryRoot, "infra/alertmanager");

const checks = [
  ["docker", ["compose", "-f", "compose.local.yaml", "config", "--quiet"]],
  ["docker", ["compose", "-f", "compose.local.yaml", "-f", "compose.scale.yaml", "config", "--quiet"]],
  [
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${prometheusConfiguration}:/etc/prometheus:ro`,
      "--entrypoint",
      "promtool",
      "prom/prometheus:v3.14.0",
      "check",
      "config",
      "/etc/prometheus/prometheus.yaml",
    ],
  ],
  [
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${prometheusConfiguration}:/etc/prometheus:ro`,
      "--entrypoint",
      "promtool",
      "prom/prometheus:v3.14.0",
      "test",
      "rules",
      "/etc/prometheus/alerts.test.yaml",
    ],
  ],
  [
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${alertmanagerConfiguration}:/etc/alertmanager:ro`,
      "--entrypoint",
      "amtool",
      "prom/alertmanager:v0.34.1",
      "check-config",
      "/etc/alertmanager/alertmanager.yaml",
    ],
  ],
];

for (const [command, args] of checks) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
