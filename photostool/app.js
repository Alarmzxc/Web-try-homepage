/* ============================================================
   photostool/app.js — 界面、状态、文件读写
   所有数据只在本机浏览器里，没有任何网络请求（“从站点读取”读的就是
   photos.html 用的那个 photos.json）。
   ============================================================ */
(function () {
  'use strict';

  var Core = window.PhotostoolCore;
  if (!Core) {
    document.body.innerHTML = '<p style="padding:24px;font-family:system-ui">core.js 没有加载成功，请确认 photostool 目录下文件齐全。</p>';
    return;
  }

  var DRAFT_KEY = 'photostool:draft:v1';
  var MAX_HISTORY = 120;

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ==================== 状态 ==================== */
  var state = {
    data: [],
    active: 0,
    query: '',
    onlyIssues: false,
    loaded: false,
    fileName: 'photos.json',
    handle: null,
    saved: ''
  };

  var history = { past: [], future: [] };
  var pendingDraft = null;
  var confirmCallback = null;
  var draftTimer = 0;
  var thumbTimers = Object.create(null);

  /* ==================== 小工具 ==================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function icon(name) {
    return '<svg class="ic"><use href="#i-' + name + '"/></svg>';
  }

  function currentGroup() {
    return state.data[state.active] || null;
  }

  function fileNameSafe(name) {
    var base = String(name || 'photos.json').split(/[\\/]/).pop();
    if (!/\.json$/i.test(base)) base += '.json';
    return base;
  }

  /* 站点里的地址是相对 photos.html 的，这里换算成相对 photostool/ 的地址，
     这样本地预览缩略图也能用。 */
  function resolveUrl(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (/^(https?:|data:|blob:|\/\/|\/|\.\.\/|\.\/)/i.test(u)) return u;
    return '../' + u;
  }

  function relTime(ts) {
    var diff = Math.max(0, Date.now() - ts) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.round(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.round(diff / 3600) + ' 小时前';
    return Math.round(diff / 86400) + ' 天前';
  }

  var toastTimer = [];
  function toast(msg, isErr) {
    var box = $('#toasts');
    var node = document.createElement('div');
    node.className = 'toast' + (isErr ? ' err' : '');
    node.innerHTML = icon(isErr ? 'alert' : 'check') + '<span>' + esc(msg) + '</span>';
    box.appendChild(node);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    var t = setTimeout(function () { node.remove(); }, isErr ? 5200 : 3000);
    toastTimer.push(t);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    try { return Promise.resolve(legacyCopy(text)); } catch (e) { return Promise.reject(e); }
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('复制失败，请手动全选复制');
  }

  /* ==================== 撤销 / 重做 ==================== */
  function snapshot() { return Core.serialize(state.data); }

  function pushUndo() {
    var snap = snapshot();
    if (history.past[history.past.length - 1] === snap) return;
    history.past.push(snap);
    if (history.past.length > MAX_HISTORY) history.past.shift();
    history.future.length = 0;
  }

  function undo() {
    if (!history.past.length) return;
    history.future.push(snapshot());
    var snap = history.past.pop();
    applySnapshot(snap);
    toast('已撤销');
  }

  function redo() {
    if (!history.future.length) return;
    history.past.push(snapshot());
    var snap = history.future.pop();
    applySnapshot(snap);
    toast('已重做');
  }

  function applySnapshot(text) {
    try {
      state.data = Core.parse(text);
    } catch (e) {
      toast('历史记录损坏，无法撤销', true);
      return;
    }
    state.active = Math.min(state.active, Math.max(0, state.data.length - 1));
    renderAll();
    queueDraft();
  }

  function commit(fn) {
    pushUndo();
    fn();
    afterStructure();
  }

  /* ==================== 变更后的同步 ==================== */
  function isDirty() {
    return state.loaded && snapshot() !== state.saved;
  }

  function afterEdit() {
    syncTop();
    syncStatus();
    syncCatMeta();
    queueDraft();
  }

  function afterStructure() {
    renderAll();
    queueDraft();
  }

  function syncTop() {
    var dirty = isDirty();
    $('#docName').textContent = state.loaded ? state.fileName : 'photostool';
    var ds = $('#docState');
    ds.textContent = state.loaded ? (dirty ? '有未保存的改动' : '与文件一致') : '尚未载入文件';
    ds.classList.toggle('is-dirty', dirty);

    $('#btnUndo').disabled = !history.past.length;
    $('#btnRedo').disabled = !history.future.length;
    ['#btnPreview', '#btnCopy', '#btnDownload', '#btnSave'].forEach(function (sel) {
      $(sel).disabled = !state.loaded;
    });
    $('#btnSave').hidden = !(state.handle && window.showSaveFilePicker);
  }

  function syncStatus() {
    var s = Core.stats(state.data);
    $('#statusCount').textContent = s.photos + ' 张图片 · ' + s.categories + ' 个分类';

    var issues = Core.issues(state.data);
    var dup = issues.filter(function (i) { return i.kind === 'duplicate'; }).length;
    var el = $('#statusIssues');
    el.classList.remove('is-warn');
    if (s.missing) {
      el.textContent = s.missing + ' 张缺地址';
      el.classList.add('is-warn');
    } else if (dup) {
      el.textContent = dup + ' 组重复地址';
      el.classList.add('is-warn');
    } else {
      el.textContent = '没有发现问题';
    }
    $('#statusHint').textContent = state.loaded ? 'Ctrl+S 保存 · Ctrl+Z 撤销' : '';
  }

  function syncCatMeta() {
    var g = currentGroup();
    var meta = $('.cat-meta');
    if (!g || !meta) return;
    var captions = g.photos.filter(function (p) { return String(p.caption || '').trim(); }).length;
    meta.textContent = g.photos.length + ' 张图片 · ' + captions + ' 张有说明';
  }

  function syncStats() {
    var s = Core.stats(state.data);
    var dup = 0;
    Core.issues(state.data).forEach(function (i) { if (i.kind === 'duplicate') dup += i.count - 1; });
    var cell = function (k, v, warn) {
      return '<div class="stat"><span class="stat-k">' + k + '</span>' +
        '<span class="stat-v' + (warn ? ' is-warn' : '') + '">' + v + '</span></div>';
    };
    $('#stats').innerHTML =
      cell('图片', s.photos) + cell('分类', s.categories) +
      cell('缺地址', s.missing, s.missing > 0) + cell('重复', dup, dup > 0);
    $('#catCount').textContent = s.categories;
  }

  /* ==================== 草稿（防手滑刷新） ==================== */
  function queueDraft() {
    if (!state.loaded) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 700);
  }

  function saveDraft() {
    try {
      if (!isDirty()) { localStorage.removeItem(DRAFT_KEY); return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        data: state.data,
        fileName: state.fileName,
        at: Date.now()
      }));
    } catch (e) { /* 隐私模式下写不进去就算了 */ }
  }

  function readDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.data)) return null;
      return { data: Core.normalize(obj.data), fileName: obj.fileName || 'photos.json', at: obj.at || 0 };
    } catch (e) { return null; }
  }

  function dropDraft() {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    pendingDraft = null;
  }

  /* ==================== 载入 ==================== */
  function load(data, opts) {
    opts = opts || {};
    state.data = data;
    state.active = 0;
    state.query = '';
    state.onlyIssues = false;
    state.loaded = true;
    state.fileName = fileNameSafe(opts.fileName || 'photos.json');
    state.handle = opts.handle || null;
    state.saved = snapshot();
    history.past.length = 0;
    history.future.length = 0;
    dropDraft();
    renderAll();
  }

  function loadError(err) {
    toast(err && err.message ? err.message : String(err), true);
  }

  function readFileObject(file, handle) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = Core.parse(String(reader.result));
        load(data, { fileName: file.name, handle: handle || null });
        toast(data.length
          ? '已载入 ' + file.name + '：' + Core.stats(data).photos + ' 张图片'
          : '已载入 ' + file.name + '：暂时没有分类', !data.length);
      } catch (e) { loadError(e); }
    };
    reader.onerror = function () { toast('读取文件失败', true); };
    reader.readAsText(file);
  }

  function openFile() {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'photos.json', accept: { 'application/json': ['.json'] } }]
      }).then(function (handles) {
        return handles[0].getFile().then(function (file) { readFileObject(file, handles[0]); });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        $('#fileInput').click();
      });
      return;
    }
    $('#fileInput').click();
  }

  function reloadFromSite() {
    var urls = ['../photos.json', 'photos.json', './photos.json'];
    var i = 0;
    function next() {
      if (i >= urls.length) {
        toast('读不到 photos.json：本目录起一个本地服务器再打开本页，或用“打开 photos.json”选文件', true);
        return;
      }
      var url = urls[i++];
      fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      }).then(function (text) {
        var data = Core.parse(text);
        load(data, { fileName: 'photos.json' });
        toast('已从站点读取 ' + Core.stats(data).photos + ' 张图片');
      }).catch(next);
    }
    next();
  }

  /* ==================== 渲染：整体 ==================== */
  function renderAll() {
    syncTop();
    syncStatus();
    syncStats();
    renderCats();
    renderEditor();
  }

  function renderCats() {
    var list = $('#catList');
    list.innerHTML = state.data.map(function (g, i) {
      return '<button class="cat' + (i === state.active ? ' is-active' : '') + '" type="button" data-cat="' + i + '">' +
        '<span class="cat-name">' + esc(g.category || '未命名分类') + '</span>' +
        '<span class="cat-n">' + g.photos.length + '</span>' +
        '</button>';
    }).join('');
  }

  function renderEditor() {
    var editor = $('#editor');

    if (!state.loaded) {
      editor.innerHTML = blankHtml();
      return;
    }

    if (!state.data.length) {
      editor.innerHTML = '<div class="blank"><div class="blank-inner">' +
        '<p class="blank-kicker">空文件</p>' +
        '<h1>还没有任何分类</h1>' +
        '<p class="blank-lead">photos.html 按分类分组显示图片。新建一个分类，往里面填图片地址即可。</p>' +
        '<div class="blank-acts"><button class="btn primary" type="button" data-act="addcat">' + icon('plus') + '<span>新建分类</span></button></div>' +
        '</div></div>';
      return;
    }

    var g = currentGroup();
    if (!g) { state.active = 0; g = state.data[0]; }

    var captions = g.photos.filter(function (p) { return String(p.caption || '').trim(); }).length;
    editor.innerHTML =
      '<div class="cat-head">' +
        '<div class="cat-field">' +
          '<label class="cat-label" for="catName">分类名称</label>' +
          '<input class="cat-input" id="catName" type="text" value="' + esc(g.category) + '" placeholder="未命名分类" autocomplete="off">' +
        '</div>' +
        '<div class="cat-meta">' + g.photos.length + ' 张图片 · ' + captions + ' 张有说明</div>' +
        '<div class="cat-tools">' +
          '<button class="btn danger" type="button" data-act="delcat">' + icon('trash') + '<span>删除分类</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="filter">' +
        '<label class="search">' + icon('search') +
          '<input id="q" type="text" value="' + esc(state.query) + '" placeholder="筛选地址或说明" autocomplete="off" aria-label="筛选当前分类的图片">' +
          '<kbd>/</kbd>' +
        '</label>' +
        '<button class="chip' + (state.onlyIssues ? ' is-on' : '') + '" id="onlyIssues" type="button">仅看缺地址</button>' +
        '<span class="filter-note" id="filterNote"></span>' +
      '</div>' +
      '<div class="rows-wrap"><div class="rows" id="rows">' + rowsInner() + '</div></div>';

    bindThumbs(editor);
    syncFilterNote();
  }

  /* 只重画表格部分（筛选时保住输入框焦点） */
  function renderRows() {
    var rows = $('#rows');
    if (!rows) return;
    rows.innerHTML = rowsInner();
    bindThumbs(rows);
    syncFilterNote();
  }

  function visibleIndexes(photos) {
    var q = state.query.trim().toLowerCase();
    var out = [];
    photos.forEach(function (p, i) {
      if (state.onlyIssues && String(p.url || '').trim()) return;
      if (q) {
        var hay = String(p.url || '') + '\n' + String(p.caption || '');
        if (hay.toLowerCase().indexOf(q) === -1) return;
      }
      out.push(i);
    });
    return out;
  }

  function rowsInner() {
    var g = currentGroup();
    if (!g) return '';
    var total = g.photos.length;
    var idxs = visibleIndexes(g.photos);

    var head = '<div class="row-head"><span></span><span></span>' +
      '<span>图片地址 URL</span><span>说明 CAPTION</span><span></span></div>';

    if (!total) {
      return head + '<p class="empty-cat">这个分类还是空的。点下面那行添加第一张图片。</p>' +
        addRowHtml();
    }

    if (!idxs.length) {
      return head + '<p class="empty-cat">没有匹配的图片。清空筛选，或换个关键词。</p>';
    }

    var showIndex = !state.query && !state.onlyIssues;
    var html = head + idxs.map(function (i) {
      return rowHtml(g.photos[i], i, total, showIndex);
    }).join('');
    return html + addRowHtml();
  }

  function addRowHtml() {
    return '<button class="add-row" type="button" data-act="add">' + icon('plus') + '<span>添加一张图片</span></button>';
  }

  function rowHtml(p, i, total, showIndex) {
    var url = String(p.url || '');
    var caption = String(p.caption || '');
    var missing = !url.trim();
    return '<div class="row' + (missing ? ' is-missing' : '') + '" data-i="' + i + '" role="group" aria-label="第 ' + (i + 1) + ' 张图片">' +
      '<span class="idx">' + (showIndex ? i + 1 : '') + '</span>' +
      '<button class="thumb' + (missing ? ' broken' : '') + '" type="button" data-act="zoom" title="查看大图" aria-label="查看第 ' + (i + 1) + ' 张的大图">' +
        (missing ? '' : '<img alt="" loading="lazy" src="' + esc(resolveUrl(url)) + '">') +
        '<svg class="ic thumb-fallback"><use href="#i-image"/></svg>' +
      '</button>' +
      '<input class="f f-url" data-field="url" type="text" value="' + esc(url) + '" placeholder="https://… 或 image/xxx.png" spellcheck="false" autocomplete="off" aria-label="第 ' + (i + 1) + ' 张的图片地址">' +
      '<input class="f f-cap" data-field="caption" type="text" value="' + esc(caption) + '" placeholder="标题或说明，可留空" autocomplete="off" aria-label="第 ' + (i + 1) + ' 张的说明">' +
      '<div class="row-acts">' +
        '<button class="mini" type="button" data-act="up" title="上移" aria-label="上移" ' + (i === 0 ? 'disabled' : '') + '>' + icon('up') + '</button>' +
        '<button class="mini" type="button" data-act="down" title="下移" aria-label="下移" ' + (i === total - 1 ? 'disabled' : '') + '>' + icon('down') + '</button>' +
        '<button class="mini danger" type="button" data-act="del" title="删除这一张" aria-label="删除这一张">' + icon('trash') + '</button>' +
      '</div>' +
    '</div>';
  }

  function syncFilterNote() {
    var g = currentGroup();
    var note = $('#filterNote');
    if (!g || !note) return;
    var shown = visibleIndexes(g.photos).length;
    var filtered = !!state.query || state.onlyIssues;
    note.textContent = filtered ? '显示 ' + shown + ' / ' + g.photos.length : g.photos.length + ' 张';
  }

  function bindThumbs(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('.thumb img'), function (img) {
      function fallback() {
        var b = img.closest('.thumb');
        if (b) b.classList.add('broken');
        img.removeAttribute('src');
      }
      img.addEventListener('error', fallback);
      if (img.complete && img.naturalWidth === 0) fallback();
    });
  }

  function blankHtml() {
    var draftBar = '';
    if (pendingDraft) {
      draftBar = '<div class="draft-bar">' + icon('alert') +
        '<span class="grow">检测到 ' + relTime(pendingDraft.at) + '未导出的改动（' + pendingDraft.fileName + '）</span>' +
        '<button class="btn accent-ghost" type="button" data-act="restore">继续编辑</button>' +
        '<button class="btn ghost" type="button" data-act="discard">丢弃</button>' +
        '</div>';
    }
    return '<div class="blank"><div class="blank-inner">' +
      '<p class="blank-kicker">未载入</p>' +
      '<h1>打开 photos.json 开始编辑</h1>' +
      '<p class="blank-lead">读取、修改、导出都在这台机器的浏览器里完成，不上传任何图片或数据。</p>' +
      draftBar +
      '<div class="blank-acts">' +
        '<button class="btn primary" type="button" data-act="open">' + icon('open') + '<span>打开 photos.json</span></button>' +
        '<button class="btn" type="button" data-act="reload">' + icon('refresh') + '<span>从站点读取</span></button>' +
        '<button class="btn ghost" type="button" data-act="paste">' + icon('clipboard') + '<span>粘贴 JSON</span></button>' +
      '</div>' +
      '<ul class="blank-tips">' +
        '<li><b>推荐</b> 在网站根目录起一个本地服务器（<code>python -m http.server 8000</code>），再打开 <code>localhost:8000/photostool/</code>，缩略图才能正常显示。</li>' +
        '<li>直接双击 index.html 也能编辑，只是 <code>image/…</code> 这类相对地址的缩略图会显示不出来。</li>' +
        '<li>也可以把 .json 文件直接拖进这个窗口。</li>' +
      '</ul>' +
    '</div></div>';
  }

  /* ==================== 操作 ==================== */
  function addCategory() {
    commit(function () {
      var n = 1, name = '新分类';
      var taken = state.data.map(function (g) { return g.category; });
      while (taken.indexOf(name) !== -1) { n++; name = '新分类 ' + n; }
      state.data.push({ category: name, photos: [] });
      state.active = state.data.length - 1;
      state.query = '';
      state.onlyIssues = false;
    });
    var input = $('#catName');
    if (input) { input.focus(); input.select(); }
  }

  function addPhoto() {
    var g = currentGroup();
    if (!g) return;
    commit(function () {
      g.photos.push({ url: '', caption: '' });
      state.query = '';
      state.onlyIssues = false;
    });
    var el = $('#rows .row[data-i="' + (g.photos.length - 1) + '"] .f-url');
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); }
  }

  function movePhoto(i, dir) {
    var g = currentGroup();
    if (!g) return;
    var j = i + dir;
    if (j < 0 || j >= g.photos.length) return;
    commit(function () {
      var tmp = g.photos[i];
      g.photos[i] = g.photos[j];
      g.photos[j] = tmp;
    });
    var row = $('#rows .row[data-i="' + j + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function deletePhoto(i) {
    var g = currentGroup();
    if (!g || !g.photos[i]) return;
    commit(function () { g.photos.splice(i, 1); });
    toast('已删除 1 张图片 · Ctrl+Z 可撤销');
  }

  function deleteCategory(gi) {
    if (!state.data[gi]) return;
    commit(function () {
      state.data.splice(gi, 1);
      state.active = Math.min(gi, Math.max(0, state.data.length - 1));
      state.query = '';
      state.onlyIssues = false;
    });
    toast('已删除分类 · Ctrl+Z 可撤销');
  }

  /* ==================== 文件输出 ==================== */
  function download() {
    if (!state.loaded) return;
    var text = Core.serialize(state.data);
    var name = fileNameSafe(state.fileName);
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    state.saved = text;
    dropDraft();
    syncTop();
    toast('已下载 ' + name + '，用它替换仓库里的 photos.json');
  }

  function save() {
    if (!state.loaded) return;
    if (state.handle && window.showSaveFilePicker) {
      var text = Core.serialize(state.data);
      state.handle.createWritable().then(function (w) {
        return w.write(text).then(function () { return w.close(); });
      }).then(function () {
        state.saved = text;
        dropDraft();
        syncTop();
        toast('已写入 ' + state.handle.name);
      }).catch(function (e) {
        toast('写入失败：' + (e && e.message ? e.message : e), true);
      });
      return;
    }
    download();
  }

  function previewJson() {
    if (!state.loaded) return;
    openTextDialog('preview', Core.serialize(state.data));
  }

  /* ==================== 对话框 ==================== */
  var textMode = 'paste';

  function openTextDialog(mode, text) {
    textMode = mode || 'paste';
    var dlg = $('#dlgText');
    var body = $('#dlgTextBody');
    var ok = $('#dlgTextOk');
    var err = $('#dlgTextErr');
    err.hidden = true;
    err.textContent = '';

    if (textMode === 'preview') {
      $('#dlgTextTitle').textContent = '将要写出的 photos.json';
      $('#dlgTextSub').textContent = '和 photos.html 现在读取的格式一致：每张图片一行，保存后 git diff 只会有实际改动。';
      body.value = text || '';
      body.readOnly = true;
      ok.textContent = '复制';
      $('#dlgTextCancel').textContent = '关闭';
    } else {
      $('#dlgTextTitle').textContent = '粘贴 JSON';
      $('#dlgTextSub').textContent = '整份文件，或只粘贴一个分类数组都行；兼容旧的平铺写法。';
      body.value = '';
      body.readOnly = false;
      ok.textContent = '载入';
      $('#dlgTextCancel').textContent = '取消';
    }
    dlg.showModal();
    body.focus();
  }

  function askConfirm(opts) {
    $('#dlgConfirmTitle').textContent = opts.title;
    $('#dlgConfirmSub').textContent = opts.sub || '';
    $('#dlgConfirmOk').textContent = opts.ok || '删除';
    confirmCallback = opts.onOk;
    $('#dlgConfirm').showModal();
  }

  function openZoom(p) {
    if (!p) return;
    var u = resolveUrl(p.url);
    var img = $('#zoomImg');
    var dlg = $('#dlgZoom');
    $('#zoomCaption').textContent = String(p.caption || '').trim() || String(p.url || '').trim() || '这张还没有填地址';
    if (u) {
      img.hidden = false;
      img.src = u;
      img.alt = p.caption || '';
    } else {
      img.hidden = true;
      img.removeAttribute('src');
    }
    dlg.showModal();
  }

  /* ==================== 事件绑定 ==================== */
  function bind() {
    $('#btnOpen').addEventListener('click', openFile);
    $('#btnReload').addEventListener('click', reloadFromSite);
    $('#btnPaste').addEventListener('click', function () { openTextDialog('paste'); });
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $('#btnPreview').addEventListener('click', previewJson);
    $('#btnCopy').addEventListener('click', function () {
      if (!state.loaded) return;
      copyText(Core.serialize(state.data)).then(function () {
        toast('JSON 已复制到剪贴板');
      }).catch(function (e) { toast(e.message, true); });
    });
    $('#btnSave').addEventListener('click', save);
    $('#btnDownload').addEventListener('click', download);
    $('#btnAddCat').addEventListener('click', addCategory);

    $('#fileInput').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (file) readFileObject(file);
      this.value = '';
    });

    /* 侧栏切换分类 */
    $('#catList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cat]');
      if (!btn) return;
      var i = +btn.dataset.cat;
      if (i === state.active) return;
      state.active = i;
      state.query = '';
      state.onlyIssues = false;
      renderCats();
      renderEditor();
    });

    /* 编辑区：点击 */
    $('#editor').addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var name = act.dataset.act;

      if (name === 'open') { openFile(); return; }
      if (name === 'reload') { reloadFromSite(); return; }
      if (name === 'paste') { openTextDialog('paste'); return; }
      if (name === 'addcat') { addCategory(); return; }
      if (name === 'restore') {
        if (pendingDraft) {
          var d = pendingDraft;
          pendingDraft = null;
          load(d.data, { fileName: d.fileName });
          toast('已恢复未导出的改动');
        }
        return;
      }
      if (name === 'discard') {
        dropDraft();
        renderAll();
        toast('已丢弃草稿');
        return;
      }

      var g = currentGroup();
      if (!g) return;
      var row = act.closest('.row');
      var i = row ? +row.dataset.i : -1;

      if (name === 'zoom') { openZoom(g.photos[i]); return; }
      if (name === 'add') { addPhoto(); return; }
      if (name === 'delcat') {
        askConfirm({
          title: '删除分类「' + (g.category || '未命名分类') + '」？',
          sub: '这个分类里的 ' + g.photos.length + ' 张图片会一起删除。删除后可以用 Ctrl+Z 撤销。',
          ok: '删除分类',
          onOk: function () { deleteCategory(state.active); }
        });
        return;
      }
      if (name === 'up') { movePhoto(i, -1); return; }
      if (name === 'down') { movePhoto(i, 1); return; }
      if (name === 'del') {
        askConfirm({
          title: '删除第 ' + (i + 1) + ' 张图片？',
          sub: (g.photos[i] && g.photos[i].url) || '这张还没有填地址',
          ok: '删除',
          onOk: function () { deletePhoto(i); }
        });
      }
    });

    /* 编辑区：输入 */
    $('#editor').addEventListener('focusin', function (e) {
      if (e.target.matches('.f, .cat-input')) pushUndo();
    });

    $('#editor').addEventListener('input', function (e) {
      var field = e.target.dataset.field;
      if (!field) return;
      var g = currentGroup();
      if (!g) return;
      var row = e.target.closest('.row');
      var p = g.photos[+row.dataset.i];
      if (!p) return;

      if (field === 'url') {
        p.url = e.target.value;
        var missing = !p.url.trim();
        row.classList.toggle('is-missing', missing);
        var thumb = row.querySelector('.thumb');
        if (thumb) thumb.classList.toggle('broken', missing);
        scheduleThumb(row, p.url);
      } else {
        p.caption = e.target.value;
      }
      afterEdit();
    });

    /* 分类名 */
    $('#editor').addEventListener('input', function (e) {
      if (e.target.id !== 'catName') return;
      var g = currentGroup();
      if (!g) return;
      g.category = e.target.value;
      var active = $('#catList .cat.is-active .cat-name');
      if (active) active.textContent = g.category || '未命名分类';
      afterEdit();
    });

    /* 筛选 */
    $('#editor').addEventListener('input', function (e) {
      if (e.target.id !== 'q') return;
      state.query = e.target.value;
      renderRows();
    });

    $('#editor').addEventListener('click', function (e) {
      if (e.target.id !== 'onlyIssues') return;
      state.onlyIssues = !state.onlyIssues;
      e.target.classList.toggle('is-on', state.onlyIssues);
      renderRows();
    });

    /* 撤销记录：分类名/输入框获得焦点时记一次 */
    $('#editor').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.dataset.field) return;
      e.preventDefault();
      var row = e.target.closest('.row');
      var n = currentGroup() ? currentGroup().photos.length : 0;
      var next = +row.dataset.i + 1;
      if (next < n) {
        var el = $('#rows .row[data-i="' + next + '"] .f-url');
        if (el) el.focus();
      } else {
        addPhoto();
      }
    });

    /* 文本对话框 */
    $('#dlgText').addEventListener('submit', function (e) {
      var ok = e.submitter && e.submitter.id === 'dlgTextOk';
      if (!ok) return;
      e.preventDefault();

      if (textMode === 'preview') {
        copyText($('#dlgTextBody').value).then(function () {
          toast('JSON 已复制到剪贴板');
        }).catch(function (err) { toast(err.message, true); });
        return;
      }

      var raw = $('#dlgTextBody').value;
      if (!raw.trim()) {
        showTextError('先粘贴一点内容');
        return;
      }
      try {
        var data = Core.parse(raw);
        $('#dlgText').close();
        load(data, { fileName: 'photos.json' });
        toast('已载入 ' + Core.stats(data).photos + ' 张图片');
      } catch (err) {
        showTextError(err.message);
      }
    });

    $('#dlgText').addEventListener('close', function () {
      $('#dlgTextErr').hidden = true;
    });

    /* 确认框 */
    $('#dlgConfirm').addEventListener('close', function () {
      if (this.returnValue === 'ok' && confirmCallback) confirmCallback();
      confirmCallback = null;
    });

    /* 看大图 */
    $('#zoomClose').addEventListener('click', function () { $('#dlgZoom').close(); });
    $('#dlgZoom').addEventListener('click', function (e) {
      if (e.target === this) this.close();
    });

    /* 拖文件进来 */
    window.addEventListener('dragover', function (e) {
      e.preventDefault();
      document.body.classList.add('dragging');
    });
    window.addEventListener('dragleave', function (e) {
      if (e.relatedTarget) return;
      document.body.classList.remove('dragging');
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      document.body.classList.remove('dragging');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readFileObject(file);
    });

    window.addEventListener('beforeunload', function (e) {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    document.addEventListener('keydown', onKey);
  }

  function showTextError(msg) {
    var el = $('#dlgTextErr');
    el.textContent = msg;
    el.hidden = false;
  }

  function onKey(e) {
    var mod = e.ctrlKey || e.metaKey;
    var key = String(e.key || '').toLowerCase();
    var tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea';

    if (mod && key === 's') { e.preventDefault(); save(); return; }
    if (mod && key === 'o') { e.preventDefault(); openFile(); return; }
    if (mod && key === 'z' && !e.shiftKey && !typing) { e.preventDefault(); undo(); return; }
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey)) && !typing) { e.preventDefault(); redo(); return; }
    if (mod && key === 'p') { e.preventDefault(); previewJson(); return; }
    if (key === '/' && !typing && !e.altKey && !mod) {
      var q = $('#q');
      if (q) { e.preventDefault(); q.focus(); q.select(); }
    }
  }

  /* ==================== 启动 ==================== */
  pendingDraft = readDraft();
  bind();
  renderAll();

  /* ?load 或 ?load=../photos.json：打开页面时自动载入，方便做书签 */
  var auto = new URLSearchParams(location.search).get('load');
  if (auto !== null) {
    fetch(auto || '../photos.json', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      var data = Core.parse(text);
      load(data, { fileName: 'photos.json' });
      if (data.length) toast('已自动载入 ' + Core.stats(data).photos + ' 张图片');
    }).catch(function (e) {
      toast('自动载入失败：' + e.message, true);
    });
  }
})();
