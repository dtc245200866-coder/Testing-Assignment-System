/* ============================================================
   Ứng dụng "Tạo câu hỏi & ôn tập" — logic chính
   Hỗ trợ nhiều MÔN HỌC: mỗi môn là một option; trong môn có các chủ đề (chương).
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "quiz_subjects_v1";
  var subjects = [];
  var currentSubjectId = null;

  var quiz = {
    questions: [],
    index: 0,
    results: [],
    answered: false,
    flags: {}
  };

  var dragState = { assigned: {}, selected: null, termOrder: [] };
  var editingId = null;        // index trong mảng questions của môn đang sửa
  var editingSubjectId = null; // id môn đang sửa
  var subjectEditId = null;    // id môn đang đổi tên (modal môn học)

  /* ---------------- Cấu hình Supabase + xác thực ---------------- */
  var APP_CONFIG = window.APP_CONFIG || {};
  var SUPABASE_URL = APP_CONFIG.SUPABASE_URL || "";
  var SUPABASE_ANON_KEY = APP_CONFIG.SUPABASE_ANON_KEY || "";
  var db = null;
  var userId = null; // id người dùng đang đăng nhập

  function useSupabase() {
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  }
  function loadSupabaseClient() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = function () { resolve(window.supabase); };
      s.onerror = function () { reject(new Error("Không tải được Supabase client")); };
      document.head.appendChild(s);
    });
  }
  function cacheKey() {
    return STORAGE_KEY + (userId ? ":" + userId : "");
  }

  /* ---------------- Dữ liệu ---------------- */
  function loadLocalSubjects() {
    try {
      var raw = localStorage.getItem(cacheKey());
      if (!raw) raw = localStorage.getItem(STORAGE_KEY); // key cũ (di trú lần đầu)
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch (e) { /* bỏ qua, dùng seed */ }
    var seed = JSON.parse(JSON.stringify(window.SEED_SUBJECTS || []));
    // Di trú dữ liệu bản cũ (mảng câu hỏi phẳng của CNXHKH) vào môn đầu tiên
    try {
      var old = localStorage.getItem("cnxhkh_bank_v2");
      if (old) {
        var oldQ = JSON.parse(old);
        if (Array.isArray(oldQ) && oldQ.length && seed.length) {
          seed[0].questions = oldQ;
          localStorage.setItem(cacheKey(), JSON.stringify(seed));
        }
      }
    } catch (e2) { /* bỏ qua */ }
    return seed;
  }

  function loadSubjects() {
    if (useSupabase() && userId) {
      return db.from("app_data").select("data").eq("user_id", userId).maybeSingle().then(function (res) {
        if (res.error) throw res.error;
        if (res.data && Array.isArray(res.data.data)) {
          subjects = res.data.data;
          return;
        }
        // Chưa có dữ liệu trên cloud -> nạp từ local rồi đồng bộ lên
        subjects = loadLocalSubjects();
        saveSubjects();
      }).catch(function () {
        // Lỗi mạng -> dùng local
        subjects = loadLocalSubjects();
      });
    }
    subjects = loadLocalSubjects();
    return Promise.resolve();
  }

  function saveSubjects() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(subjects)); } catch (e) { /* bộ nhớ trình duyệt không khả dụng */ }
    if (useSupabase() && db && userId) {
      db.from("app_data").upsert({ user_id: userId, data: subjects, updated_at: new Date().toISOString() })
        .then(function () {}, function () { /* bỏ qua lỗi mạng */ });
    }
  }
  function resetSubjects() {
    subjects = JSON.parse(JSON.stringify(window.SEED_SUBJECTS || []));
    currentSubjectId = subjects.length ? subjects[0].id : null;
    saveSubjects();
  }
  function findSubject(id) {
    for (var i = 0; i < subjects.length; i++) if (subjects[i].id === id) return subjects[i];
    return null;
  }
  function currentSubject() {
    return findSubject(currentSubjectId) || subjects[0] || null;
  }
  function getBank() {
    var s = currentSubject();
    return s && s.questions ? s.questions : [];
  }
  function uid() {
    return "q" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }
  function subjectUid() {
    return "s" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  // Thông báo ngắn (thay cho toast() — không chạy được trong khung bảo mật của Artifact)
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  // Hộp xác nhận trong trang (thay cho confirm())
  function askConfirm(msg, okLabel, onYes) {
    document.getElementById("confirmMsg").textContent = msg;
    var ok = document.getElementById("confirmOk");
    ok.textContent = okLabel || "Xóa";
    document.getElementById("confirmModal").classList.remove("hidden");
    ok.onclick = function () {
      document.getElementById("confirmModal").classList.add("hidden");
      onYes && onYes();
    };
    document.getElementById("confirmCancel").onclick = function () {
      document.getElementById("confirmModal").classList.add("hidden");
    };
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function typeLabel(t) {
    return { mcq: "Trắc nghiệm", multi: "Nhiều đáp án", tf: "Đúng/Sai", drag: "Kéo thả" }[t] || t;
  }

  /* ---------------- Điều hướng (sidebar) ---------------- */
  function openSidebar() {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebarBackdrop").classList.add("show");
  }
  function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarBackdrop").classList.remove("show");
  }
  var sideItems = document.querySelectorAll(".side-nav .side-item");
  sideItems.forEach(function (item) {
    item.addEventListener("click", function () {
      navigate(viewToRoute(item.dataset.view));
      closeSidebar();
    });
  });
  function setActiveView(name) {
    sideItems.forEach(function (it) { it.classList.toggle("active", it.dataset.view === name); });
    showView(name);
  }
  function showView(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
    document.getElementById("view-" + name).classList.add("active");
    if (name === "quiz") renderHome();
    if (name === "manage") renderManage();
  }

  /* ---------------- Định tuyến URL (hash) ---------------- */
  var offlineMode = false;

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }
  function slugify(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
  }
  function findTopicBySlug(slug) {
    var map = {};
    getBank().forEach(function (q) {
      var t = q.topic || "Chung";
      map[slugify(t)] = t;
    });
    return map[slug] || null;
  }
  function routeParts() {
    return (location.hash || "#/").replace(/^#\/?/, "").split("/");
  }
  function viewToRoute(view) {
    return view === "manage" ? "quan-ly" : "on-tap";
  }
  function navigate(route) {
    var target = "#/" + route;
    if (location.hash === target) { applyRoute(); return; }
    location.hash = target; // kích hoạt hashchange -> applyRoute
  }
  function applyRoute() {
    var parts = routeParts();
    var section = parts[0] || "on-tap";

    // Chưa đăng nhập -> ép về trang đăng nhập
    if (useSupabase() && !userId && !offlineMode && section !== "dang-nhap") {
      history.replaceState(null, "", "#/dang-nhap");
      showAuthScreen();
      return;
    }
    if (section === "dang-nhap") {
      if (userId) { history.replaceState(null, "", "#/on-tap"); section = "on-tap"; }
      else { showAuthScreen(); return; }
    }

    if (section === "quan-ly") {
      var msid = parts[1] ? safeDecode(parts[1]) : null;
      if (msid && findSubject(msid)) currentSubjectId = msid;
      setActiveView("manage");
      return;
    }

    // section on-tap: #/on-tap[/<subjectId>[/<topic>]]
    var subjectId = parts[1] ? safeDecode(parts[1]) : null;
    if (subjectId && findSubject(subjectId)) currentSubjectId = subjectId;
    setActiveView("quiz"); // hiện view + renderHome theo môn đang chọn

    var topicSlug = parts[2] ? safeDecode(parts[2]) : null;
    var runTopic = null;
    var shouldRun = false;
    if (topicSlug) {
      if (topicSlug === "all") {
        shouldRun = true;
      } else {
        var found = findTopicBySlug(topicSlug);
        if (found) { shouldRun = true; runTopic = found; }
      }
    }
    if (shouldRun) {
      startQuiz(runTopic);
    } else {
      document.getElementById("quiz-run").classList.add("hidden");
      document.getElementById("quiz-result").classList.add("hidden");
      document.getElementById("quiz-home").classList.remove("hidden");
    }
  }
  window.addEventListener("hashchange", applyRoute);
  var btnMenu = document.getElementById("btnMenu");
  if (btnMenu) btnMenu.addEventListener("click", openSidebar);
  var sidebarBackdrop = document.getElementById("sidebarBackdrop");
  if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeSidebar);

  /* ---------------- Trang chọn môn học / chủ đề ---------------- */
  function renderHome() {
    renderSubjectList();
    renderTopicList();
    renderSidebarSubjects();
  }

  function renderSubjectList() {
    var list = document.getElementById("subjectList");
    if (!list) return;
    list.innerHTML = "";
    subjects.forEach(function (s) {
      var div = document.createElement("div");
      div.className = "subject-item" + (s.id === currentSubjectId ? " selected" : "");
      div.innerHTML = '<span class="subject-icon"></span>' +
        '<span class="s-body"><span class="s-name"></span><span class="s-count"></span></span>';
      div.querySelector(".subject-icon").textContent = s.icon || "📘";
      div.querySelector(".s-name").textContent = s.name;
      div.querySelector(".s-count").textContent = (s.questions ? s.questions.length : 0) + " câu";
      div.addEventListener("click", function () {
        navigate("on-tap/" + s.id);
      });
      list.appendChild(div);
    });
  }

  function renderTopicList() {
    var list = document.getElementById("topicList");
    var empty = document.getElementById("topicEmpty");
    if (!list) return;
    list.innerHTML = "";
    var bank = getBank();
    var topics = {};
    bank.forEach(function (q) {
      var t = q.topic || "Chung";
      topics[t] = (topics[t] || 0) + 1;
    });
    var allRow = topicRow("🎯 Tất cả câu hỏi", bank.length, null);
    list.appendChild(allRow);
    Object.keys(topics).forEach(function (t) {
      list.appendChild(topicRow(t, topics[t], t));
    });
    if (empty) empty.classList.toggle("hidden", bank.length > 0);
  }

  function renderSidebarSubjects() {
    var list = document.getElementById("sideSubjectList");
    if (!list) return;
    list.innerHTML = "";
    subjects.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "side-topic" + (s.id === currentSubjectId ? " active" : "");
      b.innerHTML = '<span>' + escapeHtml(s.name) + '</span><span class="st-count">' + (s.questions ? s.questions.length : 0) + "</span>";
      b.addEventListener("click", function () {
        navigate("on-tap/" + s.id);
        closeSidebar();
      });
      list.appendChild(b);
    });
  }

  function topicRow(name, count, topic) {
    var div = document.createElement("div");
    div.className = "topic-item";
    div.innerHTML = '<span class="t-name"></span><span class="t-count"></span>';
    div.querySelector(".t-name").textContent = name;
    div.querySelector(".t-count").textContent = count + " câu";
    div.addEventListener("click", function () {
      var slug = topic ? slugify(topic) : "all";
      navigate("on-tap/" + (currentSubjectId || "") + "/" + slug);
    });
    return div;
  }

  function startQuiz(topic) {
    var qs = getBank();
    if (topic) qs = qs.filter(function (q) { return q.topic === topic; });
    if (!qs.length) { toast("Môn học này chưa có câu hỏi nào để ôn."); return; }
    if (document.getElementById("shuffleToggle").checked) qs = shuffle(qs);
    quiz.questions = qs;
    quiz.index = 0;
    quiz.results = [];
    quiz.answered = false;
    quiz.flags = {};

    document.getElementById("quiz-home").classList.add("hidden");
    document.getElementById("quiz-result").classList.add("hidden");
    document.getElementById("quiz-run").classList.remove("hidden");
    renderQuestion();
  }

  document.getElementById("btnBackHome").addEventListener("click", goHome);
  document.getElementById("btnResultHome").addEventListener("click", goHome);
  function goHome() {
    navigate("on-tap" + (currentSubjectId ? "/" + currentSubjectId : ""));
  }

  /* ---------------- Render câu hỏi ---------------- */
  function renderQuestion() {
    var q = quiz.questions[quiz.index];
    quiz.answered = false;
    dragState = { assigned: {}, selected: null, termOrder: [] };

    document.getElementById("progressText").textContent =
      "Câu " + (quiz.index + 1) + " / " + quiz.questions.length;
    document.getElementById("progressFill").style.width =
      (quiz.index / quiz.questions.length * 100) + "%";

    var card = document.getElementById("questionCard");
    var subjName = currentSubject() ? currentSubject().name : "";
    var topicLabel = (subjName ? subjName + " · " : "") + (q.topic || "Chung");
    var tag = '<span class="q-tag">' + escapeHtml(topicLabel) +
              '<span class="q-type-tag">' + typeLabel(q.type) + "</span></span>";
    var html = tag + '<p class="q-text">' + escapeHtml(q.question) + "</p>";

    if (q.type === "mcq") html += renderMcq(q);
    else if (q.type === "multi") html += renderMulti(q);
    else if (q.type === "tf") html += renderTf(q);
    else if (q.type === "drag") html += renderDrag(q);

    card.innerHTML = html;
    bindQuestionEvents(q);

    document.getElementById("btnCheck").classList.remove("hidden");
    var btnNext = document.getElementById("btnNext");
    btnNext.textContent = (quiz.index === quiz.questions.length - 1) ? "Kết quả →" : "Sau →";
    var btnPrev = document.getElementById("btnPrev");
    if (btnPrev) btnPrev.disabled = (quiz.index === 0);
    var fb = document.getElementById("feedback");
    fb.className = "feedback";
    fb.innerHTML = "";

    var flagBtn = document.getElementById("btnFlag");
    if (flagBtn) {
      var flagged = !!quiz.flags[quiz.index];
      flagBtn.textContent = flagged ? "★ Đã đánh dấu" : "⭐ Đánh dấu khó";
      flagBtn.classList.toggle("flagged", flagged);
    }
  }

  function renderMcq(q) {
    var html = "";
    q.options.forEach(function (opt, i) {
      html += '<div class="option" data-i="' + i + '">' +
        '<span class="opt-letter">' + String.fromCharCode(65 + i) + "</span>" +
        "<span>" + escapeHtml(opt) + "</span></div>";
    });
    return html;
  }

  function renderMulti(q) {
    var html = '<p class="q-text" style="font-weight:400;font-size:13.5px;color:var(--muted)">Chọn ' +
      (q.pick || 2) + " đáp án đúng</p>";
    q.options.forEach(function (opt, i) {
      html += '<div class="option" data-i="' + i + '">' +
        '<span class="opt-letter">' + String.fromCharCode(65 + i) + "</span>" +
        "<span>" + escapeHtml(opt) + "</span></div>";
    });
    return html;
  }

  function renderTf(q) {
    var html = "";
    q.statements.forEach(function (st, i) {
      html += '<div class="tf-statement" data-i="' + i + '">' +
        '<div class="tf-text"><strong>' + (i + 1) + ".</strong> " + escapeHtml(st.text) + "</div>" +
        '<div class="tf-btns">' +
        '<button data-val="true">Đúng</button>' +
        '<button data-val="false">Sai</button>' +
        "</div></div>";
    });
    return html;
  }

  function renderDrag(q) {
    dragState.termOrder = shuffle(q.pairs.map(function (_, i) { return i; }));
    var html = '<div class="drag-zone">';
    html += '<div class="drag-pool"><h4>Kéo thả hoặc bấm chọn</h4><p class="drag-hint">Trên điện thoại: bấm chọn một đáp án, rồi bấm vào ô tương ứng.</p>';
    dragState.termOrder.forEach(function (ti) {
      html += '<div class="chip" draggable="true" data-term="' + ti + '">' +
        escapeHtml(q.pairs[ti].term) + "</div>";
    });
    html += "</div><div class='drag-targets'><h4>Thả vào phát biểu tương ứng</h4>";
    q.pairs.forEach(function (p, i) {
      html += '<div class="drag-target" data-target="' + i + '">' +
        '<div class="target-text">' + escapeHtml(p.definition) + "</div>" +
        '<div class="slot" data-slot="' + i + '"><span class="ph">— Thả vào đây —</span></div>' +
        "</div>";
    });
    html += "</div></div>";
    return html;
  }

  /* ---------------- Bind sự kiện câu hỏi ---------------- */
  function bindQuestionEvents(q) {
    var card = document.getElementById("questionCard");

    if (q.type === "mcq") {
      card.querySelectorAll(".option").forEach(function (el) {
        el.addEventListener("click", function () {
          if (quiz.answered) return;
          card.querySelectorAll(".option").forEach(function (o) { o.classList.remove("selected"); });
          el.classList.add("selected");
        });
      });
    }

    if (q.type === "multi") {
      var pick = q.pick || 2;
      card.querySelectorAll(".option").forEach(function (el) {
        el.addEventListener("click", function () {
          if (quiz.answered) return;
          var selected = card.querySelectorAll(".option.selected").length;
          if (el.classList.contains("selected")) { el.classList.remove("selected"); return; }
          if (selected >= pick) return;
          el.classList.add("selected");
        });
      });
    }

    if (q.type === "tf") {
      card.querySelectorAll(".tf-statement").forEach(function (st) {
        st.querySelectorAll("button").forEach(function (btn) {
          btn.addEventListener("click", function () {
            if (quiz.answered) return;
            st.querySelectorAll("button").forEach(function (b) {
              b.classList.remove("on-true", "on-false");
            });
            btn.classList.add(btn.dataset.val === "true" ? "on-true" : "on-false");
          });
        });
      });
    }

    if (q.type === "drag") {
      bindDragEvents(card, q);
    }
  }

  function bindDragEvents(card, q) {
    // HTML5 drag & drop
    card.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", chip.dataset.term);
        chip.classList.add("selected-chip");
      });
      chip.addEventListener("dragend", function () { chip.classList.remove("selected-chip"); });
      // click để chọn
      chip.addEventListener("click", function () {
        if (quiz.answered) return;
        var ti = parseInt(chip.dataset.term, 10);
        if (dragState.assigned && Object.values(dragState.assigned).indexOf(ti) !== -1) return;
        card.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("selected-chip"); });
        dragState.selected = ti;
        chip.classList.add("selected-chip");
      });
    });

    card.querySelectorAll(".drag-target").forEach(function (target) {
      target.addEventListener("dragover", function (e) { e.preventDefault(); });
      target.addEventListener("drop", function (e) {
        e.preventDefault();
        var ti = parseInt(e.dataTransfer.getData("text/plain"), 10);
        placeTerm(card, q, ti, parseInt(target.dataset.target, 10));
      });
      target.addEventListener("click", function () {
        if (quiz.answered) return;
        if (dragState.selected == null) return;
        placeTerm(card, q, dragState.selected, parseInt(target.dataset.target, 10));
      });
    });
  }

  function placeTerm(card, q, termIdx, targetIdx) {
    if (quiz.answered) return;
    // trả term cũ trong slot này về pool
    for (var key in dragState.assigned) {
      if (dragState.assigned[key] === termIdx) delete dragState.assigned[key];
    }
    dragState.assigned[targetIdx] = termIdx;
    dragState.selected = null;
    refreshDrag(card, q);
  }

  function removeTerm(card, q, targetIdx) {
    if (quiz.answered) return;
    delete dragState.assigned[targetIdx];
    refreshDrag(card, q);
  }

  function refreshDrag(card, q) {
    card.querySelectorAll(".chip").forEach(function (chip) {
      var ti = parseInt(chip.dataset.term, 10);
      var used = Object.values(dragState.assigned).indexOf(ti) !== -1;
      chip.classList.toggle("used", used);
      chip.classList.remove("selected-chip");
    });
    card.querySelectorAll(".drag-target").forEach(function (target) {
      var i = parseInt(target.dataset.target, 10);
      var slot = target.querySelector(".slot");
      var assigned = dragState.assigned[i];
      if (assigned != null) {
        slot.classList.add("filled");
        slot.innerHTML = '<span>' + escapeHtml(q.pairs[assigned].term) +
          '</span><span class="rm" data-rm="' + i + '">✕</span>';
      } else {
        slot.classList.remove("filled");
        slot.innerHTML = '<span class="ph">— Thả vào đây —</span>';
      }
    });
    card.querySelectorAll(".rm").forEach(function (rm) {
      rm.addEventListener("click", function (e) {
        e.stopPropagation();
        removeTerm(card, q, parseInt(rm.dataset.rm, 10));
      });
    });
  }

  /* ---------------- Kiểm tra đáp án ---------------- */
  function getUserAnswer(q) {
    var card = document.getElementById("questionCard");
    if (q.type === "mcq") {
      var sel = card.querySelector(".option.selected");
      return sel ? parseInt(sel.dataset.i, 10) : null;
    }
    if (q.type === "multi") {
      var idx = [];
      card.querySelectorAll(".option.selected").forEach(function (o) { idx.push(parseInt(o.dataset.i, 10)); });
      return idx.sort(function (a, b) { return a - b; });
    }
    if (q.type === "tf") {
      var arr = [];
      card.querySelectorAll(".tf-statement").forEach(function (st) {
        var on = st.querySelector("button.on-true, button.on-false");
        arr.push(on ? on.dataset.val === "true" : null);
      });
      return arr;
    }
    if (q.type === "drag") {
      var assigned = {};
      for (var k in dragState.assigned) assigned[k] = dragState.assigned[k];
      return assigned;
    }
    return null;
  }

  function isCorrect(q, ans) {
    if (q.type === "mcq") return ans === q.answer;
    if (q.type === "multi") {
      var a = q.answer.slice().sort(function (x, y) { return x - y; });
      return JSON.stringify(ans) === JSON.stringify(a);
    }
    if (q.type === "tf") {
      return q.statements.every(function (st, i) { return ans[i] === st.answer; });
    }
    if (q.type === "drag") {
      return q.pairs.every(function (_, i) { return ans[i] === i; });
    }
    return false;
  }

  document.getElementById("btnCheck").addEventListener("click", function () {
    if (quiz.answered) return;
    var q = quiz.questions[quiz.index];
    var ans = getUserAnswer(q);
    var card = document.getElementById("questionCard");
    var fb = document.getElementById("feedback");

    // kiểm tra đã trả lời đủ chưa
    var incomplete = false;
    if (q.type === "mcq" && ans == null) incomplete = true;
    if (q.type === "multi" && ans.length !== (q.pick || 2)) incomplete = true;
    if (q.type === "tf" && ans.some(function (a) { return a == null; })) incomplete = true;
    if (q.type === "drag" && Object.keys(ans).length !== q.pairs.length) incomplete = true;
    if (incomplete) {
      fb.className = "feedback show no";
      fb.innerHTML = "⚠️ Bạn chưa trả lời đủ. Hãy chọn đầy đủ đáp án.";
      return;
    }

    var ok = isCorrect(q, ans);
    quiz.answered = true;
    quiz.results[quiz.index] = ok;
    markCorrectAnswer(q, ans);

    fb.className = "feedback show " + (ok ? "ok" : "no");
    var msg = ok ? "✅ Chính xác!" : "❌ Chưa đúng.";
    fb.innerHTML = msg + (q.explanation ? '<div class="fb-explain"><strong>Giải thích:</strong> ' + escapeHtml(q.explanation) + "</div>" : "");

    document.getElementById("btnCheck").classList.add("hidden");
  });

  function markCorrectAnswer(q, ans) {
    var card = document.getElementById("questionCard");
    card.querySelectorAll(".option").forEach(function (o) { o.classList.add("locked"); });

    if (q.type === "mcq") {
      card.querySelectorAll(".option").forEach(function (o) {
        var i = parseInt(o.dataset.i, 10);
        if (i === q.answer) o.classList.add("correct");
        else if (ans === i) o.classList.add("wrong");
      });
    }
    if (q.type === "multi") {
      card.querySelectorAll(".option").forEach(function (o) {
        var i = parseInt(o.dataset.i, 10);
        if (q.answer.indexOf(i) !== -1) o.classList.add("correct");
        else if (ans.indexOf(i) !== -1) o.classList.add("wrong");
      });
    }
    if (q.type === "tf") {
      card.querySelectorAll(".tf-statement").forEach(function (st, i) {
        st.querySelectorAll("button").forEach(function (b) {
          b.classList.add("locked");
          b.classList.remove("on-true", "on-false");
        });
        var trueBtn = st.querySelector('button[data-val="true"]');
        var falseBtn = st.querySelector('button[data-val="false"]');
        var correctBtn = q.statements[i].answer ? trueBtn : falseBtn;
        correctBtn.classList.add("tf-correct");
        if (ans[i] !== q.statements[i].answer) {
          (ans[i] === true ? trueBtn : falseBtn).classList.add("tf-wrong");
        }
      });
    }
    if (q.type === "drag") {
      card.querySelectorAll(".drag-target").forEach(function (target) {
        var i = parseInt(target.dataset.target, 10);
        target.classList.add(ans[i] === i ? "correct" : "wrong");
      });
    }
  }

  document.getElementById("btnNext").addEventListener("click", function () {
    if (quiz.index < quiz.questions.length - 1) {
      quiz.index++;
      renderQuestion();
    } else {
      showResult();
    }
  });

  var btnPrev = document.getElementById("btnPrev");
  if (btnPrev) {
    btnPrev.addEventListener("click", function () {
      if (quiz.index > 0) {
        quiz.index--;
        renderQuestion();
      }
    });
  }

  function showResult() {
    document.getElementById("quiz-run").classList.add("hidden");
    document.getElementById("quiz-result").classList.remove("hidden");
    var total = quiz.questions.length;
    var score = quiz.results.filter(Boolean).length;
    document.getElementById("scoreBig").textContent = score + " / " + total;
    var pct = total ? score / total : 0;
    var msg = pct === 1 ? "🏆 Xuất sắc! Bạn nắm rất chắc kiến thức."
      : pct >= 0.8 ? "👍 Tốt lắm, ôn thêm phần sai là ổn."
      : pct >= 0.5 ? "📖 Khá. Hãy xem lại các câu sai dưới đây."
      : "💪 Cần ôn kỹ hơn. Xem lại các câu sai nhé.";
    document.getElementById("scoreMsg").textContent = msg;

    var wl = document.getElementById("wrongList");
    wl.innerHTML = "";
    quiz.questions.forEach(function (q, i) {
      if (quiz.results[i] === true) return;
      var div = document.createElement("div");
      div.className = "wrong-item";
      var ans = correctAnswerText(q);
      var status = quiz.results[i] === false ? "Sai" : "Chưa làm";
      div.innerHTML = '<div class="wi-q">' + escapeHtml(q.question) + "</div>" +
        '<div class="wi-a">' + status + " · Đáp án: " + escapeHtml(ans) + "</div>";
      wl.appendChild(div);
    });

    var wrongBtn = document.getElementById("btnRetryWrong");
    if (wrongBtn) {
      if (score === total) {
        wrongBtn.classList.add("hidden");
      } else {
        wrongBtn.classList.remove("hidden");
        wrongBtn.textContent = "Làm lại " + (total - score) + " câu sai";
      }
    }
  }

  function correctAnswerText(q) {
    if (q.type === "mcq") return String.fromCharCode(65 + q.answer) + ". " + q.options[q.answer];
    if (q.type === "multi") return q.answer.map(function (i) { return String.fromCharCode(65 + i); }).join(", ") +
      " — " + q.answer.map(function (i) { return q.options[i]; }).join("; ");
    if (q.type === "tf") return q.statements.map(function (s, i) { return (i + 1) + ") " + (s.answer ? "Đúng" : "Sai"); }).join("; ");
    if (q.type === "drag") return q.pairs.map(function (p) { return p.definition.split(" ").slice(0, 4).join(" ") + "… → " + p.term; }).join("; ");
    return "";
  }

  function startWith(questions) {
    if (document.getElementById("shuffleToggle").checked) questions = shuffle(questions);
    quiz.questions = questions;
    quiz.index = 0;
    quiz.results = [];
    quiz.answered = false;
    quiz.flags = {};
    document.getElementById("quiz-result").classList.add("hidden");
    document.getElementById("quiz-run").classList.remove("hidden");
    renderQuestion();
  }

  document.getElementById("btnRetry").addEventListener("click", function () {
    startWith(quiz.questions);
  });

  var btnRetryWrong = document.getElementById("btnRetryWrong");
  if (btnRetryWrong) {
    btnRetryWrong.addEventListener("click", function () {
      var wrong = quiz.questions.filter(function (q, i) { return !quiz.results[i]; });
      if (!wrong.length) { toast("Không có câu sai nào để làm lại."); return; }
      startWith(wrong);
    });
  }

  function toggleFlag() {
    quiz.flags[quiz.index] = !quiz.flags[quiz.index];
    var flagBtn = document.getElementById("btnFlag");
    if (!flagBtn) return;
    var flagged = !!quiz.flags[quiz.index];
    flagBtn.textContent = flagged ? "★ Đã đánh dấu" : "⭐ Đánh dấu khó";
    flagBtn.classList.toggle("flagged", flagged);
  }

  function openNav() {
    var grid = document.getElementById("navGrid");
    var total = quiz.questions.length;
    var done = 0, correct = 0, flagged = 0;
    for (var i = 0; i < total; i++) {
      if (quiz.results[i] !== undefined) done++;
      if (quiz.results[i] === true) correct++;
      if (quiz.flags[i]) flagged++;
    }
    document.getElementById("navSummary").textContent =
      "Đã làm " + done + "/" + total + " · Đúng " + correct + " · Đánh dấu " + flagged;

    grid.innerHTML = "";
    quiz.questions.forEach(function (q, i) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "nav-cell";
      cell.textContent = i + 1;
      if (i === quiz.index) cell.classList.add("current");
      if (quiz.results[i] === true) cell.classList.add("correct");
      else if (quiz.results[i] === false) cell.classList.add("wrong");
      if (quiz.flags[i]) cell.classList.add("flagged");
      cell.addEventListener("click", function () {
        quiz.index = i;
        document.getElementById("navModal").classList.add("hidden");
        renderQuestion();
      });
      grid.appendChild(cell);
    });
    document.getElementById("navModal").classList.remove("hidden");
  }

  var btnNav = document.getElementById("btnNav");
  if (btnNav) btnNav.addEventListener("click", openNav);
  var btnNavClose = document.getElementById("btnNavClose");
  if (btnNavClose) btnNavClose.addEventListener("click", function () {
    document.getElementById("navModal").classList.add("hidden");
  });
  var btnFlag = document.getElementById("btnFlag");
  if (btnFlag) btnFlag.addEventListener("click", toggleFlag);

  /* ---------------- Quản lý môn học ---------------- */
  function renderManageSubjects() {
    var sel = document.getElementById("manageSubject");
    if (!sel) return;
    sel.innerHTML = "";
    subjects.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === currentSubjectId) opt.selected = true;
      sel.appendChild(opt);
    });
    var count = document.getElementById("manageCount");
    if (count) count.textContent = getBank().length + " câu hỏi";
  }

  var manageSubject = document.getElementById("manageSubject");
  if (manageSubject) {
    manageSubject.addEventListener("change", function () {
      currentSubjectId = manageSubject.value;
      renderManage();
      renderHome();
    });
  }

  document.getElementById("btnAddSubject").addEventListener("click", function () { openSubjectModal(null); });
  document.getElementById("btnRenameSubject").addEventListener("click", function () {
    openSubjectModal(currentSubjectId);
  });
  document.getElementById("btnDelSubject").addEventListener("click", function () {
    var s = currentSubject();
    if (!s) return;
    if (subjects.length <= 1) { toast("Phải còn ít nhất một môn học."); return; }
    askConfirm('Xóa môn học "' + s.name + '" và ' + (s.questions ? s.questions.length : 0) + " câu hỏi của nó?", "Xóa", function () {
      subjects = subjects.filter(function (x) { return x.id !== s.id; });
      currentSubjectId = subjects[0].id;
      saveSubjects();
      renderManage();
      renderHome();
    });
  });

  function openSubjectModal(id) {
    subjectEditId = id || null;
    var s = id ? findSubject(id) : null;
    document.getElementById("subjectModalTitle").textContent = id ? "Đổi tên môn học" : "Thêm môn học";
    document.getElementById("subjectName").value = s ? s.name : "";
    document.getElementById("subjectModal").classList.remove("hidden");
  }

  document.getElementById("subjectCancel").addEventListener("click", function () {
    document.getElementById("subjectModal").classList.add("hidden");
  });
  document.getElementById("subjectSave").addEventListener("click", function () {
    var name = document.getElementById("subjectName").value.trim();
    if (!name) { toast("Vui lòng nhập tên môn học."); return; }
    if (subjectEditId) {
      var s = findSubject(subjectEditId);
      if (s) s.name = name;
    } else {
      subjects.push({ id: subjectUid(), name: name, icon: "📘", questions: [] });
      currentSubjectId = subjects[subjects.length - 1].id;
    }
    saveSubjects();
    document.getElementById("subjectModal").classList.add("hidden");
    renderManage();
    renderHome();
  });

  /* ---------------- Quản lý câu hỏi ---------------- */
  var managePage = 0;          // trang hiện tại của danh sách câu hỏi
  var lastManageSubjectId = null;
  var PAGE_SIZE = 20;

  function renderManage() {
    renderManageSubjects();
    if (currentSubjectId !== lastManageSubjectId) {
      managePage = 0;
      lastManageSubjectId = currentSubjectId;
    }
    var list = document.getElementById("manageList");
    list.innerHTML = "";
    var bank = getBank();
    if (!bank.length) {
      list.innerHTML = '<p class="hint">Môn học này chưa có câu hỏi. Bấm “＋ Thêm câu hỏi” hoặc “📄 Import Word/PDF/Ảnh”.</p>';
      renderPager(1);
      return;
    }
    var totalPages = Math.ceil(bank.length / PAGE_SIZE);
    if (managePage >= totalPages) managePage = 0;
    var start = managePage * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, bank.length);
    var pageItems = [];
    for (var i = start; i < end; i++) pageItems.push({ q: bank[i], idx: i });
    pageItems.forEach(function (item) {
      var q = item.q;
      var idx = item.idx;
      var div = document.createElement("div");
      div.className = "mg-item";
      var meta = typeLabel(q.type) + " · " + (q.topic || "Chung");
      div.innerHTML = '<div class="mg-top"><div class="mg-main">' +
        '<div class="mg-q"></div><div class="mg-meta"></div></div>' +
        '<div class="mg-btns"><button class="detail">Chi tiết</button><button class="edit">Sửa</button><button class="del">Xóa</button></div></div>';
      div.querySelector(".mg-q").textContent = "Câu " + (idx + 1);
      div.querySelector(".mg-meta").textContent = meta;
      div.querySelector(".detail").addEventListener("click", function () { openDetail(idx); });
      div.querySelector(".edit").addEventListener("click", function () { openEdit(idx); });
      div.querySelector(".del").addEventListener("click", function () {
        askConfirm("Xóa câu hỏi này?", "Xóa", function () {
          bank.splice(idx, 1); saveSubjects(); renderManage(); renderHome();
        });
      });
      list.appendChild(div);
    });
    renderPager(totalPages);
  }

  function renderPager(totalPages) {
    var pager = document.getElementById("managePager");
    if (!pager) return;
    pager.innerHTML = "";
    if (totalPages <= 1) { pager.classList.add("hidden"); return; }
    pager.classList.remove("hidden");
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "btn secondary sm";
    prev.textContent = "← Trước";
    prev.disabled = managePage === 0;
    prev.addEventListener("click", function () { managePage--; renderManage(); });
    var info = document.createElement("span");
    info.className = "pager-info";
    info.textContent = "Trang " + (managePage + 1) + " / " + totalPages;
    var next = document.createElement("button");
    next.type = "button";
    next.className = "btn secondary sm";
    next.textContent = "Sau →";
    next.disabled = managePage >= totalPages - 1;
    next.addEventListener("click", function () { managePage++; renderManage(); });
    pager.appendChild(prev);
    pager.appendChild(info);
    pager.appendChild(next);
  }

  document.getElementById("btnAdd").addEventListener("click", function () { openEdit(null); });
  document.getElementById("btnReset").addEventListener("click", function () {
    askConfirm("Đặt lại toàn bộ dữ liệu về bản gốc? Mọi thay đổi của bạn sẽ mất.", "Đặt lại", function () {
      resetSubjects(); renderManage(); renderHome();
    });
  });
  /* ---- Chi tiết câu hỏi ---- */
  var detailIdx = null;
  function openDetail(idx) {
    detailIdx = idx;
    var q = getBank()[idx];
    if (!q) return;
    document.getElementById("detailTitle").textContent = "Chi tiết câu hỏi";
    var html = '<p class="detail-meta">' +
      '<span class="dt-tag">' + typeLabel(q.type) + '</span>' +
      '<span class="dt-tag">' + escapeHtml(q.topic || "Chung") + '</span></p>' +
      '<div class="detail-q">' + escapeHtml(q.question) + '</div>';
    if (q.type === "mcq" || q.type === "multi") {
      var answers = q.type === "multi" ? q.answer : [q.answer];
      q.options.forEach(function (opt, i) {
        var isCorrect = answers.indexOf(i) !== -1;
        html += '<div class="detail-opt' + (isCorrect ? " correct" : "") + '">' +
          '<span class="dt-letter">' + String.fromCharCode(65 + i) + '</span>' +
          '<span>' + escapeHtml(opt) + '</span>' +
          (isCorrect ? '<span class="dt-ok">✓ Đúng</span>' : '') + '</div>';
      });
    } else if (q.type === "tf") {
      q.statements.forEach(function (st, i) {
        html += '<div class="detail-opt' + (st.answer ? " correct" : "") + '">' +
          '<span class="dt-letter">' + (i + 1) + '</span>' +
          '<span>' + escapeHtml(st.text) + '</span>' +
          '<span class="dt-ok">' + (st.answer ? "Đúng" : "Sai") + '</span></div>';
      });
    } else if (q.type === "drag") {
      q.pairs.forEach(function (p, i) {
        html += '<div class="detail-opt correct"><span class="dt-letter">' + (i + 1) + '</span>' +
          '<span><strong>' + escapeHtml(p.term) + '</strong> — ' + escapeHtml(p.definition) + '</span></div>';
      });
    }
    if (q.explanation) {
      html += '<div class="detail-explain"><strong>Giải thích:</strong> ' + escapeHtml(q.explanation) + '</div>';
    }
    document.getElementById("detailBody").innerHTML = html;
    document.getElementById("detailModal").classList.remove("hidden");
  }

  document.getElementById("btnDetailClose").addEventListener("click", function () {
    document.getElementById("detailModal").classList.add("hidden");
  });
  document.getElementById("btnDetailEdit").addEventListener("click", function () {
    document.getElementById("detailModal").classList.add("hidden");
    if (detailIdx != null) openEdit(detailIdx);
  });

  /* ---- Form thêm/sửa ---- */
  var editFormState = { options: [], statements: [], pairs: [], correct: null, correctMulti: [], pick: 2 };

  function populateSubjectSelect(sel, selectedId) {
    if (!sel) return;
    sel.innerHTML = "";
    subjects.forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function editingQuestion() {
    if (editingId == null) return null;
    var s = findSubject(editingSubjectId);
    return s && s.questions[editingId] ? s.questions[editingId] : null;
  }

  function openEdit(idx) {
    editingId = idx;
    editingSubjectId = currentSubjectId;
    var q = editingQuestion();
    document.getElementById("editTitle").textContent = idx == null ? "Thêm câu hỏi" : "Sửa câu hỏi";
    document.getElementById("fTopic").value = q ? (q.topic || "") : "";
    document.getElementById("fQuestion").value = q ? q.question : "";
    document.getElementById("fExplain").value = q ? (q.explanation || "") : "";
    document.getElementById("fType").value = q ? q.type : "mcq";
    populateSubjectSelect(document.getElementById("fSubject"), currentSubjectId);

    editFormState.options = q && q.options ? q.options.slice() : ["", "", "", ""];
    editFormState.correct = q && q.type === "mcq" ? q.answer : 0;
    editFormState.correctMulti = q && q.type === "multi" ? q.answer.slice() : [0];
    editFormState.pick = q && q.pick ? q.pick : 2;
    editFormState.statements = q && q.type === "tf" ? q.statements.map(function (s) { return { text: s.text, answer: s.answer }; }) : [{ text: "", answer: true }, { text: "", answer: true }];
    editFormState.pairs = q && q.type === "drag" ? q.pairs.map(function (p) { return { term: p.term, definition: p.definition }; }) : [{ term: "", definition: "" }, { term: "", definition: "" }];

    buildFormBody();
    document.getElementById("editModal").classList.remove("hidden");
  }

  document.getElementById("fType").addEventListener("change", buildFormBody);
  document.getElementById("btnCancelEdit").addEventListener("click", function () {
    document.getElementById("editModal").classList.add("hidden");
  });

  function buildFormBody() {
    var type = document.getElementById("fType").value;
    var body = document.getElementById("fBody");
    var html = "";

    if (type === "mcq" || type === "multi") {
      var pick = type === "multi";
      editFormState.options.forEach(function (opt, i) {
        var mark = pick
          ? '<label class="correct-mark" style="margin-left:8px"><input type="checkbox" class="cmark" data-i="' + i + '"' + (editFormState.correctMulti.indexOf(i) !== -1 ? " checked" : "") + '> đúng</label>'
          : '<label class="correct-mark" style="margin-left:8px"><input type="radio" name="mcorrect" class="cmark" data-i="' + i + '"' + (editFormState.correct === i ? " checked" : "") + '> đúng</label>';
        html += '<div class="fbody-row"><input type="text" class="fopt" data-i="' + i + '" value="' + escapeHtml(opt) + '" placeholder="Đáp án ' + String.fromCharCode(65 + i) + '">' + mark + '<span class="rm-row" data-i="' + i + '">✕</span></div>';
      });
      html += '<button type="button" class="btn secondary" id="btnAddOpt">＋ Thêm đáp án</button>';
      if (pick) {
        html += '<label style="margin-top:12px">Số đáp án đúng cần chọn<input type="number" id="fPick" min="1" value="' + editFormState.pick + '"></label>';
      }
    } else if (type === "tf") {
      editFormState.statements.forEach(function (st, i) {
        var checkedTrue = st.answer ? " checked" : "";
        var checkedFalse = st.answer ? "" : " checked";
        html += '<div class="fbody-row"><textarea class="fstmt" data-i="' + i + '" rows="1" placeholder="Phát biểu ' + (i + 1) + '">' + escapeHtml(st.text) + '</textarea>' +
          '<label class="correct-mark" style="margin-left:8px"><input type="radio" name="stmt' + i + '" class="stmtTrue" data-i="' + i + '"' + checkedTrue + '> Đúng</label>' +
          '<label class="correct-mark" style="margin-left:4px"><input type="radio" name="stmt' + i + '" class="stmtFalse" data-i="' + i + '"' + checkedFalse + '> Sai</label>' +
          '<span class="rm-row" data-i="' + i + '">✕</span></div>';
      });
      html += '<button type="button" class="btn secondary" id="btnAddStmt">＋ Thêm phát biểu</button>';
    } else if (type === "drag") {
      editFormState.pairs.forEach(function (p, i) {
        html += '<div class="fbody-row"><input type="text" class="fterm" data-i="' + i + '" value="' + escapeHtml(p.term) + '" placeholder="Khái niệm ' + (i + 1) + '">' +
          '<textarea class="fdef" data-i="' + i + '" rows="1" placeholder="Phát biểu tương ứng">' + escapeHtml(p.definition) + '</textarea>' +
          '<span class="rm-row" data-i="' + i + '">✕</span></div>';
      });
      html += '<button type="button" class="btn secondary" id="btnAddPair">＋ Thêm cặp</button>';
    }

    body.innerHTML = html;
    bindFormBody(type);
  }

  function bindFormBody(type) {
    var body = document.getElementById("fBody");
    body.querySelectorAll(".rm-row").forEach(function (el) {
      el.addEventListener("click", function () {
        var i = parseInt(el.dataset.i, 10);
        if (type === "mcq" || type === "multi") {
          editFormState.options.splice(i, 1);
          editFormState.correctMulti = editFormState.correctMulti.filter(function (x) { return x !== i; }).map(function (x) { return x > i ? x - 1 : x; });
          if (editFormState.correct === i) editFormState.correct = 0;
          else if (editFormState.correct > i) editFormState.correct--;
        } else if (type === "tf") { editFormState.statements.splice(i, 1); }
        else if (type === "drag") { editFormState.pairs.splice(i, 1); }
        buildFormBody();
      });
    });

    var addOpt = body.querySelector("#btnAddOpt");
    if (addOpt) addOpt.addEventListener("click", function () { editFormState.options.push(""); buildFormBody(); });
    var addStmt = body.querySelector("#btnAddStmt");
    if (addStmt) addStmt.addEventListener("click", function () { editFormState.statements.push({ text: "", answer: true }); buildFormBody(); });
    var addPair = body.querySelector("#btnAddPair");
    if (addPair) addPair.addEventListener("click", function () { editFormState.pairs.push({ term: "", definition: "" }); buildFormBody(); });

    body.querySelectorAll(".fopt").forEach(function (inp) {
      inp.addEventListener("input", function () { editFormState.options[parseInt(inp.dataset.i, 10)] = inp.value; });
    });
    body.querySelectorAll(".fstmt").forEach(function (inp) {
      inp.addEventListener("input", function () { editFormState.statements[parseInt(inp.dataset.i, 10)].text = inp.value; });
    });
    body.querySelectorAll(".fterm").forEach(function (inp) {
      inp.addEventListener("input", function () { editFormState.pairs[parseInt(inp.dataset.i, 10)].term = inp.value; });
    });
    body.querySelectorAll(".fdef").forEach(function (inp) {
      inp.addEventListener("input", function () { editFormState.pairs[parseInt(inp.dataset.i, 10)].definition = inp.value; });
    });
    body.querySelectorAll(".cmark").forEach(function (c) {
      c.addEventListener("change", function () {
        var i = parseInt(c.dataset.i, 10);
        if (c.type === "radio") editFormState.correct = i;
        else {
          if (c.checked) { if (editFormState.correctMulti.indexOf(i) === -1) editFormState.correctMulti.push(i); }
          else editFormState.correctMulti = editFormState.correctMulti.filter(function (x) { return x !== i; });
        }
      });
    });
    body.querySelectorAll(".stmtTrue").forEach(function (c) {
      c.addEventListener("change", function () { if (c.checked) editFormState.statements[parseInt(c.dataset.i, 10)].answer = true; });
    });
    body.querySelectorAll(".stmtFalse").forEach(function (c) {
      c.addEventListener("change", function () { if (c.checked) editFormState.statements[parseInt(c.dataset.i, 10)].answer = false; });
    });
  }

  document.getElementById("qForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var type = document.getElementById("fType").value;
    var fSubjectEl = document.getElementById("fSubject");
    var targetSubjectId = fSubjectEl ? fSubjectEl.value : editingSubjectId;
    var q = {
      topic: document.getElementById("fTopic").value.trim() || "Chung",
      type: type,
      question: document.getElementById("fQuestion").value.trim(),
      explanation: document.getElementById("fExplain").value.trim()
    };

    if (!q.question) { toast("Vui lòng nhập nội dung câu hỏi."); return; }

    if (type === "mcq") {
      q.options = editFormState.options.map(function (o) { return o.trim(); });
      q.answer = editFormState.correct;
      if (q.options.some(function (o) { return !o; })) { toast("Vui lòng điền đủ các đáp án."); return; }
    } else if (type === "multi") {
      q.options = editFormState.options.map(function (o) { return o.trim(); });
      q.answer = editFormState.correctMulti.slice().sort(function (a, b) { return a - b; });
      q.pick = parseInt(document.getElementById("fPick").value, 10) || 2;
      if (q.options.some(function (o) { return !o; })) { toast("Vui lòng điền đủ các đáp án."); return; }
      if (!q.answer.length) { toast("Hãy đánh dấu ít nhất một đáp án đúng."); return; }
    } else if (type === "tf") {
      q.statements = editFormState.statements.map(function (s) { return { text: s.text.trim(), answer: s.answer }; });
      if (q.statements.some(function (s) { return !s.text; })) { toast("Vui lòng điền đủ các phát biểu."); return; }
    } else if (type === "drag") {
      q.pairs = editFormState.pairs.map(function (p) { return { term: p.term.trim(), definition: p.definition.trim() }; });
      if (q.pairs.some(function (p) { return !p.term || !p.definition; })) { toast("Vui lòng điền đủ khái niệm và phát biểu."); return; }
    }

    var targetSubject = findSubject(targetSubjectId) || currentSubject();
    if (!targetSubject) { toast("Chưa có môn học. Hãy thêm môn học trước."); return; }
    var tbank = targetSubject.questions || (targetSubject.questions = []);

    if (editingId == null) {
      q.id = uid();
      tbank.push(q);
    } else {
      var oldSubject = findSubject(editingSubjectId);
      if (oldSubject && oldSubject.id !== targetSubject.id) {
        // Đổi môn học: xóa khỏi môn cũ, thêm vào môn mới
        q.id = oldSubject.questions[editingId] && oldSubject.questions[editingId].id;
        oldSubject.questions.splice(editingId, 1);
        tbank.push(q);
      } else {
        q.id = tbank[editingId] && tbank[editingId].id;
        tbank[editingId] = q;
      }
    }

    currentSubjectId = targetSubject.id;
    saveSubjects();
    document.getElementById("editModal").classList.add("hidden");
    renderManage();
    renderHome();
  });

  /* ---------------- Utility ---------------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ---------------- API cho import.js ---------------- */
  window.App = {
    currentSubject: currentSubject,
    addQuestions: function (qs) {
      var s = currentSubject();
      if (s) s.questions = (s.questions || []).concat(qs);
      saveSubjects();
    },
    refresh: function () { renderManage(); renderHome(); },
    toast: toast,
    escapeHtml: escapeHtml,
    uid: uid
  };

  /* ---------------- Đăng nhập / đăng ký ---------------- */
  function showApp() {
    var auth = document.getElementById("authScreen");
    if (auth) auth.classList.add("hidden");
    var layout = document.querySelector(".layout");
    if (layout) layout.classList.remove("hidden");
    if (subjects.length) currentSubjectId = subjects[0].id;
    applyRoute();
  }

  function showAuthScreen() {
    var auth = document.getElementById("authScreen");
    if (auth) auth.classList.remove("hidden");
    var layout = document.querySelector(".layout");
    if (layout) layout.classList.add("hidden");
  }

  var authMode = "login"; // "login" | "signup"

  function setAuthMsg(msg) {
    var el = document.getElementById("authMsg");
    if (el) el.textContent = msg;
  }

  function setAuthMode(mode) {
    authMode = mode;
    var tabLogin = document.getElementById("tabLogin");
    var tabSignup = document.getElementById("tabSignup");
    if (tabLogin) tabLogin.classList.toggle("active", mode === "login");
    if (tabSignup) tabSignup.classList.toggle("active", mode === "signup");
    var submit = document.getElementById("btnAuthSubmit");
    if (submit) submit.textContent = mode === "login" ? "Đăng nhập" : "Tạo tài khoản";
    var pwd = document.getElementById("authPassword");
    if (pwd) pwd.autocomplete = mode === "login" ? "current-password" : "new-password";
    var confirm = document.getElementById("authConfirmLabel");
    if (confirm) confirm.classList.toggle("hidden", mode !== "signup");
    setAuthMsg("");
  }

  function doAuth() {
    var email = document.getElementById("authEmail").value.trim();
    var password = document.getElementById("authPassword").value;
    if (!email || !password) { setAuthMsg("Vui lòng nhập email và mật khẩu."); return; }
    if (password.length < 6) { setAuthMsg("Mật khẩu tối thiểu 6 ký tự."); return; }
    if (authMode === "signup") {
      var confirm = document.getElementById("authConfirm").value;
      if (password !== confirm) { setAuthMsg("Mật khẩu nhập lại không khớp."); return; }
    }
    if (!window.supabase || !window.supabase.createClient) { setAuthMsg("Hệ thống chưa sẵn sàng, thử lại sau."); return; }
    var remember = document.getElementById("authRemember").checked;
    // Tạo lại client theo lựa chọn "ghi nhớ" (bỏ chọn = không lưu phiên vào trình duyệt)
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: remember, autoRefreshToken: remember, detectSessionInUrl: false }
    });
    setAuthMsg("Đang xử lý…");
    var p = authMode === "login"
      ? db.auth.signInWithPassword({ email: email, password: password })
      : db.auth.signUp({ email: email, password: password });
    p.then(function (res) {
      if (res.error) { setAuthMsg(res.error.message); return; }
      if (authMode === "signup" && !res.data.session) {
        setAuthMsg("Đã gửi email xác nhận. Hãy xác nhận rồi đăng nhập lại.");
        return;
      }
      userId = res.data.session.user.id;
      loadSubjects().then(showApp);
    }).catch(function () {
      setAuthMsg("Có lỗi xảy ra, vui lòng thử lại.");
    });
  }

  function doLogout() {
    if (db) db.auth.signOut();
    userId = null;
    subjects = [];
    currentSubjectId = null;
    navigate("dang-nhap");
  }

  var authForm = document.getElementById("authForm");
  if (authForm) authForm.addEventListener("submit", function (e) { e.preventDefault(); doAuth(); });
  var tabLogin = document.getElementById("tabLogin");
  if (tabLogin) tabLogin.addEventListener("click", function () { setAuthMode("login"); });
  var tabSignup = document.getElementById("tabSignup");
  if (tabSignup) tabSignup.addEventListener("click", function () { setAuthMode("signup"); });
  var btnLogout = document.getElementById("btnLogout");
  if (btnLogout) btnLogout.addEventListener("click", doLogout);

  /* ---------------- Khởi động ---------------- */
  function bootstrap() {
    if (useSupabase()) {
      loadSupabaseClient().then(function (sb) {
        db = sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        return db.auth.getSession();
      }).then(function (res) {
        if (res.data && res.data.session) {
          userId = res.data.session.user.id;
          return loadSubjects().then(showApp);
        }
        showAuthScreen();
      }).catch(function () {
        // Lỗi mạng / sự cố -> dùng local (không cần đăng nhập)
        offlineMode = true;
        subjects = loadLocalSubjects();
        showApp();
      });
    } else {
      subjects = loadLocalSubjects();
      showApp();
    }
  }
  bootstrap();
})();
