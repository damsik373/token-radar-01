// Token Radar entry point (Node 22, standard library only).
//
// It loads the sealed snapshot (a file, or a directory holding snapshot.json), scores every
// rankable pre-token protocol with the peer-multiple model in lib/model.ts, and writes the
// ranked board, the dashboard data, the dashboard files and the screenshots into the output
// directory, finishing with dossier.json, the summary the judge reads, built by the vendored
// make.fun library.
//
// The dashboard is a static page with no framework and no network calls: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read the data.js this program writes from the same
// board the gate checks. Change the model, the page or the plan; keep the gate's shape.
//
// When the grader's container is not around, MAKEFUN_OUTPUT_DIR takes /output's place:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  fileURLToPath,
} from 'node:url';
import {
  boardIssue,
  buildRadar,
  dataScript,
  parseSnapshot,
} from './lib/model.ts';
import {
  buildDossier,
} from './vendor/makefun-board.ts';

const rootDir = fileURLToPath(new URL('./', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_CAP = 65536;
const SHOT_LIMITS = { max: 4, max_bytes: 524288 };
const IMAGE_NAME = new RegExp('^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$');

/** Print a message to stderr and leave with the given code. */
function fail(code: number, message: string): never {
  const stream = process.stderr;
  stream.write(message);
  process.exit(code);
}

/**
 * The value of a `--name value` flag, else of a `--name=value` flag, else `fallback`.
 * The bare form wins when both are present.
 */
function flagValue(argv: string[], name: string, fallback: string): string {
  const bare = `--${name}`;
  for (let i = 0; i + 1 < argv.length; i++) {
    if (argv[i] === bare) return argv[i + 1]!;
  }
  const glued = `${bare}=`;
  for (const token of argv) {
    if (token.startsWith(glued)) return token.slice(glued.length);
  }
  return fallback;
}

/** Copy a directory's plain files into `to`, skipping dotfiles, and report the names copied. */
function copyPlainFiles(fromDir: string, toDir: string): string[] {
  if (!fs.existsSync(fromDir)) return [];
  fs.mkdirSync(toDir, { recursive: true });
  const names: string[] = [];
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile()) continue;
    fs.copyFileSync(path.join(fromDir, entry.name), path.join(toDir, entry.name));
    names.push(entry.name);
  }
  return names;
}

const argv: string[] = process.argv.slice(2);
const rawInput = flagValue(argv, 'input', '/input');
const inputIsFile = rawInput.endsWith('.json');
const snapshotPath = inputIsFile ? rawInput : path.join(rawInput, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  fail(2, `token radar: no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
}
const outDir = flagValue(argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(fs.readFileSync(snapshotPath, 'utf8'));
const scored = buildRadar(snapshot);
const board = scored.board;
const radar = scored.radar;
const boardProblem = boardIssue(board, snapshot);
if (boardProblem !== null) fail(1, `token radar: the model wrote a board the gate refuses: ${boardProblem}\n`);

const boardPath = path.join(outDir, 'board.json');
const dataPath = path.join(outDir, 'data.js');
const dashboardPath = path.join(outDir, 'dashboard');
const shotsPath = path.join(outDir, 'screenshots');
const dossierPath = path.join(outDir, 'dossier.json');

fs.mkdirSync(outDir, { recursive: true });
const boardText = JSON.stringify({ rows: board }) + '\n';
fs.writeFileSync(boardPath, boardText);
fs.writeFileSync(dataPath, dataScript(radar));

copyPlainFiles(path.join(rootDir, 'dashboard'), dashboardPath);
const shots = copyPlainFiles(path.join(rootDir, 'screenshots'), shotsPath);
const enoughShots = shots.length > 2;
if (!enoughShots) fail(1, `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
shots.forEach((shot) => {
  if (!IMAGE_NAME.test(shot)) {
    fail(1, `token radar: screenshots/${shot}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
  }
});

// The dossier is written last: the scorer rebuilds it from this output directory and compares bytes.
fs.writeFileSync(dossierPath, buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const summaryLines = [
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`,
  `token radar: wrote ${boardPath}, ${dataPath}, ${dashboardPath} (3 files), ${shotsPath} (${shots.length} images) and ${dossierPath}`,
];
process.stdout.write(summaryLines.join('\n') + '\n');
