// Token Radar's plain dashboard. It reads window.RADAR, written beside dashboard/ by main.ts,
// and paints the ranked board, a filterable table, and a per-protocol detail drawer holding the
// model's own inputs and the protocol's farm plan. No network: every byte shown lives in data.js.
(function () { // dashboard boot
  'use strict'; // strict mode

  const RADAR = window.RADAR;
  if (!RADAR) return;
  const app = document.getElementById('board');
  const state = { q: '', category: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** A dollar amount, shortened: billions with two decimals, millions with one, thousands rounded. */
  const USD_UNITS = [[1e9, 'B', 2], [1e6, 'M', 1]];
  function fmtUsd(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    const abs = Math.abs(value);
    for (let i = 0; i < USD_UNITS.length; i++) {
      const [limit, suffix, digits] = USD_UNITS[i];
      if (abs >= limit) return '$' + (value / limit).toFixed(digits) + suffix;
    }
    if (abs >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
    return usd.format(value);
  }
  function fmtMult(value) {
    return 'x' + value.toFixed(3);
  }
  function fmtPct(value) {
    if (value === null || value === undefined || !isFinite(value)) return 'n/a';
    const shown = value.toFixed(2);
    return value > 0 ? '+' + shown + '%' : shown + '%';
  }
  function fmtAge(age) {
    if (age === null || age === undefined) return 'unknown';
    if (age < 365) return Math.max(0, Math.round(age)) + 'd';
    return (age / 365).toFixed(1) + 'y';
  }
  // The model, recomputed in the page: a row's figures run through the same arithmetic board.json
  // carries, so the drawer can check the board's number instead of trusting it.
  function impliedOf(row, model, globalMultiple) {
    const mult = row.peer_count >= model.min_peers ? row.peer_multiple : globalMultiple;
    const rawGrowth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    const growth = Math.max(model.growth_floor, Math.min(model.growth_cap, rawGrowth));
    const growthMult = 1 + (growth * model.growth_weight) / 100;
    const age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    const capped = Math.min(Math.max(age, 0), model.maturity_days);
    const maturity = model.maturity_floor + (capped * model.maturity_range) / model.maturity_days;
    const value = Math.round(row.tvl_usd * mult * growthMult * maturity);
    return value < 1 ? 1 : value;
  }

  /**
   * Build one element from a spec: `tag` names it, `cls` sets its class (even null — the page
   * keeps the old quirk where a non-top row carries class="null"), `text` or `html` fills it,
   * `attrs` sets attributes, `on` wires listeners, and `kids` is the one array of children.
   */
  function el(spec, kids) {
    const node = document.createElement(spec.tag);
    if ('cls' in spec) node.className = spec.cls;
    if (spec.text !== undefined) node.textContent = spec.text;
    if (spec.html !== undefined) node.innerHTML = spec.html;
    Object.entries(spec.attrs ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined) node.setAttribute(key, value);
    });
    Object.entries(spec.on ?? {}).forEach(([event, handler]) => node.addEventListener(event, handler));
    (kids ?? []).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node; // built
  }

  /** A table cell holding one number, right-aligned by the sheet. */
  function numCell(text) {
    return el({ tag: 'td', cls: 'num', text });
  }

  // The farm plan mirrors main.ts: category, chains, TVL and age decide the action, the capital,
  // the hold and every cost and time. No protocol name is special-cased.
  function chainOf(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }
  function capitalFor(
    p
  ) {
    const tiers = [[5e9, 250], [1e9, 150], [1e8, 100]];
    for (const [floor, amount] of tiers) {
      if (p.tvl_usd >= floor) return amount;
    }
    return 50; // the base stake
  }
  function holdDaysFor(
    age
  ) {
    const days = age ?? 365;
    if (days >= 365) return 30;
    if (days < 180) return 60;
    return 45;
  }
  const CHEAP_CHAINS = new Set(
    'Arbitrum|Optimism|Base|Polygon|BNB Chain|BSC|Avalanche|Solana|Aptos|Sui|zkSync Era|Linea|Scroll|Blast|Mantle|Mode|Gnosis|Fantom|Tron|Sei|Berachain|Unichain|Abstract|Soneium|Hyperliquid|Starknet|Celo|Moonbeam|Kava|Cronos|Polygon zkEVM|opBNB|Manta|Taiko|Zora|Fraxtal|Ink|World Chain|Katana|Plume|Sonic|Monad|MegaETH|Eclipse|Fuel|Movement|ApeChain|BOB|Corn'.split('|')
  );
  function gasCost(chain) {
    if (chain === 'Ethereum') return 'about $8 of gas';
    return CHEAP_CHAINS.has(chain) ? 'under $0.50 of gas' : 'about $2 of gas';
  }
  function weeklyGas(chain) {
    if (chain === 'Ethereum') return 'about $8 of gas a week';
    return CHEAP_CHAINS.has(chain) ? 'under $0.50 of gas a week' : 'about $2 of gas a week';
  }
  const ACTION_RULES = [
    [['lend', 'cdp', 'collateral'], function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; }],
    [['dex', 'yield', 'leveraged farm'], function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; }],
    [['bridge'], function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; }],
    [['staking', 'restak'], function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.'; }],
    [['perpetual', 'derivative', 'basis'], function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.'; }],
    [['prediction'], function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + ', then leave the stake working.'; }],
    [['curator', 'allocator', 'capital'], function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.'; }],
    [['stable'], function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; }],
    [['rwa'], function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.'; }],
    [['insurance'], function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.'; }],
    [['payment'], function (name, capital, chain) { return 'Send $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt of the payment.'; }],
    [['index'], function (name, capital, chain) { return 'Buy $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it.'; }],
    [['farm'], function (name, capital, chain) { return 'Deposit $' + capital + " into " + name + "'s farm on " + chain + ' and keep the position open.'; }],
    [['chain'], function (name, capital, chain) { return 'Use $' + capital + ' of the ' + name + " chain's own app on " + chain + ' and keep the activity going.'; }],
    [['governance'], function (name, capital, chain) { return 'Lock $' + capital + ' of assets in ' + name + ' on ' + chain + ' and vote once on a live proposal.'; }]
  ];
  function lower(value) {
    return (value || '').toLowerCase();
  }
  function actionFor(
    p,
    capital,
    chain
  ) {
    const category = lower(p.category);
    const hit = ACTION_RULES.find(([keys]) => keys.some((key) => category.includes(key)));
    if (hit === undefined) return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
    return hit[1](p.name, capital, chain);
  }
  function stepText(
    step
  ) {
    const joined = [step.text, 'Cost: ' + step.cost + '.', 'Time: ' + step.time + '.'].join(' ');
    if (joined.length > 600) return joined.slice(0, 596) + '...';
    return joined.length < 20 ? joined + " Hold the position and check the protocol's own page." : joined;
  }
  function farmSteps(
    p
  ) {
    const inputs = { chain: chainOf(p), capital: capitalFor(p), hold: holdDaysFor(p.age_days) };
    const secondChain = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    const plan = [];
    const add = function (text, cost, time) { plan.push({ text: text, cost: cost, time: time }); };
    add("Open " + p.name + "'s own app from its official docs or announcements and bookmark it, so a search result cannot swap in a fake copy.", 'nothing to check', '5 minutes');
    add(actionFor(p, inputs.capital, inputs.chain), '$' + inputs.capital + ' of capital and ' + gasCost(inputs.chain), '15 minutes to set up');
    add('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', weeklyGas(inputs.chain), '10 minutes a week');
    if (secondChain) {
      add('Repeat the same deposit on ' + secondChain + ", the protocol's second chain, so the activity is not tied to one network.", '$' + Math.floor(inputs.capital / 2) + ' of capital and ' + gasCost(secondChain), '10 minutes');
    }
    add('Hold the position for at least ' + inputs.hold + ' days so the activity is counted in more than one snapshot.', 'the $' + inputs.capital + ' stays in the position', inputs.hold + ' days');
    add("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; no token is confirmed, so never pay anyone to claim for you.", 'no fee to check', '10 minutes');
    add('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes');
    return plan.map(stepText);
  }

  /** Repaint the board after any state change. */
  function repaint() { render(); }

  function readHash() { // from the URL
    const raw = window.location.hash;
    const hash = raw.length <= 1 ? '' : raw.slice(1);
    if (hash === '') return;
    const params = new URLSearchParams(hash);
    const q = params.get('q');
    const p = params.get('p');
    const category = params.get('category');
    if (q) state.q = q;
    if (p) state.selected = p;
    if (category) state.category = category;
    if (params.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() { // into the URL
    const params = new URLSearchParams();
    const entries = [
      ['q', state.q],
      ['category', state.category !== 'all' ? state.category : ''],
      ['watch', state.watchOnly ? '1' : ''],
      ['p', state.selected === null ? '' : state.selected],
    ];
    entries.forEach(([key, value]) => {
      if (value !== '') params.set(key, value);
    });
    const query = params.toString();
    const url = query ? '#' + query : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }

  function rows() { // the filtered board
    const q = state.q.trim().toLowerCase();
    return RADAR.rows.filter((r) => {
      if (state.watchOnly && !r.watchlist) return false;
      const categoryOk = state.category === 'all' || r.category === state.category;
      if (!categoryOk) return false;
      if (q.length === 0) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  function sortedRows(
    list
  ) {
    const key = state.sort;
    const pick = (r) => {
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null || r.age_days === undefined ? Infinity : r.age_days;
      return r.implied_value_usd;
    };
    const sorted = list.slice();
    sorted.sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      if (av !== bv) return av < bv ? -state.dir : state.dir;
      if (a.slug === b.slug) return 0;
      return a.slug < b.slug ? -1 : 1;
    });
    return sorted;
  }

  function header() { // brand + snapshot meta
    const meta = el({ tag: 'div', cls: 'top-meta' }, [
      el({ tag: 'span', text: 'Snapshot ' + RADAR.as_of }),
      el({ tag: 'span', text: 'DefiLlama protocol index' }),
      el({ tag: 'span', text: RADAR.model_version + ' model' }),
    ]);
    const brand = el({ tag: 'div', cls: 'brand' }, [
      el({ tag: 'span', cls: 'mark' }),
      el({ tag: 'span', cls: 'brand-name', text: 'Token Radar' }),
    ]);
    return el({ tag: 'header', cls: 'top' }, [brand, meta]);
  }

  function lede() { // headline + facts
    const intro = el({ tag: 'div' }, [
      el({ tag: 'h1', text: RADAR.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      el({ tag: 'p', text: 'The watchlist is the floor: every protocol with at least $' + Math.round(RADAR.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar ranks every other pre-token protocol the house rule keeps, below that floor. Implied value is a model, not a promise.' }),
    ]);
    const facts = el({ tag: 'div', cls: 'facts' }, [
      el({ tag: 'div', cls: 'fact' }, [el({ tag: 'span', text: 'Watchlist covered' }), el({ tag: 'b', text: RADAR.watchlist_size + ' / ' + RADAR.watchlist_size })]),
      el({ tag: 'div', cls: 'fact' }, [el({ tag: 'span', text: 'Pre-token rows scored' }), el({ tag: 'b', text: String(RADAR.board_size) })]),
      el({ tag: 'div', cls: 'fact' }, [el({ tag: 'span', text: 'Early rows below the floor' }), el({ tag: 'b', text: String(RADAR.early_size) })]),
      el({ tag: 'div', cls: 'fact' }, [el({ tag: 'span', text: 'Live-token protocols set aside' }), el({ tag: 'b', text: String(RADAR.live_size) })]),
    ]);
    return el({ tag: 'section', cls: 'lede' }, [intro, facts]);
  }

  function topPicks() {
    const labels = ['Rank 1', 'Rank 2', 'Rank 3'];
    const picks = RADAR.rows.slice(0, 3).map((r, i) => {
      return el({ tag: 'button', cls: 'pick', attrs: { type: 'button' }, on: { click: function () { openDetail(r.slug); } } }, [
        el({ tag: 'span', cls: 'rank', text: labels[i] }),
        el({ tag: 'b', text: r.name }),
        el({ tag: 'span', cls: 'num', text: fmtUsd(r.implied_value_usd) + ' implied value' }),
        el({ tag: 'span', cls: 'sub', text: (r.category || 'Other') + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · ' + fmtPct(r.change_7d) + ' in 7d' }),
      ]);
    });
    return el({ tag: 'section', cls: 'top3' }, picks);
  }

  function controls() { // search, filter, tabs
    const categories = Array.from(new Set(RADAR.rows.map((r) => r.category || 'Other'))).sort();
    const search = el({ tag: 'input', attrs: { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' }, on: { input: function () { state.q = search.value; writeHash(); repaint(); } } });
    const options = [el({ tag: 'option', attrs: { value: 'all' }, text: 'All categories' })].concat(
      categories.map((c) => el({ tag: 'option', attrs: { value: c, selected: c === state.category ? 'selected' : null }, text: c }))
    );
    const select = el({ tag: 'select', attrs: { id: 'category', 'aria-label': 'Filter by category' }, on: { change: function () { state.category = select.value; writeHash(); repaint(); } } }, options);
    const watch = el({ tag: 'input', attrs: { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null }, on: { change: function () { state.watchOnly = watch.checked; writeHash(); repaint(); } } });
    const pre = el({ tag: 'button', attrs: { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false' }, text: 'Pre-token', on: { click: function () { state.tab = 'pre-token'; repaint(); } } });
    const live = el({ tag: 'button', attrs: { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false' }, text: 'Live token', on: { click: function () { state.tab = 'live'; repaint(); } } });
    const count = el({ tag: 'span', cls: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : RADAR.live.length + ' live-token protocols' });
    return el({ tag: 'div', cls: 'controls' }, [
      el({ tag: 'div', cls: 'field' }, [el({ tag: 'label', attrs: { for: 'q' }, text: 'Search' }), search]),
      el({ tag: 'div', cls: 'field' }, [el({ tag: 'label', attrs: { for: 'category' }, text: 'Category' }), select]),
      el({ tag: 'label', cls: 'check', attrs: { for: 'watch' } }, [watch, 'Watchlist only']),
      el({ tag: 'div', cls: 'field' }, [el({ tag: 'span', cls: 'sub', text: 'Token status' }), el({ tag: 'div', cls: 'tabs' }, [pre, live])]),
      count,
    ]);
  }

  function sortHeader(
    key,
    label
  ) {
    const arrow = state.sort === key ? el({ tag: 'span', attrs: { 'aria-hidden': 'true' }, text: state.dir < 0 ? ' v' : ' ^' }) : null;
    const button = el({ tag: 'button', attrs: { type: 'button' }, on: { click: function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      repaint();
    } } }, [label, arrow]);
    return el({ tag: 'th', attrs: { scope: 'col' } }, [button]);
  }

  function boardTable() { // the ranked table
    const list = sortedRows(rows());
    if (list.length < 1) {
      return el({ tag: 'div', cls: 'panel' }, [el({ tag: 'div', cls: 'empty' }, [
        el({ tag: 'h2', text: 'No protocol matches that filter' }),
        el({ tag: 'p', text: 'Clear the search or pick another category to see the board again.' }),
        el({ tag: 'button', cls: 'button primary', attrs: { type: 'button' }, text: 'Clear filters', on: { click: function () { state.q = ''; state.category = 'all'; state.watchOnly = false; writeHash(); repaint(); } } }),
      ])]);
    }
    const max = list[0].implied_value_usd || 1;
    const bodyRows = list.map((r) => {
      const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      const width = Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%';
      return el({ tag: 'tr', cls: r.rank <= 3 ? 'top-row' : null, attrs: { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0' }, on: { click: function () { openDetail(r.slug); }, keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } } }, [
        numCell(String(r.rank)),
        el({ tag: 'td' }, [el({ tag: 'div', cls: 'name' }, [
          el({ tag: 'b', text: r.name }),
          el({ tag: 'span', cls: 'sub', text: (r.category || 'Other') + ' on ' + chains }),
        ])]),
        numCell(fmtUsd(r.tvl_usd)),
        el({ tag: 'td', cls: 'num ' + growthClass, text: growth }),
        numCell(fmtAge(r.age_days)),
        el({ tag: 'td' }, [el({ tag: 'div', cls: 'implied' }, [
          el({ tag: 'div', cls: 'bar', attrs: { 'aria-hidden': 'true' } }, [el({ tag: 'i', attrs: { style: 'width:' + width } })]),
          el({ tag: 'span', cls: 'num', text: fmtUsd(r.implied_value_usd) }),
        ])]),
        el({ tag: 'td' }, [el({ tag: 'span', cls: r.watchlist ? 'tag watch' : 'tag', text: r.watchlist ? 'watchlist' : 'early' })]),
      ]);
    });
    const headCells = [];
    headCells.push(sortHeader('implied', 'Rank'));
    headCells.push(sortHeader('name', 'Protocol'));
    headCells.push(sortHeader('tvl', 'TVL'));
    headCells.push(sortHeader('growth', '7d'));
    headCells.push(sortHeader('age', 'Age'));
    headCells.push(sortHeader('implied', 'Implied value'));
    headCells.push(el({ tag: 'th', attrs: { scope: 'col' }, text: 'Board' }));
    return el({ tag: 'div', cls: 'panel' }, [
      el({ tag: 'div', cls: 'table-wrap' }, [
        el({ tag: 'table' }, [
          el({ tag: 'caption', cls: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el({ tag: 'thead' }, [el({ tag: 'tr' }, headCells)]),
          el({ tag: 'tbody' }, bodyRows),
        ]),
      ]),
    ]);
  }

  function liveTable() { // the set-aside live tokens
    const bodyRows = RADAR.live.map((r) => {
      const chains = r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      const trend = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
      return el({ tag: 'tr' }, [
        numCell('live'),
        el({ tag: 'td' }, [el({ tag: 'div', cls: 'name' }, [el({ tag: 'b', text: r.name }), el({ tag: 'span', cls: 'sub', text: (r.category || 'Other') + ' on ' + chains })])]),
        numCell(fmtUsd(r.tvl_usd)),
        el({ tag: 'td', cls: 'num ' + trend, text: fmtPct(r.change_7d) }),
        numCell(fmtUsd(r.mcap_usd)),
        el({ tag: 'td' }, [el({ tag: 'span', cls: 'tag', text: 'already trades' })]),
      ]);
    });
    return el({ tag: 'div', cls: 'panel' }, [
      el({ tag: 'div', cls: 'table-wrap' }, [
        el({ tag: 'table' }, [
          el({ tag: 'caption', cls: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el({ tag: 'thead' }, [el({ tag: 'tr' }, [
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Status' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Protocol' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'TVL' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: '7d' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Market cap' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Token' }),
          ])]),
          el({ tag: 'tbody' }, bodyRows),
        ]),
      ]),
    ]);
  }

  function modelPanel() { // formula + peer evidence
    const model = RADAR.model;
    const peerRows = (RADAR.peers || []).map((p) => {
      return el({ tag: 'tr' }, [
        el({ tag: 'td', text: p.category }),
        numCell(String(p.peers)),
        numCell(p.median === null ? 'n/a' : fmtMult(p.median)),
        numCell(fmtMult(p.multiple)),
      ]);
    });
    const formula = 'implied = round( tvl_usd x peer multiple x (1 + clamp(change_7d, ' + model.growth_floor + ', ' + model.growth_cap + ') / 100 x ' + model.growth_weight + ') x (' + model.maturity_floor + ' + min(age_days, ' + model.maturity_days + ') / ' + model.maturity_days + ' x ' + model.maturity_range + ') )';
    const explainer = 'The peer multiple is the median market-cap/TVL ratio of the live-token protocols in the same category, shrunk toward the global median of ' + fmtMult(RADAR.global_peer_multiple) + ' by a prior of ' + model.peer_shrinkage_prior + ' and clamped to ' + fmtMult(model.peer_floor) + '–' + fmtMult(model.peer_cap) + '. A category with fewer than ' + model.min_peers + ' live peers takes the global median outright, so one outlier cannot set the price. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + model.unknown_age_days + ' days. Exchanges, bridges, liquid-staking products and versioned pools never rank: the watchlist rule applies to the whole board.';
    return el({ tag: 'section', cls: 'panel model' }, [
      el({ tag: 'h2', text: 'How implied value is computed' }),
      el({ tag: 'p', cls: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el({ tag: 'div', cls: 'formula' }, [formula]),
      el({ tag: 'p', cls: 'sub', text: explainer }),
      el({ tag: 'div', cls: 'table-wrap' }, [
        el({ tag: 'table', cls: 'peers' }, [
          el({ tag: 'caption', cls: 'sub', text: 'Peer evidence by category: live-token protocols, their median market-cap/TVL ratio, and the multiple the model uses.' }),
          el({ tag: 'thead' }, [el({ tag: 'tr' }, [
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Category' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Live peers' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Median mcap/TVL' }),
            el({ tag: 'th', attrs: { scope: 'col' }, text: 'Multiple used' }),
          ])]),
          el({ tag: 'tbody' }, peerRows),
        ]),
      ]),
    ]);
  }

  const dialog = el({ tag: 'dialog', cls: 'detail', attrs: { id: 'detail', 'aria-labelledby': 'detail-title' } });
  dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

  /** One equation line: a label and the row's value for it. */
  function equationLine(label, value) {
    return el({ tag: 'div' }, [el({ tag: 'span', text: label }), el({ tag: 'b', cls: 'num', text: value })]);
  }

  /** The drawer's head: rank, name, and where the protocol runs. */
  function detailHead(row) {
    return el({ tag: 'div', cls: 'detail-head' }, [
      el({ tag: 'div' }, [
        el({ tag: 'span', cls: 'brand-name', text: 'Rank ' + row.rank + ' of ' + RADAR.board_size + (row.watchlist ? ' · watchlist' : ' · early') }),
        el({ tag: 'h2', attrs: { id: 'detail-title' }, text: row.name }),
        el({ tag: 'p', cls: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
      ]),
      el({ tag: 'button', cls: 'close', attrs: { type: 'button', 'aria-label': 'Close details' }, text: 'Close', on: { click: function () { dialog.close(); } } }),
    ]);
  }

  function openDetail(
    slug
  ) {
    const row = RADAR.rows.filter((r) => r.slug === slug)[0];
    if (row === undefined) return;
    state.selected = slug; writeHash();
    dialog.replaceChildren();
    const steps = farmSteps(row);
    const peerLine = row.peer_count >= RADAR.model.min_peers
      ? 'Median market-cap/TVL of the ' + row.peer_count + ' live-token ' + (row.category || 'Other') + ' protocols, shrunk toward the global median.'
      : 'Fewer than ' + RADAR.model.min_peers + ' live-token peers in this category, so the model uses the global median of ' + fmtMult(RADAR.global_peer_multiple) + '.';
    const recomputed = impliedOf(row, RADAR.model, RADAR.global_peer_multiple);
    const matchNote = recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.';
    const head = detailHead(row);
    const equation = el({ tag: 'div', cls: 'equation' }, [
      equationLine('TVL', fmtUsd(row.tvl_usd)),
      equationLine('Peer multiple', fmtMult(row.peer_multiple) + ' (' + row.peer_count + ' peers)'),
      equationLine('Seven-day growth', fmtPct(row.change_7d)),
      equationLine('Age with no token', fmtAge(row.age_days)),
      equationLine('Growth multiplier', String(row.growth_multiplier)),
      equationLine('Maturity multiplier', String(row.maturity_multiplier)),
      equationLine('Implied value', fmtUsd(row.implied_value_usd)),
    ]);
    const valueSection = el({ tag: 'section', cls: 'detail-section' }, [
      el({ tag: 'h3', text: 'Implied value' }),
      equation,
      el({ tag: 'p', cls: 'sub', text: peerLine }),
      el({ tag: 'p', cls: 'sub', text: 'Model ' + RADAR.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + matchNote + ' This is an estimate, not a price.' }),
    ]);
    const planSection = el({ tag: 'section', cls: 'detail-section' }, [
      el({ tag: 'h3', text: 'Farm plan' }),
      el({ tag: 'ol', cls: 'steps' }, steps.map((s) => {
        const at = s.indexOf(' Cost: ');
        const action = at >= 0 ? s.slice(0, at) : s;
        const tail = at >= 0 ? s.slice(at + 1) : '';
        return el({ tag: 'li' }, [el({ tag: 'b', text: action }), el({ tag: 'span', cls: 'cost', text: tail })]);
      })),
    ]);
    dialog.appendChild(head);
    dialog.appendChild(valueSection);
    dialog.appendChild(planSection);
    const modal = typeof dialog.showModal === 'function';
    if (modal && !dialog.open) dialog.showModal();
    else if (!modal) dialog.setAttribute('open', '');
  }

  function render() { // rebuild the page
    app.replaceChildren();
    const shell = el({ tag: 'div', cls: 'shell' });
    const parts = [header(), lede()];
    if (state.tab === 'pre-token') parts.push(topPicks());
    parts.push(controls());
    parts.push(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') parts.push(modelPanel());
    parts.forEach((part) => shell.appendChild(part));
    app.append(shell);
    app.setAttribute('aria-busy', 'false'); // painted
    if (!dialog.isConnected) app.append(dialog);
    if (state.selected !== null) openDetail(state.selected);
  }

  readHash(); repaint();
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (dialog.open) dialog.close();
  });
})();
