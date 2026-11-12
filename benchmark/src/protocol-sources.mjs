import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const excludedDirectories = new Set(['node_modules', 'public', 'results']);
const isProtocolInput = name => /\.(mjs|ts|json|yaml|sh)$/.test(name) || name.endsWith('Dockerfile');

async function protocolPaths(root, prefix = '') {
  const paths = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) paths.push(...await protocolPaths(root, path));
    } else if (entry.isFile() && isProtocolInput(entry.name)) paths.push(path);
  }
  return paths;
}

export async function protocolSources(root) {
  const paths = (await protocolPaths(root)).sort();
  return Promise.all(paths.map(async path => [path, await readFile(join(root, path), 'utf8')]));
}
