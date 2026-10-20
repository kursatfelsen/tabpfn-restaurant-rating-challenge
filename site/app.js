/* Beat TabPFN: guess Zomato ratings, compare against precomputed TabPFN predictions. */
(() => {
  "use strict";

  const DATA = window.GAME_DATA;
  if (!DATA || !DATA.samples || !DATA.samples.length) {
    document.body.innerHTML =
      '<p style="padding:40px;font:16px sans-serif">No game data found. Run <code>python precompute.py</code> first.</p>';
    return;
  }
  const SAMPLES = DATA.samples;
  const BY_ID = new Map(SAMPLES.map((s) => [s.id, s]));
  const STORE_KEY = "beat-tabpfn-v1:" + DATA.model + ":" + SAMPLES.length;

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, text) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  // ------------------------------------------------------------------ random
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  function shuffle(arr, r = Math.random) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ------------------------------------------------------------------- state
  let state = load() || fresh();
  function fresh() {
    return { order: shuffle(SAMPLES.map((s) => s.id)), idx: 0, results: [], revealed: false, guess: 3.7 };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.order) && s.order.every((id) => BY_ID.has(id))) return s;
    } catch (_) { /* storage unavailable */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
  }
  const current = () => BY_ID.get(state.order[state.idx % state.order.length]);

  // ------------------------------------------------------------------- stars
  let gradSeq = 0;
  const STAR_PATH = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z";
  function starsEl(value, { hidden = false } = {}) {
    const wrap = document.createElement("span");
    wrap.className = "stars";
    for (let i = 0; i < 5; i++) {
      const s = svg("svg", { viewBox: "0 0 24 24" });
      const fill = hidden ? 0 : Math.max(0, Math.min(1, value - i));
      const id = "sg" + gradSeq++;
      const g = svg("linearGradient", { id });
      g.append(
        svg("stop", { offset: fill, "stop-color": "var(--star)" }),
        svg("stop", { offset: fill, "stop-color": "var(--star-off)" })
      );
      const defs = svg("defs");
      defs.append(g);
      s.append(defs);
      s.append(svg("path", { d: STAR_PATH, fill: `url(#${id})` }));
      wrap.append(s);
    }
    return wrap;
  }

  // ------------------------------------------------------------ place panel
  const EMOJI = [
    [/pizza|italian/i, "🍕"], [/burger|fast food|american/i, "🍔"], [/biryani/i, "🍗"],
    [/south indian/i, "🥞"], [/north indian|mughlai|punjabi/i, "🍛"], [/chinese|asian|thai|momos|tibetan/i, "🍜"],
    [/japanese|sushi/i, "🍣"], [/dessert|ice cream|bakery|mithai/i, "🍰"], [/cafe|coffee|beverage|tea/i, "☕"],
    [/juice/i, "🥤"], [/kerala|andhra|chettinad|seafood/i, "🦐"], [/bar|pub|brew|lounge/i, "🍺"],
    [/street|rolls|kebab/i, "🌯"], [/healthy|salad/i, "🥗"], [/continental|european|steak/i, "🥩"],
    [/arabian|middle eastern|lebanese/i, "🥙"], [/sandwich/i, "🥪"],
  ];
  const HUES = [[255, 183, 77], [129, 199, 132], [100, 181, 246], [240, 98, 146], [149, 117, 205], [77, 208, 225], [255, 138, 101]];
  function emojiFor(text) {
    const out = [];
    for (const [re, e] of EMOJI) if (re.test(text) && !out.includes(e)) out.push(e);
    return out.length ? out : ["🍽"];
  }

  function renderHero(s) {
    const hero = $("hero");
    hero.replaceChildren();
    const r = rng(s.id * 7 + 3);
    const emojis = emojiFor([s.cuisines, s.type, s.listed].join(" "));
    const caps = ["All", "Food & drink", s.type || "Vibe"];
    for (let i = 0; i < 3; i++) {
      const [a, b, c] = pick(r, HUES);
      const d = el("div");
      d.style.background = `linear-gradient(${Math.floor(r() * 360)}deg, rgb(${a},${b},${c}), rgb(${a * 0.7 | 0},${b * 0.7 | 0},${c * 0.7 | 0}))`;
      d.append(document.createTextNode(emojis[i % emojis.length]));
      d.append(el("span", { class: "cap" }, caps[i]));
      hero.append(d);
    }
  }

  const ICONS = {
    pin: "M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7m0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5",
    food: "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4",
    money: "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4",
    moped: "M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65L13.52 14H10V9H6c-2.21 0-4 1.79-4 4v3h2c0 1.66 1.34 3 3 3s3-1.34 3-3h4.48L19 10.35zM7 17c-.55 0-1-.45-1-1h2c0 .55-.45 1-1 1m12-4c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3m0 4c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1",
    cal: "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V10h14zM9 14H7v-2h2zm4 0h-2v-2h2zm4 0h-2v-2h2z",
    tag: "M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9a2 2 0 0 0 2.83 0l7-7a2 2 0 0 0-.01-2.84M5.5 7A1.5 1.5 0 1 1 7 5.5 1.5 1.5 0 0 1 5.5 7",
  };
  function infoRow(icon, main, sub) {
    const li = el("li");
    const s = svg("svg", { viewBox: "0 0 24 24" });
    s.append(svg("path", { d: ICONS[icon] }));
    const box = el("div");
    box.append(el("div", {}, main));
    if (sub) box.append(el("div", { class: "sub" }, sub));
    li.append(s, box);
    return li;
  }

  const AVATAR_COLORS = ["#1a73e8", "#e8710a", "#188038", "#d93025", "#9334e6", "#12b5cb", "#c5221f", "#b06000"];

  function renderPanel(s) {
    $("search-input").value = s.name;
    $("p-name").textContent = s.name;
    renderHero(s);

    const rating = $("p-rating");
    rating.textContent = "?.?";
    rating.className = "rating-num hidden-rating";
    $("p-stars").replaceWith(Object.assign(starsEl(0, { hidden: true }), { id: "p-stars" }));
    $("p-votes").textContent = `(${s.votes.toLocaleString("en-IN")})`;

    const meta = [];
    if (s.cost) meta.push("₹".repeat(s.cost < 400 ? 1 : s.cost < 900 ? 2 : s.cost < 1800 ? 3 : 4));
    if (s.type) meta.push(s.type);
    $("p-meta").textContent = meta.join(" · ");

    const info = $("p-info");
    info.replaceChildren(
      infoRow("pin", s.address, s.location + (s.area && s.area !== s.location ? ` · listed in ${s.area}` : "")),
      infoRow("food", s.cuisines || "Cuisine not listed"),
      infoRow("money", s.cost ? `₹${s.cost.toLocaleString("en-IN")} for two` : "Price not listed", "Approximate cost"),
      infoRow("moped", s.online ? "Online ordering available" : "No online ordering"),
      infoRow("cal", s.booking ? "Table booking available" : "No table booking"),
      infoRow("tag", `Listed under “${s.listed}”`)
    );

    const dishes = $("p-dishes");
    dishes.replaceChildren(...s.dishes.map((d) => el("span", { class: "chip" }, d)));
    $("dishes-block").hidden = !s.dishes.length;

    // Histogram of every review score on the listing (same info TabPFN sees).
    const sum = $("p-summary");
    sum.replaceChildren();
    const hist = s.hist || [0, 0, 0, 0, 0];
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) {
      sum.append(el("div", { class: "empty" }, "No scored reviews on this listing."));
    } else {
      for (let star = 5; star >= 1; star--) {
        const row = el("div", { class: "bar-row" });
        const bar = el("div", { class: "bar" });
        const fill = el("i");
        fill.style.width = `${(100 * hist[star - 1]) / total}%`;
        bar.append(fill);
        row.append(el("span", {}, String(star)), bar, el("span", {}, String(hist[star - 1])));
        sum.append(row);
      }
      sum.append(el("div", { class: "summary-note" }, `${total} scored reviews on the listing`));
    }

    const menu = $("p-menu");
    menu.replaceChildren(...s.menu.map((m) => el("li", {}, m)));
    if (!s.menu.length) menu.replaceChildren(el("li", { class: "empty" }, "Menu not available"));

    const revs = $("p-reviews");
    revs.replaceChildren();
    if (!s.reviews.length) revs.append(el("div", { class: "review empty" }, "No written reviews."));
    s.reviews.forEach((rv, i) => {
      const box = el("div", { class: "review" });
      const head = el("div", { class: "review-head" });
      const av = el("div", { class: "avatar" }, String.fromCharCode(65 + ((s.id + i * 7) % 26)));
      av.style.background = AVATAR_COLORS[(s.id + i) % AVATAR_COLORS.length];
      const who = el("div");
      who.append(el("div", { class: "review-name" }, `Zomato diner ${i + 1}`), el("div", { class: "review-sub" }, "Review from the listing"));
      head.append(av, who);
      box.append(head);
      if (rv.stars != null) box.append(starsEl(rv.stars));
      box.append(el("div", { class: "review-text" }, rv.text));
      revs.append(box);
    });

    setTab("overview");
    $("panel-scroll").scrollTop = 0;
  }

  function setTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".tab-body").forEach((b) => (b.hidden = b.dataset.body !== name));
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));

  // --------------------------------------------------------------------- map
  const W = 2400, H = 1600, CX = W / 2, CY = H / 2;
  const MAJOR_ROADS = ["100 Feet Rd", "80 Feet Rd", "Outer Ring Rd", "Hosur Rd", "Old Airport Rd", "Bannerghatta Rd",
    "Sarjapur Rd", "Double Rd", "Residency Rd", "Infantry Rd", "Church St", "CMH Rd", "Brigade Rd", "Kanakapura Rd"];
  const LANDMARKS = [["Metro Station", "#1a73e8", "M"], ["Bus Stop", "#1a73e8", "B"], ["ATM", "#5f6368", "₹"],
    ["Temple", "#e8710a", "T"], ["Hospital", "#d93025", "H"], ["Pharmacy", "#d93025", "+"], ["Supermarket", "#1a73e8", "S"],
    ["Petrol Bunk", "#5f6368", "P"], ["School", "#8d6e63", "S"], ["Gym", "#1a73e8", "G"]];
  const PARKS = ["Park", "Gardens", "Playground", "Lake Park"];
  const ALL_LOCATIONS = [...new Set(SAMPLES.map((s) => s.location))];
  const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

  let view = { x: 0, y: 0, w: 1400, h: 900 };
  const mapEl = $("map");

  function blob(r, cx, cy, rad, pts = 9) {
    const p = [];
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = rad * (0.7 + r() * 0.5);
      p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.75]);
    }
    let d = "";
    for (let i = 0; i < pts; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % pts];
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      d += i === 0 ? `M${mx},${my}` : "";
      const [x2, y2] = p[(i + 2) % pts];
      d += ` Q${x1},${y1} ${(x1 + x2) / 2},${(y1 + y2) / 2}`;
    }
    return d + "Z";
  }

  function renderMap(s) {
    const r = rng(s.id * 13 + 1);
    mapEl.replaceChildren();
    const defs = svg("defs");
    mapEl.append(defs);
    mapEl.append(svg("rect", { x: -W, y: -H, width: W * 3, height: H * 3, fill: "#f5f3ef" }));

    const gWater = svg("g"), gPark = svg("g"), gBld = svg("g"), gMinorC = svg("g"), gMinor = svg("g"),
      gMajorC = svg("g"), gMajor = svg("g"), gLabels = svg("g"), gPoi = svg("g"), gPin = svg("g");
    mapEl.append(gWater, gPark, gBld, gMinorC, gMinor, gMajorC, gMajor, gLabels, gPoi, gPin);

    // Street grid: slightly rotated, jittered.
    const angle = (r() - 0.5) * 24;
    const grid = svg("g", { transform: `rotate(${angle} ${CX} ${CY})` });
    const gridC = svg("g", { transform: `rotate(${angle} ${CX} ${CY})` });
    const gridB = svg("g", { transform: `rotate(${angle} ${CX} ${CY})` });
    gMinor.append(grid); gMinorC.append(gridC); gBld.append(gridB);
    const xs = [], ys = [];
    for (let x = -600 + r() * 120; x < W + 600; x += 150 + r() * 90) xs.push(x);
    for (let y = -600 + r() * 120; y < H + 600; y += 130 + r() * 80) ys.push(y);
    const road = (d, g, gc, wd) => {
      gc.append(svg("path", { d, stroke: "#dcd8d0", "stroke-width": wd + 3, fill: "none", "stroke-linecap": "round" }));
      g.append(svg("path", { d, stroke: "#ffffff", "stroke-width": wd, fill: "none", "stroke-linecap": "round" }));
    };
    xs.forEach((x) => road(`M${x},${-600} L${x + (r() - 0.5) * 40},${H + 600}`, grid, gridC, 11));
    ys.forEach((y) => road(`M${-600},${y} L${W + 600},${y + (r() - 0.5) * 40}`, grid, gridC, 11));
    // Buildings inside blocks.
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) {
        const bx = xs[i] + 14, by = ys[j] + 14, bw = xs[i + 1] - xs[i] - 28, bh = ys[j + 1] - ys[j] - 28;
        if (bw < 30 || bh < 30) continue;
        const n = 2 + Math.floor(r() * 4);
        for (let k = 0; k < n; k++) {
          const w = bw * (0.2 + r() * 0.35), h = bh * (0.25 + r() * 0.35);
          gridB.append(svg("rect", { x: bx + r() * (bw - w), y: by + r() * (bh - h), width: w, height: h, rx: 3, fill: "#e9e6df" }));
        }
      }
    }
    // Bangalore-style cross / main labels.
    const baseMain = 1 + Math.floor(r() * 15), baseCross = 1 + Math.floor(r() * 15);
    xs.forEach((x, i) => {
      if (i % 2) return;
      grid.append(svg("text", { x: x + 5, y: CY - 200 + r() * 400, transform: `rotate(90 ${x + 5} ${CY})`, "font-size": 13, fill: "#80868b", "text-anchor": "middle" }, `${ordinal(baseMain + i)} Main Rd`));
    });
    ys.forEach((y, j) => {
      if (j % 2) return;
      grid.append(svg("text", { x: CX - 300 + r() * 600, y: y + 4, "font-size": 13, fill: "#80868b", "text-anchor": "middle" }, `${ordinal(baseCross + j)} Cross Rd`));
    });

    // Water: lake in one corner.
    const corner = [[260, 240], [W - 260, 260], [280, H - 240], [W - 280, H - 260]][Math.floor(r() * 4)];
    const lakeName = pick(r, ALL_LOCATIONS) + " Lake";
    gWater.append(svg("path", { d: blob(r, corner[0], corner[1], 260 + r() * 120, 11), fill: "#aadaff" }));
    gLabels.append(svg("text", { x: corner[0], y: corner[1], "font-size": 18, "font-style": "italic", fill: "#4a90c2", "text-anchor": "middle" }, lakeName));

    // Parks.
    for (let i = 0; i < 3; i++) {
      let px, py;
      do { px = 200 + r() * (W - 400); py = 200 + r() * (H - 400); } while (Math.hypot(px - CX, py - CY) < 320);
      const rad = 90 + r() * 90;
      gPark.append(svg("path", { d: blob(r, px, py, rad), fill: "#c8e6c9" }));
      gLabels.append(svg("text", { x: px, y: py + 5, "font-size": 14, fill: "#2e7d32", "text-anchor": "middle" }, `${pick(r, ALL_LOCATIONS)} ${pick(r, PARKS)}`));
    }

    // Major roads (yellow, curved) with labels along the path.
    for (let i = 0; i < 2; i++) {
      const horiz = i === 0;
      const off = (r() - 0.5) * 500;
      const d = horiz
        ? `M${-600},${CY + off - 140} C${W * 0.3},${CY + off - 260 - r() * 200} ${W * 0.7},${CY + off + r() * 200} ${W + 600},${CY + off - 60}`
        : `M${CX + off + 160},${-600} C${CX + off - 200 * r()},${H * 0.3} ${CX + off + 300 * r()},${H * 0.7} ${CX + off - 100},${H + 600}`;
      const id = `road${s.id}_${i}`;
      defs.append(svg("path", { id, d }));
      gMajorC.append(svg("path", { d, stroke: "#f2c14e", "stroke-width": 26, fill: "none" }));
      gMajor.append(svg("path", { d, stroke: "#fde293", "stroke-width": 22, fill: "none" }));
      const t = svg("text", { "font-size": 14, fill: "#6b5a1e", "font-weight": 500, dy: 5 });
      const tp = svg("textPath", { href: `#${id}`, startOffset: "38%" }, pick(r, MAJOR_ROADS));
      t.append(tp);
      gLabels.append(t);
    }

    // Neighbourhood label.
    const hood = svg("text", {
      x: CX + (r() > 0.5 ? 1 : -1) * (320 + r() * 200), y: CY - 250 - r() * 120,
      "font-size": 26, "letter-spacing": 6, fill: "#9aa0a6", "font-weight": 500, "text-anchor": "middle",
    }, (s.location || "").toUpperCase());
    gLabels.append(hood);

    // Neighbouring restaurants and landmarks.
    const others = shuffle(SAMPLES.filter((o) => o.id !== s.id), r).slice(0, 9);
    const placed = [[CX, CY]];
    const spot = (minD) => {
      for (let tries = 0; tries < 60; tries++) {
        const p = [CX + (r() - 0.5) * 1500, CY + (r() - 0.5) * 900];
        if (placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > minD)) { placed.push(p); return p; }
      }
      return null;
    };
    others.forEach((o) => {
      const p = spot(170);
      if (!p) return;
      const g = svg("g", { transform: `translate(${p[0]},${p[1]})` });
      g.append(svg("circle", { r: 11, fill: "#f57c00", stroke: "#fff", "stroke-width": 2 }));
      g.append(svg("path", { d: "M-3,-6 v5 M-5,-6 v4 a2,2 0 0 0 4,0 v-4 M-3,-1 v7 M3,-6 c2,0 2,5 0,6 v6", stroke: "#fff", "stroke-width": 1.4, fill: "none", "stroke-linecap": "round" }));
      g.append(svg("text", { x: 16, y: 5, "font-size": 13, fill: "#b06000", "font-weight": 500, stroke: "#f5f3ef", "stroke-width": 3, "paint-order": "stroke" }, o.name));
      gPoi.append(g);
    });
    for (let i = 0; i < 5; i++) {
      const p = spot(170);
      if (!p) continue;
      const [label, color, glyph] = pick(r, LANDMARKS);
      const g = svg("g", { transform: `translate(${p[0]},${p[1]})` });
      g.append(svg("circle", { r: 10, fill: color, stroke: "#fff", "stroke-width": 2 }));
      g.append(svg("text", { y: 4, "font-size": 11, fill: "#fff", "font-weight": 700, "text-anchor": "middle" }, glyph));
      g.append(svg("text", { x: 15, y: 4, "font-size": 12, fill: "#5f6368", stroke: "#f5f3ef", "stroke-width": 3, "paint-order": "stroke" }, label));
      gPoi.append(g);
    }

    // The restaurant pin.
    const pin = svg("g", { class: "pin-drop", transform: `translate(${CX},${CY})` });
    pin.append(svg("ellipse", { cx: 0, cy: 2, rx: 9, ry: 3.5, fill: "rgba(0,0,0,.25)" }));
    pin.append(svg("path", { d: "M0,0 C-4,-14 -17,-22 -17,-36 A17,17 0 1 1 17,-36 C17,-22 4,-14 0,0Z", fill: "#ea4335", stroke: "#b31412", "stroke-width": 1.5 }));
    pin.append(svg("circle", { cx: 0, cy: -36, r: 6.5, fill: "#b31412" }));
    pin.append(svg("text", { x: 24, y: -30, "font-size": 17, "font-weight": 700, fill: "#c5221f", stroke: "#fff", "stroke-width": 4, "paint-order": "stroke" }, s.name));
    gPin.append(pin);

    resetView();
  }

  function applyView() {
    mapEl.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  }
  function resetView() {
    const rect = mapEl.getBoundingClientRect();
    const aspect = rect.width && rect.height ? rect.width / rect.height : 1.5;
    view.w = Math.max(900, Math.min(1500, rect.width * 1.4 || 1400));
    view.h = view.w / aspect;
    view.x = CX - view.w / 2;
    view.y = CY - view.h * 0.38; // pin sits above the guess card
    applyView();
  }
  function zoom(f, cx = view.x + view.w / 2, cy = view.y + view.h / 2) {
    const nw = Math.max(400, Math.min(3200, view.w * f));
    const k = nw / view.w;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.w = nw;
    view.h *= k;
    applyView();
  }
  $("zoom-in").addEventListener("click", () => zoom(0.8));
  $("zoom-out").addEventListener("click", () => zoom(1.25));
  mapEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    const cx = view.x + ((e.clientX - rect.left) / rect.width) * view.w;
    const cy = view.y + ((e.clientY - rect.top) / rect.height) * view.h;
    zoom(e.deltaY > 0 ? 1.1 : 0.9, cx, cy);
  }, { passive: false });
  let drag = null;
  mapEl.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    mapEl.setPointerCapture(e.pointerId);
    mapEl.classList.add("dragging");
  });
  mapEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const rect = mapEl.getBoundingClientRect();
    view.x = drag.vx - ((e.clientX - drag.x) / rect.width) * view.w;
    view.y = drag.vy - ((e.clientY - drag.y) / rect.height) * view.h;
    applyView();
  });
  const endDrag = () => { drag = null; mapEl.classList.remove("dragging"); };
  mapEl.addEventListener("pointerup", endDrag);
  mapEl.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", () => { const cx = view.x + view.w / 2; resetView(); view.x = cx - view.w / 2; applyView(); });

  // ------------------------------------------------------------------ guess
  const range = $("guess-range");
  function setGuess(v) {
    v = Math.round(Math.max(1, Math.min(5, v)) * 10) / 10;
    state.guess = v;
    range.value = v;
    $("guess-num").textContent = v.toFixed(1);
    const gs = $("guess-stars");
    gs.replaceChildren(starsEl(v));
  }
  range.addEventListener("input", () => setGuess(parseFloat(range.value)));

  function submit() {
    if (state.revealed) return;
    const s = current();
    state.results.push({ id: s.id, guess: state.guess, bot: s.tabpfn, rate: s.rate });
    state.revealed = true;
    save();
    showReveal();
    renderScores();
  }

  function next() {
    if (!state.revealed) return;
    state.idx += 1;
    if (state.idx >= state.order.length) { state.order = shuffle(state.order); state.idx = 0; }
    state.revealed = false;
    save();
    showRound();
    window.scrollTo(0, 0);
  }

  function showReveal() {
    const s = current();
    const res = state.results[state.results.length - 1];
    const eu = Math.abs(res.guess - res.rate), eb = Math.abs(res.bot - res.rate);

    $("guess-view").hidden = true;
    $("reveal-view").hidden = false;

    const rating = $("p-rating");
    rating.textContent = s.rate.toFixed(1);
    rating.className = "rating-num revealed";
    $("p-stars").replaceWith(Object.assign(starsEl(s.rate), { id: "p-stars" }));

    const v = $("verdict");
    const d = eu - eb;
    if (Math.abs(d) < 1e-9) { v.textContent = "It's a tie!"; v.className = "verdict tie"; }
    else if (d < 0) { v.textContent = "You beat TabPFN! 🎉"; v.className = "verdict win"; }
    else { v.textContent = "TabPFN wins this one"; v.className = "verdict lose"; }

    $("rv-you").textContent = res.guess.toFixed(1);
    $("rv-true").textContent = res.rate.toFixed(1);
    $("rv-bot").textContent = res.bot.toFixed(2);
    // Closer prediction is highlighted; ties get no highlight.
    const yu = $("rv-you-err"), bo = $("rv-bot-err");
    yu.textContent = `off by ${eu.toFixed(2)}`; yu.className = "rv-err" + (d < -1e-9 ? " hit" : d > 1e-9 ? " miss" : "");
    bo.textContent = `off by ${eb.toFixed(2)}`; bo.className = "rv-err" + (d > 1e-9 ? " hit" : d < -1e-9 ? " miss" : "");

    // Number line with the three markers.
    const sc = $("reveal-scale");
    sc.replaceChildren(el("div", { class: "track" }));
    const pos = (x) => `${((x - 1) / 4) * 100}%`;
    for (let t = 1; t <= 5; t++) { const tk = el("span", { class: "tick" }, t.toFixed(1)); tk.style.left = pos(t); sc.append(tk); }
    [["truth", res.rate, "Actual"], ["you", res.guess, "You"], ["bot", res.bot, "TabPFN"]].forEach(([cls, x, title]) => {
      const m = el("span", { class: "mark " + cls, title: `${title}: ${x.toFixed(2)}` });
      m.style.left = "50%";
      sc.append(m);
      requestAnimationFrame(() => requestAnimationFrame(() => (m.style.left = pos(x))));
    });
    $("next-btn").focus();
  }

  function renderScores() {
    const R = state.results;
    const n = R.length;
    const mae = (k) => (n ? (R.reduce((a, r) => a + Math.abs(r[k] - r.rate), 0) / n).toFixed(2) : "–");
    const rmse = (k) => (n ? Math.sqrt(R.reduce((a, r) => a + (r[k] - r.rate) ** 2, 0) / n).toFixed(2) : "–");
    let wy = 0, wb = 0;
    const hist = $("history");
    hist.replaceChildren();
    R.forEach((r) => {
      const d = Math.abs(r.guess - r.rate) - Math.abs(r.bot - r.rate);
      const c = Math.abs(d) < 1e-9 ? "t" : d < 0 ? "w" : "l";
      if (c === "w") wy++; else if (c === "l") wb++;
      hist.append(el("span", { class: c, title: `${BY_ID.get(r.id)?.name}: you ${r.guess.toFixed(1)}, TabPFN ${r.bot.toFixed(2)}, actual ${r.rate.toFixed(1)}` }));
    });
    // Keep the history strip short.
    while (hist.children.length > 40) hist.firstChild.remove();
    $("you-mae").textContent = mae("guess");
    $("bot-mae").textContent = mae("bot");
    $("you-rmse").textContent = rmse("guess");
    $("bot-rmse").textContent = rmse("bot");
    $("you-wins").textContent = wy;
    $("bot-wins").textContent = wb;
    $("round-no").textContent = n + (state.revealed ? 0 : 1);
  }

  function showRound() {
    const s = current();
    renderPanel(s);
    renderMap(s);
    if (state.revealed) {
      showReveal();
    } else {
      $("guess-view").hidden = false;
      $("reveal-view").hidden = true;
      setGuess(state.guess ?? 3.7);
      range.focus({ preventScroll: true });
    }
    renderScores();
  }

  $("submit-btn").addEventListener("click", submit);
  $("next-btn").addEventListener("click", next);
  document.addEventListener("keydown", (e) => {
    if ($("how").open) return;
    if (e.key === "Enter") { e.preventDefault(); state.revealed ? next() : submit(); }
    else if (!state.revealed && document.activeElement !== range) {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setGuess(state.guess + 0.1); }
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setGuess(state.guess - 0.1); }
    }
  });

  // ----------------------------------------------------------- reset + help
  const resetBtn = $("reset-btn");
  let resetArmed = null;
  resetBtn.addEventListener("click", () => {
    if (!resetArmed) {
      resetBtn.textContent = "Click again to reset";
      resetArmed = setTimeout(() => { resetBtn.textContent = "Reset"; resetArmed = null; }, 2500);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null; resetBtn.textContent = "Reset";
    state = fresh(); save(); showRound();
  });

  const how = $("how");
  $("how-btn").addEventListener("click", () => how.showModal());
  $("model-name").textContent = DATA.model.replace(/\s*\(.*\)/, "");
  $("how-ntrain").textContent = DATA.metrics.nTrain.toLocaleString("en-US");
  const m = DATA.metrics;
  $("how-model").textContent =
    `Model: ${DATA.model}. On all ${m.nTest.toLocaleString("en-US")} held-out test listings it scored ` +
    `R² ${m.r2.toFixed(3)}, RMSE ${m.rmse.toFixed(3)}, and MAE ${m.mae.toFixed(3)}.`;

  showRound();
  if (!state.results.length) how.showModal();
})();
