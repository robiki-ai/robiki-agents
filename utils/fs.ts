import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJsonFile<T>(path: string): Promise<T> {
  return readFile(path, 'utf-8')
    .then((content) => JSON.parse(content) as T)
    .catch((error) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return {} as T;
      }
      throw error;
    });
}

export async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  return mkdir(dirname(path), { recursive: true })
    .then(() => writeFile(path, JSON.stringify(data, null, 2), 'utf-8'))
    .then(() => void 0);
}

export async function readMarkdownFile(path: string): Promise<string> {
  return readFile(path, 'utf-8')
    .then((content) => content.replaceAll(/\r?\n/g, '\n'))
    .catch((error) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return '';
      }
      throw error;
    });
}

export async function writeMarkdownFile(path: string, data: string): Promise<void> {
  return mkdir(dirname(path), { recursive: true })
    .then(() => writeFile(path, data.replaceAll(/\r?\n/g, '\n'), 'utf-8'))
    .then(() => void 0);
}
