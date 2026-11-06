/* ============================================================
   Import câu hỏi từ file Word (.docx) / PDF / TXT
   - .docx: mammoth.js (giữ thẻ <strong> để nhận diện đáp án in đậm)
   - .pdf : pdf.js (trích text; file ảnh quét chưa hỗ trợ OCR)
   - .txt : đọc trực tiếp
   Sau khi tách, hiện màn hình duyệt để sửa + đánh dấu đáp án rồi lưu.
   ============================================================ */
(function () {
  "use strict";

  var drafts = []; // các câu đã tách, đang chờ duyệt

  function init() {
    if (!window.App) return;
    var btn = document.getElementById("btnImportDoc");
    var fileInput = document.getElementById("importDocFile");
    if (btn && fileInput) {
      btn.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function (e) {
        var file = e.target.files[0];
        if (!file) return;
        handleImportFile(file);
        e.target.value = "";
      });
    }
    var cancel = document.getElementById("btnImportCancel");
    if (cancel) cancel.addEventListener("click", closeImportModal);
    var confirm = document.getElementById("btnImportConfirm");
    if (confirm) confirm.addEventListener("click", confirmImport);
  }

  /* ---------------- Đọc file ---------------- */
  function handleImportFile(file) {
    var name = (file.name || "").toLowerCase();
    if (name.endsWith(".txt")) {
      var tr = new FileReader();
      tr.onload = function () { finishParse(tr.result, null); };
      tr.onerror = function () { App.toast("Không đọc được file."); };
      tr.readAsText(file);
      return;
    }
    if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png")) {
      ocrFile(file);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result;
      if (name.endsWith(".docx")) extractDocx(buf);
      else if (name.endsWith(".pdf")) extractPdf(buf);
      else App.toast("Định dạng không hỗ trợ. Dùng .docx, .pdf hoặc .txt.");
    };
    reader.onerror = function () { App.toast("Không đọc được file."); };
    reader.readAsArrayBuffer(file);
  }

  function extractDocx(buf) {
    if (!window.mammoth) { App.toast("Chưa tải thư viện đọc Word. Kiểm tra kết nối mạng."); return; }
    mammoth.convertToHtml({ arrayBuffer: buf }).then(function (result) {
      var html = result.value;
      finishParse(htmlToText(html), html);
    }, function () { App.toast("Không đọc được file Word."); });
  }

  function extractPdf(buf) {
    if (!window.pdfjsLib) { App.toast("Chưa tải thư viện đọc PDF. Kiểm tra kết nối mạng."); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    pdfjsLib.getDocument({ data: buf }).promise.then(function (pdf) {
      var pagePromises = [];
      for (var i = 1; i <= pdf.numPages; i++) pagePromises.push(pdf.getPage(i));
      return Promise.all(pagePromises);
    }).then(function (pages) {
      return Promise.all(pages.map(function (page) {
        return page.getTextContent().then(function (tc) {
          return tc.items.map(function (it) { return it.str; }).join(" ");
        });
      })).then(function (texts) {
        var text = texts.join("\n");
        // PDF ảnh quét (không có lớp chữ) -> nhận diện OCR từng trang
        if (text.replace(/\s/g, "").length < 20) return ocrPdf(pages);
        return text;
      });
    }).then(function (text) {
      finishParse(text, null);
    }).catch(function () {
      App.toast("Không đọc được file PDF.");
    });
  }

  function htmlToText(html) {
    var div = document.createElement("div");
    div.innerHTML = html;
    div.querySelectorAll("p, li, br, div, h1, h2, h3, h4, h5, tr").forEach(function (el) {
      el.appendChild(document.createTextNode("\n"));
    });
    return div.textContent;
  }

  /* ---------------- OCR (ảnh quét) ---------------- */
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Không tải được thư viện OCR")); };
      document.head.appendChild(s);
    });
  }

  function ocrFile(file) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      showOcrLoading();
      setOcrStatus("Đang tải dữ liệu nhận diện tiếng Việt…");
      loadTesseract().then(function () {
        return recognizeImage(img, setOcrProgress);
      }).then(function (text) {
        URL.revokeObjectURL(url);
        hideOcrLoading();
        finishParse(text, null);
      }).catch(function () {
        URL.revokeObjectURL(url);
        hideOcrLoading();
        App.toast("Nhận diện ảnh không thành công.");
      });
    };
    img.onerror = function () { App.toast("Không đọc được ảnh."); };
    img.src = url;
  }

  function ocrPdf(pages) {
    showOcrLoading();
    setOcrStatus("Đang tải dữ liệu nhận diện tiếng Việt…");
    return loadTesseract().then(function () {
      var total = pages.length;
      var results = [];
      var chain = Promise.resolve();
      pages.forEach(function (page, pi) {
        chain = chain.then(function () {
          return renderPage(page, 2).then(function (canvas) {
            setOcrStatus("Đang nhận diện trang " + (pi + 1) + "/" + total + "…");
            return recognizeImage(canvas, function (p) {
              setOcrProgress((pi + (p || 0)) / total);
            });
          }).then(function (text) {
            results.push(text);
          });
        });
      });
      return chain.then(function () { return results.join("\n"); });
    });
  }

  function renderPage(page, scale) {
    var viewport = page.getViewport({ scale: scale });
    var canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    var ctx = canvas.getContext("2d");
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () { return canvas; });
  }

  function recognizeImage(img, onProgress) {
    return Tesseract.recognize(img, "vie", {
      logger: function (m) {
        if (m.status === "recognizing text") { if (onProgress) onProgress(m.progress); }
        else if (m.status) setOcrStatus(ocrStatusText(m.status));
      }
    }).then(function (result) { return result.data.text || ""; });
  }

  function ocrStatusText(status) {
    if (status === "loading tesseract core") return "Đang tải bộ nhận diện…";
    if (status === "initializing tesseract") return "Đang khởi tạo…";
    if (status === "loading language traineddata") return "Đang tải dữ liệu tiếng Việt…";
    if (status === "initializing api") return "Đang khởi tạo…";
    return status;
  }

  function showOcrLoading() {
    var el = document.getElementById("ocrLoading");
    if (el) el.classList.remove("hidden");
    setOcrProgress(0);
  }
  function hideOcrLoading() {
    var el = document.getElementById("ocrLoading");
    if (el) el.classList.add("hidden");
  }
  function setOcrStatus(text) {
    var el = document.getElementById("ocrStatus");
    if (el) el.textContent = text;
  }
  function setOcrProgress(frac) {
    var fill = document.getElementById("ocrFill");
    if (fill) fill.style.width = Math.round((frac || 0) * 100) + "%";
  }

  /* ---------------- Tách câu hỏi ---------------- */
  function finishParse(text, html) {
    if (!text || !text.trim()) { App.toast("File rỗng hoặc không có nội dung chữ."); return; }
    drafts = parseQuestions(text, html);
    if (!drafts.length) { App.toast("Không tách được câu hỏi nào từ file."); return; }
    renderImportReview();
    openImportModal();
  }

  function parseQuestions(text, html) {
    var blocks = splitBlocks(text);
    if (!blocks) return [];
    var boldLetters = html ? extractBoldLetters(html) : [];
    var boldIdx = 0;
    var result = [];
    blocks.forEach(function (block) {
      var parsed = parseBlock(block);
      if (!parsed) return;
      if (!parsed.correct.length && boldLetters[boldIdx]) {
        var idx = letterToIndex(boldLetters[boldIdx]);
        if (idx >= 0 && idx < parsed.options.length) parsed.correct = [idx];
      }
      boldIdx++;
      result.push(parsed);
    });
    return result;
  }

  // Tách thành các khối câu hỏi theo mốc "Câu N" (hoặc "1." ở đầu dòng nếu không có chữ "Câu")
  function splitBlocks(text) {
    var marker = /(^|\n)[ \t]*(?:C(?:â|a)u(?:\s+hỏi)?[ \t]*\d+)[.:)]?[ \t]*/gi;
    var idxs = [];
    var m;
    while ((m = marker.exec(text)) !== null) idxs.push({ start: m.index + m[0].length, end: m.index });
    if (!idxs.length) {
      var num = /(^|\n)[ \t]*\d+[\.\)][ \t]+/g;
      while ((m = num.exec(text)) !== null) idxs.push({ start: m.index + m[0].length, end: m.index });
      if (!idxs.length) return null;
    }
    var blocks = [];
    for (var i = 0; i < idxs.length; i++) {
      var s = idxs[i].start;
      var e = i + 1 < idxs.length ? idxs[i + 1].end : text.length;
      var b = text.slice(s, e).trim();
      if (b) blocks.push(b);
    }
    return blocks;
  }

  // Nhận diện đáp án in đậm trong HTML (chỉ chữ cái đơn A-E hoặc cả dòng bắt đầu bằng chữ cái)
  function extractBoldLetters(html) {
    var letters = [];
    var re1 = /<(?:strong|b)>\s*([A-Ea-e])\s*[\.\):：]?\s*<\/(?:strong|b)>/gi;
    var re2 = /<(?:strong|b)>\s*([A-Ea-e])\s*[\.\):：]\s+[^<]*<\/(?:strong|b)>/gi;
    var m;
    while ((m = re1.exec(html)) !== null) letters.push(m[1].toUpperCase());
    while ((m = re2.exec(html)) !== null) letters.push(m[1].toUpperCase());
    return letters;
  }

  function parseBlock(block) {
    var correct = [];
    var low = block.toLowerCase();
    // "Đáp án: A" / "đáp án là B" / "ĐA: C"
    var am = low.match(/(?:đáp\s*án|dap\s*an|đ\.?\s*a)(?:\s*(?:là|la)\s*)?[\s:：.=\-–]*([a-d])\b/);
    if (am) {
      correct = [letterToIndex(am[1])];
      // Xóa cụm "đáp án: X" khỏi khối (không xóa cả dòng) để không lẫn vào nội dung/đáp án
      block = block.slice(0, am.index) + " " + block.slice(am.index + am[0].length);
    }

    // Bỏ ký hiệu radio "O"/"o"/"0" đứng trước chữ cái đáp án (dữ liệu OCR thường có)
    block = block.replace(/\b[Oo0]\s+(?=[A-Ea-e][\.\):：])/g, "");

    var lines = block.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    var optRe = /^([A-Ea-e])[\.\):：]\s*(.+)$/;
    var optLines = [];
    var firstOpt = -1;
    for (var i = 0; i < lines.length; i++) {
      var om = lines[i].match(optRe);
      if (om) { optLines.push(om); if (firstOpt === -1) firstOpt = i; }
    }

    var question = "";
    var options = [];
    if (optLines.length >= 2) {
      question = lines.slice(0, firstOpt).join(" ").trim();
      options = optLines.map(function (o) { return o[2].trim(); });
    } else {
      // Dạng inline: các đáp án nằm chung dòng (chấp nhận khoảng trắng bị mất)
      var flat = lines.join(" ");
      var parts = flat.split(/\s+(?=[A-Ea-e][\.\):：]\s*)/);
      if (parts.length >= 3) {
        question = parts[0].trim();
        options = parts.slice(1).map(function (p) {
          return p.replace(/^[A-Ea-e][\.\):：]\s*/, "").trim();
        });
      }
    }

    if (!question || options.length < 2) return null;
    return { question: question, options: options, correct: correct };
  }

  function letterToIndex(l) {
    var c = String(l).toUpperCase().charCodeAt(0);
    if (c >= 65 && c <= 69) return c - 65; // A-E
    return -1;
  }

  /* ---------------- Màn hình duyệt ---------------- */
  function openImportModal() {
    document.getElementById("importModal").classList.remove("hidden");
  }
  function closeImportModal() {
    document.getElementById("importModal").classList.add("hidden");
  }

  function renderImportReview() {
    var list = document.getElementById("importReviewList");
    var summary = document.getElementById("importSummary");
    var subject = App.currentSubject();
    if (summary) {
      summary.textContent = "Đã tách " + drafts.length + " câu. Môn học: " +
        (subject ? subject.name : "—") + ". Kiểm tra, đánh dấu đáp án đúng rồi bấm Nhập.";
    }
    var confirmBtn = document.getElementById("btnImportConfirm");
    if (confirmBtn) confirmBtn.textContent = "Nhập " + drafts.length + " câu";

    list.innerHTML = "";
    drafts.forEach(function (d, i) {
      var div = document.createElement("div");
      div.className = "imp-item";
      var opts = "";
      d.options.forEach(function (opt, oi) {
        var letter = String.fromCharCode(65 + oi);
        var checked = d.correct.indexOf(oi) !== -1 ? " checked" : "";
        opts += '<div class="imp-opt"><span class="imp-letter">' + letter + '</span>' +
          '<input type="text" class="imp-opt-text" value="' + App.escapeHtml(opt) + '">' +
          '<label class="imp-ok"><input type="checkbox" class="imp-opt-ok"' + checked + '> đúng</label></div>';
      });
      div.innerHTML =
        '<div class="imp-head"><span class="imp-num">Câu ' + (i + 1) + '</span>' +
        '<button type="button" class="imp-del">✕</button></div>' +
        '<textarea class="imp-q" rows="2">' + App.escapeHtml(d.question) + '</textarea>' +
        '<div class="imp-opts">' + opts + '</div>';
      div.querySelector(".imp-del").addEventListener("click", function () { div.remove(); });
      list.appendChild(div);
    });
  }

  function confirmImport() {
    var list = document.getElementById("importReviewList");
    var items = list.querySelectorAll(".imp-item");
    var topic = (document.getElementById("importTopic").value || "").trim() || "Chung";
    var qs = [];
    items.forEach(function (item) {
      var question = item.querySelector(".imp-q").value.trim();
      var optInputs = item.querySelectorAll(".imp-opt-text");
      var options = [];
      var correct = [];
      optInputs.forEach(function (inp) {
        var val = inp.value.trim();
        if (!val) return;
        var idx = options.length;
        options.push(val);
        var ok = inp.parentNode.querySelector(".imp-opt-ok");
        if (ok && ok.checked) correct.push(idx);
      });
      if (!question || options.length < 2 || !correct.length) return; // bỏ câu không hợp lệ
      var q = {
        id: App.uid(),
        topic: topic,
        type: correct.length === 1 ? "mcq" : "multi",
        question: question,
        options: options,
        answer: correct.length === 1 ? correct[0] : correct.slice().sort(function (a, b) { return a - b; }),
        explanation: ""
      };
      if (q.type === "multi") q.pick = correct.length;
      qs.push(q);
    });
    if (!qs.length) { App.toast("Không có câu hợp lệ. Kiểm tra nội dung và đánh dấu đáp án đúng."); return; }
    App.addQuestions(qs);
    closeImportModal();
    App.refresh();
    App.toast("Đã nhập " + qs.length + " câu hỏi.");
  }

  init();
})();
