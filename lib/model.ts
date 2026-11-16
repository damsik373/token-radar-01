// The token radar's scoring model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the house rule would keep. The watchlist is the floor,
// never the ceiling: the early radar is every other pre-token protocol that is not a wrapped,
// staked or bridged product, not an exchange, and not a versioned pool. Protocols whose token
// already trades are kept apart and shown with the market's own values, never mixed into the
// ranked board.
//
// Implied value follows only from the snapshot's own figures, in three factors. The peer
// multiple is the median market-cap/TVL ratio of the live-token protocols in the same category,
// shrunk toward the global median and capped; categories with fewer than three live peers carry
// no usable signal, so they take the global median instead of a single outlier's ratio. Growth
// is the seven-day change clamped to -60..120 per cent and half-weighted. Maturity rises with
// age, from 0.6 for a newborn protocol toward 1.0 after 1095 days (age unknown: 365 days).
// Implied value is the TVL times those three factors, rounded, and never below one.
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// shows each row's peer multiple and peer count so the number can be checked.

/** One protocol entry from the snapshot: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol { // the sealed input's ten fields
  slug: string
  name: string
  category: string | null
  chains: string[]
  tvl_usd: number
  change_7d: number | null
  mcap_usd: number | null
  listed_at: string | null
  gecko_id: string | null
  symbol: string | null
}

/** The whole snapshot document: facts, protocols, and the watchlist. */
export interface Snapshot { // as_of, source, floor, protocols, watchlist
  as_of: string
  source: string
  floor_usd: number
  protocols: SnapshotProtocol[]
  watchlist: string[]
}

/** The model's constants, as the dashboard states them and the peer table shows them. */
export interface ModelConstants { // growth, maturity, peers, clamp
  growth_weight: number
  growth_floor: number
  growth_cap: number
  maturity_floor: number
  maturity_range: number
  maturity_days: number
  unknown_age_days: number
  min_peers: number
  peer_shrinkage_prior: number
  peer_floor: number
  peer_cap: number
}

/**
 * The model's constants, built from pairs so the key order the dashboard prints is explicit:
 * growth, then maturity, then peers, then the peer clamp.
 */
const MODEL_PAIRS: Array<[keyof ModelConstants, number]> = [
  ['growth_weight', 0.5],
  ['growth_floor', -60],
  ['growth_cap', 120],
  ['maturity_floor', 0.6],
  ['maturity_range', 0.4],
  ['maturity_days', 1095],
  ['unknown_age_days', 365],
  ['min_peers', 3],
  ['peer_shrinkage_prior', 3],
  ['peer_floor', 0.05],
  ['peer_cap', 1.0],
];

export const MODEL: ModelConstants = Object.fromEntries(MODEL_PAIRS) as ModelConstants;

/** The model's version label, named by the dashboard and the rules. */
export const MODEL_VERSION: string = 'radar-2';

/** How many live-token protocols the Live token view carries, strongest first. */
export const LIVE_ROWS: number = 24;

/** One farm step: its action, its cost, and its time. */
export interface FarmStep { // text, cost, time
  text: string
  cost: string
  time: string
}

/** The fields every board row shares, ranked or compact. */
interface RowCore {
  rank: number
  slug: string
  name: string
  category: string | null
  chains: string[]
  tvl_usd: number
  change_7d: number | null
  mcap_usd: number | null
  listed_at: string | null
}

/** One row's model breakdown, as the board and the dashboard both show it. */
export interface RowModel { // peer, growth, maturity, age
  peer_multiple: number
  peer_count: number
  growth_pct: number
  growth_multiplier: number
  maturity_multiplier: number
  age_days: number | null
}

/** One row of board.json: a ranked protocol with its model breakdown. */
export interface BoardRow extends RowCore { // core plus token, watchlist, model, farm plan
  gecko_id: string | null
  symbol: string | null
  token_status: 'pre-token'
  watchlist: boolean
  age_days: number | null
  peer_multiple: number
  peer_count: number
  implied_value_usd: number
  model: RowModel
  farm_steps: string[]
}

/** One row as data.js carries it: compact, with the farm plan made in the page. */
export interface RadarRow extends RowCore { // core plus watchlist, age, multiples
  watchlist: boolean
  age_days: number | null
  peer_multiple: number
  peer_count: number
  implied_value_usd: number
  growth_multiplier: number
  maturity_multiplier: number
}

/** One category's peer evidence, as the model panel's table shows it. */
export interface PeerRow { // category, live peers, median, multiple used
  category: string
  peers: number
  median: number | null
  multiple: number
}

/** A live-token protocol: it already trades, so the board shows the market's value, not a model's. */
export interface LiveRow { // slug, name, category, chains, tvl, mcap, 7d
  slug: string
  name: string
  category: string | null
  chains: string[]
  tvl_usd: number
  mcap_usd: number | null
  change_7d: number | null
}

/** Everything the dashboard needs: the board, the live set, the peers, and the model it runs. */
export interface RadarData { // snapshot facts plus board, live set, peer table
  as_of: string
  source: string
  floor_usd: number
  model: ModelConstants
  model_version: string
  global_peer_multiple: number
  watchlist_size: number
  board_size: number
  early_size: number
  live_size: number
  peers: PeerRow[]
  rows: RadarRow[]
  live: LiveRow[]
}

/** The peer evidence: the global median market-cap/TVL ratio and one median per category. */
export interface PeerStats { // global median plus one median per category
  global: number
  byCategory: Map<string, { n: number; median: number | null }>
}

const SNAPSHOT_ERROR_NAME = 'SnapshotError';

/** Thrown when the snapshot is not one this model can score. */
export class SnapshotError extends Error { // thrown for a bad snapshot
  name = SNAPSHOT_ERROR_NAME;
  constructor(message: string) { super(message); }
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

/** A finite number, else `fallback` when the value is not one. */
function asFinite(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  return Number.isFinite(value) ? value : fallback;
}

/** The middle value of a sorted list, or null when it holds none. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values];
  ordered.sort((a, b) => a - b);
  return ordered[ordered.length >> 1]!;
}

/** Clamp `value` into [`low`, `high`]. */
function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** A nullable string lowered, with null becoming the empty string. */
function lower(value: string | null): string {
  return (value ?? '').toLowerCase();
}

/** The day number of a `YYYY-MM-DD` date, or NaN when it does not parse. */
function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Whole days between a listing date and the snapshot date, never below zero; null when a date is missing or unparsable. */
export function ageDays(
  asOf: string,
  listedAt: string | null,
): number | null {
  const start = listedAt === null ? NaN : dayNumber(listedAt);
  const end = dayNumber(asOf);
  const span = end - start;
  if (Number.isNaN(span)) return null;
  return span <= 0 ? 0 : Math.floor(span / DAY_MS);
}

/** Round to four decimals for the breakdown the board prints. */
function round4dp(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** The peer evidence: the global median market-cap/TVL ratio and one median per category. */
export function peerStats(snapshot: Snapshot): PeerStats {
  const scored = snapshot.protocols.map((p) => ({
    category: p.category ?? 'Other',
    ratio: p.mcap_usd === null ? NaN : p.mcap_usd / p.tvl_usd,
    tvl: p.tvl_usd,
  }));
  const live = scored.filter((entry) => entry.tvl > 0 && Number.isFinite(entry.ratio) && entry.ratio > 0);
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  live.forEach(({ category, ratio }) => {
    const bucket = ratiosByCategory.get(category);
    if (bucket === undefined) ratiosByCategory.set(category, [ratio]);
    else bucket.push(ratio);
    allRatios.push(ratio);
  });
  const global = median(allRatios) ?? 0.2;
  const stats = new Map<string, { n: number; median: number | null }>();
  ratiosByCategory.forEach((ratios, category) => {
    stats.set(category, { n: ratios.length, median: median(ratios) });
  });
  return { global, byCategory: stats };
}

/**
 * One category's peer multiple: the median market-cap/TVL of its live-token peers, shrunk toward
 * the global median by the prior, then clamped. A thin category carries no usable signal, so it
 * takes the global median outright instead of one outlier's ratio.
 */
export function peerMultiple(
  category: string | null,
  stats: PeerStats,
  model: ModelConstants,
): { multiple: number; peers: number } {
  const entry = stats.byCategory.get(category ?? 'Other');
  const peers = entry === undefined ? 0 : entry.n;
  const medianValue = entry === undefined ? null : entry.median;
  if (medianValue === null || peers < model.min_peers) return { multiple: stats.global, peers };
  const prior = model.peer_shrinkage_prior;
  const blended = (peers * medianValue + prior * stats.global) / (peers + prior);
  return { multiple: clamp(blended, model.peer_floor, model.peer_cap), peers };
}

/** The three factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  stats: PeerStats,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; peerMult: number; peers: number } {
  const age: number | null = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(asFinite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct * model.growth_weight) / 100;
  const ageForModel = age === null ? model.unknown_age_days : age;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) * model.maturity_range) / model.maturity_days;
  const peerOutcome = peerMultiple(protocol.category, stats, model);
  const raw = protocol.tvl_usd * peerOutcome.multiple * growthMult * maturityMult;
  const implied = Math.max(1, Math.round(raw));
  const outcome = { implied, growthPct, growthMult, maturityMult, age, peerMult: peerOutcome.multiple, peers: peerOutcome.peers };
  return outcome;
}

/** The house watchlist's own exclusions: a wrapped, staked or bridged product, an exchange, a versioned pool. */
const BARRED_CATEGORIES: Set<string> = new Set('Bridge|Canonical Bridge|Liquid Staking|Liquid Restaking|Restaked BTC|CEX'.split('|'));
const EXCHANGE_PREFIX = new RegExp('^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\\b', 'i');
const VERSION_SUFFIX = new RegExp('\\s(V\\d+(\\.\\d+)?|v\\d+(\\.\\d+)?|\\d+\\.\\d+)$');
const WRAPPED_WORD = new RegExp('\\b(wrapped|staked|staking)\\b', 'i');

/** Whether a protocol records no token at all: every token field empty. */
export function isPreToken(
  p: SnapshotProtocol,
): boolean {
  const fields = [p.mcap_usd, p.gecko_id, p.symbol];
  return fields.filter((field) => field !== null).length === 0;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and none of the house rule's exclusions
 * (an exchange, a bridge or liquid-staking product, a versioned pool, a wrapped or staked product,
 * or a product named for an exchange). The watchlist already passes this rule; the early radar
 * applies the same rule below the floor, so no wrapped token or exchange ever ranks as a launch.
 */
export function isRankable(
  p: SnapshotProtocol,
): boolean {
  if (!isPreToken(p)) return false;
  if (BARRED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return !EXCHANGE_PREFIX.test(p.name);
}

/** The snapshot's protocols, indexed by slug. */
function bySlug(
  protocols: SnapshotProtocol[],
): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  protocols.forEach((protocol) => {
    index.set(protocol.slug, protocol);
  });
  return index;
}

/** The protocols the board ranks, strongest first, ranked 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): BoardRow[] {
  const stats = peerStats(snapshot);
  const watched = new Set(snapshot.watchlist);
  // Rank every rankable pre-token protocol: the watchlist is the floor, and the early radar is
  // the whole rankable set below it, never a hand-picked top slice.
  const rankable = snapshot.protocols.filter((p) => isRankable(p));
  const scored = rankable.map((protocol) => {
    const outcome = impliedValue(protocol, snapshot.as_of, model, stats);
    return { protocol, ...outcome };
  });
  const byValueThenSlug = (a: { implied: number; protocol: SnapshotProtocol }, b: { implied: number; protocol: SnapshotProtocol }): number => {
    const gap = b.implied - a.implied;
    if (gap !== 0) return gap;
    const left = a.protocol.slug;
    const right = b.protocol.slug;
    return left === right ? 0 : left < right ? -1 : 1;
  };
  scored.sort(byValueThenSlug);
  return scored.map((entry, index) => {
    const { protocol, implied, growthPct, growthMult, maturityMult, age, peerMult, peers } = entry;
    const slug = protocol.slug;
    const name = protocol.name;
    const category = protocol.category;
    const chains = protocol.chains;
    const tvl_usd = protocol.tvl_usd;
    const change_7d = protocol.change_7d;
    const mcap_usd = protocol.mcap_usd;
    const listed_at = protocol.listed_at;
    const gecko_id = protocol.gecko_id;
    const symbol = protocol.symbol;
    const breakdown: RowModel = {
      peer_multiple: round4dp(peerMult),
      peer_count: peers,
      growth_pct: growthPct,
      growth_multiplier: round4dp(growthMult),
      maturity_multiplier: round4dp(maturityMult),
      age_days: age,
    };
    const core = {
      rank: index + 1, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at,
    };
    const row: BoardRow = {
      ...core,
      gecko_id, symbol, token_status: 'pre-token', watchlist: watched.has(slug), age_days: age,
      // Kept unrounded here: the page re-derives this row from the same factors, and a
      // rounded multiple would put its check a dollar away from the board.
      peer_multiple: peerMult, peer_count: peers, implied_value_usd: implied,
      model: breakdown,
      farm_steps: farmSteps(protocol, age).map(stepText),
    };
    return row;
  });
}

/** One farm step as one string: action, cost, and time, within 20..600 characters. */
export function stepText(
  step: FarmStep,
): string {
  const joined = [step.text, `Cost: ${step.cost}.`, `Time: ${step.time}.`].join(' ');
  if (joined.length > 600) return joined.slice(0, 596) + '...';
  return joined.length < 20 ? joined + " Hold the position and check the protocol's own page." : joined;
}

/** A protocol's first chain, or a neutral phrase when it names none. */
function chainOf(
  p: SnapshotProtocol,
): string {
  return p.chains.length === 0 ? 'its main chain' : (p.chains[0] as string);
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(
  p: SnapshotProtocol,
): number {
  const tiers: Array<[number, number]> = [[5_000_000_000, 250], [1_000_000_000, 150], [100_000_000, 100]];
  for (const [floor, amount] of tiers) {
    if (p.tvl_usd >= floor) return amount;
  }
  const base = 50;
  return base;
}

/** The hold length, from the protocol's age: younger protocols hold longer. */
function holdDaysFor(
  age: number | null,
): number {
  const days = age ?? 365;
  if (days >= 365) return 30;
  if (days < 180) return 60;
  return 45;
}

/** Chains where a transaction costs cents, so the gas lines stay honest instead of one flat fee. */
const CHEAP_CHAINS: Set<string> = new Set(
  'Arbitrum|Optimism|Base|Polygon|BNB Chain|BSC|Avalanche|Solana|Aptos|Sui|zkSync Era|Linea|Scroll|Blast|Mantle|Mode|Gnosis|Fantom|Tron|Sei|Berachain|Unichain|Abstract|Soneium|Hyperliquid|Starknet|Celo|Moonbeam|Kava|Cronos|Polygon zkEVM|opBNB|Manta|Taiko|Zora|Fraxtal|Ink|World Chain|Katana|Plume|Sonic|Monad|MegaETH|Eclipse|Fuel|Movement|ApeChain|BOB|Corn'.split('|'),
);

/** One transaction's gas on a chain: Ethereum mainnet is the expensive one, L2s and cheap L1s are cents. */
function gasCost(chain: string): string {
  const premium: Record<string, string> = { Ethereum: 'about $8 of gas' };
  const priced = premium[chain];
  if (priced !== undefined) return priced;
  return CHEAP_CHAINS.has(chain) ? 'under $0.50 of gas' : 'about $2 of gas';
}

/** A week's worth of small transactions on a chain. */
function weeklyGas(chain: string): string {
  const premium: Record<string, string> = { Ethereum: 'about $8 of gas a week' };
  const priced = premium[chain];
  if (priced !== undefined) return priced;
  return CHEAP_CHAINS.has(chain) ? 'under $0.50 of gas a week' : 'about $2 of gas a week';
}

/** One launch-action rule: the category keywords, then a builder for the words the board prints. */
type ActionRule = [string[], (name: string, capital: number, chain: string) => string];

/**
 * The launch actions, first match wins, in the order the board has always printed them. Each
 * builder takes the protocol's name, the capital its TVL calls for, and its first chain.
 */
const ACTION_RULES: ActionRule[] = [
  [['lend', 'cdp', 'collateral'], (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`],
  [['dex', 'yield', 'leveraged farm'], (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`],
  [['bridge'], (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`],
  [['staking', 'restak'], (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`],
  [['perpetual', 'derivative', 'basis'], (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`],
  [['prediction'], (name, capital, chain) => `Fund $${capital} and place one market position on ${name}, then leave the stake working.`],
  [['curator', 'allocator', 'capital'], (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`],
  [['stable'], (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`],
  [['rwa'], (name, capital, chain) => `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`],
  [['insurance'], (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`],
  [['payment'], (name, capital, chain) => `Send $${capital} through ${name} on ${chain} and keep the receipt of the payment.`],
  [['index'], (name, capital, chain) => `Buy $${capital} of the ${name} index token on ${chain} and hold it.`],
  [['farm'], (name, capital, chain) => `Deposit $${capital} into ${name}'s farm on ${chain} and keep the position open.`],
  [['chain'], (name, capital, chain) => `Use $${capital} of the ${name} chain's own app on ${chain} and keep the activity going.`],
  [['governance'], (name, capital, chain) => `Lock $${capital} of assets in ${name} on ${chain} and vote once on a live proposal.`],
];

/** The fallback action, for a category no rule names: a plain deposit that keeps the position open. */
const FALLBACK_ACTION = (name: string, capital: number, chain: string): string =>
  `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;

/** What to do on a protocol, from its category alone — first rule wins, else the plain deposit. */
export function actionFor(
  p: SnapshotProtocol,
  capital: number,
  chain: string,
): string {
  const category = lower(p.category);
  const hit = ACTION_RULES.find(([keys]) => keys.some((key) => category.includes(key)));
  if (hit === undefined) return FALLBACK_ACTION(p.name, capital, chain);
  return hit[1](p.name, capital, chain);
}

/**
 * The farm plan for one protocol: six steps, each an action with a cost and a time, derived from
 * the protocol's own record (category, chains, TVL, age) and never from a hand-written list of
 * names. A second chain, when there is one, gets its own step before the hold. No token is
 * confirmed for any of these protocols: the plan farms only what the protocol's own page shows,
 * and never pays to claim.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
): FarmStep[] {
  const inputs = { chain: chainOf(p), capital: capitalFor(p), hold: holdDaysFor(age) };
  const steps: FarmStep[] = [];
  const add = (text: string, cost: string, time: string): void => {
    steps.push({ text, cost, time });
  };
  add(
    `Open ${p.name}'s own app from its official docs or announcements and bookmark it, so a search result cannot swap in a fake copy.`,
    'nothing to check',
    '5 minutes',
  );
  add(
    actionFor(p, inputs.capital, inputs.chain),
    `$${inputs.capital} of capital and ${gasCost(inputs.chain)}`,
    '15 minutes to set up',
  );
  add(
    `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
    weeklyGas(inputs.chain),
    '10 minutes a week',
  );
  const other = p.chains[1];
  if (other !== undefined) {
    add(
      `Repeat the same deposit on ${other}, the protocol's second chain, so the activity is not tied to one network.`,
      `$${Math.floor(inputs.capital / 2)} of capital and ${gasCost(other)}`,
      '10 minutes',
    );
  }
  add(
    `Hold the position for at least ${inputs.hold} days so the activity is counted in more than one snapshot.`,
    `the $${inputs.capital} stays in the position`,
    `${inputs.hold} days`,
  );
  add(
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; no token is confirmed, so never pay anyone to claim for you.`,
    'no fee to check',
    '10 minutes',
  );
  add(
    `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
    'nothing but the log',
    '5 minutes',
  );
  return steps;
}

/** The live-token protocols, strongest market cap first — the dashboard's Live token view. */
export function liveRows(
  snapshot: Snapshot,
): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  const byCapThenTvl = (a: SnapshotProtocol, b: SnapshotProtocol): number => {
    if ((b.mcap_usd ?? 0) !== (a.mcap_usd ?? 0)) return (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
    return b.tvl_usd - a.tvl_usd;
  };
  trading.sort(byCapThenTvl);
  trading.splice(LIVE_ROWS);
  return trading.map((p) => {
    const { slug, name, category, chains, tvl_usd, mcap_usd, change_7d } = p;
    return { slug, name, category, chains, tvl_usd, mcap_usd, change_7d };
  });
}

/**
 * The peer-evidence table: every category the board carries, with its live peers and the multiple
 * the model uses for it. Multiples stay unrounded here, like the row multiples: the page
 * recomputes from these same numbers.
 */
export function peerTable(
  snapshot: Snapshot,
  board: BoardRow[],
  model: ModelConstants = MODEL,
): PeerRow[] {
  const stats = peerStats(snapshot);
  const cats = [...new Set(board.map((r) => r.category ?? 'Other'))].sort();
  const table: PeerRow[] = [];
  for (const category of cats) {
    const { multiple, peers } = peerMultiple(category === 'Other' ? null : category, stats, model);
    const entry = stats.byCategory.get(category);
    const medianValue = entry === undefined ? null : entry.median;
    table.push({ category, peers, median: medianValue, multiple });
  }
  table.sort((a, b) => {
    if (b.multiple !== a.multiple) return b.multiple - a.multiple;
    if (a.category === b.category) return 0;
    return a.category < b.category ? -1 : 1;
  });
  return table;
}

/** One board row in the compact form data.js carries, with the farm plan generated in the page. */
export function radarRow(
  row: BoardRow,
): RadarRow {
  const { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at } = row;
  const { watchlist, age_days, peer_multiple, peer_count, implied_value_usd } = row;
  const { growth_multiplier, maturity_multiplier } = row.model;
  const compact: RadarRow = {
    rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at,
    watchlist, age_days, peer_multiple, peer_count, implied_value_usd,
    growth_multiplier, maturity_multiplier,
  };
  return compact;
}

/** Everything the dashboard needs: the board, the live set, the peer table, and the model itself. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const stats = peerStats(snapshot);
  const board: BoardRow[] = buildBoard(snapshot, model);
  const trading = liveRows(snapshot);
  const peers = peerTable(snapshot, board, model);
  const rows = board.map(radarRow);
  const earlyCount = board.reduce((n, row) => n + (row.watchlist ? 0 : 1), 0);
  const { as_of, source, floor_usd, watchlist } = snapshot;
  const version = MODEL_VERSION;
  const radar = {
    as_of,
    source,
    floor_usd,
    model: model,
    model_version: version,
    // Unrounded, like the row multiples: the page recomputes from this same number.
    global_peer_multiple: stats.global,
    watchlist_size: watchlist.length,
    board_size: rows.length,
    early_size: earlyCount,
    live_size: trading.length,
    peers,
    rows,
    live: trading,
  };
  const result = { board, radar };
  return result;
}

/** A snapshot field read as text, or null when it is not a string. */
function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A snapshot field read as a finite number, or null when it is not one. */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A snapshot field read as a list of strings, dropping anything that is not one. */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  value.forEach((item) => {
    if (typeof item === 'string') out.push(item);
  });
  return out;
}

/** One protocol, validated field by field: anything wrong is a snapshot error, not a skip. */
function parseProtocol(raw: unknown, index: number): SnapshotProtocol {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    const message = `snapshot.json's protocol ${index} is not an object`;
    throw new SnapshotError(message);
  }
  const rec = raw as Record<string, unknown>;
  const tvl = asFiniteNumber(rec.tvl_usd);
  if (typeof rec.slug !== 'string' || typeof rec.name !== 'string' || tvl === null) {
    const message = `snapshot.json's protocol ${index} lacks a slug, a name or a TVL`;
    throw new SnapshotError(message);
  }
  const { slug, name } = rec as { slug: string; name: string };
  const protocol: SnapshotProtocol = {
    slug,
    name,
    category: asText(rec.category),
    chains: asStringList(rec.chains),
    tvl_usd: tvl,
    change_7d: asFiniteNumber(rec.change_7d),
    mcap_usd: asFiniteNumber(rec.mcap_usd),
    listed_at: asText(rec.listed_at),
    gecko_id: asText(rec.gecko_id),
    symbol: asText(rec.symbol),
  };
  return protocol;
}

/** Text as JSON, with the parse failure worded as a snapshot error. */
function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {
    const message = 'snapshot.json is not JSON';
    throw new SnapshotError(message);
  }
}

/** A snapshot from its JSON text, validated against the shape the model reads. */
export function parseSnapshot(
  text: string,
): Snapshot {
  const data = parseJson(text);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const rec = data as Record<string, unknown>;
  const asOf = rec.as_of;
  if (typeof asOf !== 'string') throw new SnapshotError('snapshot.json has no as_of date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof rec.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  const floor = rec.floor_usd;
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(rec.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(rec.watchlist) || rec.watchlist.some((item) => typeof item !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = (rec.protocols as unknown[]).map(parseProtocol);
  const { source } = rec as { source: string };
  const watchlist = rec.watchlist as string[];
  const snapshot: Snapshot = { as_of: asOf, source, floor_usd: floor, protocols, watchlist };
  return snapshot;
}

/** The watchlist slugs a board leaves out, if any. */
function missingWatchlist(board: BoardRow[], snapshot: Snapshot): string[] {
  const present = new Set(board.map((row) => row.slug));
  return snapshot.watchlist.filter((slug) => !present.has(slug));
}

/** The first rank problem, if the ranks are not exactly 1..n. */
function rankProblem(board: BoardRow[]): string | null {
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  const bad = ranks.findIndex((rank, i) => rank !== i + 1);
  return bad === -1 ? null : `rank ${bad + 1} is ${ranks[bad]}`;
}

/** The first ordering problem, if implied values do not fall down the board. */
function orderProblem(board: BoardRow[]): string | null {
  const bad = board.findIndex((row, i) => i > 0 && row.implied_value_usd > (board[i - 1] as BoardRow).implied_value_usd);
  return bad === -1 ? null : `row ${bad + 1} outranks row ${bad} on implied value`;
}

/** Whether one row's farm plan or implied value reads wrong. */
function rowProblem(row: BoardRow): string | null {
  const steps = row.farm_steps;
  if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
  const badStep = steps.find((step) => step.length < 20 || step.length > 600);
  if (badStep !== undefined) return `${row.slug} has a farm step of ${badStep.length} characters`;
  const valueOk = Number.isSafeInteger(row.implied_value_usd) && row.implied_value_usd > 0;
  return valueOk ? null : `${row.slug} has implied value ${row.implied_value_usd}`;
}

/** The first thing wrong with a board, or null when it passes: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(
  board: BoardRow[],
  snapshot: Snapshot,
): string | null {
  const missing = missingWatchlist(board, snapshot);
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = rankProblem(board);
  if (ranks !== null) return ranks;
  const order = orderProblem(board);
  if (order !== null) return order;
  const firstValue = board.length === 0 ? null : board[0]!.implied_value_usd;
  const lastValue = board.length === 0 ? null : board[board.length - 1]!.implied_value_usd;
  if (board.length >= 2 && firstValue !== null && firstValue === lastValue) {
    const shared = `all ${board.length} rows share the same implied value $${firstValue}: a board that ranks nothing by value is not a ranking`;
    return shared;
  }
  for (const row of board) {
    const problem = rowProblem(row);
    if (problem !== null) return problem;
  }
  return null; // the board checks out
}

/** data.js, compact: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(
  radar: RadarData,
): string {
  const payload = JSON.stringify(radar);
  return `window.RADAR=${payload};\n`;
}
