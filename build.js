/**
 * Watchly — مولّد موقع ثابت (Static Site Generator) من غير أي مكتبات.
 *
 * بيقرا:   content/site.json        (إعدادات الموقع)
 *          content/works/*.json     (كل فيلم أو مسلسل في ملف)
 * وبيطلّع: dist/                    (الموقع الجاهز للرفع)
 *
 * التشغيل: node build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content/site.json"), "utf8"));
const BASE = (process.env.SITE_URL || site.url || "").replace(/\/$/, "");
const NOW = new Date().toISOString().slice(0, 10);
const EXTRA_HOSTS = (site.video_hosts || []).map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter(Boolean);

/* ================= أدوات مساعدة ================= */

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paras = (s) =>
  String(s ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
const slugify = (s) =>
  String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\u0600-\u06FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const typeLabel = (t) => (t === "series" ? "مسلسل" : "فيلم");
const ORD = ["", "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة"];
const POSTER_FALLBACK = "/assets/poster.svg";

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name), d = path.join(dest, f.name);
    f.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

/** بيحوّل أي رابط فيديو لرابط embed. لو اتلصق كود <iframe> كامل بياخد الـ src منه */
function toEmbed(url) {
  let u = String(url || "").trim();
  const src = u.match(/src\s*=\s*["']([^"']+)["']/i);
  if (src) u = src[1];
  if (u.startsWith("//")) u = "https:" + u;
  let m;
  if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/)))
    return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
  if ((m = u.match(/archive\.org\/(?:details|embed)\/([^/?#]+)/))) return `https://archive.org/embed/${m[1]}`;
  if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return `https://player.vimeo.com/video/${m[1]}`;
  if ((m = u.match(/dailymotion\.com\/video\/([a-z0-9]+)/i))) return `https://geo.dailymotion.com/player.html?video=${m[1]}`;
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

/** بيحوّل قايمة روابط فيديو لروابط embed ويشيل اللي مش مسموح */
function cleanVideos(list, where, defName = "فيديو") {
  return (list || [])
    .filter((v) => v && v.url)
    .map((v, i) => {
      const embed = toEmbed(v.url);
      if (!embed) warnings.push(`⚠️ "${where}": الرابط ${v.url} مش رابط صحيح واتشال (لازم يبدأ بـ https://).`);
      return { title: v.title || `${defName} ${i + 1}`, embed };
    })
    .filter((v) => v.embed);
}

/** المشغل + أزرار السيرفرات */
function playerHtml(videos, poster, label = "الفيديوهات") {
  if (!videos.length) return "";
  return `<div class="player">
  <div class="servers"><h3>${esc(label)}</h3>${videos.map((v) => `<button class="srv" data-src="${esc(v.embed)}">${esc(v.title)}</button>`).join("")}</div>
  <div class="screen"><button class="play" style="background-image:url('${esc(poster)}')" aria-label="تشغيل"><span>▶</span></button></div>
</div>`;
}

/** اسم السيرفر من الدومين لو مالوش اسم: streamtape.com → Streamtape */
function hostName(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").split(".");
    const n = h.length > 1 ? h[h.length - 2] : h[0];
    return n.charAt(0).toUpperCase() + n.slice(1);
  } catch { return ""; }
}

/** روابط التحميل */
function cleanDownloads(list, where) {
  return (list || [])
    .filter((d) => d && d.url)
    .map((d) => {
      const u = String(d.url).trim();
      if (!/^https?:\/\/[^\s"'<>]+$/i.test(u)) {
        warnings.push(`⚠️ "${where}": رابط التحميل ${u} مش صحيح واتشال (لازم يبدأ بـ https://).`);
        return null;
      }
      return { name: d.title || hostName(u), quality: d.quality || "", size: d.size || "", url: u };
    })
    .filter(Boolean);
}

/** صفحة المشاهدة: السيرفرات عمود على الجنب والمشغل جنبه */
function playerSide(videos, poster) {
  if (!videos.length) return "";
  return `<div class="player side">
  <div class="servers"><h3>سيرفرات المشاهدة</h3>${videos.map((v) => `<button class="srv" data-src="${esc(v.embed)}">${esc(v.title)}</button>`).join("")}</div>
  <div class="screen"><button class="play" style="background-image:url('${esc(poster)}')" aria-label="تشغيل"><span>▶</span></button></div>
</div>`;
}

/** مشغل عريض والسيرفرات أزرار فوقه (شكل صفحات المشاهدة) */
function playerWide(videos, poster) {
  if (!videos.length) return "";
  return `<div class="player wide">
  <div class="servers">${videos.map((v) => `<button class="srv" data-src="${esc(v.embed)}">${esc(v.title)}</button>`).join("")}</div>
  <div class="screen"><button class="play" style="background-image:url('${esc(poster)}')" aria-label="تشغيل"><span>▶</span></button></div>
</div>`;
}

/** شبكة الحلقات متقسمة مواسم */
/**
 * إضافة سيرفرات/تحميل لحلقات كتير مرة واحدة من خانة نص:
 *   5 | https://... | https://...      ← الحلقة 5
 *   2-5 | https://...                   ← الموسم 2 الحلقة 5
 */
function mergeBulk(episodes, text, key) {
  for (const raw of String(text || "").split(/\r?\n/)) {
    const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const m = parts[0].match(/^(?:(\d+)\s*[-x×]\s*)?(\d+)$/i);
    if (!m) continue;
    const season = m[1] ? Number(m[1]) : 1, number = Number(m[2]);
    let ep = episodes.find((e) => (Number(e.season) || 1) === season && Number(e.number) === number);
    if (!ep) { ep = { season, number, summary: "", title: "" }; episodes.push(ep); }
    ep[key] = [...(ep[key] || []), ...parts.slice(1).filter((u) => /^https?:\/\//.test(u)).map((url) => ({ title: "", url }))];
  }
  return episodes;
}

function epGrid(w, current) {
  const seasons = [...new Set(w.episodes.map((e) => e.season))];
  if (!seasons.length && Number(w.episodes_count) > 0) seasons.push(1);
  const multi = seasons.length > 1;
  return `<div class="seasons">${seasons
    .map(
      (sn) => `${multi ? `<h3 class="season-h">الموسم ${esc(sn)}</h3>` : ""}<div class="epgrid">${w.episodes
        .filter((e) => e.season === sn)
        .map(
          (e) => `<a class="ep${e === current ? " on" : ""}" href="${e.href}"><small>الحلقة</small><b>${esc(e.number)}</b>${
            e.servers.length ? '<i title="متاحة للمشاهدة">▶</i>' : ""
          }</a>`
        )
        .join("")}${
        sn === 1 && Number(w.episodes_count) > 0
          ? Array.from({ length: Math.max(0, Number(w.episodes_count) - Math.max(0, ...w.episodes.filter((e) => e.season === 1).map((e) => Number(e.number) || 0))) }, (_, i) =>
              `<span class="ep soon"><small>الحلقة</small><b>${Math.max(0, ...w.episodes.filter((e) => e.season === 1).map((e) => Number(e.number) || 0)) + i + 1}</b><i>قريبًا</i></span>`
            ).join("")
          : ""
      }</div>`
    )
    .join("")}</div>`;
}

/** صفحة التحميل */
function downloadPage({ title, back, backLabel, crumbItems, downloads, canonical, image }) {
  const c = crumbs(crumbItems);
  const body = `<section class="wrap page narrow">
  ${c.html}
  <h1>تحميل ${esc(title)}</h1>
  <p class="muted"><a class="y" href="${back}">← ${esc(backLabel)}</a></p>
  ${site.ads?.in_page ? `<div class="ad">${site.ads.in_page}</div>` : ""}
  <div class="dls">${downloads
    .map(
      (d) => `<a class="dl" href="${esc(d.url)}" target="_blank" rel="nofollow noopener">
      <span class="dl-ico">⬇</span>
      <span class="dl-name">${esc(d.name)}</span>
      ${d.quality ? `<span class="dl-tag">${esc(d.quality)}</span>` : ""}
      ${d.size ? `<span class="dl-size">${esc(d.size)}</span>` : ""}
      <span class="dl-go">تحميل</span>
    </a>`
    )
    .join("")}</div>
</section>`;
  return layout({ title: `تحميل ${title}`, description: `روابط تحميل ${title}`, canonical, body, image, noindex: true, jsonld: [c.ld] });
}

/* ================= قراءة المحتوى ================= */

const warnings = [];
const works = fs
  .readdirSync(path.join(ROOT, "content/works"))
  .filter((f) => !f.startsWith("."))
  .map((f) => {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(ROOT, "content/works", f), "utf8"));
      w._file = f;
      return w;
    } catch (e) {
      warnings.push(`⚠️ الملف ${f} فيه خطأ ومش هيتنشر: ${e.message}`);
      return null;
    }
  })
  .filter((w) => w && w.status !== "draft" && w.title)
  .map((w) => {
    w.type = w.type === "series" ? "series" : "movie";
    w.slug = slugify(w.slug) || slugify(`${w.original_title || w.title}-${w.year || ""}`);
    w.genres = (w.genres || []).map((g) => String(g).trim()).filter(Boolean);
    w.lists = (w.lists || []).map((g) => String(g).trim()).filter(Boolean);
    w.cast = (w.cast || []).filter((c) => c && c.name);
    w.platforms = (w.platforms || []).filter((p) => p && p.name && p.url);
    w.episodes = mergeBulk(mergeBulk([...(w.episodes || [])], w.servers_bulk, "servers"), w.downloads_bulk, "downloads");
    w.episodes = w.episodes.filter((e) => e && (e.summary || e.title || (e.servers && e.servers.length) || (e.downloads && e.downloads.length))).sort((a, b) => (a.number || 0) - (b.number || 0));
    w.videos = cleanVideos(w.videos, w.title, "سيرفر").map((v) => ({ ...v, title: /^سيرفر \d+$/.test(v.title) ? hostName(v.embed) || v.title : v.title }));
    w.trailerEmbed = w.trailer ? toEmbed(w.trailer) : null;
    w.href = `/work/${w.slug}/`;
    w.downloads = cleanDownloads(w.downloads, w.title);
    w.episodes = w.episodes
      .filter((e) => e.number !== undefined && e.number !== null && e.number !== "")
      .map((e) => {
        const season = Number(e.season) || 1;
        const tag = `${w.title} — ${season > 1 ? `الموسم ${season} ` : ""}الحلقة ${e.number}`;
        return {
          ...e,
          season,
          label: `${season > 1 ? `الموسم ${season} ` : ""}الحلقة ${e.number}`,
          servers: cleanVideos(e.servers, tag, "سيرفر").map((v) => ({ ...v, title: /^سيرفر \d+$/.test(v.title) ? hostName(v.embed) || v.title : v.title })),
          downloads: cleanDownloads(e.downloads, tag),
        };
      })
      .sort((a, b) => a.season - b.season || Number(a.number) - Number(b.number));
    w.posterUrl = w.poster || POSTER_FALLBACK;
    return w;
  })
  .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

// منع تكرار الروابط
const seen = new Set();
for (const w of works) {
  let s = w.slug, i = 2;
  while (seen.has(s)) s = `${w.slug}-${i++}`;
  seen.add(s);
  if (s !== w.slug) { w.slug = s; w.href = `/work/${s}/`; }
}
for (const w of works) {
  for (const e of w.episodes) {
    e.href = `${w.href}${e.season > 1 ? `season/${e.season}/` : ""}episode/${e.number}/`;
    e.dlHref = `${e.href}download/`;
  }
  w.dlHref = `${w.href}download/`;
  w.watchHref = `${w.href}watch/`;
  w.firstEp = w.episodes.find((e) => e.servers.length) || w.episodes[0];
}

const series = works.filter((w) => w.type === "series");
const movies = works.filter((w) => w.type === "movie");
const genres = [...new Set(works.flatMap((w) => w.genres))].sort((a, b) => a.localeCompare(b, "ar"));
const genreHref = (g) => `/genre/${slugify(g)}/`;
const lists = [...new Set(works.flatMap((w) => w.lists))];
const listHref = (l) => `/list/${slugify(l)}/`;
const homeLists = (site.home_lists || []).map((l) => String(l).trim()).filter((l) => lists.includes(l));

/* ================= القالب العام ================= */

function layout({ title, description, canonical, body, image, jsonld = [], noindex = false, fullTitle = false }) {
  const t = fullTitle ? title : `${title} | ${site.name}`;
  const url = BASE + (canonical || "/");
  const img = image ? (image.startsWith("http") ? image : BASE + image) : "";
  const social = Object.entries(site.social || {}).filter(([, v]) => v);
  const logoHtml = site.logo
    ? `<a class="logo" href="/"><img src="${esc(site.logo)}" alt="${esc(site.name)}"></a>`
    : `<a class="logo" href="/" dir="ltr">Watch<span>ly</span></a>`;
  const ogImg = img || (site.cover ? (site.cover.startsWith("http") ? site.cover : BASE + site.cover) : "");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title>
<meta name="description" content="${esc(description || site.description)}">
<link rel="canonical" href="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">'}
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:locale" content="ar_AR">
<meta property="og:title" content="${esc(t)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:url" content="${esc(url)}">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0b0b">
<link rel="icon" href="${esc(site.favicon || "/assets/icon.svg")}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
${site.ads?.head || ""}
</head>
<body>
<header class="hdr" id="hdr">
  <div class="wrap hdr-in">
    <button class="burger" id="burger" aria-label="القائمة">☰</button>
    ${logoHtml}
    <nav class="nav" id="nav">
      <a href="/">الرئيسية</a>
      <a href="/series/">المسلسلات</a>
      <a href="/movies/">الأفلام</a>
      <a href="/genres/">التصنيفات</a>
      ${lists.length ? '<a href="/lists/">القوائم</a>' : ""}
      <a href="/free/">مجانًا</a>
    </nav>
    <a class="search-btn" href="/search/" aria-label="بحث">🔍 <span>ابحث</span></a>
  </div>
</header>
<main>
${body}
</main>
<footer class="ftr">
  <div class="wrap ftr-in">
    <div>
      ${logoHtml}
      <p>${esc(site.tagline)}</p>
      ${social.length ? `<p class="social">${social.map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(k)}</a>`).join(" · ")}</p>` : ""}
    </div>
    <div class="ftr-links">
      <a href="/about/">من نحن</a>
      <a href="/privacy/">سياسة الخصوصية</a>
      <a href="/contact/">اتصل بنا</a>
      <a href="/dmca/">حقوق النشر (DMCA)</a>
      <a href="/sitemap.xml">خريطة الموقع</a>
    </div>
    <p class="muted small">لو عندك أي ملاحظة على محتوى في الموقع، تواصل معانا من <a href="/dmca/">صفحة حقوق النشر</a>.<br>© ${new Date().getFullYear()} ${esc(site.name)}</p>
  </div>
</footer>
<script>window.WL_HOSTS=${JSON.stringify(EXTRA_HOSTS).replace(/</g, "\\u003c")};</script>
<script src="/assets/app.js" defer></script>
${site.ads?.body_end || ""}
</body>
</html>`;
}

const crumbs = (items) => {
  const all = [{ name: "الرئيسية", href: "/" }, ...items];
  return {
    html: `<nav class="crumbs">${all
      .map((c, i) => (c.href && i < all.length - 1 ? `<a href="${esc(c.href)}">${esc(c.name)}</a>` : `<span>${esc(c.name)}</span>`))
      .join('<i>‹</i>')}</nav>`,
    ld: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: all.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, ...(c.href ? { item: BASE + c.href } : {}) })),
    },
  };
};

const card = (w) => `
<a class="card" href="${w.href}" title="${esc(w.title)}">
  <div class="card-img">
    <img src="${esc(w.posterUrl)}" alt="${esc(typeLabel(w.type) + " " + w.title)}" loading="lazy" onerror="this.onerror=null;this.src='/assets/poster.svg'">
    ${w.rating ? `<span class="badge-rate">★ ${esc(w.rating)}</span>` : ""}
    <span class="badge-type">${typeLabel(w.type)}</span>
    ${w.platforms.some((p) => p.access === "مجانًا") ? '<span class="badge-free">مجانًا</span>' : ""}
  </div>
  <h3>${esc(w.title)}</h3>
  <p>${esc(w.year || "")}${w.genres[0] ? " · " + esc(w.genres[0]) : ""}</p>
</a>`;

const grid = (list) => (list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<p class="empty">لسه مفيش أعمال هنا.</p>`);
const rail = (title, list, more) =>
  list.length
    ? `<section class="wrap sec"><div class="sec-h"><h2>${esc(title)}</h2>${more ? `<a href="${more}">عرض الكل ←</a>` : ""}</div><div class="rail">${list.slice(0, 18).map(card).join("")}</div></section>`
    : "";

/* ================= الصفحات ================= */

function homePage() {
  const hero = works.find((w) => w.featured) || works[0];
  const heroHtml = hero
    ? `<section class="hero${hero.backdrop ? "" : " no-bd"}" style="background-image:url('${esc(hero.backdrop || hero.posterUrl)}')">
  <div class="hero-fade"></div>
  <div class="wrap hero-in">
    ${hero.backdrop ? "" : `<img class="hero-poster" src="${esc(hero.posterUrl)}" alt="${esc(hero.title)}" onerror="this.onerror=null;this.src='/assets/poster.svg'">`}
    <div>
    <span class="pill">⭐ مختارات Watchly</span>
    <h1>${typeLabel(hero.type)} ${esc(hero.title)}</h1>
    <p class="muted">${esc([hero.year, hero.country, hero.genres.join("، ")].filter(Boolean).join(" · "))}</p>
    <p class="hero-story">${esc(hero.story || "")}</p>
    <div class="btns"><a class="btn" href="${hero.href}">التفاصيل وتتفرج فين</a></div>
    </div>
  </div>
</section>`
    : `<section class="wrap" style="padding-top:110px"><h1>أهلًا في ${esc(site.name)}</h1><p class="muted">ضيفي أول فيلم أو مسلسل من لوحة التحكم.</p></section>`;

  const byGenre = genres
    .map((g) => ({ g, list: works.filter((w) => w.genres.includes(g)) }))
    .filter((x) => x.list.length >= 3)
    .slice(0, 4)
    .map((x) => rail(`${x.g}`, x.list, genreHref(x.g)))
    .join("");

  const body = `${heroHtml}
${homeLists.map((l) => rail(l, works.filter((w) => w.lists.includes(l)), listHref(l))).join("")}
${rail("أحدث الإضافات", works, null)}
${rail("المسلسلات", series, "/series/")}
${rail("الأفلام", movies, "/movies/")}
${rail("تتفرج عليه مجانًا", works.filter((w) => w.platforms.some((p) => p.access === "مجانًا")), "/free/")}
${byGenre}`;

  return layout({
    title: `${site.name} | ${site.name_ar} — ${site.tagline}`,
    fullTitle: true,
    description: site.description,
    canonical: "/",
    body,
    jsonld: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: site.name,
        alternateName: site.name_ar,
        url: BASE + "/",
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${BASE}/search/?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  });
}

function listPage({ title, h1, intro, list, canonical, crumbItems }) {
  const c = crumbs(crumbItems);
  return layout({
    title,
    description: intro,
    canonical,
    body: `<section class="wrap page">${c.html}<h1>${esc(h1)}</h1><p class="muted">${esc(intro)}</p>${grid(list)}</section>`,
    jsonld: [c.ld],
  });
}

function workPage(w) {
  const label = typeLabel(w.type);
  const c = crumbs([{ name: w.type === "series" ? "المسلسلات" : "الأفلام", href: w.type === "series" ? "/series/" : "/movies/" }, { name: w.title }]);
  const seoTitle = `${label} ${w.title}${w.year ? " " + w.year : ""} — القصة والأبطال${w.type === "series" ? " والحلقات" : ""} وتتفرج فين`;
  const desc = (w.story || `${label} ${w.title}`).replace(/\s+/g, " ").slice(0, 155);
  const related = works
    .filter((x) => x !== w && x.genres.some((g) => w.genres.includes(g)))
    .slice(0, 12);

  const meta = [
    w.rating ? `<span class="rate">★ ${esc(w.rating)}</span>` : "",
    `<span>${label}</span>`,
    w.year ? `<span>${esc(w.year)}</span>` : "",
    w.country ? `<span>${esc(w.country)}</span>` : "",
    w.runtime ? `<span>${esc(w.runtime)} دقيقة</span>` : "",
    w.type === "series" && w.episodes_count ? `<span>${esc(w.episodes_count)} حلقة</span>` : "",
  ].join("");

  const where = w.platforms.length
    ? `<h2 class="h">تتفرج على ${label} ${esc(w.title)} فين؟</h2>
<div class="where">${w.platforms
        .map((p) => {
          const cls = p.access === "مجانًا" ? "free" : p.access === "اشتراك" ? "sub" : "";
          return `<a class="plat" href="${esc(p.url)}" target="_blank" rel="nofollow noopener sponsored">${esc(p.name)}<em class="${cls}">${esc(p.access || "")}</em></a>`;
        })
        .join("")}</div>`
    : `<h2 class="h">تتفرج فين؟</h2><p class="muted">لسه مش متاح على المنصات اللي بنتابعها. هنحدّث الصفحة أول ما يتاح.</p>`;

  const player = w.videos.length
    ? `<h2 class="h">${w.videos.length === 1 ? esc(w.videos[0].title) : "الفيديوهات الرسمية"}</h2>${playerHtml(w.videos, w.backdrop || w.posterUrl)}`
    : "";

  const eps =
    w.type === "series" && w.episodes.length
      ? `<h2 class="h">حلقات ${label} ${esc(w.title)}${w.episodes_count ? ` (${esc(w.episodes_count)} حلقات)` : ""}</h2>${epGrid(w)}`
      : "";

  const cast = w.cast.length
    ? `<h2 class="h">طاقم العمل</h2><div class="castgrid">${w.cast
        .map((p) => `<div><b>${esc(p.name)}</b>${p.role ? `<span>${esc(p.role)}</span>` : ""}</div>`)
        .join("")}</div>`
    : "";

  const details = [
    ["الاسم الأصلي", w.original_title],
    ["النوع", label],
    ["التصنيف", w.genres.map((g) => `<a href="${genreHref(g)}">${esc(g)}</a>`).join("، "), true],
    ["تاريخ العرض", w.release_date],
    ["بلد الإنتاج", w.country],
    ["اللغة", w.language],
    ["الإخراج", w.director],
    ["التأليف", w.writer],
  ]
    .filter(([, v]) => v)
    .map(([k, v, raw]) => `<dt>${k}</dt><dd>${raw ? v : esc(v)}</dd>`)
    .join("");

  const ld = {
    "@context": "https://schema.org",
    "@type": w.type === "series" ? "TVSeries" : "Movie",
    name: w.title,
    alternateName: w.original_title || undefined,
    url: BASE + w.href,
    image: w.poster ? (w.poster.startsWith("http") ? w.poster : BASE + w.poster) : undefined,
    description: desc,
    datePublished: w.release_date || (w.year ? String(w.year) : undefined),
    genre: w.genres,
    countryOfOrigin: w.country ? { "@type": "Country", name: w.country } : undefined,
    director: w.director ? { "@type": "Person", name: w.director } : undefined,
    actor: w.cast.slice(0, 8).map((p) => ({ "@type": "Person", name: p.name })),
    ...(w.type === "series" && w.episodes_count ? { numberOfEpisodes: w.episodes_count } : {}),
    ...(w.type === "series" && w.episodes.length
      ? {
          episode: w.episodes.map((e) => ({
            "@type": "TVEpisode",
            episodeNumber: e.number,
            name: e.title || `الحلقة ${e.number}`,
            description: String(e.summary || "").slice(0, 200),
          })),
        }
      : {}),
    ...(w.videos[0] && w.videos[0].embed.includes("youtube")
      ? {
          trailer: {
            "@type": "VideoObject",
            name: `${w.videos[0].title} — ${w.title}`,
            embedUrl: w.videos[0].embed,
            thumbnailUrl: `https://i.ytimg.com/vi/${w.videos[0].embed.split("/embed/")[1].split("?")[0]}/hqdefault.jpg`,
            uploadDate: w.date || NOW,
            description: desc,
          },
        }
      : {}),
  };

  const watchTarget = w.type === "movie" ? (w.videos.length ? w.watchHref : null) : w.firstEp ? w.firstEp.href : null;
  const dlTarget = w.type === "movie" ? (w.downloads.length ? w.dlHref : null) : w.firstEp && w.firstEp.downloads.length ? w.firstEp.dlHref : null;
  const what = w.type === "series" ? "المسلسل" : "الفيلم";
  const facts = [
    ["🏷️", "التصنيف", w.type === "series" ? "مسلسلات" : "أفلام"],
    ["🎭", `نوع ${what}`, w.genres.map((g) => `<a href="${genreHref(g)}">${esc(g)}</a>`).join(" "), true],
    ["⏱️", `مدة ${what}`, w.runtime ? `${esc(w.runtime)} دقيقة` : "", true],
    ["📅", "سنة الإصدار", w.year],
    ["🗣️", "اللغة", w.language],
    ["🎞️", "الجودة", w.quality],
    ["🌍", "الدولة", w.country],
    ["🎬", "الإخراج", w.director],
    ["✍️", "التأليف", w.writer],
    ["📺", "عدد الحلقات", w.type === "series" && w.episodes_count ? w.episodes_count : ""],
  ]
    .filter(([, , v]) => v)
    .map(([ic, k, v, raw]) => `<div class="fact"><span class="fact-k">${ic} ${k}:</span> <span class="fact-v">${raw ? v : esc(v)}</span></div>`)
    .join("");

  const body = `<section class="detail2" style="--img:url('${esc(w.backdrop || w.posterUrl)}')">
  <div class="detail-bg"></div>
  <div class="wrap d2">
    <aside class="d2-poster">
      <img class="poster" src="${esc(w.posterUrl)}" alt="${esc(label + " " + w.title)}" onerror="this.onerror=null;this.src='/assets/poster.svg'">
      ${w.rating ? `<span class="d2-rate">★ ${esc(w.rating)}</span>` : ""}
      ${w.trailerEmbed ? `<button class="trailer-btn" data-trailer="${esc(w.trailerEmbed)}">▶ مشاهدة التريلر</button>` : ""}
    </aside>
    <div class="d2-main">
      <h1>${label} ${esc(w.title)}${w.year ? " " + esc(w.year) : ""}</h1>
      ${w.original_title ? `<p class="orig" dir="ltr">${esc(w.original_title)}</p>` : ""}
      ${c.html}
      <h2 class="h2q">قصة ${what}</h2>
      <div class="story-box">${paras(w.story)}</div>
      <h2 class="h2q">تفاصيل ${what}</h2>
      <div class="facts">${facts}</div>
    </div>
    <aside class="d2-actions">
      ${watchTarget ? `<a class="act act-watch" href="${watchTarget}"><span class="act-ic">🎬</span><b>مشاهدة الآن</b><small>الذهاب لصفحة المشاهدة</small></a>` : ""}
      ${dlTarget ? `<a class="act act-dl" href="${dlTarget}"><span class="act-ic">⬇</span><b>تحميل الآن</b><small>الذهاب لصفحة التحميل</small></a>` : ""}
      ${!watchTarget && w.platforms.length ? `<a class="act act-watch" href="#where"><span class="act-ic">📺</span><b>تتفرج فين؟</b><small>المنصات المتاح عليها</small></a>` : ""}
    </aside>
  </div>
</section>
<section class="wrap body">
  ${site.ads?.in_page ? `<div class="ad">${site.ads.in_page}</div>` : ""}
  ${eps}
  ${w.platforms.length ? `<div id="where">${where}</div>` : ""}
  ${cast}
  ${w.review ? `<h2 class="h">رأي Watchly</h2><div class="story">${paras(w.review)}</div>` : ""}
</section>
${rail("أعمال مشابهة", related, null)}
<div class="modal" id="trailer-modal" hidden><div class="modal-in"><button class="modal-x" aria-label="إغلاق">✕</button><div class="screen"></div></div></div>`;

  return layout({ title: seoTitle, description: desc, canonical: w.href, body, image: w.backdrop || w.poster, jsonld: [ld, c.ld] });
}

function watchShell({ c, title, back, dl, playerBlock, extra = "" }) {
  return `<section class="watch2">
  <div class="wrap">
    ${c.html}
    <div class="w2-bar">
      <a class="w2-back" href="${back}">→ عودة للتفاصيل</a>
      <h1 class="w2-title">${esc(title)}</h1>
      ${dl ? `<a class="w2-dl" href="${dl}">⬇ تحميل الآن</a>` : "<span></span>"}
    </div>
    <div id="watch">${playerBlock}</div>
    ${extra}
  </div>
</section>`;
}

function moviePage(w) {
  const title = `فيلم ${w.title}${w.year ? " " + w.year : ""}`;
  const c = crumbs([{ name: "الأفلام", href: "/movies/" }, { name: w.title, href: w.href }, { name: "مشاهدة" }]);
  const body = watchShell({ c, title, back: w.href, dl: w.downloads.length ? w.dlHref : null, playerBlock: playerSide(w.videos, w.backdrop || w.posterUrl) }) +
    `<section class="wrap page-body">${site.ads?.in_page ? `<div class="ad">${site.ads.in_page}</div>` : ""}</section>${rail("أفلام مشابهة", works.filter((x) => x !== w && x.type === "movie" && x.genres.some((g) => w.genres.includes(g))).slice(0, 12), null)}`;
  return layout({ title: `مشاهدة ${title}`, description: (w.story || title).replace(/\s+/g, " ").slice(0, 155), canonical: w.watchHref, body, image: w.backdrop || w.poster, jsonld: [c.ld] });
}

function episodePage(w, e, idx) {
  const label = typeLabel(w.type);
  const prev = w.episodes[idx - 1], next = w.episodes[idx + 1];
  const title = `${label} ${w.title} ${e.label}${e.title ? " — " + e.title : ""}`;
  const c = crumbs([
    { name: "المسلسلات", href: "/series/" },
    { name: w.title, href: w.href },
    { name: e.label },
  ]);
  const desc = (e.summary || w.story || title).replace(/\s+/g, " ").slice(0, 155);
  const poster = w.backdrop || w.posterUrl;
  const playerBlock = e.servers.length
    ? playerSide(e.servers, poster)
    : `<div class="noplay">الحلقة دي لسه مش متاحة للمشاهدة.${w.platforms.length ? ` تقدر تتفرج عليها على: ${w.platforms.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="nofollow noopener sponsored">${esc(p.name)}</a>`).join("، ")}` : ""}</div>`;
  const nav = `<div class="watch-actions">
      ${prev ? `<a class="pill" href="${prev.href}">→ ${esc(prev.label)}</a>` : ""}
      ${next ? `<a class="pill pill-next" href="${next.href}">${esc(next.label)} ←</a>` : ""}
    </div>`;
  const body = watchShell({ c, title, back: w.href, dl: e.downloads.length ? e.dlHref : null, playerBlock, extra: nav }) + `
<section class="wrap page-body">
  ${site.ads?.in_page ? `<div class="ad">${site.ads.in_page}</div>` : ""}
  <div class="box">
    <h2 class="box-h">المواسم والحلقات</h2>
    ${epGrid(w, e)}
  </div>
  ${e.summary ? `<div class="box"><h2 class="box-h">قصة الحلقة</h2><div class="story">${paras(e.summary)}</div></div>` : ""}
</section>`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "TVEpisode",
    name: title,
    url: BASE + e.href,
    episodeNumber: Number(e.number) || e.number,
    partOfSeason: { "@type": "TVSeason", seasonNumber: e.season },
    description: desc,
    image: w.poster ? (w.poster.startsWith("http") ? w.poster : BASE + w.poster) : undefined,
    partOfSeries: { "@type": "TVSeries", name: w.title, url: BASE + w.href },
  };
  return layout({ title, description: desc, canonical: e.href, body, image: w.backdrop || w.poster, jsonld: [ld, c.ld] });
}

function textPage(slug, title, html) {
  const c = crumbs([{ name: title }]);
  return layout({ title, canonical: `/${slug}/`, description: `${title} — ${site.name}`, body: `<section class="wrap page narrow">${c.html}<h1>${esc(title)}</h1><div class="story">${html}</div></section>`, jsonld: [c.ld] });
}

/* ================= البناء ================= */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(ROOT, "assets"), path.join(OUT, "assets"));
copyDir(path.join(ROOT, "images"), path.join(OUT, "images"));

const urls = [];
const page = (rel, html, priority = 0.6) => {
  write(rel === "/" ? "index.html" : rel.replace(/^\//, "") + "index.html", html);
  urls.push({ loc: rel, priority });
};

page("/", homePage(), 1.0);
page("/series/", listPage({ title: "المسلسلات", h1: "المسلسلات", intro: "كل المسلسلات على Watchly: القصة، الحلقات، الأبطال، وتتفرج عليها فين.", list: series, canonical: "/series/", crumbItems: [{ name: "المسلسلات" }] }), 0.9);
page("/movies/", listPage({ title: "الأفلام", h1: "الأفلام", intro: "كل الأفلام على Watchly: القصة، الأبطال، الإعلان الرسمي، وتتفرج عليها فين.", list: movies, canonical: "/movies/", crumbItems: [{ name: "الأفلام" }] }), 0.9);
page("/free/", listPage({ title: "أفلام ومسلسلات تتفرج عليها مجانًا وبشكل قانوني", h1: "تتفرج عليه مجانًا", intro: "أعمال متاحة للمشاهدة المجانية بشكل قانوني: على قنوات يوتيوب الرسمية أو لأنها ملكية عامة.", list: works.filter((w) => w.platforms.some((p) => p.access === "مجانًا")), canonical: "/free/", crumbItems: [{ name: "مجانًا" }] }), 0.8);

{
  const c = crumbs([{ name: "التصنيفات" }]);
  page(
    "/genres/",
    layout({
      title: "التصنيفات",
      canonical: "/genres/",
      description: "تصفح الأفلام والمسلسلات حسب التصنيف على Watchly.",
      body: `<section class="wrap page">${c.html}<h1>التصنيفات</h1><div class="chips">${genres
        .map((g) => `<a href="${genreHref(g)}">${esc(g)} <small>${works.filter((w) => w.genres.includes(g)).length}</small></a>`)
        .join("")}</div></section>`,
      jsonld: [c.ld],
    }),
    0.7
  );
}

// القوائم (رمضان 2027، يعرض حاليًا، ...)
if (lists.length) {
  const c = crumbs([{ name: "القوائم" }]);
  page("/lists/", layout({
    title: "قوائم الأفلام والمسلسلات", canonical: "/lists/", description: "قوائم مختارة من الأفلام والمسلسلات على Watchly.",
    body: `<section class="wrap page">${c.html}<h1>القوائم</h1><div class="chips">${lists.map((l) => `<a href="${listHref(l)}">${esc(l)} <small>${works.filter((w) => w.lists.includes(l)).length}</small></a>`).join("")}</div></section>`,
    jsonld: [c.ld],
  }), 0.7);
  for (const l of lists)
    page(listHref(l), listPage({
      title: `${l} — قائمة الأعمال`, h1: l, intro: `كل الأعمال في قائمة «${l}» على Watchly.`,
      list: works.filter((w) => w.lists.includes(l)), canonical: listHref(l),
      crumbItems: [{ name: "القوائم", href: "/lists/" }, { name: l }],
    }), 0.8);
}

for (const g of genres) {
  page(
    genreHref(g),
    listPage({
      title: `أفلام ومسلسلات ${g}`,
      h1: `أفلام ومسلسلات ${g}`,
      intro: `قائمة أفلام ومسلسلات ${g} على Watchly، مع القصة وأماكن المشاهدة.`,
      list: works.filter((w) => w.genres.includes(g)),
      canonical: genreHref(g),
      crumbItems: [{ name: "التصنيفات", href: "/genres/" }, { name: g }],
    }),
    0.7
  );
}

for (const w of works) {
  page(w.href, workPage(w), 0.8);
  if (w.type === "movie" && w.videos.length) page(w.watchHref, moviePage(w), 0.7);
  if (w.downloads.length)
    write(w.dlHref.replace(/^\//, "") + "index.html", downloadPage({
      title: `${typeLabel(w.type)} ${w.title}`, back: w.href, backLabel: `رجوع لصفحة ${typeLabel(w.type) === "فيلم" ? "الفيلم" : "المسلسل"}`,
      crumbItems: [{ name: w.type === "series" ? "المسلسلات" : "الأفلام", href: w.type === "series" ? "/series/" : "/movies/" }, { name: w.title, href: w.href }, { name: "تحميل" }],
      downloads: w.downloads, canonical: w.dlHref, image: w.poster,
    }));
  if (w.type === "series")
    w.episodes.forEach((e, i) => {
      page(e.href, episodePage(w, e, i), 0.7);
      if (e.downloads.length)
        write(e.dlHref.replace(/^\//, "") + "index.html", downloadPage({
          title: `${typeLabel(w.type)} ${w.title} ${e.label}`, back: e.href, backLabel: `رجوع لصفحة المشاهدة`,
          crumbItems: [{ name: "المسلسلات", href: "/series/" }, { name: w.title, href: w.href }, { name: e.label, href: e.href }, { name: "تحميل" }],
          downloads: e.downloads, canonical: e.dlHref, image: w.poster,
        }));
    });
}

page("/about/", textPage("about", "من نحن", paras(site.about)), 0.3);
page("/privacy/", textPage("privacy", "سياسة الخصوصية", paras(site.privacy)), 0.3);
page("/dmca/", textPage("dmca", "حقوق النشر (DMCA)", paras(site.dmca || "بنحترم حقوق النشر. لو انت صاحب حقوق أي عمل معروض في الموقع وشايف إنه معروض من غير إذنك، ابعتلنا على الإيميل اللي تحت اسم العمل ورابط الصفحة وما يثبت ملكيتك، وهنشيله في أسرع وقت.") + `<p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>`), 0.3);
page("/contact/", textPage("contact", "اتصل بنا", `<p>لأي اقتراح أو تصحيح أو تعاون، راسلنا على:</p><p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>`), 0.3);

// البحث (صفحة + فهرس JSON)
write("search/index.html", layout({
  title: "بحث",
  canonical: "/search/",
  noindex: true,
  body: `<section class="wrap page"><h1>ابحث في <span class="y">Watchly</span></h1>
<input id="q" class="search-input" type="search" placeholder="اكتب اسم فيلم أو مسلسل أو ممثل..." autocomplete="off" autofocus>
<div id="results" class="grid" style="margin-top:24px"></div></section>`,
}));
write("search.json", JSON.stringify(works.map((w) => ({
  t: w.title, o: w.original_title || "", h: w.href, p: w.posterUrl, y: w.year || "", ty: typeLabel(w.type),
  k: [w.genres.join(" "), w.cast.map((c) => c.name).join(" "), w.director || ""].join(" "),
}))));

// أداة جلب البيانات (مش بتتأرشف)
write("tool/index.html", layout({
  title: "أداة جلب بيانات عمل", canonical: "/tool/", noindex: true,
  body: `<section class="wrap page narrow"><h1>⚡ جلب بيانات فيلم أو مسلسل</h1>
<p class="muted">اكتبي اسم العمل (عربي أو إنجليزي)، والأداة هتجيب البيانات الأساسية من Wikidata.</p>
<div class="t-bar"><input id="t-q" class="search-input" placeholder="مثلا: The Godfather أو خمسين خمسين"><button id="t-go" class="btn">بحث</button></div>
<p id="t-msg" class="muted"></p><div id="t-list" class="t-list"></div><div id="t-out" class="t-out"></div></section>
<script src="/assets/tool.js" defer></script>`,
}));

// 404
write("404.html", layout({ title: "الصفحة مش موجودة", noindex: true, canonical: "/404", body: `<section class="wrap page narrow center"><div class="big">404</div><h1>الصفحة دي مش موجودة</h1><p><a class="btn" href="/">رجوع للرئيسية</a></p></section>` }));

// sitemap + robots
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(BASE + encodeURI(u.loc))}</loc><lastmod>${NOW}</lastmod><priority>${u.priority.toFixed(1)}</priority></url>`).join("\n")}
</urlset>`);
write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /search/\nDisallow: /tool/\n\nSitemap: ${BASE}/sitemap.xml\n`);

// ads.txt (لو اتحط في site.json)
if (site.ads_txt) write("ads.txt", site.ads_txt);

console.log(`✅ اتبنى الموقع: ${works.length} عمل (${series.length} مسلسل، ${movies.length} فيلم)، ${genres.length} تصنيف، ${urls.length} صفحة.`);
warnings.forEach((w) => console.log(w));
