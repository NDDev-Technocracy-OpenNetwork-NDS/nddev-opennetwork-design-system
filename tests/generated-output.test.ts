import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEDGER,
  rollbackLegacyLedgerMode,
  sha256,
  withGeneration,
  type LegacyLedgerModeRollback,
  type OutputFiles,
  type Scope,
} from "../src/generated-output.ts";

const inputs = {
  derived: { "tokens/intent/example.json": sha256("authored input") },
  packages: { "src/emit/example.ts": sha256("emitter input") },
};
const old = new Map<string, string | Uint8Array>([
  ["packages/web/tokens.css", "old package\n"],
  ["tokens/derived/theme.tokens.json", '{"old":true}\n'],
  ["tokens/nddev.resolver.json", '{"version":"2025.10"}\n'],
]);
const next = new Map(
  [...old].map(([name, data]) => [
    name,
    typeof data === "string" ? data.replace("old", "new") : data,
  ]),
);
const scopes: Scope[] = ["derived", "packages"];
function fixture(): string {
  // The caller selects a frozen acceptance root; CI already supplies its native job-owned
  // RUNNER_TEMP. No implicit OS-root scratch/cache tree is introduced by this suite.
  const evidence =
    process.env["NDDEV_DS_ACCEPTANCE_ROOT"] ?? process.env["RUNNER_TEMP"];
  if (!evidence)
    throw new Error(
      "Set NDDEV_DS_ACCEPTANCE_ROOT to the approved acceptance-evidence directory",
    );
  mkdirSync(evidence, { recursive: true });
  const root = mkdtempSync(join(evidence, "generated-files-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        ![
          "GIT_DIR",
          "GIT_WORK_TREE",
          "GIT_COMMON_DIR",
          "GIT_INDEX_FILE",
        ].includes(key),
    ),
  );
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Acceptance Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-C",
        root,
        ...args,
      ],
      { env, stdio: "pipe" },
    );
  git("init", "-q", "--initial-branch=main");
  for (const [name, data] of old) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), data);
  }
  writeFileSync(
    join(root, "README.md"),
    "Authored source must remain intact\n",
  );
  git("add", ".");
  git("commit", "-qm", "Fixture source");
  return root;
}
const publish = (root: string, files: OutputFiles = old) =>
  withGeneration(root, true, (session) => {
    session.publish(files, inputs, scopes, new Set(files.keys()));
  });
function snapshot(root: string) {
  return Object.fromEntries(
    [...old.keys(), LEDGER].map((name) => {
      const file = join(root, name);
      return [
        name,
        existsSync(file)
          ? {
              bytes: readFileSync(file).toString("base64"),
              mode: lstatSync(file).mode,
              modified: lstatSync(file).mtimeMs,
            }
          : null,
      ];
    }),
  );
}
function interrupt(root: string, atLedger = false): void {
  const module = pathToFileURL(resolve("src/generated-output.ts")).href;
  const code =
    "import {withGeneration,LEDGER} from " +
    JSON.stringify(module) +
    ";" +
    "const files=new Map(" +
    JSON.stringify([...next]) +
    ");" +
    "await withGeneration(" +
    JSON.stringify(root) +
    ",true,s=>s.publish(files," +
    JSON.stringify(inputs) +
    ',["derived","packages"],new Set(files.keys()),name=>{' +
    (atLedger ? "if(name===LEDGER)" : "if(name!==LEDGER)") +
    "process.exit(74)}));";
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      encoding: "utf8",
    },
  );
  expect(child.status, child.stderr).toBe(74);
}

async function legacyLedgerInterruption() {
  const root = fixture();
  await publish(root);
  chmodSync(join(root, LEDGER), 0o664);
  const ledger = snapshot(root)[LEDGER];
  interrupt(root);
  const state = join(root, ".git/nddev-design-generation");
  const pending = JSON.parse(
    readFileSync(join(state, "pending.json"), "utf8"),
  ) as {
    transaction: string;
  };
  const journalPath = join(state, pending.transaction, "journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    changes: { name: string; mode: number }[];
  };
  // Isolated fixture only: reproduce the journal written by the original publisher.
  const final = journal.changes.at(-1)!;
  expect(final.name).toBe(LEDGER);
  expect(final.mode).toBe(0o664);
  final.mode = 0o644;
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n");
  const raw = readFileSync(journalPath, "utf8");
  const acknowledgement: LegacyLedgerModeRollback = {
    transaction: pending.transaction,
    journalSHA256: sha256(raw),
    ledgerSHA256: sha256(readFileSync(join(root, LEDGER))),
    ledgerMode: 0o664,
  };
  return { root, state, journalPath, raw, ledger, acknowledgement };
}

describe("generated-file ownership and recoverable publication", () => {
  it("preserves a group-writable committed ledger during a later publication", async () => {
    const root = fixture();
    await publish(root);
    chmodSync(join(root, LEDGER), 0o664);
    await publish(root, next);
    expect(lstatSync(join(root, LEDGER)).mode & 0o777).toBe(0o664);
    await withGeneration(root, false, (session) => {
      session.check(next, inputs);
    });
  });
  it("requires exact acknowledgement to roll back the legacy ledger mode defect", async () => {
    const { root, state, journalPath, raw, ledger, acknowledgement } =
      await legacyLedgerInterruption();
    const mixed = snapshot(root);
    await expect(publish(root, next)).rejects.toThrow("Foreign mode");
    expect(snapshot(root)).toEqual(mixed);
    await rollbackLegacyLedgerMode(root, acknowledgement);
    expect(snapshot(root)[LEDGER]).toEqual(ledger);
    for (const [name, data] of old)
      expect(readFileSync(join(root, name))).toEqual(Buffer.from(data));
    expect(readFileSync(journalPath, "utf8")).toBe(raw);
    expect(existsSync(join(state, "pending.json"))).toBe(false);
    expect(
      JSON.parse(
        readFileSync(
          join(state, acknowledgement.transaction, "result.json"),
          "utf8",
        ),
      ),
    ).toEqual({ result: "rolled-back", legacyLedgerMode: acknowledgement });
    await publish(root, next);
    expect(lstatSync(join(root, LEDGER)).mode & 0o777).toBe(0o664);
    await withGeneration(root, false, (session) => {
      session.check(next, inputs);
    });
  });
  it.each([undefined, null])(
    "refuses an absent migration acknowledgement before ordinary recovery: %s",
    async (missing) => {
      const root = fixture();
      await publish(root);
      interrupt(root);
      const before = snapshot(root);
      const marker = join(root, ".git/nddev-design-generation/pending.json");
      const pending = readFileSync(marker, "utf8");
      await expect(
        rollbackLegacyLedgerMode(
          root,
          missing as unknown as LegacyLedgerModeRollback,
        ),
      ).rejects.toThrow("Legacy ledger rollback acknowledgement differs");
      expect(snapshot(root)).toEqual(before);
      expect(readFileSync(marker, "utf8")).toBe(pending);
    },
  );
  it.each([
    "transaction",
    "journalSHA256",
    "ledgerSHA256",
    "ledgerMode",
  ] as const)(
    "preserves the complete pending set with a mismatching legacy acknowledgement: %s",
    async (field) => {
      const { root, state, journalPath, raw, acknowledgement } =
        await legacyLedgerInterruption();
      const before = snapshot(root);
      const wrong = {
        ...acknowledgement,
        [field]: field === "ledgerMode" ? 0o644 : "0".repeat(64),
      };
      await expect(rollbackLegacyLedgerMode(root, wrong)).rejects.toThrow(
        /acknowledgement|precondition/,
      );
      expect(snapshot(root)).toEqual(before);
      expect(readFileSync(journalPath, "utf8")).toBe(raw);
      expect(existsSync(join(state, "pending.json"))).toBe(true);
    },
  );
  it.each(["ledger bytes", "ledger mode", "output mode", "ledger temporary"])(
    "preserves foreign work even with a fingerprinted legacy acknowledgement: %s",
    async (change) => {
      const { root, state, journalPath, raw, acknowledgement } =
        await legacyLedgerInterruption();
      const ledger = join(root, LEDGER);
      if (change === "ledger bytes") writeFileSync(ledger, "foreign ledger");
      if (change === "ledger mode") chmodSync(ledger, 0o600);
      if (change === "output mode")
        chmodSync(join(root, "packages/web/tokens.css"), 0o600);
      const temporary = join(
        root,
        "generated",
        ".nddev-generated-" + acknowledgement.transaction + "-outputs.json.tmp",
      );
      if (change === "ledger temporary")
        writeFileSync(temporary, "preserve temporary");
      const before = snapshot(root);
      await expect(
        rollbackLegacyLedgerMode(root, acknowledgement),
      ).rejects.toThrow(/preserved/);
      expect(snapshot(root)).toEqual(before);
      expect(readFileSync(journalPath, "utf8")).toBe(raw);
      expect(existsSync(join(state, "pending.json"))).toBe(true);
      if (change === "ledger temporary")
        expect(readFileSync(temporary, "utf8")).toBe("preserve temporary");
    },
  );
  it("adopts only the committed baseline and keeps read-only/idempotent checks byte-stable", async () => {
    const root = fixture();
    await publish(root);
    const before = snapshot(root);
    await withGeneration(root, false, (session) => {
      session.check(old, inputs);
    });
    await publish(root);
    expect(snapshot(root)).toEqual(before);
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe(
      "Authored source must remain intact\n",
    );
  });
  it("refuses an edited committed output on initial adoption", async () => {
    const root = fixture();
    writeFileSync(
      join(root, "packages/web/tokens.css"),
      "important foreign work",
    );
    const before = snapshot(root);
    await expect(publish(root, next)).rejects.toThrow(
      "Modified generated file preserved",
    );
    expect(snapshot(root)).toEqual(before);
  });
  it("preserves a foreign generated edit and does not repair it during check", async () => {
    const root = fixture();
    await publish(root);
    writeFileSync(join(root, "packages/web/tokens.css"), "important work");
    const before = snapshot(root);
    await expect(publish(root, next)).rejects.toThrow(
      "Modified generated file preserved",
    );
    await expect(
      withGeneration(root, false, (session) => {
        session.check(old, inputs);
      }),
    ).rejects.toThrow("Modified generated file preserved");
    expect(snapshot(root)).toEqual(before);
  });
  it("does not accept a hand-edited ledger as a new owner", async () => {
    const root = fixture();
    await publish(root);
    const path = join(root, LEDGER);
    const ledger = JSON.parse(readFileSync(path, "utf8")) as {
      inputs: { derived: Record<string, string> };
    };
    ledger.inputs.derived["foreign"] = sha256("foreign identity");
    writeFileSync(path, JSON.stringify(ledger));
    const before = snapshot(root);
    await expect(publish(root, next)).rejects.toThrow(
      "Foreign ledger edit preserved",
    );
    expect(snapshot(root)).toEqual(before);
  });
  it("retains unknown/untracked package material instead of adopting or removing it", async () => {
    const root = fixture();
    await publish(root);
    writeFileSync(join(root, "packages/web/foreign.txt"), "retain me");
    await expect(publish(root, next)).rejects.toThrow(
      "Unowned output preserved",
    );
    expect(readFileSync(join(root, "packages/web/foreign.txt"), "utf8")).toBe(
      "retain me",
    );
    expect(readFileSync(join(root, "packages/web/tokens.css"), "utf8")).toBe(
      "old package\n",
    );
  });
  it("holds the actual kernel lock while another generator attempts to enter", async () => {
    const root = fixture();
    await publish(root);
    await withGeneration(root, true, () => {
      const module = pathToFileURL(resolve("src/generated-output.ts")).href;
      const code =
        "import {withGeneration} from " +
        JSON.stringify(module) +
        ";" +
        "try{await withGeneration(" +
        JSON.stringify(root) +
        ",true,()=>{});process.exit(0)}" +
        "catch(error){console.error(error.message);process.exit(71)}";
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        {
          encoding: "utf8",
        },
      );
      expect(child.status, child.stderr).toBe(71);
      expect(child.stderr).toContain("Generation lock unavailable");
    });
    await publish(root, next);
  });
  it("recovers a real child-process interruption before publishing the new complete set", async () => {
    const root = fixture();
    await publish(root);
    interrupt(root);
    const mixed = snapshot(root);
    await expect(
      withGeneration(root, false, (session) => {
        session.check(old, inputs);
      }),
    ).rejects.toThrow("Pending generated publication");
    expect(snapshot(root)).toEqual(mixed);
    await withGeneration(root, true, (session) => {
      for (const [name, data] of old)
        expect(readFileSync(join(root, name))).toEqual(Buffer.from(data));
      session.publish(next, inputs, scopes, new Set(next.keys()));
    });
    await withGeneration(root, false, (session) => {
      session.check(next, inputs);
    });
  });
  it("preserves all files if a foreign edit appears during an interrupted publication", async () => {
    const root = fixture();
    await publish(root);
    interrupt(root);
    writeFileSync(
      join(root, "tokens/derived/theme.tokens.json"),
      "foreign recovery work",
    );
    const before = snapshot(root);
    await expect(publish(root, next)).rejects.toThrow(
      "Foreign change during interrupted generation preserved",
    );
    expect(snapshot(root)).toEqual(before);
  });
  it("finalizes an already complete interrupted set without rewriting its bytes", async () => {
    const root = fixture();
    await publish(root);
    interrupt(root, true);
    const before = snapshot(root);
    await withGeneration(root, true, (session) => {
      session.check(next, inputs);
    });
    expect(snapshot(root)).toEqual(before);
  });
  it("rejects symlinks and path escape before publishing any output", async () => {
    const root = fixture();
    await publish(root);
    const outside = join(
      root,
      "..",
      "retained-" + root.slice(root.lastIndexOf("/") + 1),
    );
    writeFileSync(outside, "outside data");
    symlinkSync(outside, join(root, "packages/web/link.css"));
    const linked = new Map([
      ...old,
      ["packages/web/link.css", "do not follow"],
    ]);
    await expect(publish(root, linked)).rejects.toThrow(/Non-regular|link/);
    expect(readFileSync(outside, "utf8")).toBe("outside data");
    const escape = new Map([["../escape", "bad"]]);
    await expect(publish(root, escape)).rejects.toThrow(/Unsafe|ownership/);
    expect(existsSync(join(root, "..", "escape"))).toBe(false);
  });
  it("retires only known unchanged producer outputs and preserves tool-owned material", async () => {
    const root = fixture();
    await publish(root);
    mkdirSync(join(root, "packages/web/build"), { recursive: true });
    writeFileSync(join(root, "packages/web/build/runtime-pin"), "pinned build");
    const reduced = new Map(old);
    reduced.delete("packages/web/tokens.css");
    await publish(root, reduced);
    expect(existsSync(join(root, "packages/web/tokens.css"))).toBe(false);
    expect(
      readFileSync(join(root, "packages/web/build/runtime-pin"), "utf8"),
    ).toBe("pinned build");
    await withGeneration(root, false, (session) => {
      session.check(reduced, inputs);
    });
  });
  it("preserves executable meaning and restores a missing owned executable", async () => {
    const root = fixture();
    const file = join(root, "packages/web/tokens.css");
    chmodSync(file, 0o755);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Acceptance Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qam",
      "Executable fixture",
    ]);
    await publish(root);
    unlinkSync(file);
    await publish(root, next);
    expect(lstatSync(file).mode & 0o111).not.toBe(0);
    await withGeneration(root, false, (session) => {
      session.check(next, inputs);
    });
  });
  it("does not roll back foreign permissions during interruption recovery", async () => {
    const root = fixture();
    await publish(root);
    interrupt(root);
    chmodSync(join(root, "packages/web/tokens.css"), 0o600);
    const before = snapshot(root);
    await expect(publish(root, next)).rejects.toThrow(
      "Foreign mode during interrupted generation preserved",
    );
    expect(snapshot(root)).toEqual(before);
  });
  it("retires an owned empty file without mistaking it for an absent output", async () => {
    const root = fixture();
    await publish(root);
    const added = new Map([...old, ["packages/web/empty.css", ""]]);
    await publish(root, added);
    expect(existsSync(join(root, "packages/web/empty.css"))).toBe(true);
    await publish(root, old);
    expect(existsSync(join(root, "packages/web/empty.css"))).toBe(false);
  });
  it("refuses an untracked collision even when it has an emitter-selected name", async () => {
    const root = fixture();
    writeFileSync(join(root, "packages/web/future.css"), "untracked work");
    const files = new Map([
      ...old,
      ["packages/web/future.css", "generated future"],
    ]);
    await expect(publish(root, files)).rejects.toThrow(
      "Untracked output preserved",
    );
    expect(readFileSync(join(root, "packages/web/future.css"), "utf8")).toBe(
      "untracked work",
    );
  });
  it.each(["emitted bytes", "foreign work"])(
    "refuses an unowned new emitter path after ledger adoption: %s",
    async (existing) => {
      const root = fixture();
      await publish(root);
      const name = "packages/web/future.css";
      writeFileSync(join(root, name), existing);
      const before = snapshot(root);
      const files = new Map(old).set(name, "emitted bytes");
      await expect(publish(root, files)).rejects.toThrow(
        "Unowned generated collision preserved",
      );
      expect(readFileSync(join(root, name), "utf8")).toBe(existing);
      expect(snapshot(root)).toEqual(before);
    },
  );
  it("holds corrupt private receipts before changing any generated file", async () => {
    const root = fixture();
    await publish(root);
    writeFileSync(
      join(root, ".git/nddev-design-generation/latest.json"),
      '{"foreign":"retain"}',
    );
    const before = snapshot(root);
    await expect(publish(root, next)).rejects.toThrow(
      "Unknown producer receipt preserved",
    );
    expect(snapshot(root)).toEqual(before);
  });
  it("refuses device paths in a portable producer input record", async () => {
    const root = fixture();
    await publish(root);
    const before = snapshot(root);
    for (const name of [
      "/device/private/source",
      "src" + String.fromCharCode(92) + "private",
    ]) {
      const foreign = {
        derived: { [name]: sha256("source") },
        packages: inputs.packages,
      };
      await expect(
        withGeneration(root, true, (session) => {
          session.publish(next, foreign, scopes, new Set(next.keys()));
        }),
      ).rejects.toThrow("Missing producer input identity");
      expect(snapshot(root)).toEqual(before);
    }
  });
  it("keeps binary content intact through publication and replacement", async () => {
    const root = fixture();
    await publish(root);
    const name = "packages/fonts/fixture.ttf";
    const first = new Map([...old, [name, new Uint8Array([0, 1, 128, 255])]]);
    await publish(root, first);
    expect(readFileSync(join(root, name))).toEqual(
      Buffer.from([0, 1, 128, 255]),
    );
    const second = new Map([...old, [name, new Uint8Array([255, 128, 1, 0])]]);
    await publish(root, second);
    expect(readFileSync(join(root, name))).toEqual(
      Buffer.from([255, 128, 1, 0]),
    );
    await withGeneration(root, false, (session) => {
      session.check(second, inputs);
    });
  });
  it("keeps the other phase and its provenance during an explicit partial write", async () => {
    const root = fixture();
    await publish(root);
    const derived = new Map(
      [...next].filter(([name]) => name.startsWith("tokens/")),
    );
    const selected = {
      derived: { "tokens/intent/example.json": sha256("new authored") },
    };
    await withGeneration(root, true, (session) => {
      session.publish(derived, selected, ["derived"], new Set(next.keys()));
    });
    expect(readFileSync(join(root, "packages/web/tokens.css"), "utf8")).toBe(
      "old package\n",
    );
    const ledger: unknown = JSON.parse(
      readFileSync(join(root, LEDGER), "utf8"),
    );
    expect(ledger).toMatchObject({
      inputs: { derived: selected.derived, packages: inputs.packages },
    });
    const complete = new Map([...old, ...derived]);
    await withGeneration(root, false, (session) => {
      session.check(complete, { ...inputs, derived: selected.derived });
    });
  });
});
