// Token launch radar — model "comps-odds v1".
//
// One sealed DefiLlama snapshot in, one ranked board out. The model is
// calibrated from the snapshot itself, never from a hand-written list of
// names, and every number on a row can be recomputed from the snapshot:
//
//   implied = TVL x comp x odds x growth
//
//   comp   = the category's median mcap/TVL among its token-bearing
//            protocols (n >= 5 in that category, else the global median),
//            clamped to [0.05, 0.60]. A launch is priced like its peers.
//   odds   = the category's token rate — the share of protocols in that
//            category that already record a token — clamped to
//            [0.20, 0.80], times a maturity factor 0.70..1.00 over four
//            years of tracking (unknown age counts as 365 days).
//            Categories where tokens are rare score low; it is a proxy,
//            and the dashboard says so.
//   growth = 1 + clamp(change_7d, -50, 100) / 100 * 0.5.
//
// A protocol is rankable only when it records no token AND it is not a
// wrapped, staked or bridged product of a token that already trades:
// its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid
// Restaking, Restaked BTC or CEX, its name carries no whole word
// wrapped/staked/staking, does not start with an exchange's name, and
// does not end in a version marker. That is the house watchlist's own
// exclusion rule, applied to every ranked row — not just the watchlist.
// WBTC, Binance staked ETH and USDT0 are therefore never ranked as
// launches: they are a token that already trades, in another form.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  comp_floor: number;
  comp_cap: number;
  comp_min_n: number;
  odds_floor: number;
  odds_cap: number;
  maturity_floor: number;
  maturity_days: number;
  unknown_age_days: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
}

export const MODEL: ModelConstants = {
  comp_floor: 0.05,
  comp_cap: 0.6,
  comp_min_n: 5,
  odds_floor: 0.2,
  odds_cap: 0.8,
  maturity_floor: 0.7,
  maturity_days: 1460,
  unknown_age_days: 365,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
};

export const MODEL_VERSION = 'comps-odds v1';

export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comp_multiple: number;
    comp_n: number;
    launch_odds: number;
    category_token_rate: number;
    maturity_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    age_days: number | null;
  };
  flags: string[];
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  comp_multiple: number;
  comp_raw: number;
  launch_odds: number;
  odds_rate: number;
  maturity_multiplier: number;
  growth_pct: number;
  growth_multiplier: number;
  flags: string[];
  farm_steps: string[];
  watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_comp: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank as a launch: pre-token and not a wrapped, staked or bridged product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

export function parseSnapshot(text: string): Snapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (typeof data !== 'object' || data === null) throw new SnapshotError('snapshot is not an object');
  const s = data as Partial<Snapshot>;
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('snapshot carries no protocols or watchlist');
  }
  if (typeof s.as_of !== 'string' || typeof s.floor_usd !== 'number') {
    throw new SnapshotError('snapshot carries no as_of date or floor');
  }
  return s as Snapshot;
}

interface Calibration {
  globalComp: number;
  compByCategory: Map<string, { multiple: number; n: number }>;
  tokenRateByCategory: Map<string, number>;
}

function calibrate(snapshot: Snapshot, model: ModelConstants): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    const key = p.category ?? 'Unknown';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalComp = clamp(median(allRatios), model.comp_floor, model.comp_cap);
  const compByCategory = new Map<string, { multiple: number; n: number }>();
  for (const [key, values] of ratiosByCategory) {
    if (values.length >= model.comp_min_n) {
      compByCategory.set(key, {
        multiple: clamp(median(values), model.comp_floor, model.comp_cap),
        n: values.length,
      });
    }
  }
  const tokenRateByCategory = new Map<string, number>();
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Unknown';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  for (const [key, list] of byCategory) {
    tokenRateByCategory.set(
      key,
      list.filter((p) => !isPreToken(p)).length / list.length,
    );
  }
  return { globalComp, compByCategory, tokenRateByCategory };
}

export interface Scored {
  implied: number;
  compMultiple: number;
  compRaw: number;
  compN: number;
  launchOdds: number;
  tokenRate: number;
  maturityMult: number;
  growthPct: number;
  growthMult: number;
  age: number | null;
}

export function scoreProtocol(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  cal: Calibration,
  model: ModelConstants = MODEL,
): Scored {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const key = p.category ?? 'Unknown';
  const compEntry = compByCategoryLookup(cal, key);
  const compRaw = compEntry.multiple;
  const compN = compEntry.n;
  const tokenRate = cal.tokenRateByCategory.get(key) ?? 0.5;
  const rateClamped = clamp(tokenRate, model.odds_floor, model.odds_cap);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (1 - model.maturity_floor) *
      (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days);
  const launchOdds = rateClamped * maturityMult;
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * compRaw * launchOdds * growthMult),
  );
  return {
    implied,
    compMultiple: round4(compRaw),
    compRaw: round4(compRaw),
    compN,
    launchOdds: round4(launchOdds),
    tokenRate: round4(tokenRate),
    maturityMult: round4(maturityMult),
    growthPct: round4(growthPct),
    growthMult: round4(growthMult),
    age,
  };
}

function compByCategoryLookup(
  cal: Calibration,
  key: string,
): { multiple: number; n: number } {
  const entry = cal.compByCategory.get(key);
  if (entry !== undefined) return entry;
  return { multiple: cal.globalComp, n: 0 };
}

/** The doubts a reader should hold about one row, derived from its own record. */
export function flagsFor(
  p: SnapshotProtocol,
  scored: Scored,
  snapshot: Snapshot,
): string[] {
  const flags: string[] = [];
  if (snapshot.watchlist.includes(p.slug)) {
    flags.push('On the house watchlist: TVL of $50M or more, no token recorded, not a wrapped, staked or bridged product.');
  } else {
    flags.push('Below the $50M watchlist floor: smaller and earlier, so less proven than the watchlist names.');
  }
  if (scored.age === null) {
    flags.push('Age unknown in the snapshot: treated as 365 days, so the maturity factor is a guess.');
  }
  if (p.change_7d === null) {
    flags.push('No 7-day TVL change reported: the growth tilt is neutral by default, not by evidence.');
  } else if (p.change_7d < -10) {
    flags.push(`TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in 7 days: the board may be catching a protocol on its way down.`);
  }
  if (scored.tokenRate < 0.15) {
    flags.push(
      `Only ${(scored.tokenRate * 100).toFixed(0)}% of protocols in this category record a token: launches here are rare, so the odds are the model's weakest claim.`,
    );
  }
  const category = (p.category ?? '').toLowerCase();
  if (category.includes('cdp') || category.includes('stable')) {
    flags.push('Stable-asset protocol: the asset itself may already be the token, so treat the launch value with extra doubt.');
  }
  if (scored.compN === 0) {
    flags.push('No category peers with a token: the value multiple falls back to the global median, not a category comp.');
  }
  return flags;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and keep the shares.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Fund ${name} with $${capital} and place one market position on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  }
  if (c.includes('payment')) {
    return `Route $${capital} of payments through ${name} on ${chain} across at least two weeks.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's farm plan: six steps, each an action with a cost and a time, plus the doubt check. */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  flags: string[],
): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  // The doubt check names the strongest doubt, not the watchlist note:
  // a stable-asset warning, a rare-category warning, a TVL fall or an
  // unknown age outranks the routine watchlist line.
  const doubt =
    flags.find((f) => /doubt|rare|Stable|fell|unknown|fallback/i.test(f)) ??
    (flags.length > 0 ? flags[0]! : 'Nothing in the snapshot contradicts this row.');
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you farm, check the doubt: ${doubt} If it fails, skip this protocol.`,
      cost: 'nothing but the check',
      time: '10 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const cal = calibrate(snapshot, model);
  const ranked = snapshot.protocols
    .filter((p) => isRankable(p))
    .map((p) => ({ p, scored: scoreProtocol(p, snapshot, cal, model) }));
  ranked.sort(
    (a, b) =>
      b.scored.implied - a.scored.implied ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return ranked.map((entry, i) => {
    const { p, scored } = entry;
    const flags = flagsFor(p, scored, snapshot);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: scored.age,
      implied_value_usd: scored.implied,
      model: {
        comp_multiple: scored.compMultiple,
        comp_n: scored.compN,
        launch_odds: scored.launchOdds,
        category_token_rate: scored.tokenRate,
        maturity_multiplier: scored.maturityMult,
        growth_pct: scored.growthPct,
        growth_multiplier: scored.growthMult,
        age_days: scored.age,
      },
      flags,
      farm_steps: farmSteps(p, scored.age, flags).map(stepText),
    };
  });
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function radarRow(row: BoardRow, snapshot: Snapshot): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    comp_multiple: row.model.comp_multiple,
    comp_raw: row.model.comp_multiple,
    launch_odds: row.model.launch_odds,
    odds_rate: row.model.category_token_rate,
    maturity_multiplier: row.model.maturity_multiplier,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    flags: row.flags,
    farm_steps: row.farm_steps,
    watchlist: snapshot.watchlist.includes(row.slug),
  };
}

export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    global_comp: round4(cal.globalComp),
    rows: board.map((row) => radarRow(row, snapshot)),
    live,
  };
  return { board, radar };
}

/** The dashboard's data file: one script that sets window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** The gate's own shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board holds ${board.length} rows, the gate takes 100 to 4000`;
  }
  const seen = new Set<string>();
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  let previous = Number.POSITIVE_INFINITY;
  const values = new Set<number>();
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!slugs.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} carries no positive whole implied value`;
    }
    if (row.implied_value_usd > previous) return 'implied values rise as rank ascends';
    previous = row.implied_value_usd;
    values.add(row.implied_value_usd);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} carries ${row.farm_steps.length} farm steps, the gate takes 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `row ${row.slug} carries a farm step of ${trimmed.length} characters, the gate takes 20 to 600`;
      }
    }
  }
  if (values.size < 2) return 'every row carries the same implied value';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
