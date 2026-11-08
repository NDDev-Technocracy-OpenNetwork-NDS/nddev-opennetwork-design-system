// Repository-owned generated files. The public ledger is portable; transaction bytes and
// the native flock live in this worktree's Git administration directory, never in a cache.
// Individual replacements are atomic. A mixed interrupted set is held/recovered before the
// next producer operation; this is not a multi-file atomic view for unrelated readers.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export const LEDGER = "generated/outputs.json";
const PRODUCER = "nddev-opennetwork-design-system";
export type Scope = "derived" | "packages";
export type Content = string | Uint8Array;
export type OutputFiles = ReadonlyMap<string, Content>;
export type InputHashes = Record<string, string>;
interface Owned {
  sha256: string;
  scope: Scope;
  executable: boolean;
}
interface Ledger {
  schema: 1;
  producer: typeof PRODUCER;
  inputs: Partial<Record<Scope, InputHashes>>;
  outputs: Record<string, Owned>;
}
interface Change {
  name: string;
  before: string | null;
  after: string | null;
  mode: number;
}
interface Journal {
  schema: 1;
  producer: typeof PRODUCER;
  id: string;
  changes: Change[];
}
interface Pending {
  schema: 1;
  producer: typeof PRODUCER;
  transaction: string;
}
const HASH = /^[a-f0-9]{64}$/;
export const sha256 = (data: Content): string =>
  createHash("sha256").update(data).digest("hex");
const bytes = (data: Content): Buffer =>
  typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
const encoded = (value: unknown): string =>
  JSON.stringify(value, null, 2) + "\n";
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Existing in-place toolchain outputs are not producer output and are never traversed/removed.
const TOOL_OUTPUT = new Set([
  ".dart_tool",
  ".gradle",
  ".kotlin",
  ".swiftpm",
  ".build",
  "build",
  "target",
  "pubspec.lock",
  "Cargo.lock",
]);

function portable(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith("/") &&
    !name.includes(String.fromCharCode(92)) &&
    !/^[A-Za-z]:/.test(name) &&
    !name.split("/").some((part) => !part || part === "." || part === "..")
  );
}

export function scopeOf(name: string): Scope {
  if (
    name.includes("\\") ||
    name.startsWith("/") ||
    name.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Unsafe generated path: " + name);
  if (name.split("/").some((p) => TOOL_OUTPUT.has(p) || p === ".git"))
    throw new Error("Protected tool/history path: " + name);
  if (name.startsWith("packages/") || name === "tokens/tokens.json")
    return "packages";
  if (
    name.startsWith("tokens/derived/") ||
    ["tokens/nddev.resolver.json", "tokens/tokens.json"].includes(name)
  )
    return "derived";
  throw new Error("Outside generated ownership: " + name);
}

function regular(path: string): Stats | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error(
        "Non-regular or shared generated path preserved: " + path,
      );
    return stat;
  } catch (error) {
    if (object(error) && error["code"] === "ENOENT") return null;
    throw error;
  }
}

function outputPath(root: string, name: string, create = false): string {
  if (name !== LEDGER) scopeOf(name);
  const path = resolve(root, name);
  if (!path.startsWith(root + sep))
    throw new Error("Generated path escapes root: " + name);
  let parent = root;
  for (const part of relative(root, dirname(path)).split(sep).filter(Boolean)) {
    parent = join(parent, part);
    try {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error(
          "Generated ancestor link/non-directory preserved: " + parent,
        );
    } catch (error) {
      if (!object(error) || error["code"] !== "ENOENT") throw error;
      if (create) mkdirSync(parent);
    }
  }
  return path;
}
function current(root: string, name: string): Buffer | null {
  const path = outputPath(root, name);
  return regular(path) ? readFileSync(path) : null;
}
function currentHash(root: string, name: string): string | null {
  const data = current(root, name);
  return data === null ? null : sha256(data);
}
function syncDir(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function durable(path: string, data: Content, mode = 0o600): void {
  const fd = openSync(path, "wx", mode);
  try {
    writeFileSync(fd, data);
    fchmodSync(fd, mode);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function privateWrite(path: string, data: Content): void {
  regular(path);
  const temp = path + "." + randomUUID();
  durable(temp, data);
  renameSync(temp, path);
  syncDir(dirname(path));
}
function temporaryPath(root: string, name: string, id: string): string {
  return join(
    dirname(outputPath(root, name)),
    ".nddev-generated-" +
      id +
      "-" +
      name.slice(name.lastIndexOf("/") + 1) +
      ".tmp",
  );
}
function canonical(ledger: Ledger): Ledger {
  const inputs: Partial<Record<Scope, InputHashes>> = {};
  for (const scope of ["derived", "packages"] as const) {
    const source = ledger.inputs[scope];
    if (source)
      inputs[scope] = Object.fromEntries(Object.entries(source).sort());
  }
  return {
    schema: 1,
    producer: PRODUCER,
    inputs,
    outputs: Object.fromEntries(Object.entries(ledger.outputs).sort()),
  };
}

function replace(
  root: string,
  entry: Change,
  data: Buffer | null,
  id: string,
): void {
  const path = outputPath(root, entry.name, true);
  if (data === null) {
    if (regular(path)) unlinkSync(path);
  } else {
    const temporary = temporaryPath(root, entry.name, id);
    if (regular(temporary))
      throw new Error(
        "Pending generated temporary file preserved: " + temporary,
      );
    durable(temporary, data, entry.mode);
    renameSync(temporary, path);
  }
  syncDir(dirname(path));
}

function readLedger(data: Buffer): Ledger {
  const value: unknown = JSON.parse(data.toString());
  if (
    !object(value) ||
    value["schema"] !== 1 ||
    value["producer"] !== PRODUCER ||
    !object(value["outputs"]) ||
    !object(value["inputs"])
  )
    throw new Error("Unknown generated ledger preserved");
  for (const [name, entry] of Object.entries(value["outputs"])) {
    const scope = scopeOf(name);
    if (
      !object(entry) ||
      entry["scope"] !== scope ||
      typeof entry["executable"] !== "boolean" ||
      typeof entry["sha256"] !== "string" ||
      !HASH.test(entry["sha256"])
    )
      throw new Error("Invalid generated ownership: " + name);
  }
  for (const [scope, inputs] of Object.entries(value["inputs"])) {
    if (
      !["derived", "packages"].includes(scope) ||
      !object(inputs) ||
      Object.entries(inputs).some(
        ([name, h]) =>
          !portable(name) || typeof h !== "string" || !HASH.test(h),
      )
    )
      throw new Error("Invalid producer input identity");
  }
  return value as unknown as Ledger;
}
function git(root: string, ...args: string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_COMMON_DIR: undefined,
      GIT_INDEX_FILE: undefined,
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
}
function headFiles(root: string): Map<string, { oid: string; mode: string }> {
  const rows = git(
    root,
    "ls-tree",
    "-r",
    "-z",
    "HEAD",
    "--",
    "packages",
    "tokens/derived",
    "tokens/nddev.resolver.json",
    LEDGER,
  )
    .toString()
    .split("\0");
  const out = new Map<string, { oid: string; mode: string }>();
  for (const row of rows.filter(Boolean)) {
    const split = row.indexOf("\t");
    const [mode, type, oid] = row.slice(0, split).split(" ");
    if (type !== "blob" || !oid || !mode)
      throw new Error("Unknown committed output kind");
    out.set(row.slice(split + 1), { oid, mode });
  }
  return out;
}

export interface GenerationSession {
  publish(
    files: OutputFiles,
    inputs: Partial<Record<Scope, InputHashes>>,
    scopes: readonly Scope[],
    allPaths: ReadonlySet<string>,
    afterReplace?: (name: string) => void,
  ): void;
  check(files: OutputFiles, inputs: Partial<Record<Scope, InputHashes>>): void;
}

export interface LegacyLedgerModeRollback {
  transaction: string;
  journalSHA256: string;
  ledgerSHA256: string;
  ledgerMode: number;
}

function legacyRollbackAcknowledgement(
  value: unknown,
): LegacyLedgerModeRollback {
  if (
    !object(value) ||
    typeof value["transaction"] !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value["transaction"]) ||
    typeof value["journalSHA256"] !== "string" ||
    !HASH.test(value["journalSHA256"]) ||
    typeof value["ledgerSHA256"] !== "string" ||
    !HASH.test(value["ledgerSHA256"]) ||
    value["ledgerMode"] !== 0o664
  )
    throw new Error(
      "Legacy ledger rollback acknowledgement differs; evidence preserved",
    );
  return Object.freeze({
    transaction: value["transaction"],
    journalSHA256: value["journalSHA256"],
    ledgerSHA256: value["ledgerSHA256"],
    ledgerMode: value["ledgerMode"],
  });
}

// Explicit, fingerprinted recovery for a legacy ledger mode; normal recovery stays strict.
export async function rollbackLegacyLedgerMode(
  directory: string,
  acknowledgement: LegacyLedgerModeRollback,
): Promise<void> {
  const checked = legacyRollbackAcknowledgement(acknowledgement);
  await withGenerationLock(directory, true, () => {}, checked);
}

export async function withGeneration<T>(
  directory: string,
  writing: boolean,
  operation: (session: GenerationSession) => Promise<T> | T,
): Promise<T> {
  return withGenerationLock(directory, writing, operation);
}

async function withGenerationLock<T>(
  directory: string,
  writing: boolean,
  operation: (session: GenerationSession) => Promise<T> | T,
  legacyRollback?: LegacyLedgerModeRollback,
): Promise<T> {
  const root = realpathSync(directory);
  if (
    realpathSync(
      git(root, "rev-parse", "--show-toplevel").toString().trim(),
    ) !== root
  )
    throw new Error("Generation requires its own repository root");
  const admin = git(root, "rev-parse", "--absolute-git-dir").toString().trim();
  const state = join(admin, "nddev-design-generation");
  const ownerPath = join(state, "owner.json");
  const owner = encoded({ schema: 1, producer: PRODUCER });
  if (!existsSync(state)) {
    mkdirSync(state);
    durable(ownerPath, owner);
    syncDir(state);
  }
  if (
    lstatSync(state).isSymbolicLink() ||
    !lstatSync(state).isDirectory() ||
    !regular(ownerPath) ||
    readFileSync(ownerPath, "utf8") !== owner
  )
    throw new Error("Unknown producer state preserved");
  const lockPath = join(state, "lock");
  if (existsSync(lockPath)) regular(lockPath);
  const fd = openSync(
    lockPath,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  // A child acquires flock on the inherited open-file description. The parent's retained
  // descriptor keeps the kernel lock until finally/exit, including an unexpected process exit.
  const acquired = spawnSync(
    "flock",
    ["--nonblock", writing ? "--exclusive" : "--shared", "3"],
    {
      stdio: ["ignore", "pipe", "pipe", fd],
      encoding: "utf8",
    },
  );
  if (acquired.error || acquired.status !== 0) {
    closeSync(fd);
    throw new Error(
      "Generation lock unavailable; no outputs changed: " +
        (acquired.error?.message ?? (acquired.stderr.trim() || "busy")),
    );
  }
  try {
    const pendingPath = join(state, "pending.json");
    const latestPath = join(state, "latest.json");
    const committed = headFiles(root);
    const empty: Ledger = {
      schema: 1,
      producer: PRODUCER,
      inputs: {},
      outputs: {},
    };
    const latest = (): string | undefined => {
      if (!regular(latestPath)) return undefined;
      const value: unknown = JSON.parse(readFileSync(latestPath, "utf8"));
      if (
        !object(value) ||
        value["schema"] !== 1 ||
        value["producer"] !== PRODUCER ||
        typeof value["ledger"] !== "string" ||
        !HASH.test(value["ledger"])
      )
        throw new Error("Unknown producer receipt preserved");
      return value["ledger"];
    };
    const receipt = (hash: string): void => {
      latest();
      privateWrite(
        latestPath,
        encoded({ schema: 1, producer: PRODUCER, ledger: hash }),
      );
    };
    const clearPending = (raw: string): void => {
      if (readFileSync(pendingPath, "utf8") !== raw)
        throw new Error("Changed publication marker preserved");
      unlinkSync(pendingPath);
      syncDir(state);
    };
    const recover = (): void => {
      if (!regular(pendingPath)) return;
      const raw = readFileSync(pendingPath, "utf8");
      const pending: unknown = JSON.parse(raw);
      if (
        !object(pending) ||
        pending["schema"] !== 1 ||
        pending["producer"] !== PRODUCER ||
        typeof pending["transaction"] !== "string" ||
        !/^[a-f0-9-]{36}$/.test(pending["transaction"])
      )
        throw new Error("Unknown pending publication preserved");
      const directory = join(state, pending["transaction"]);
      if (
        !lstatSync(directory).isDirectory() ||
        lstatSync(directory).isSymbolicLink()
      )
        throw new Error("Unsafe transaction directory preserved");
      const journalPath = join(directory, "journal.json");
      if (!regular(journalPath))
        throw new Error("Missing publication journal; evidence preserved");
      const journalRaw = readFileSync(journalPath, "utf8");
      const journal: unknown = JSON.parse(journalRaw);
      if (
        !object(journal) ||
        journal["producer"] !== PRODUCER ||
        journal["schema"] !== 1 ||
        journal["id"] !== pending["transaction"] ||
        !Array.isArray(journal["changes"])
      )
        throw new Error("Unknown publication journal preserved");
      if (
        legacyRollback &&
        (legacyRollback.transaction !== pending["transaction"] ||
          !HASH.test(legacyRollback.journalSHA256) ||
          sha256(journalRaw) !== legacyRollback.journalSHA256 ||
          !HASH.test(legacyRollback.ledgerSHA256) ||
          legacyRollback.ledgerMode !== 0o664)
      )
        throw new Error(
          "Legacy ledger rollback acknowledgement differs; evidence preserved",
        );
      const entries = journal["changes"] as Change[];
      const seen = new Set<string>();
      let legacyLedgerValidated = false;
      for (const [index, entry] of entries.entries()) {
        if (
          !object(entry) ||
          typeof entry.name !== "string" ||
          seen.has(entry.name) ||
          ![entry.before, entry.after].every(
            (h) => h === null || (typeof h === "string" && HASH.test(h)),
          ) ||
          !Number.isInteger(entry.mode) ||
          entry.mode < 0 ||
          entry.mode > 0o777
        )
          throw new Error("Invalid publication entry preserved");
        outputPath(root, entry.name);
        seen.add(entry.name);
        for (const [kind, hash] of [
          ["before", entry.before],
          ["after", entry.after],
        ] as const) {
          if (hash === null) continue;
          const file = join(directory, String(index) + "-" + kind);
          if (!regular(file) || sha256(readFileSync(file)) !== hash)
            throw new Error(
              "Changed/incomplete publication evidence preserved",
            );
        }
        const actual = currentHash(root, entry.name);
        if (legacyRollback && entry.name === LEDGER) {
          const atHead = committed.has(LEDGER)
            ? sha256(git(root, "show", "HEAD:" + LEDGER))
            : undefined;
          if (
            entry.mode !== 0o644 ||
            entry.before !== legacyRollback.ledgerSHA256 ||
            entry.before === entry.after ||
            actual !== entry.before ||
            ((regular(outputPath(root, LEDGER))?.mode ?? 0) & 0o777) !==
              0o664 ||
            (actual !== atHead && actual !== latest()) ||
            regular(temporaryPath(root, LEDGER, journal["id"]))
          )
            throw new Error(
              "Legacy ledger rollback precondition differs; evidence preserved",
            );
          readLedger(readFileSync(outputPath(root, LEDGER)));
          legacyLedgerValidated = true;
        }
        if (
          actual !== null &&
          (lstatSync(outputPath(root, entry.name)).mode & 0o777) !==
            entry.mode &&
          !(entry.name === LEDGER && legacyLedgerValidated)
        )
          throw new Error(
            "Foreign mode during interrupted generation preserved: " +
              entry.name,
          );
        if (actual !== entry.before && actual !== entry.after)
          throw new Error(
            "Foreign change during interrupted generation preserved: " +
              entry.name,
          );
        const temporary = temporaryPath(root, entry.name, journal["id"]);
        if (
          regular(temporary) &&
          sha256(readFileSync(temporary)) !== entry.after
        )
          throw new Error(
            "Unknown/partial temporary output preserved: " + entry.name,
          );
      }
      const final = entries.at(-1);
      if (
        !seen.has(LEDGER) ||
        !final ||
        final.name !== LEDGER ||
        final.after === null
      )
        throw new Error(
          "Publication has no final ownership record; evidence preserved",
        );
      if (legacyRollback && !legacyLedgerValidated)
        throw new Error(
          "Missing legacy ledger rollback evidence; publication preserved",
        );
      const complete = entries.every(
        (entry) => currentHash(root, entry.name) === entry.after,
      );
      for (const [index, entry] of entries.entries()) {
        const temporary = temporaryPath(root, entry.name, journal["id"]);
        if (regular(temporary)) unlinkSync(temporary);
        if (!complete && currentHash(root, entry.name) !== entry.before) {
          const before =
            entry.before === null
              ? null
              : readFileSync(join(directory, String(index) + "-before"));
          replace(root, entry, before, journal["id"]);
        }
      }
      if (complete) receipt(final.after);
      privateWrite(
        join(directory, "result.json"),
        encoded({
          result: complete ? "finalized" : "rolled-back",
          ...(legacyRollback ? { legacyLedgerMode: legacyRollback } : {}),
        }),
      );
      clearPending(raw);
    };
    const inspectUnknown = (allowed: ReadonlySet<string>): void => {
      for (const prefix of ["packages", "tokens/derived"]) {
        const walk = (name: string): void => {
          const full = outputPath(root, name + "/placeholder");
          const dir = dirname(full);
          if (!existsSync(dir)) return;
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (TOOL_OUTPUT.has(entry.name)) continue;
            const child = name + "/" + entry.name;
            if (entry.isDirectory()) walk(child);
            else {
              regular(outputPath(root, child));
              if (!allowed.has(child))
                throw new Error("Unowned output preserved: " + child);
            }
          }
        };
        walk(prefix);
      }
    };
    const owned = (allPaths: ReadonlySet<string>): Ledger => {
      const data = current(root, LEDGER);
      if (data !== null) {
        if (lstatSync(outputPath(root, LEDGER)).mode & 0o111)
          throw new Error("Executable generated ledger preserved");
        const ledger = readLedger(data);
        const atHead = committed.has(LEDGER)
          ? sha256(git(root, "show", "HEAD:" + LEDGER))
          : undefined;
        if (sha256(data) !== atHead && sha256(data) !== latest())
          throw new Error("Foreign ledger edit preserved");
        return ledger;
      }
      // Initial adoption is tied to committed Git blobs, never to arbitrary existing bytes.
      const ledger: Ledger = structuredClone(empty);
      const algorithm = git(root, "rev-parse", "--show-object-format")
        .toString()
        .trim();
      for (const name of allPaths) {
        scopeOf(name);
        const entry = committed.get(name);
        const currentBytes = current(root, name);
        if (!entry) {
          if (currentBytes !== null)
            throw new Error("Untracked output preserved: " + name);
          continue;
        }
        if (entry.mode !== "100644" && entry.mode !== "100755")
          throw new Error("Committed generated link preserved: " + name);
        if (currentBytes !== null) {
          if (
            Boolean(lstatSync(outputPath(root, name)).mode & 0o111) !==
            (entry.mode === "100755")
          )
            throw new Error(
              "Changed generated executable mode preserved: " + name,
            );
          const oid = createHash(algorithm)
            .update("blob " + String(currentBytes.length) + "\0")
            .update(currentBytes)
            .digest("hex");
          if (oid !== entry.oid)
            throw new Error("Modified generated file preserved: " + name);
        }
        const data = currentBytes ?? git(root, "show", "HEAD:" + name);
        ledger.outputs[name] = {
          sha256: sha256(data),
          scope: scopeOf(name),
          executable: entry.mode === "100755",
        };
      }
      return ledger;
    };
    const intact = (ledger: Ledger): void => {
      for (const [name, entry] of Object.entries(ledger.outputs)) {
        const actual = currentHash(root, name);
        if (actual !== null && actual !== entry.sha256)
          throw new Error("Modified generated file preserved: " + name);
        if (
          actual !== null &&
          Boolean(lstatSync(outputPath(root, name)).mode & 0o111) !==
            entry.executable
        )
          throw new Error(
            "Changed generated executable mode preserved: " + name,
          );
      }
    };
    latest();
    if (legacyRollback && !regular(pendingPath))
      throw new Error("No pending legacy publication; no outputs changed");
    if (regular(pendingPath)) {
      if (!writing)
        throw new Error(
          "Pending generated publication; use the owning generate operation",
        );
      recover();
    }
    const session: GenerationSession = {
      publish(files, inputs, scopes, allPaths, afterReplace) {
        if (!writing) throw new Error("Read-only producer cannot publish");
        for (const name of allPaths) scopeOf(name);
        for (const name of files.keys()) scopeOf(name);
        const selected = new Set(scopes);
        const ledger = owned(allPaths);
        intact(ledger);
        inspectUnknown(new Set([...allPaths, ...Object.keys(ledger.outputs)]));
        const next: Ledger = structuredClone(ledger);
        next.outputs = Object.fromEntries(
          Object.entries(next.outputs).filter(
            ([, entry]) => !selected.has(entry.scope),
          ),
        );
        for (const [name, data] of files) {
          const scope = scopeOf(name);
          if (!selected.has(scope))
            throw new Error(
              "Output is outside selected producer phase: " + name,
            );
          next.outputs[name] = {
            sha256: sha256(data),
            scope,
            executable: ledger.outputs[name]?.executable ?? false,
          };
        }
        for (const scope of scopes) {
          const source = inputs[scope];
          if (
            !source ||
            Object.entries(source).some(
              ([name, h]) => !portable(name) || !HASH.test(h),
            )
          )
            throw new Error("Missing producer input identity: " + scope);
          next.inputs[scope] = Object.fromEntries(
            Object.entries(source).sort(),
          );
        }
        next.outputs = Object.fromEntries(Object.entries(next.outputs).sort());
        const changes: Change[] = [];
        const data = new Map<string, Buffer | null>();
        for (const name of new Set([
          ...Object.keys(ledger.outputs),
          ...Object.keys(next.outputs),
        ])) {
          if (!selected.has(scopeOf(name))) continue;
          const file = files.get(name);
          const wanted = file === undefined ? null : bytes(file);
          const before = current(root, name);
          // Matching bytes do not grant ownership over an existing untracked path.
          if (!ledger.outputs[name] && before !== null)
            throw new Error("Unowned generated collision preserved: " + name);
          if (
            (before === null && wanted === null) ||
            (before !== null && wanted !== null && before.equals(wanted))
          )
            continue;
          changes.push({
            name,
            before: before === null ? null : sha256(before),
            after: wanted === null ? null : sha256(wanted),
            mode:
              regular(outputPath(root, name))?.mode !== undefined
                ? lstatSync(outputPath(root, name)).mode & 0o777
                : ledger.outputs[name]?.executable
                  ? 0o755
                  : 0o644,
          });
          data.set(name, wanted);
        }
        changes.sort((a, b) => a.name.localeCompare(b.name));
        const ledgerBytes = Buffer.from(encoded(canonical(next)));
        const previous = current(root, LEDGER);
        // Even with only an ownership update, the ledger is always the final journal entry.
        changes.push({
          name: LEDGER,
          before: previous === null ? null : sha256(previous),
          after: sha256(ledgerBytes),
          mode: (regular(outputPath(root, LEDGER))?.mode ?? 0o644) & 0o777,
        });
        data.set(LEDGER, ledgerBytes);
        if (changes.length === 1 && previous?.equals(ledgerBytes)) return;
        const id = randomUUID();
        const transaction = join(state, id);
        mkdirSync(transaction);
        for (const [index, entry] of changes.entries()) {
          const before = current(root, entry.name);
          if (before !== null)
            durable(join(transaction, String(index) + "-before"), before);
          const after = data.get(entry.name);
          if (after !== null && after !== undefined)
            durable(join(transaction, String(index) + "-after"), after);
        }
        const journal: Journal = { schema: 1, producer: PRODUCER, id, changes };
        durable(join(transaction, "journal.json"), encoded(journal));
        syncDir(transaction);
        const pending: Pending = {
          schema: 1,
          producer: PRODUCER,
          transaction: id,
        };
        const marker = encoded(pending);
        privateWrite(pendingPath, marker);
        for (const entry of changes) {
          if (
            currentHash(root, entry.name) !== entry.before ||
            (entry.before !== null &&
              (lstatSync(outputPath(root, entry.name)).mode & 0o777) !==
                entry.mode)
          )
            throw new Error(
              "Output changed before replacement; publication held: " +
                entry.name,
            );
          replace(root, entry, data.get(entry.name) ?? null, id);
          afterReplace?.(entry.name);
        }
        receipt(sha256(ledgerBytes));
        privateWrite(
          join(transaction, "result.json"),
          encoded({ result: "committed" }),
        );
        clearPending(marker);
      },
      check(files, inputs) {
        const data = current(root, LEDGER);
        if (data === null)
          throw new Error(
            "Missing generated ownership ledger; run just generate",
          );
        const ledger = owned(new Set(files.keys()));
        intact(ledger);
        inspectUnknown(new Set(files.keys()));
        const expected: Ledger = {
          schema: 1,
          producer: PRODUCER,
          inputs: structuredClone(inputs),
          outputs: {},
        };
        for (const [name, data] of files) {
          const digest = sha256(data);
          expected.outputs[name] = {
            sha256: digest,
            scope: scopeOf(name),
            executable: ledger.outputs[name]?.executable ?? false,
          };
          if (currentHash(root, name) !== digest)
            throw new Error("Generated output differs: " + name);
        }
        expected.outputs = Object.fromEntries(
          Object.entries(expected.outputs).sort(),
        );
        for (const scope of ["derived", "packages"] as const) {
          const source = expected.inputs[scope];
          if (source)
            expected.inputs[scope] = Object.fromEntries(
              Object.entries(source).sort(),
            );
        }
        if (data.toString() !== encoded(canonical(expected)))
          throw new Error(
            "Generated ownership/input ledger differs; run just generate",
          );
      },
    };
    return await operation(session);
  } finally {
    closeSync(fd);
  }
}
