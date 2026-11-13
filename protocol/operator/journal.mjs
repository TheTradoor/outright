import { constants } from "node:fs";
import { mkdir, open, rename, unlink, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export async function openKeeperJournal(directory) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error("Keeper state directory must be private (mode 0700)");
  const lockPath = join(root, "keeper.lock"),
    statePath = join(root, "state.json");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error(
        "Keeper state is locked. Stop the other worker; after a crash, inspect its PID and receipt before removing keeper.lock.",
      );
    throw e;
  }
  let busy = false,
    poisoned = false,
    closed = false;
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await lock.sync();
  } catch (e) {
    await lock.close();
    await unlink(lockPath);
    throw e;
  }
  const ensure = () => {
    if (closed || poisoned)
      throw new Error("Keeper journal is closed or needs operator inspection");
  };
  return {
    async exclusive(work) {
      ensure();
      if (busy) throw new Error("Keeper cycle already in progress");
      busy = true;
      try {
        return await work();
      } finally {
        busy = false;
      }
    },
    async read() {
      ensure();
      let file;
      try {
        file = await open(statePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 1_048_576 || stat.mode & 0o077)
          throw new Error("Invalid keeper state file");
        return JSON.parse(await file.readFile("utf8"));
      } finally {
        await file.close();
      }
    },
    async write(state) {
      ensure();
      const temp = join(root, `state-${randomUUID()}.tmp`);
      let file;
      try {
        file = await open(temp, "wx", 0o600);
        await file.writeFile(JSON.stringify(state, null, 2) + "\n");
        await file.sync();
        await file.close();
        file = null;
        await rename(temp, statePath);
        const dir = await open(root, "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      } catch (e) {
        poisoned = true;
        if (file) await file.close().catch(() => {});
        await unlink(temp).catch(() => {});
        throw e;
      }
    },
    async close() {
      if (closed) return;
      if (busy) throw new Error("Cannot close keeper journal during a cycle");
      closed = true;
      await lock.close();
      // A failed durable write keeps the lock for deliberate operator recovery.
      if (!poisoned) await unlink(lockPath);
    },
  };
}
