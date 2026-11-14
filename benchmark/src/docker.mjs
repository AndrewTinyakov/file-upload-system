import http from 'node:http';

export function docker(path, method = 'GET', input, raw = false) {
  return new Promise((resolve, reject) => {
    const body = input === undefined ? undefined : JSON.stringify(input);
    const request = http.request({ socketPath: '/var/run/docker.sock', path, method, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {} }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (raw && response.statusCode < 300) return resolve(Buffer.concat(chunks));
        const body = Buffer.concat(chunks).toString();
        if (response.statusCode >= 300) return reject(new Error(`Docker ${response.statusCode}: ${body}`));
        try { resolve(body ? JSON.parse(body) : null); } catch { reject(new Error(`Docker non-JSON response ${body.slice(0, 100)}`)); }
      });
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Docker request timeout')));
    request.end(body);
  });
}

export async function dockerExec(containerId, command) {
  const exec = await docker(`/containers/${containerId}/exec`, 'POST', { Cmd: command, AttachStdout: true, AttachStderr: true });
  const output = await docker(`/exec/${exec.Id}/start`, 'POST', { Detach: false, Tty: false }, true);
  const chunks = [];
  for (let offset = 0; offset < output.length;) {
    if (offset + 8 > output.length) throw new Error('Truncated Docker exec header');
    const length = output.readUInt32BE(offset + 4);
    if (offset + 8 + length > output.length) throw new Error('Truncated Docker exec output');
    chunks.push(output.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  const result = chunks.map(chunk => chunk.toString()).join('');
  const status = await docker(`/exec/${exec.Id}/json`);
  if (status.Running || status.ExitCode !== 0) throw new Error(`Docker exec failed ${status.ExitCode}: ${result}`);
  return result;
}

export async function containers() {
  const filters = encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=upload-benchmark'] }));
  return (await docker(`/containers/json?filters=${filters}`)).map(container => ({ id: container.Id, service: container.Labels['com.docker.compose.service'], image: container.ImageID }));
}

export async function sample(container) {
  const stats = await docker(`/containers/${container.id}/stats?stream=false&one-shot=true`);
  const io = stats.blkio_stats?.io_service_bytes_recursive ?? [];
  return {
    service: container.service,
    at: Date.now(),
    statsReadMs: Number.isFinite(Date.parse(stats.read)) ? Date.parse(stats.read) : null,
    statsPreReadMs: Number.isFinite(Date.parse(stats.preread)) ? Date.parse(stats.preread) : null,
    systemCpuSeconds: Number.isFinite(stats.cpu_stats?.system_cpu_usage) ? stats.cpu_stats.system_cpu_usage / 1e9 : null,
    onlineCpus: stats.cpu_stats?.online_cpus ?? null,
    cpuPeriods: stats.cpu_stats?.throttling_data?.periods ?? null,
    cpuThrottledPeriods: stats.cpu_stats?.throttling_data?.throttled_periods ?? null,
    memoryMajorFaults: stats.memory_stats?.stats?.pgmajfault ?? null,
    cpuSeconds: (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) / 1e9,
    peakMemoryBytes: stats.memory_stats?.usage ?? 0,
    anonymousMemoryBytes: stats.memory_stats?.stats?.anon ?? stats.memory_stats?.stats?.rss ?? null,
    networkRxBytes: Object.values(stats.networks ?? {}).reduce((sum, value) => sum + value.rx_bytes, 0),
    networkTxBytes: Object.values(stats.networks ?? {}).reduce((sum, value) => sum + value.tx_bytes, 0),
    storageReadBytes: io.filter(entry => entry.op.toLowerCase() === 'read').reduce((sum, entry) => sum + entry.value, 0),
    storageWriteBytes: io.filter(entry => entry.op.toLowerCase() === 'write').reduce((sum, entry) => sum + entry.value, 0),
    throttledSeconds: (stats.cpu_stats?.throttling_data?.throttled_time ?? 0) / 1e9,
    memoryLimitBytes: stats.memory_stats?.limit,
  };
}
