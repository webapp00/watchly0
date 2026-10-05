/**
 * Watchly — مولّد موقع ثابت (Static Site Generator) من غير أي مكتبات.
 *
 * بيقرا:   content/site.json        (إعدادات الموقع)
 *          content/works/*.json     (كل فيلم أو مسلسل في ملف)
 * وبيطلّع: dist/                    (الموقع الجاهز للرفع)
 *
 * SEO: كل حاجة بتتولد لوحدها من بيانات العمل (العنوان، الوصف، canonical، Schema،
 * Open Graph، breadcrumbs، sitemaps). أي عمل جديد بياخد SEO كامل من غير أي كود.
 *
 * صفحات المشاهدة بتتأرشف وبتدخل Video Sitemap بس لو خانة "حقوق الفيديو" في العمل متحددة
 * (حقوق مملوكة/مرخّصة، ملكية عامة، أو Creative Commons). من غيرها الصفحة بتشتغل عادي للزوار
 * بس بتبقى noindex.
 *
 * التشغيل: node build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content/site.json"), "utf8"));
const NOW = new Date().toISOString().slice(0, 10);
const EXTRA_HOSTS = (site.video_hosts || []).map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter(Boolean);

/** رابط الموقع دايمًا https ومن غير / في الآخر (حتى لو اتكتب www.watchlyar.com بس) */
function normUrl(u) {
  u = String(u || "").trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/^http:\/\//i, "https://");
}
const BASE = normUrl(process.env.SITE_URL || site.url);

/* حدود الصفحات الخفيفة: ما نأرشفش صفحات فاضية أو فيها عمل واحد */
const MIN_LIST = 3; // تصنيف، سنة، قائمة
const MIN_PERSON = 2; // ممثل أو مخرج أو مؤلف
const MIN_EP_SUMMARY = 250; // صفحة حلقة من غير فيديو مرخّص تتأرشف بس لو ملخصها مكتوب كويس
const PER_PAGE = 48;

/* حقوق الفيديو */
const RIGHTS = {
  owned: "الفيديو معروض بترخيص من أصحاب الحقوق لـ Watchly.",
  public_domain: "الفيديو ملكية عامة (Public Domain).",
  cc: "الفيديو منشور برخصة Creative Commons.",
};

/* ================= أدوات مساعدة ================= */

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** تنظيف النص: بيصلح الحروف العربية المنسوخة بترميز غريب (ﺇﺧﺮاﺝ ← إخراج) والمسافات */
const clean = (s) => String(s ?? "").normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/\s+/g, " ").trim();
const paras = (s) =>
  String(s ?? "").normalize("NFKC").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
/** رابط (للتصنيفات والأشخاص والقوائم) — زي ما كان */
const slugify = (s) =>
  String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\u0600-\u06FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
/** رابط إنجليزي (لصفحات الأعمال) */
const asciiSlug = (s) =>
  String(s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
/** قص النص على آخر كلمة كاملة */
const cut = (s, n = 155) => {
  s = clean(s);
  if (s.length <= n) return s;
  const t = s.slice(0, n - 1);
  return t.slice(0, Math.max(t.lastIndexOf(" "), n - 30)).replace(/[،,.:؛\s]+$/, "") + "…";
};
const abs = (u) => (!u ? "" : /^https?:\/\//.test(u) ? u : BASE + encodeURI(u));
const absPath = (p) => BASE + encodeURI(p);
const typeLabel = (t) => (t === "series" ? "مسلسل" : "فيلم");
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

/** مقاس الصورة (JPG/PNG/WebP) من الملف نفسه — علشان width/height وتقليل اهتزاز الصفحة (CLS) */
const sizeCache = {};
function imgSize(src) {
  if (!src || /^https?:/.test(src) || !src.startsWith("/images/")) return null;
  if (src in sizeCache) return sizeCache[src];
  let r = null;
  try {
    const b = fs.readFileSync(path.join(ROOT, decodeURI(src)));
    if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") r = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8X") r = { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      else if (kind === "VP8 ") r = { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      else if (kind === "VP8L") { const n = b.readUInt32LE(21); r = { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
    } else if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { r = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; break; }
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { r = null; }
  return (sizeCache[src] = r);
}
const dims = (src, fw, fh) => {
  const s = imgSize(src);
  return s ? `width="${s.w}" height="${s.h}"` : fw ? `width="${fw}" height="${fh}"` : "";
};

/** بيحوّل أي رابط فيديو لرابط embed. لو اتلصق كود <iframe> كامل بياخد الـ src منه */
function toEmbed(url) {
  let u = String(url || "").trim();
  const src = u.match(/src\s*=\s*["']([^"']+)["']/i);
  if (src) u = src[1];
  if (u.startsWith("//")) u = "https:" + u;
  let m;
  if ((m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/)))
    return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
  if ((m = u.match(/archive\.org\/(?:details|embed)\/([^/?#]+)/))) return `https://archive.org/embed/${m[1]}`;
  if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/))) return `https://player.vimeo.com/video/${m[1]}`;
  if ((m = u.match(/dailymotion\.com\/video\/([a-z0-9]+)/i))) return `https://geo.dailymotion.com/player.html?video=${m[1]}`;
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}
/** صورة مصغرة حقيقية للفيديو لو المنصة بتوفرها */
function videoThumb(embed) {
  let m;
  if ((m = String(embed).match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/))) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
  if ((m = String(embed).match(/archive\.org\/embed\/([^/?#]+)/))) return `https://archive.org/services/img/${m[1]}`;
  return "";
}

/** بيحوّل قايمة روابط فيديو لروابط embed ويشيل اللي مش مسموح */
function cleanVideos(list, where, defName = "فيديو") {
  return (list || [])
    .filter((v) => v && v.url)
    .map((v, i) => {
      const embed = toEmbed(v.url);
      if (!embed) warnings.push(`⚠️ "${where}": الرابط ${v.url} مش رابط صحيح واتشال (لازم يبدأ بـ https://).`);
      return { title: clean(v.title) || `${defName} ${i + 1}`, embed };
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
      return { name: clean(d.title) || hostName(u), quality: d.quality || "", size: d.size || "", url: u };
    })
    .filter(Boolean);
}

/** صفحة المشاهدة: السيرفرات عمود على الجنب والمشغل جنبه (الفيديو ما بيتحملش إلا لما الزائر يدوس) */
function playerSide(videos, poster) {
  if (!videos.length) return "";
  return `<div class="player side">
  <div class="servers"><h3>سيرفرات المشاهدة</h3>${videos.map((v) => `<button class="srv" data-src="${esc(v.embed)}">${esc(v.title)}</button>`).join("")}</div>
  <div class="screen"><button class="play" style="background-image:url('${esc(poster)}')" aria-label="تشغيل"><span>▶</span></button></div>
</div>`;
}

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

/** شبكة الحلقات متقسمة مواسم */
function epGrid(w, current) {
  const seasons = [...new Set(w.episodes.map((e) => e.season))];
  if (!seasons.length && Number(w.episodes_count) > 0) seasons.push(1);
  const multi = seasons.length > 1;
  const maxS1 = Math.max(0, ...w.episodes.filter((e) => e.season === 1).map((e) => Number(e.number) || 0));
  return `<div class="seasons">${seasons
    .map(
      (sn) => `${multi ? `<h3 class="season-h">الموسم ${esc(sn)}</h3>` : ""}<div class="epgrid">${w.episodes
        .filter((e) => e.season === sn)
        .map(
          (e) => `<a class="ep${e === current ? " on" : ""}" href="${e.href}" title="${esc(`${w.title} ${e.label}`)}"><small>الحلقة</small><b>${esc(e.number)}</b>${
            e.servers.length ? '<i title="متاحة للمشاهدة">▶</i>' : ""
          }</a>`
        )
        .join("")}${
        sn === 1 && Number(w.episodes_count) > 0
          ? Array.from({ length: Math.max(0, Number(w.episodes_count) - maxS1) }, (_, i) =>
              `<span class="ep soon"><small>الحلقة</small><b>${maxS1 + i + 1}</b><i>قريبًا</i></span>`
            ).join("")
          : ""
      }</div>`
    )
    .join("")}</div>`;
}

/** صفحة التحميل (مش بتتأرشف) */
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

/** أسماء الأشخاص من خانة نص: بيشيل "إخراج:" و"(مؤلف)" ويفصل الأسماء */
function people(v) {
  const s = clean(Array.isArray(v) ? v.join("، ") : v).replace(/^(?:إخراج|اخراج|تأليف|تاليف|سيناريو وحوار|سيناريو|قصة|بطولة)\s*[:：]\s*/, "");
  return [...new Set(s.split(/\s*\([^)]*\)\s*|\s*[،,]\s*/).map((x) => x.trim()).filter((x) => x && x.length > 1))];
}

/* ================= قراءة المحتوى ================= */

const warnings = [];
const redirects = [];
const works = fs
  .readdirSync(path.join(ROOT, "content/works"))
  .filter((f) => !f.startsWith(".") && f.endsWith(".json"))
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
    w.original_title = clean(w.original_title);
    // الاسم: من غير السنة اللي بين قوسين، ومن غير الاسم الإنجليزي، ومن غير كلمة فيلم/مسلسل
    let t = clean(w.title).replace(/\(\s*\d{4}\s*\)/g, " ");
    if (w.original_title && t.toLowerCase().includes(w.original_title.toLowerCase()) && t.toLowerCase() !== w.original_title.toLowerCase())
      t = t.replace(new RegExp(w.original_title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
    w.title = clean(t.replace(/^(?:مسلسل|فيلم)\s+/, "")) || clean(w.title);
    w.year = Number(w.year) || (w.release_date ? Number(String(w.release_date).slice(0, 4)) : "") || "";

    // الرابط: إنجليزي قصير. لو الخانة فيها عربي أو مسافات بيتعمل من الاسم الأصلي + السنة، والرابط القديم بيتحوّل له (301)
    const raw = String(w.slug || "");
    const old = slugify(raw);
    const messy = /[\u0600-\u06FF]/.test(raw) || /\s/.test(raw.trim());
    w.slug = (!messy && asciiSlug(raw)) || (w.original_title && asciiSlug(`${w.original_title}-${w.year}`)) || old || slugify(`${w.title}-${w.year}`);
    if (old && old !== w.slug) w._oldSlug = old;

    w.genres = [...new Set((w.genres || []).map(clean).filter(Boolean))];
    w.lists = [...new Set((w.lists || []).map(clean).filter(Boolean))];
    w.cast = (w.cast || []).filter((c) => c && c.name).map((c) => ({ name: clean(c.name), role: clean(c.role) }));
    w.directors = people(w.director);
    w.writers = people(w.writer);
    w.country = clean(w.country);
    w.language = clean(w.language);
    w.quality = clean(w.quality);
    w.story = String(w.story || "").normalize("NFKC").trim();
    w.platforms = (w.platforms || []).filter((p) => p && p.name && p.url);
    w.rights = RIGHTS[w.rights] ? w.rights : "";
    w.rights_note = clean(w.rights_note);
    w.episodes = mergeBulk(mergeBulk([...(w.episodes || [])], w.servers_bulk, "servers"), w.downloads_bulk, "downloads");
    w.videos = cleanVideos(w.videos, w.title, "سيرفر").map((v) => ({ ...v, title: /^سيرفر \d+$/.test(v.title) ? hostName(v.embed) || v.title : v.title }));
    w.trailerEmbed = w.trailer ? toEmbed(w.trailer) : null;
    w.href = `/work/${w.slug}/`;
    w.downloads = cleanDownloads(w.downloads, w.title);

    // الحلقات: رقم الحلقة لو ناقص بيتحسب من ترتيبها (قبل كده الحلقة اللي من غير رقم كانت بتختفي)
    const used = {};
    const eps = [];
    for (const e of w.episodes) {
      if (!e || !(e.summary || e.title || (e.servers && e.servers.length) || (e.downloads && e.downloads.length))) continue;
      const season = Number(e.season) || 1;
      used[season] = used[season] || new Set();
      let n = Number(e.number);
      if (!n) { n = 1; while (used[season].has(n)) n++; }
      used[season].add(n);
      const label = `${season > 1 ? `الموسم ${season} ` : ""}الحلقة ${n}`;
      const tag = `${w.title} — ${label}`;
      eps.push({
        ...e,
        season,
        number: n,
        title: clean(e.title),
        summary: String(e.summary || "").normalize("NFKC").trim(),
        label,
        servers: cleanVideos(e.servers, tag, "سيرفر").map((v) => ({ ...v, title: /^سيرفر \d+$/.test(v.title) ? hostName(v.embed) || v.title : v.title })),
        downloads: cleanDownloads(e.downloads, tag),
      });
    }
    w.episodes = eps.sort((a, b) => a.season - b.season || a.number - b.number);
    w.posterUrl = w.poster || POSTER_FALLBACK;

    const hasPlayable = w.videos.length || w.episodes.some((e) => e.servers.length);
    if (hasPlayable && !w.rights)
      warnings.push(`⚠️ "${w.title}": فيه سيرفرات مشاهدة بس خانة "حقوق الفيديو" فاضية — صفحات المشاهدة شغالة للزوار بس مش هتتأرشف في جوجل ومش هتدخل Video Sitemap.`);
    return w;
  })
  .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

// منع تكرار الروابط + تحويل الروابط القديمة
const seen = new Set();
for (const w of works) {
  let s = w.slug, i = 2;
  while (seen.has(s)) s = `${w.slug}-${i++}`;
  seen.add(s);
  if (s !== w.slug) { w.slug = s; w.href = `/work/${s}/`; }
  const olds = new Set([w._oldSlug, ...(w.old_slugs || []).map(slugify)].filter((o) => o && o !== w.slug));
  for (const o of olds) redirects.push([`/work/${o}/`, w.href]);
}
for (const w of works) {
  for (const e of w.episodes) {
    e.href = `${w.href}${e.season > 1 ? `season/${e.season}/` : ""}episode/${e.number}/`;
    e.dlHref = `${e.href}download/`;
    // تتأرشف لو فيها فيديو مرخّص، أو لو مفيهاش سيرفرات وملخصها مكتوب كويس (صفحة محتوى حقيقية)
    e.index = w.rights ? !!(e.servers.length || e.summary.length >= MIN_EP_SUMMARY) : !e.servers.length && e.summary.length >= MIN_EP_SUMMARY;
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
const years = [...new Set(works.map((w) => w.year).filter(Boolean))].sort((a, b) => b - a);
const yearHref = (y) => `/year/${y}/`;
const homeLists = (site.home_lists || []).map(clean).filter((l) => lists.includes(l));

// الأشخاص (مخرجين، مؤلفين، ممثلين) — صفحة لكل شخص للربط الداخلي
const persons = new Map();
const addPerson = (name, w, role) => {
  const key = slugify(name);
  if (!key) return;
  if (!persons.has(key)) persons.set(key, { name, key, href: `/person/${key}/`, works: new Map() });
  const p = persons.get(key);
  if (!p.works.has(w)) p.works.set(w, new Set());
  p.works.get(w).add(role);
};
for (const w of works) {
  w.directors.forEach((n) => addPerson(n, w, "إخراج"));
  w.writers.forEach((n) => addPerson(n, w, "تأليف"));
  w.cast.forEach((c) => addPerson(c.name, w, "تمثيل"));
}
const personHref = (name) => (persons.get(slugify(name)) || {}).href;
const personLink = (name) => (personHref(name) ? `<a href="${personHref(name)}">${esc(name)}</a>` : esc(name));
const latest = (list) => list.map((w) => String(w.date || w.release_date || "")).filter(Boolean).sort().pop() || "";

/* ================= القالب العام ================= */

function layout({ title, description, canonical, body, image, imageAlt, jsonld = [], noindex = false, fullTitle = false, ogType = "website", preload = "", prev, next, ogVideo = "" }) {
  const t = fullTitle ? title : `${title} | ${site.name}`;
  const url = canonical ? absPath(canonical) : "";
  const desc = cut(description || site.description, 160);
  const social = Object.entries(site.social || {}).filter(([, v]) => v);
  const logoHtml = site.logo
    ? `<a class="logo" href="/"><img src="${esc(site.logo)}" alt="${esc(site.name)}" ${dims(site.logo, 42, 42)}></a>`
    : `<a class="logo" href="/" dir="ltr">Watch<span>ly</span></a>`;
  const ogImg = abs(image) || abs(site.cover) || abs(site.logo);
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title>
<meta name="description" content="${esc(desc)}">
${url ? `<link rel="canonical" href="${esc(url)}">` : ""}
${prev ? `<link rel="prev" href="${esc(absPath(prev))}">` : ""}${next ? `<link rel="next" href="${esc(absPath(next))}">` : ""}
<meta name="robots" content="${noindex ? "noindex, follow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:locale" content="ar_EG">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(t)}">
<meta property="og:description" content="${esc(desc)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ""}
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">\n<meta property="og:image:alt" content="${esc(imageAlt || t)}">` : ""}
${ogVideo ? `<meta property="og:video" content="${esc(ogVideo)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(t)}">
<meta name="twitter:description" content="${esc(desc)}">
${ogImg ? `<meta name="twitter:image" content="${esc(ogImg)}">` : ""}
<meta name="theme-color" content="#0b0b0b">
<link rel="icon" href="${esc(site.favicon || "/assets/icon.svg")}">
${preload}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
${jsonld.filter(Boolean).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
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
      <a href="/years/">حسب السنة</a>
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
    html: `<nav class="crumbs" aria-label="مسار الصفحة">${all
      .map((c, i) => (c.href && i < all.length - 1 ? `<a href="${esc(c.href)}">${esc(c.name)}</a>` : `<span>${esc(c.name)}</span>`))
      .join("<i>‹</i>")}</nav>`,
    ld: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: all.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, ...(c.href ? { item: absPath(c.href) } : {}) })),
    },
  };
};

const card = (w) => `
<a class="card" href="${w.href}" title="${esc(typeLabel(w.type) + " " + w.title)}">
  <div class="card-img">
    <img src="${esc(w.posterUrl)}" alt="بوستر ${esc(typeLabel(w.type) + " " + w.title)}${w.year ? " " + w.year : ""}" ${dims(w.posterUrl, 300, 450)} loading="lazy" decoding="async" onerror="this.onerror=null;this.src='/assets/poster.svg'">
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
const itemList = (list) => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: list.slice(0, 50).map((w, i) => ({ "@type": "ListItem", position: i + 1, url: absPath(w.href), name: w.title })),
});

/** VideoObject لفيديو مرخّص (بيانات حقيقية بس — لو ناقص حاجة أساسية ما بيتعملش) */
function videoLd({ name, description, embed, thumb, date, minutes }) {
  if (!embed || !thumb || !date) return null;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name,
    description,
    thumbnailUrl: thumb,
    uploadDate: date,
    embedUrl: embed,
    ...(minutes ? { duration: `PT${Number(minutes)}M` } : {}),
  };
}

/* ================= الصفحات ================= */

const urls = []; // كل الصفحات اللي تتأرشف → sitemap
const page = (rel, html, { index = true, group = "pages", lastmod = "", images = [], videos = [] } = {}) => {
  write(rel === "/" ? "index.html" : decodeURI(rel).replace(/^\//, "") + "index.html", html);
  if (index) urls.push({ loc: rel, group, lastmod, images, videos });
};

function homePage() {
  const hero = works.find((w) => w.featured) || works[0];
  const heroImg = hero ? hero.backdrop || hero.posterUrl : "";
  const heroHtml = hero
    ? `<section class="hero${hero.backdrop ? "" : " no-bd"}" style="background-image:url('${esc(heroImg)}')">
  <div class="hero-fade"></div>
  <div class="wrap hero-in">
    ${hero.backdrop ? "" : `<img class="hero-poster" src="${esc(hero.posterUrl)}" alt="بوستر ${esc(typeLabel(hero.type) + " " + hero.title)}" ${dims(hero.posterUrl, 300, 450)} fetchpriority="high" onerror="this.onerror=null;this.src='/assets/poster.svg'">`}
    <div>
    <span class="pill">⭐ مختارات Watchly</span>
    <h2 class="hero-title">${typeLabel(hero.type)} ${esc(hero.title)}</h2>
    <p class="muted">${esc([hero.year, hero.country, hero.genres.join("، ")].filter(Boolean).join(" · "))}</p>
    <p class="hero-story">${esc(cut(hero.story, 260))}</p>
    <div class="btns"><a class="btn" href="${hero.href}">التفاصيل وتتفرج فين</a></div>
    </div>
  </div>
</section>`
    : `<section class="wrap" style="padding-top:110px"><p class="muted">ضيفي أول فيلم أو مسلسل من لوحة التحكم.</p></section>`;

  const byGenre = genres
    .map((g) => ({ g, list: works.filter((w) => w.genres.includes(g)) }))
    .filter((x) => x.list.length >= MIN_LIST)
    .slice(0, 4)
    .map((x) => rail(`${x.g}`, x.list, genreHref(x.g)))
    .join("");

  const body = `<h1 class="sr-only">${esc(site.name)} — ${esc(site.tagline)}</h1>
${heroHtml}
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
    image: site.cover || site.logo,
    preload: heroImg ? `<link rel="preload" as="image" href="${esc(heroImg)}" fetchpriority="high">` : "",
    jsonld: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: site.name,
        alternateName: site.name_ar,
        url: BASE + "/",
        inLanguage: "ar",
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${BASE}/search/?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: site.name,
        url: BASE + "/",
        ...(site.logo ? { logo: abs(site.logo) } : {}),
        ...(Object.values(site.social || {}).filter(Boolean).length ? { sameAs: Object.values(site.social).filter(Boolean) } : {}),
      },
    ],
  });
}

/** صفحة قائمة أعمال بترقيم صفحات (/genre/x/ ، /genre/x/page/2/ ...) — كل صفحة canonical لنفسها */
function listPages({ title, h1, intro, list, base, crumbItems, min = 1 }) {
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const index = list.length >= min;
  for (let p = 1; p <= pages; p++) {
    const rel = p === 1 ? base : `${base}page/${p}/`;
    const slice = list.slice((p - 1) * PER_PAGE, p * PER_PAGE);
    const c = crumbs(p === 1 ? crumbItems : [...crumbItems.slice(0, -1), { ...crumbItems[crumbItems.length - 1], href: base }, { name: `صفحة ${p}` }]);
    const nav = pages > 1
      ? `<nav class="pager" aria-label="الصفحات">${Array.from({ length: pages }, (_, i) => i + 1).map((n) => (n === p ? `<span class="on">${n}</span>` : `<a href="${n === 1 ? base : `${base}page/${n}/`}">${n}</a>`)).join("")}</nav>`
      : "";
    const pt = p > 1 ? ` — صفحة ${p}` : "";
    page(rel, layout({
      title: title + pt,
      description: intro + (p > 1 ? ` (صفحة ${p})` : ""),
      canonical: rel,
      noindex: !index,
      prev: p > 1 ? (p === 2 ? base : `${base}page/${p - 1}/`) : null,
      next: p < pages ? `${base}page/${p + 1}/` : null,
      body: `<section class="wrap page">${c.html}<h1>${esc(h1 + pt)}</h1><p class="muted">${esc(intro)}</p>${grid(slice)}${nav}</section>`,
      image: slice[0] && slice[0].poster,
      jsonld: [c.ld, slice.length ? itemList(slice) : null],
    }), { index, lastmod: latest(slice) });
  }
}

function workPage(w) {
  const label = typeLabel(w.type);
  const what = w.type === "series" ? "المسلسل" : "الفيلم";
  const section = w.type === "series" ? { name: "المسلسلات", href: "/series/" } : { name: "الأفلام", href: "/movies/" };
  const c = crumbs([section, ...(w.genres[0] ? [{ name: w.genres[0], href: genreHref(w.genres[0]) }] : []), { name: w.title }]);
  const seoTitle = `${label} ${w.title}${w.year ? " " + w.year : ""} — القصة والأبطال${w.type === "series" ? " والحلقات" : ""} وتتفرج فين`;
  const desc = cut(w.story || `${label} ${w.title}${w.year ? " " + w.year : ""}`, 155);

  // أعمال مشابهة: نفس التصنيف، نفس الأشخاص، نفس السنة
  const ppl = new Set([...w.directors, ...w.writers, ...w.cast.map((x) => x.name)].map(slugify));
  const score = (x) =>
    x.genres.filter((g) => w.genres.includes(g)).length * 3 +
    [...x.directors, ...x.writers, ...x.cast.map((y) => y.name)].filter((n) => ppl.has(slugify(n))).length * 2 +
    (x.year && x.year === w.year ? 1 : 0) + (x.type === w.type ? 1 : 0);
  const related = works.filter((x) => x !== w).map((x) => [x, score(x)]).filter(([, s]) => s > 1).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x]) => x);

  const where = w.platforms.length
    ? `<h2 class="h">تتفرج على ${label} ${esc(w.title)} فين؟</h2>
<div class="where">${w.platforms
        .map((p) => {
          const cls = p.access === "مجانًا" ? "free" : p.access === "اشتراك" ? "sub" : "";
          return `<a class="plat" href="${esc(p.url)}" target="_blank" rel="nofollow noopener sponsored">${esc(p.name)}<em class="${cls}">${esc(p.access || "")}</em></a>`;
        })
        .join("")}</div>`
    : "";

  const eps =
    w.type === "series" && w.episodes.length
      ? `<h2 class="h">حلقات ${label} ${esc(w.title)}${w.episodes_count ? ` (${esc(w.episodes_count)} حلقات)` : ""}</h2>${epGrid(w)}`
      : "";

  const cast = w.cast.length
    ? `<h2 class="h">طاقم العمل</h2><div class="castgrid">${w.cast
        .map((p) => `<div><b>${personLink(p.name)}</b>${p.role ? `<span>${esc(p.role)}</span>` : ""}</div>`)
        .join("")}</div>`
    : "";

  const trailerId = w.trailerEmbed && (w.trailerEmbed.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/) || [])[1];
  const trailerDate = w.trailer_date || w.date || "";
  const ld = {
    "@context": "https://schema.org",
    "@type": w.type === "series" ? "TVSeries" : "Movie",
    name: w.title,
    ...(w.original_title ? { alternateName: w.original_title } : {}),
    url: absPath(w.href),
    ...(w.poster ? { image: abs(w.poster) } : {}),
    description: desc,
    ...(w.release_date ? { datePublished: w.release_date } : w.year ? { datePublished: String(w.year) } : {}),
    ...(w.genres.length ? { genre: w.genres } : {}),
    ...(w.language ? { inLanguage: w.language } : {}),
    ...(w.country ? { countryOfOrigin: { "@type": "Country", name: w.country } } : {}),
    ...(w.directors.length ? { director: w.directors.map((n) => ({ "@type": "Person", name: n, ...(personHref(n) ? { url: absPath(personHref(n)) } : {}) })) } : {}),
    ...(w.writers.length ? { author: w.writers.map((n) => ({ "@type": "Person", name: n })) } : {}),
    ...(w.cast.length ? { actor: w.cast.slice(0, 15).map((p) => ({ "@type": "Person", name: p.name, ...(personHref(p.name) ? { url: absPath(personHref(p.name)) } : {}) })) } : {}),
    ...(w.type === "movie" && w.runtime ? { duration: `PT${Number(w.runtime)}M` } : {}),
    ...(w.type === "series" && w.episodes_count ? { numberOfEpisodes: Number(w.episodes_count) } : {}),
    ...(w.type === "series" && w.episodes.length
      ? {
          episode: w.episodes.map((e) => ({
            "@type": "TVEpisode",
            episodeNumber: e.number,
            ...(w.episodes.some((x) => x.season > 1) ? { partOfSeason: { "@type": "TVSeason", seasonNumber: e.season } } : {}),
            name: e.title || e.label,
            ...(e.summary ? { description: cut(e.summary, 200) } : {}),
            url: absPath(e.href),
          })),
        }
      : {}),
    ...(trailerId && trailerDate
      ? {
          trailer: {
            "@type": "VideoObject",
            name: `الإعلان الرسمي — ${label} ${w.title}`,
            description: desc,
            embedUrl: `https://www.youtube.com/embed/${trailerId}`,
            thumbnailUrl: `https://i.ytimg.com/vi/${trailerId}/hqdefault.jpg`,
            uploadDate: trailerDate,
          },
        }
      : {}),
    ...(w.review && w.rating
      ? {
          review: {
            "@type": "Review",
            author: { "@type": "Organization", name: site.name },
            reviewRating: { "@type": "Rating", ratingValue: Number(w.rating), bestRating: 10, worstRating: 1 },
            reviewBody: cut(w.review, 300),
          },
        }
      : {}),
  };

  const watchTarget = w.type === "movie" ? (w.videos.length ? w.watchHref : null) : w.firstEp ? w.firstEp.href : null;
  const dlTarget = w.type === "movie" ? (w.downloads.length ? w.dlHref : null) : w.firstEp && w.firstEp.downloads.length ? w.firstEp.dlHref : null;
  const facts = [
    ["🏷️", "التصنيف", `<a href="${section.href}">${w.type === "series" ? "مسلسلات" : "أفلام"}</a>`, true],
    ["🎭", `نوع ${what}`, w.genres.map((g) => `<a href="${genreHref(g)}">${esc(g)}</a>`).join(" "), true],
    ["⏱️", `مدة ${what}`, w.runtime ? `${esc(w.runtime)} دقيقة` : "", true],
    ["📅", "سنة الإصدار", w.year ? `<a href="${yearHref(w.year)}">${esc(w.year)}</a>` : "", true],
    ["🗣️", "اللغة", w.language],
    ["🎞️", "الجودة", w.quality],
    ["🌍", "الدولة", w.country],
    ["🎬", "الإخراج", w.directors.map(personLink).join("، "), true],
    ["✍️", "التأليف", w.writers.map(personLink).join("، "), true],
    ["📺", "عدد الحلقات", w.type === "series" && w.episodes_count ? w.episodes_count : ""],
  ]
    .filter(([, , v]) => v)
    .map(([ic, k, v, raw]) => `<div class="fact"><span class="fact-k">${ic} ${k}:</span> <span class="fact-v">${raw ? v : esc(v)}</span></div>`)
    .join("");

  const body = `<section class="detail2" style="--img:url('${esc(w.backdrop || w.posterUrl)}')">
  <div class="detail-bg"></div>
  <div class="wrap d2">
    <aside class="d2-poster">
      <img class="poster" src="${esc(w.posterUrl)}" alt="بوستر ${esc(label + " " + w.title)}${w.year ? " " + w.year : ""}" ${dims(w.posterUrl, 300, 450)} fetchpriority="high" onerror="this.onerror=null;this.src='/assets/poster.svg'">
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
  <p class="tags">${w.genres.map((g) => `<a href="${genreHref(g)}">${esc(g)}</a>`).join("")}${w.year ? `<a href="${yearHref(w.year)}">أعمال ${esc(w.year)}</a>` : ""}${w.lists.map((l) => `<a href="${listHref(l)}">${esc(l)}</a>`).join("")}</p>
</section>
${rail("أعمال مشابهة", related, null)}
<div class="modal" id="trailer-modal" hidden><div class="modal-in"><button class="modal-x" aria-label="إغلاق">✕</button><div class="screen"></div></div></div>`;

  return layout({
    title: seoTitle,
    description: desc,
    canonical: w.href,
    body,
    image: w.backdrop || w.poster,
    imageAlt: `بوستر ${label} ${w.title}`,
    ogType: w.type === "series" ? "video.tv_show" : "video.movie",
    preload: w.poster ? `<link rel="preload" as="image" href="${esc(w.posterUrl)}" fetchpriority="high">` : "",
    jsonld: [ld, c.ld],
  });
}

const rightsNote = (w) => (w.rights ? `<p class="rights-note">ℹ️ ${esc(RIGHTS[w.rights])}${w.rights_note ? ` ${esc(w.rights_note)}` : ""}</p>` : "");

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
  const desc = cut(w.story || title, 155);
  const thumb = abs(w.backdrop || w.poster) || videoThumb(w.videos[0].embed);
  const vld = w.rights ? videoLd({ name: title, description: cut(w.story || title, 900), embed: w.videos[0].embed, thumb, date: w.video_date || w.date || w.release_date, minutes: w.runtime }) : null;
  const body = watchShell({ c, title, back: w.href, dl: w.downloads.length ? w.dlHref : null, playerBlock: playerSide(w.videos, w.backdrop || w.posterUrl), extra: rightsNote(w) }) +
    `<section class="wrap page-body">${site.ads?.in_page ? `<div class="ad">${site.ads.in_page}</div>` : ""}${w.story ? `<div class="box"><h2 class="box-h">قصة الفيلم</h2><div class="story">${paras(w.story)}</div></div>` : ""}</section>${rail("أفلام مشابهة", works.filter((x) => x !== w && x.type === "movie" && x.genres.some((g) => w.genres.includes(g))).slice(0, 12), null)}`;
  return {
    html: layout({ title: `مشاهدة ${title}`, description: desc, canonical: w.watchHref, body, image: w.backdrop || w.poster, ogType: "video.movie", ogVideo: vld ? w.videos[0].embed : "", noindex: !w.rights, jsonld: [vld, c.ld] }),
    video: vld,
  };
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
  const desc = cut(e.summary || w.story || title, 155);
  const poster = w.backdrop || w.posterUrl;
  const playerBlock = e.servers.length
    ? playerSide(e.servers, poster)
    : `<div class="noplay">الحلقة دي لسه مش متاحة للمشاهدة.${w.platforms.length ? ` تقدر تتفرج عليها على: ${w.platforms.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="nofollow noopener sponsored">${esc(p.name)}</a>`).join("، ")}` : ""}</div>`;
  const nav = `<div class="watch-actions">
      ${prev ? `<a class="pill" href="${prev.href}">→ ${esc(prev.label)}</a>` : ""}
      ${next ? `<a class="pill pill-next" href="${next.href}">${esc(next.label)} ←</a>` : ""}
    </div>`;
  const body = watchShell({ c, title, back: w.href, dl: e.downloads.length ? e.dlHref : null, playerBlock, extra: (e.servers.length ? rightsNote(w) : "") + nav }) + `
<section class="wrap page-body">
  ${site.ads?.in_page ? `<div class="ad">${site.ads.in_page}</div>` : ""}
  <div class="box">
    <h2 class="box-h">المواسم والحلقات</h2>
    ${epGrid(w, e)}
  </div>
  ${e.summary ? `<div class="box"><h2 class="box-h">قصة الحلقة</h2><div class="story">${paras(e.summary)}</div></div>` : ""}
</section>`;
  const vld = w.rights && e.servers.length
    ? videoLd({ name: title, description: cut(e.summary || w.story || title, 900), embed: e.servers[0].embed, thumb: abs(w.backdrop || w.poster) || videoThumb(e.servers[0].embed), date: e.date || w.date || w.release_date, minutes: w.runtime })
    : null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "TVEpisode",
    name: e.title || title,
    url: absPath(e.href),
    episodeNumber: e.number,
    partOfSeason: { "@type": "TVSeason", seasonNumber: e.season },
    description: desc,
    ...(w.poster ? { image: abs(w.poster) } : {}),
    partOfSeries: { "@type": "TVSeries", name: w.title, url: absPath(w.href) },
  };
  return {
    html: layout({ title, description: desc, canonical: e.href, body, image: w.backdrop || w.poster, ogType: "video.episode", ogVideo: vld ? e.servers[0].embed : "", noindex: !e.index, prev: prev && prev.index ? prev.href : null, next: next && next.index ? next.href : null, jsonld: [ld, vld, c.ld] }),
    video: vld,
  };
}

function personPage(p) {
  const list = [...p.works.keys()];
  const roles = [...new Set([...p.works.values()].flatMap((s) => [...s]))];
  const roleText = roles.map((r) => ({ "إخراج": "مخرج", "تأليف": "مؤلف", "تمثيل": "ممثل" }[r])).join(" و");
  const c = crumbs([{ name: p.name }]);
  const intro = `أعمال ${p.name} على Watchly (${roleText}): ${list.slice(0, 5).map((w) => `${typeLabel(w.type)} ${w.title}`).join("، ")}${list.length > 5 ? " وغيرها" : ""}.`;
  const roleOf = (w) => (w.cast.find((x) => slugify(x.name) === p.key) || {}).role;
  const rows = list.map((w) => `<li><a href="${w.href}">${typeLabel(w.type)} ${esc(w.title)}${w.year ? ` (${esc(w.year)})` : ""}</a> — ${[...p.works.get(w)].map(esc).join("، ")}${roleOf(w) ? ` (دور ${esc(roleOf(w))})` : ""}</li>`).join("");
  return layout({
    title: `أعمال ${p.name} — أفلام ومسلسلات`,
    description: intro,
    canonical: p.href,
    noindex: list.length < MIN_PERSON,
    body: `<section class="wrap page">${c.html}<h1>أعمال ${esc(p.name)}</h1><p class="muted">${esc(intro)}</p><ul class="filmo">${rows}</ul>${grid(list)}</section>`,
    image: list[0] && list[0].poster,
    jsonld: [c.ld, { "@context": "https://schema.org", "@type": "Person", name: p.name, url: absPath(p.href) }],
  });
}

function textPage(slug, title, html) {
  const c = crumbs([{ name: title }]);
  return layout({ title, canonical: `/${slug}/`, description: `${title} — ${site.name}: ${cut(String(html).replace(/<[^>]+>/g, " "), 120)}`, body: `<section class="wrap page narrow">${c.html}<h1>${esc(title)}</h1><div class="story">${html}</div></section>`, jsonld: [c.ld] });
}

function chipsPage({ rel, title, h1, intro, items }) {
  const c = crumbs([{ name: h1 }]);
  page(rel, layout({
    title, canonical: rel, description: intro, noindex: !items.length,
    body: `<section class="wrap page">${c.html}<h1>${esc(h1)}</h1><p class="muted">${esc(intro)}</p><div class="chips">${items.map(([name, href, n]) => `<a href="${href}">${esc(name)} <small>${n}</small></a>`).join("")}</div></section>`,
    jsonld: [c.ld],
  }), { index: !!items.length });
}

/* ================= البناء ================= */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(ROOT, "assets"), path.join(OUT, "assets"));
copyDir(path.join(ROOT, "images"), path.join(OUT, "images"));

page("/", homePage(), { lastmod: latest(works) });
listPages({ title: "مسلسلات عربي وأجنبي: القصة والحلقات وتتفرج فين", h1: "المسلسلات", intro: "كل المسلسلات على Watchly: القصة، الحلقات، الأبطال، وتتفرج عليها فين.", list: series, base: "/series/", crumbItems: [{ name: "المسلسلات" }] });
listPages({ title: "أفلام عربي وأجنبي: القصة والأبطال وتتفرج فين", h1: "الأفلام", intro: "كل الأفلام على Watchly: القصة، الأبطال، الإعلان الرسمي، وتتفرج عليها فين.", list: movies, base: "/movies/", crumbItems: [{ name: "الأفلام" }] });
listPages({ title: "أفلام ومسلسلات تتفرج عليها مجانًا وبشكل قانوني", h1: "تتفرج عليه مجانًا", intro: "أعمال متاحة للمشاهدة المجانية بشكل قانوني: على قنوات يوتيوب الرسمية أو لأنها ملكية عامة.", list: works.filter((w) => w.platforms.some((p) => p.access === "مجانًا") || ["public_domain", "cc"].includes(w.rights)), base: "/free/", crumbItems: [{ name: "مجانًا" }], min: MIN_LIST });

chipsPage({ rel: "/genres/", title: "تصنيفات الأفلام والمسلسلات", h1: "التصنيفات", intro: "تصفح الأفلام والمسلسلات حسب التصنيف على Watchly.", items: genres.map((g) => [g, genreHref(g), works.filter((w) => w.genres.includes(g)).length]) });
chipsPage({ rel: "/years/", title: "الأفلام والمسلسلات حسب سنة الإنتاج", h1: "حسب السنة", intro: "تصفح الأفلام والمسلسلات حسب سنة العرض على Watchly.", items: years.map((y) => [String(y), yearHref(y), works.filter((w) => w.year === y).length]) });
if (lists.length) chipsPage({ rel: "/lists/", title: "قوائم الأفلام والمسلسلات", h1: "القوائم", intro: "قوائم مختارة من الأفلام والمسلسلات على Watchly.", items: lists.map((l) => [l, listHref(l), works.filter((w) => w.lists.includes(l)).length]) });

for (const l of lists)
  listPages({ title: `${l} — قائمة الأعمال`, h1: l, intro: `كل الأعمال في قائمة «${l}» على Watchly، مع القصة وأماكن المشاهدة.`, list: works.filter((w) => w.lists.includes(l)), base: listHref(l), crumbItems: [{ name: "القوائم", href: "/lists/" }, { name: l }], min: MIN_LIST });
for (const g of genres) {
  const list = works.filter((w) => w.genres.includes(g));
  listPages({ title: `أفلام ومسلسلات ${g}`, h1: `أفلام ومسلسلات ${g}`, intro: `قائمة أفلام ومسلسلات ${g} على Watchly (${list.length} عمل)، مع القصة والأبطال وأماكن المشاهدة.`, list, base: genreHref(g), crumbItems: [{ name: "التصنيفات", href: "/genres/" }, { name: g }], min: MIN_LIST });
}
for (const y of years) {
  const list = works.filter((w) => w.year === y);
  listPages({ title: `أفلام ومسلسلات ${y}`, h1: `أفلام ومسلسلات ${y}`, intro: `الأفلام والمسلسلات اللي اتعرضت سنة ${y} على Watchly (${list.length} عمل)، مع القصة وتتفرج فين.`, list, base: yearHref(y), crumbItems: [{ name: "حسب السنة", href: "/years/" }, { name: String(y) }], min: MIN_LIST });
}
for (const p of persons.values()) page(p.href, personPage(p), { index: p.works.size >= MIN_PERSON, lastmod: latest([...p.works.keys()]) });

const vidEntry = (v) => v && { thumb: v.thumbnailUrl, name: v.name, description: v.description, player: v.embedUrl, date: v.uploadDate, seconds: v.duration ? Number(v.duration.replace(/\D/g, "")) * 60 : 0 };
for (const w of works) {
  page(w.href, workPage(w), {
    group: "works",
    lastmod: w.date || w.release_date || "",
    images: w.poster ? [{ loc: abs(w.poster) }] : [],
  });
  if (w.type === "movie" && w.videos.length) {
    const m = moviePage(w);
    page(w.watchHref, m.html, { index: !!w.rights, group: "works", lastmod: w.date || "", videos: m.video ? [vidEntry(m.video)] : [] });
  }
  if (w.downloads.length)
    write(w.dlHref.replace(/^\//, "") + "index.html", downloadPage({
      title: `${typeLabel(w.type)} ${w.title}`, back: w.href, backLabel: `رجوع لصفحة ${w.type === "movie" ? "الفيلم" : "المسلسل"}`,
      crumbItems: [{ name: w.type === "series" ? "المسلسلات" : "الأفلام", href: w.type === "series" ? "/series/" : "/movies/" }, { name: w.title, href: w.href }, { name: "تحميل" }],
      downloads: w.downloads, canonical: w.dlHref, image: w.poster,
    }));
  if (w.type === "series")
    w.episodes.forEach((e, i) => {
      const ep = episodePage(w, e, i);
      page(e.href, ep.html, { index: e.index, group: "episodes", lastmod: e.date || w.date || "", videos: ep.video ? [vidEntry(ep.video)] : [] });
      if (e.downloads.length)
        write(e.dlHref.replace(/^\//, "") + "index.html", downloadPage({
          title: `${typeLabel(w.type)} ${w.title} ${e.label}`, back: e.href, backLabel: `رجوع لصفحة المشاهدة`,
          crumbItems: [{ name: "المسلسلات", href: "/series/" }, { name: w.title, href: w.href }, { name: e.label, href: e.href }, { name: "تحميل" }],
          downloads: e.downloads, canonical: e.dlHref, image: w.poster,
        }));
    });
}

page("/about/", textPage("about", "من نحن", paras(site.about)));
page("/privacy/", textPage("privacy", "سياسة الخصوصية", paras(site.privacy)));
page("/dmca/", textPage("dmca", "حقوق النشر (DMCA)", paras(site.dmca || "بنحترم حقوق النشر. لو انت صاحب حقوق أي عمل معروض في الموقع وشايف إنه معروض من غير إذنك، ابعتلنا على الإيميل اللي تحت اسم العمل ورابط الصفحة وما يثبت ملكيتك، وهنشيله في أسرع وقت.") + `<p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>`));
page("/contact/", textPage("contact", "اتصل بنا", `<p>لأي اقتراح أو تصحيح أو تعاون، راسلنا على:</p><p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>`));

// البحث (صفحة + فهرس JSON) — مش بتتأرشف
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
  k: [w.genres.join(" "), w.cast.map((c) => c.name).join(" "), w.directors.join(" "), w.writers.join(" ")].join(" "),
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

// 404 (من غير canonical)
write("404.html", layout({ title: "الصفحة مش موجودة", noindex: true, body: `<section class="wrap page narrow center"><div class="big">404</div><h1>الصفحة دي مش موجودة</h1><p>جرّبي <a class="y" href="/search/">البحث</a> أو ارجعي للرئيسية.</p><p><a class="btn" href="/">رجوع للرئيسية</a></p></section>` }));

/* ---------- sitemaps (sitemap.xml = فهرس) ---------- */
const xmlEsc = (s) => esc(s).replace(/'/g, "&apos;");
const urlXml = (u, extra = "") => `  <url><loc>${xmlEsc(absPath(u.loc))}</loc>${u.lastmod ? `<lastmod>${xmlEsc(u.lastmod)}</lastmod>` : ""}${extra}</url>`;
const maps = [];
const sitemap = (file, list, ns, extraFn = () => "") => {
  if (!list.length) return;
  write(file, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${list.map((u) => urlXml(u, extraFn(u))).join("\n")}\n</urlset>\n`);
  maps.push({ file, lastmod: list.map((u) => u.lastmod).filter(Boolean).sort().pop() || NOW });
};
const IMG_NS = ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';
const VID_NS = ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"';
sitemap("sitemap-pages.xml", urls.filter((u) => u.group === "pages"), "");
sitemap("sitemap-works.xml", urls.filter((u) => u.group === "works" && !u.videos.length), IMG_NS, (u) => u.images.map((i) => `<image:image><image:loc>${xmlEsc(i.loc)}</image:loc></image:image>`).join(""));
sitemap("sitemap-episodes.xml", urls.filter((u) => u.group === "episodes" && !u.videos.length), "");
sitemap("sitemap-videos.xml", urls.filter((u) => u.videos.length), VID_NS, (u) =>
  u.videos.map((v) => `\n    <video:video><video:thumbnail_loc>${xmlEsc(v.thumb)}</video:thumbnail_loc><video:title>${xmlEsc(v.name)}</video:title><video:description>${xmlEsc(v.description)}</video:description><video:player_loc>${xmlEsc(v.player)}</video:player_loc>${v.seconds ? `<video:duration>${v.seconds}</video:duration>` : ""}<video:publication_date>${xmlEsc(v.date)}</video:publication_date><video:family_friendly>yes</video:family_friendly></video:video>`).join("") + "\n  ");
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.map((m) => `  <sitemap><loc>${BASE}/${m.file}</loc><lastmod>${m.lastmod}</lastmod></sitemap>`).join("\n")}\n</sitemapindex>\n`);

write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /search/\nDisallow: /tool/\n\nSitemap: ${BASE}/sitemap.xml\n`);

/* ---------- redirects + headers (Cloudflare) ---------- */
write("_redirects", redirects.map(([from, to]) => `${encodeURI(from)} ${to} 301`).join("\n") + "\n");
write("_headers", `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/assets/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800

/images/*
  Cache-Control: public, max-age=2592000

/*/download/*
  X-Robots-Tag: noindex

/search/*
  X-Robots-Tag: noindex

/sitemap*.xml
  Cache-Control: public, max-age=3600
`);

// ads.txt (لو اتحط في site.json)
if (site.ads_txt) write("ads.txt", site.ads_txt.trim() + "\n");

if (!/^https:\/\/[^/]+\.[^/]+$/.test(BASE)) warnings.push(`⚠️ رابط الموقع في الإعدادات (${site.url}) شكله مش صحيح — لازم يبقى زي https://www.watchlyar.com`);
console.log(`✅ اتبنى الموقع: ${works.length} عمل (${series.length} مسلسل، ${movies.length} فيلم)، ${genres.length} تصنيف، ${persons.size} شخص، ${urls.length} صفحة في الـ sitemap.`);
warnings.forEach((w) => console.log(w));
