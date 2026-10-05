/* Watchly — جافاسكريبت الموقع */
(function () {
  /* ---- الهيدر: يختفي وانت نازل ويظهر وانت طالع ---- */
  var hdr = document.getElementById("hdr"), last = 0;
  window.addEventListener("scroll", function () {
    var y = window.scrollY;
    hdr.classList.toggle("solid", y > 10);
    if (y > last + 6 && y > 80 && !nav.classList.contains("open")) hdr.classList.add("hide");
    else if (y < last - 6) hdr.classList.remove("hide");
    last = y;
  }, { passive: true });

  /* ---- قائمة الموبايل + تعليم اللينك الحالي ---- */
  var nav = document.getElementById("nav");
  document.getElementById("burger").addEventListener("click", function () { nav.classList.toggle("open"); });
  nav.querySelectorAll("a").forEach(function (a) {
    var h = a.getAttribute("href");
    if (h === "/" ? location.pathname === "/" : location.pathname.indexOf(h) === 0) a.classList.add("on");
  });

  /* ---- المشغل ---- */
  function ok(u) { return /^https?:\/\//i.test(String(u || "")); }
  document.querySelectorAll(".player").forEach(function (p) {
    var btns = p.querySelectorAll(".srv"), screen = p.querySelector(".screen");
    function load(i) {
      var b = btns[i]; if (!b) return;
      btns.forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      var src = b.getAttribute("data-src");
      if (!ok(src)) { screen.innerHTML = '<p style="padding:30px;text-align:center">⚠️ مصدر غير مسموح</p>'; return; }
      var f = document.createElement("iframe");
      f.src = src; f.allowFullscreen = true;
      f.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
      screen.innerHTML = ""; screen.appendChild(f);
    }
    btns.forEach(function (b, i) { b.addEventListener("click", function () { load(i); }); });
    var play = p.querySelector(".play");
    if (play) play.addEventListener("click", function () { load(0); });
  });

  /* ---- التريلر في نافذة ---- */
  var modal = document.getElementById("trailer-modal");
  if (modal) {
    var mscreen = modal.querySelector(".screen");
    var close = function () { modal.hidden = true; mscreen.innerHTML = ""; };
    document.querySelectorAll("[data-trailer]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = document.createElement("iframe");
        f.src = b.getAttribute("data-trailer") + (b.getAttribute("data-trailer").indexOf("?") > -1 ? "&" : "?") + "autoplay=1";
        f.allowFullscreen = true; f.setAttribute("allow", "autoplay; encrypted-media; fullscreen");
        mscreen.innerHTML = ""; mscreen.appendChild(f); modal.hidden = false;
      });
    });
    modal.querySelector(".modal-x").addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ---- البحث ---- */
  var q = document.getElementById("q");
  if (q) {
    var box = document.getElementById("results"), data = null;
    var norm = function (s) {
      return String(s || "").toLowerCase()
        .replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ً-ْ]/g, "");
    };
    var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    function run() {
      var term = norm(q.value.trim());
      history.replaceState(null, "", term ? "?q=" + encodeURIComponent(q.value.trim()) : location.pathname);
      if (term.length < 2) { box.innerHTML = ""; return; }
      var hits = data.filter(function (w) { return norm(w.t + " " + w.o + " " + w.k).indexOf(term) > -1; });
      box.innerHTML = hits.length ? hits.map(function (w) {
        return '<a class="card" href="' + esc(w.h) + '"><div class="card-img"><img src="' + esc(w.p) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'/assets/poster.svg\'"><span class="badge-type">' + esc(w.ty) + '</span></div><h3>' + esc(w.t) + '</h3><p>' + esc(w.y) + "</p></a>";
      }).join("") : '<p class="empty" style="grid-column:1/-1">مفيش نتايج لـ «' + esc(q.value) + "»</p>";
    }
    fetch("/search.json").then(function (r) { return r.json(); }).then(function (d) {
      data = d;
      var init = new URLSearchParams(location.search).get("q");
      if (init) q.value = init;
      run();
    });
    var t; q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { if (data) run(); }, 200); });
  }
})();
