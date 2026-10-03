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

/** بيحوّل أي رابط فيديو عادي لرابط embed — ومن مصادر قانونية بس */
function toEmbed(url) {
  const u = String(url || "").trim();
  let m;
  if ((m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/)))
    return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
  if ((m = u.match(/archive\.org\/(?:details|embed)\/([^/?#]+)/))) return `https://archive.org/embed/${m[1]}`;
  if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return `https://player.vimeo.com/video/${m[1]}`;
  if ((m = u.match(/dailymotion\.com\/video\/([a-z0-9]+)/i))) return `https://geo.dailymotion.com/player.html?video=${m[1]}`;
  return null;
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
    w.cast = (w.cast || []).filter((c) => c && c.name);
    w.platforms = (w.platforms || []).filter((p) => p && p.name && p.url);
    w.episodes = (w.episodes || []).filter((e) => e && (e.summary || e.title)).sort((a, b) => (a.number || 0) - (b.number || 0));
    w.videos = (w.videos || [])
      .filter((v) => v && v.url)
      .map((v) => {
        const embed = toEmbed(v.url);
        if (!embed) warnings.push(`⚠️ "${w.title}": الفيديو ${v.url} مش من مصدر مسموح (YouTube / Archive / Vimeo / Dailymotion) واتشال.`);
        return { title: v.title || "فيديو", embed };
      })
      .filter((v) => v.embed);
    w.href = `/work/${w.slug}/`;
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

const series = works.filter((w) => w.type === "series");
const movies = works.filter((w) => w.type === "movie");
const genres = [...new Set(works.flatMap((w) => w.genres))].sort((a, b) => a.localeCompare(b, "ar"));
const genreHref = (g) => `/genre/${slugify(g)}/`;

/* ================= القالب العام ================= */

function layout({ title, description, canonical, body, image, jsonld = [], noindex = false, fullTitle = false }) {
  const t = fullTitle ? title : `${title} | ${site.name}`;
  const url = BASE + (canonical || "/");
  const img = image ? (image.startsWith("http") ? image : BASE + image) : "";
  const social = Object.entries(site.social || {}).filter(([, v]) => v);
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
${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0b0b">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
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
    <a class="logo" href="/" dir="ltr">Watch<span>ly</span></a>
    <nav class="nav" id="nav">
      <a href="/">الرئيسية</a>
      <a href="/series/">المسلسلات</a>
      <a href="/movies/">الأفلام</a>
      <a href="/genres/">التصنيفات</a>
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
      <a class="logo" href="/" dir="ltr">Watch<span>ly</span></a>
      <p>${esc(site.tagline)}</p>
      ${social.length ? `<p class="social">${social.map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(k)}</a>`).join(" · ")}</p>` : ""}
    </div>
    <div class="ftr-links">
      <a href="/about/">من نحن</a>
      <a href="/privacy/">سياسة الخصوصية</a>
      <a href="/contact/">اتصل بنا</a>
      <a href="/sitemap.xml">خريطة الموقع</a>
    </div>
    <p class="muted small">Watchly دليل للأعمال الفنية. ما بنرفعش أي محتوى، وكل روابط المشاهدة بتوديك للمنصات الرسمية.<br>© ${new Date().getFullYear()} ${esc(site.name)}</p>
  </div>
</footer>
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
    ? `<section class="hero" style="background-image:url('${esc(hero.backdrop || hero.posterUrl)}')">
  <div class="hero-fade"></div>
  <div class="wrap hero-in">
    <span class="pill">⭐ مختارات Watchly</span>
    <h1>${typeLabel(hero.type)} ${esc(hero.title)}</h1>
    <p class="muted">${esc([hero.year, hero.country, hero.genres.join("، ")].filter(Boolean).join(" · "))}</p>
    <p class="hero-story">${esc(hero.story || "")}</p>
    <div class="btns"><a class="btn" href="${hero.href}">التفاصيل وتتفرج فين</a></div>
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
    ? `<h2 class="h">${w.videos.length === 1 ? esc(w.videos[0].title) : "الفيديوهات الرسمية"}</h2>
<div class="player">
  <div class="servers"><h3>الفيديوهات</h3>${w.videos
        .map((v, i) => `<button class="srv${i === 0 ? "" : ""}" data-src="${esc(v.embed)}">${esc(v.title)}</button>`)
        .join("")}</div>
  <div class="screen"><button class="play" style="background-image:url('${esc(w.backdrop || w.posterUrl)}')" aria-label="تشغيل"><span>▶</span></button></div>
</div>`
    : "";

  const eps =
    w.type === "series" && w.episodes.length
      ? `<h2 class="h">حلقات ${label} ${esc(w.title)}${w.episodes_count ? ` (${esc(w.episodes_count)} حلقات)` : ""}</h2>
<div class="eplist">${w.episodes
          .map(
            (e, i) => `<details${i === w.episodes.length - 1 ? " open" : ""} id="ep-${esc(e.number)}"><summary>الحلقة ${esc(e.number)}${
              e.title ? ` — ${esc(e.title)}` : ""
            }</summary>${paras(e.summary)}</details>`
          )
          .join("")}</div>`
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

  const body = `<section class="detail" style="--img:url('${esc(w.backdrop || w.posterUrl)}')">
  <div class="detail-bg"></div>
  <div class="wrap detail-in">
    <img class="poster" src="${esc(w.posterUrl)}" alt="${esc(label + " " + w.title)}" onerror="this.onerror=null;this.src='/assets/poster.svg'">
    <div>
      ${c.html}
      <h1>${label} ${esc(w.title)}${w.year ? ` <small>(${esc(w.year)})</small>` : ""}</h1>
      ${w.original_title ? `<p class="orig" dir="ltr">${esc(w.original_title)}</p>` : ""}
      <div class="meta">${meta}</div>
      <div class="tags">${w.genres.map((g) => `<a href="${genreHref(g)}">${esc(g)}</a>`).join("")}</div>
      <div class="story">${paras(w.story)}</div>
      <p class="muted small">${w.director ? `<b>إخراج:</b> ${esc(w.director)}` : ""}${w.director && w.writer ? " &nbsp;|&nbsp; " : ""}${
    w.writer ? `<b>تأليف:</b> ${esc(w.writer)}` : ""
  }</p>
      <div class="btns">${w.platforms.length ? '<a class="btn" href="#where">تتفرج فين؟</a>' : ""}${
    w.videos.length ? '<a class="btn ghost" href="#watch">▶ الفيديو</a>' : ""
  }</div>
    </div>
  </div>
</section>
<section class="wrap body">
  <div id="where">${where}</div>
  ${site.ads?.in_page ? `<div class="ad">${site.ads.in_page}</div>` : ""}
  <div id="watch">${player}</div>
  ${eps}
  ${cast}
  ${w.review ? `<h2 class="h">رأي Watchly</h2><div class="story">${paras(w.review)}</div>` : ""}
  ${details ? `<h2 class="h">تفاصيل العمل</h2><dl class="dl">${details}</dl>` : ""}
</section>
${rail("أعمال مشابهة", related, null)}`;

  return layout({ title: seoTitle, description: desc, canonical: w.href, body, image: w.backdrop || w.poster, jsonld: [ld, c.ld] });
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

for (const w of works) page(w.href, workPage(w), 0.8);

page("/about/", textPage("about", "من نحن", paras(site.about)), 0.3);
page("/privacy/", textPage("privacy", "سياسة الخصوصية", paras(site.privacy)), 0.3);
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

// 404
write("404.html", layout({ title: "الصفحة مش موجودة", noindex: true, canonical: "/404", body: `<section class="wrap page narrow center"><div class="big">404</div><h1>الصفحة دي مش موجودة</h1><p><a class="btn" href="/">رجوع للرئيسية</a></p></section>` }));

// sitemap + robots
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(BASE + encodeURI(u.loc))}</loc><lastmod>${NOW}</lastmod><priority>${u.priority.toFixed(1)}</priority></url>`).join("\n")}
</urlset>`);
write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /search/\n\nSitemap: ${BASE}/sitemap.xml\n`);

// ads.txt (لو اتحط في site.json)
if (site.ads_txt) write("ads.txt", site.ads_txt);

console.log(`✅ اتبنى الموقع: ${works.length} عمل (${series.length} مسلسل، ${movies.length} فيلم)، ${genres.length} تصنيف، ${urls.length} صفحة.`);
warnings.forEach((w) => console.log(w));
