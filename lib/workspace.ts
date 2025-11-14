import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Workspace manager for Claude Agent sessions
 * Manages session-specific directories where Claude can save/edit HTML files
 */

export interface WorkspaceSession {
  sessionId: string;
  workspaceDir: string;
  htmlFilePath: string;
  metadataFilePath: string;
}

/**
 * Create a new workspace for a generation session
 */
export async function createWorkspace(): Promise<WorkspaceSession> {
  const sessionId = randomUUID();
  const workspaceDir = join(process.cwd(), 'public', 'workspaces', sessionId);

  // Create workspace directory
  await mkdir(workspaceDir, { recursive: true });

  const htmlFilePath = join(workspaceDir, 'presentation.html');
  const metadataFilePath = join(workspaceDir, 'metadata.json');

  return {
    sessionId,
    workspaceDir,
    htmlFilePath,
    metadataFilePath,
  };
}

/**
 * Get workspace for existing session
 */
export function getWorkspace(sessionId: string): WorkspaceSession {
  const workspaceDir = join(process.cwd(), 'public', 'workspaces', sessionId);

  return {
    sessionId,
    workspaceDir,
    htmlFilePath: join(workspaceDir, 'presentation.html'),
    metadataFilePath: join(workspaceDir, 'metadata.json'),
  };
}

/**
 * Save presentation metadata (title, sections info, etc.)
 */
export async function saveMetadata(workspace: WorkspaceSession, metadata: any): Promise<void> {
  await writeFile(
    workspace.metadataFilePath,
    JSON.stringify({ ...metadata, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
}

/**
 * Read presentation metadata
 */
export async function readMetadata(workspace: WorkspaceSession): Promise<any> {
  try {
    const content = await readFile(workspace.metadataFilePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Read the HTML file from workspace
 */
export async function readHtml(workspace: WorkspaceSession): Promise<string | null> {
  try {
    return await readFile(workspace.htmlFilePath, 'utf-8');
  } catch (error) {
    return null;
  }
}

/**
 * Write HTML file to workspace
 */
export async function writeHtml(workspace: WorkspaceSession, html: string): Promise<void> {
  await writeFile(workspace.htmlFilePath, html, 'utf-8');
}

/**
 * Clean up old workspaces (older than 24 hours)
 */
export async function cleanupOldWorkspaces(): Promise<void> {
  const workspacesDir = join(process.cwd(), 'public', 'workspaces');

  try {
    const { readdir, stat } = await import('fs/promises');
    const entries = await readdir(workspacesDir);

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const entry of entries) {
      const entryPath = join(workspacesDir, entry);
      const stats = await stat(entryPath);

      if (stats.isDirectory() && stats.mtimeMs < oneDayAgo) {
        await rm(entryPath, { recursive: true, force: true });
      }
    }
  } catch (error) {
    // Directory might not exist yet, ignore
  }
}
