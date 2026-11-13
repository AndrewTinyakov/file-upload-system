import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runBenchmark, scenarios, stopBenchmark } from './runner.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = {
  run: 'run [--scenario <scenario>] [--name <name>] [--reuse-build]\n\nDefaults to the smoke check. Run names are generated automatically. --reuse-build uses existing local images for matched repeats.',
  list: 'list\n\nList scenarios and their measured durations.',
  compare: 'compare --baseline <run1,run2,run3> --candidate <run4,run5,run6> [--output <file>]\n\nAccepts run names or paths. Requires three matching repeats per side.',
  stop: 'stop\n\nRemove the benchmark containers and volumes. Saved results are preserved.',
};
const options = {
  run: { scenario: { type: 'string', default: 'smoke' }, name: { type: 'string' }, 'reuse-build': { type: 'boolean', default: false } },
  list: {},
  compare: { baseline: { type: 'string' }, candidate: { type: 'string' }, output: { type: 'string' } },
  stop: {},
};

async function main(args = process.argv.slice(2)) {
  const [action, ...rest] = args;
  if (!action || ['help', '--help', '-h'].includes(action)) {
    process.stdout.write(`Usage: npm run bench -- <command> [options]\n\n${Object.values(usage).map(text => `  ${text.split('\n')[0]}`).join('\n')}\n\nUse <command> --help for details.\n`);
    return;
  }
  if (!Object.hasOwn(options, action)) throw new Error(`Unknown command: ${action}. Use --help for usage.`);
  const { values } = parseArgs({ args: rest, options: { ...options[action], help: { type: 'boolean', short: 'h' } }, allowPositionals: false });
  if (values.help) { process.stdout.write(`Usage: npm run bench -- ${usage[action]}\n`); return; }
  if (action === 'list') {
    for (const [name, scenario] of Object.entries(await scenarios(root))) {
      process.stdout.write(`${name.padEnd(18)} ${scenario.segments.reduce((sum, segment) => sum + segment.seconds, 0)}s measured\n`);
    }
    return;
  }
  if (action === 'stop') { await stopBenchmark(root); return; }
  if (action === 'compare') {
    if (!values.baseline || !values.candidate) throw new Error('compare requires --baseline and --candidate.');
    const paths = value => value.split(',').map(path => {
      if (!path.trim()) throw new Error('Run lists must not contain empty entries.');
      return path.includes('/') || path.includes('\\') ? resolve(root, path.trim()) : resolve(root, '.local/upload-benchmark', path.trim());
    }).join(',');
    const evaluatorArgs = ['--baseline', paths(values.baseline), '--candidate', paths(values.candidate)];
    if (values.output) evaluatorArgs.push('--output', resolve(root, values.output));
    const { main: evaluate } = await import('./evaluate.mjs');
    const result = await evaluate(evaluatorArgs);
    process.exitCode = result.verdict === 'accept' ? 0 : result.verdict === 'insufficient_evidence' ? 2 : 1;
    return result;
  }
  const controller = new AbortController();
  let exitCode;
  const interrupt = () => { exitCode = 130; controller.abort(); };
  const terminate = () => { exitCode = 143; controller.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try { return await runBenchmark(root, { scenario: values.scenario, name: values.name, reuseBuild: values['reuse-build'], signal: controller.signal }); }
  catch (error) { if (exitCode) error.exitCode = exitCode; throw error; }
  finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    if (exitCode) process.exitCode = exitCode;
  }
}

try { await main(); }
catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode ?? 1; }
