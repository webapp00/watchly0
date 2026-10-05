/* أداة جلب بيانات فيلم/مسلسل من Wikidata (مجانية ومسموح استخدامها تجاريًا CC0) */
(function () {
  var API = "https://www.wikidata.org/w/api.php";
  var q = document.getElementById("t-q"), go = document.getElementById("t-go"),
      list = document.getElementById("t-list"), out = document.getElementById("t-out"), msg = document.getElementById("t-msg");

  function api(params) {
    var u = new URL(API);
    params.format = "json"; params.origin = "*";
    Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); });
    return fetch(u).then(function (r) { return r.json(); });
  }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var lbl = function (e) { return e && e.labels ? ((e.labels.ar || e.labels["arz"] || e.labels.en || {}).value || "") : ""; };
  var lblEn = function (e) { return e && e.labels && e.labels.en ? e.labels.en.value : ""; };
  function ids(ent, p) { return ((ent.claims || {})[p] || []).map(function (c) { var v = c.mainsnak.datavalue; return v && v.value && v.value.id; }).filter(Boolean); }
  function val(ent, p) { var c = ((ent.claims || {})[p] || [])[0]; return c && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : null; }

  function search() {
    var t = q.value.trim(); if (t.length < 2) return;
    msg.textContent = "جاري البحث..."; list.innerHTML = ""; out.innerHTML = "";
    Promise.all([
      api({ action: "wbsearchentities", search: t, language: "ar", uselang: "ar", type: "item", limit: 10 }),
      api({ action: "wbsearchentities", search: t, language: "en", uselang: "ar", type: "item", limit: 10 }),
    ]).then(function (rs) {
      var seen = {}, items = [];
      rs.forEach(function (r) { (r.search || []).forEach(function (i) { if (!seen[i.id]) { seen[i.id] = 1; items.push(i); } }); });
      msg.textContent = items.length ? "اختاري العمل الصح:" : "مفيش نتايج. جربي الاسم بالإنجليزي.";
      list.innerHTML = items.map(function (i) {
        return '<button class="t-item" data-id="' + i.id + '"><b>' + esc(i.label) + "</b><small>" + esc(i.description || "") + "</small></button>";
      }).join("");
    }).catch(function () { msg.textContent = "حصل خطأ في الاتصال. جربي تاني."; });
  }

  function load(id) {
    msg.textContent = "جاري جلب البيانات..."; out.innerHTML = "";
    api({ action: "wbgetentities", ids: id, props: "labels|claims", languages: "ar|arz|en" }).then(function (r) {
      var e = r.entities[id];
      var refs = [].concat(ids(e, "P31"), ids(e, "P495"), ids(e, "P57"), ids(e, "P58"), ids(e, "P161").slice(0, 12), ids(e, "P136"), ids(e, "P364"));
      var uniq = refs.filter(function (x, i) { return refs.indexOf(x) === i; });
      var chunks = []; for (var i = 0; i < uniq.length; i += 45) chunks.push(uniq.slice(i, i + 45));
      return Promise.all(chunks.map(function (c) { return api({ action: "wbgetentities", ids: c.join("|"), props: "labels", languages: "ar|arz|en" }); }))
        .then(function (rs) {
          var L = {}; rs.forEach(function (x) { Object.assign(L, x.entities || {}); });
          var names = function (p, n) { return ids(e, p).slice(0, n || 99).map(function (x) { return lbl(L[x]); }).filter(Boolean); };
          var types = ids(e, "P31");
          var isSeries = types.some(function (t) { return ["Q5398426", "Q1259759", "Q526877", "Q581714", "Q117467246"].indexOf(t) > -1; }) || /series|مسلسل/i.test(types.map(function (t) { return lblEn(L[t]); }).join(" "));
          var date = val(e, "P577") || val(e, "P580");
          var d = date && date.time ? date.time.replace(/^\+/, "").slice(0, 10).replace(/-00/g, "-01") : "";
          var dur = val(e, "P2047");
          var eps = val(e, "P1113");
          var enTitle = lblEn(e), arTitle = (e.labels.ar || e.labels.arz || {}).value || "";
          var year = d.slice(0, 4);
          var slug = (enTitle || arTitle).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + (year ? "-" + year : "");
          var cast = names("P161", 12);
          var rows = [
            ["النوع", isSeries ? "مسلسل" : "فيلم"],
            ["الاسم بالعربي", arTitle || "(مش موجود — اكتبيه بنفسك)"],
            ["الاسم الأصلي", enTitle],
            ["الرابط (slug)", slug],
            ["السنة", year],
            ["تاريخ العرض", d],
            ["بلد الإنتاج", names("P495").join("، ")],
            ["اللغة", names("P364").join("، ")],
            ["المدة (بالدقايق)", dur ? Math.round(+dur.amount) : ""],
            ["عدد الحلقات", eps ? Math.round(+eps.amount) : ""],
            ["الإخراج", names("P57").join("، ")],
            ["التأليف", names("P58").join("، ")],
            ["التصنيفات", names("P136").join("\n")],
            ["طاقم العمل", cast.join("\n")],
          ].filter(function (r) { return r[1] !== "" && r[1] != null; });
          msg.textContent = "انسخي كل خانة ⧉ والصقيها في لوحة التحكم. القصة والرأي اكتبيهم بأسلوبك.";
          out.innerHTML = rows.map(function (r) {
            return '<div class="t-row"><span class="t-k">' + esc(r[0]) + '</span><pre class="t-v">' + esc(r[1]) + '</pre><button class="t-copy" title="نسخ">⧉</button></div>';
          }).join("") + '<p class="muted small">المصدر: <a class="y" target="_blank" rel="noopener" href="https://www.wikidata.org/wiki/' + id + '">Wikidata ' + id + "</a>. البيانات دي ممكن تكون ناقصة أو فيها غلط، راجعيها.</p>";
        });
    }).catch(function () { msg.textContent = "حصل خطأ في الاتصال. جربي تاني."; });
  }

  go.addEventListener("click", search);
  q.addEventListener("keydown", function (e) { if (e.key === "Enter") search(); });
  list.addEventListener("click", function (e) { var b = e.target.closest(".t-item"); if (b) load(b.getAttribute("data-id")); });
  out.addEventListener("click", function (e) {
    var b = e.target.closest(".t-copy"); if (!b) return;
    var t = b.parentNode.querySelector(".t-v").textContent;
    navigator.clipboard.writeText(t).then(function () { b.textContent = "✓"; setTimeout(function () { b.textContent = "⧉"; }, 1200); });
  });
})();
