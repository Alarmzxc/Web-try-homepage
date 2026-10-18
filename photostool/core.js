/* ============================================================
   photostool/core.js — photos.json 的纯数据处理
   不碰 DOM：浏览器里挂到 window.PhotostoolCore，Node 里可以 require
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.PhotostoolCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function str(v) {
    return v == null ? '' : String(v);
  }

  /* ==================== 读入：把各种历史写法统一成分类数组 ====================
     支持三种形态：
     1. [{ category, photos: [{ url, caption }] }]   —— 现在站点在用的形态
     2. [{ url, caption, category }]                 —— 平铺列表，按 category 归组
     3. { url, caption, category }                   —— 单张图片
     字段别名：url / src / avatar，caption / name / title */
  function normalize(raw) {
    if (!Array.isArray(raw)) {
      if (raw && Array.isArray(raw.photos)) raw = [raw];
      else if (raw && (raw.url || raw.src || raw.avatar)) {
        return [{
          category: str(raw.category) || '未分类',
          photos: [photo(raw)]
        }];
      } else {
        throw new Error('结构无法识别：应为分类数组');
      }
    }

    var grouped = raw.some(function (x) { return x && Array.isArray(x.photos); });
    if (grouped) {
      return raw.filter(Boolean).map(function (g) {
        var photos = Array.isArray(g.photos) ? g.photos : [];
        return {
          category: str(g.category || g.title) || '未分类',
          photos: photos.filter(Boolean).map(photo)
        };
      });
    }

    var order = [];
    var buckets = Object.create(null);
    raw.forEach(function (item) {
      if (!item) return;
      var url = item.url || item.src || item.avatar;
      if (!url) return;
      var cat = str(item.category) || '未分类';
      if (!buckets[cat]) { buckets[cat] = []; order.push(cat); }
      buckets[cat].push(photo(item));
    });
    return order.map(function (cat) {
      return { category: cat, photos: buckets[cat] };
    });
  }

  function photo(p) {
    return {
      url: str(p && (p.url || p.src || p.avatar)),
      caption: str(p && (p.caption || p.name || p.title))
    };
  }

  /* ==================== 写出：保持站点现有排版 ====================
     每张图片一行，方便 git diff；空标题不输出 caption 字段。 */
  function serialize(data) {
    var groups = Array.isArray(data) ? data : [];
    if (!groups.length) return '[]\n';

    var out = ['['];
    groups.forEach(function (g, gi) {
      var photos = (g && Array.isArray(g.photos)) ? g.photos : [];
      out.push('  {');
      out.push('    "category": ' + JSON.stringify(str(g && g.category)) + ',');
      if (!photos.length) {
        out.push('    "photos": []');
      } else {
        out.push('    "photos": [');
        photos.forEach(function (p, pi) {
          var line = '      { "url": ' + JSON.stringify(str(p && p.url));
          var caption = str(p && p.caption);
          if (caption) line += ', "caption": ' + JSON.stringify(caption);
          line += ' }' + (pi < photos.length - 1 ? ',' : '');
          out.push(line);
        });
        out.push('    ]');
      }
      out.push('  }' + (gi < groups.length - 1 ? ',' : ''));
    });
    out.push(']');
    return out.join('\n') + '\n';
  }

  function parse(text) {
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error('JSON 语法错误：' + e.message);
    }
    return normalize(raw);
  }

  /* ==================== 校验 ==================== */
  function urlKind(url) {
    var u = str(url).trim();
    if (!u) return 'missing';
    if (/\s/.test(u)) return 'suspicious';
    if (/^javascript:/i.test(u)) return 'suspicious';
    if (/^data:image\//i.test(u)) return 'ok';
    if (/^(https?:)?\/\//i.test(u)) return 'ok';
    if (/^(\.{1,2}\/|\/)/.test(u)) return 'ok';
    if (/^[\w./-]+\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?.*)?$/i.test(u)) return 'ok';
    return 'unknown';
  }

  function issues(data) {
    var list = [];
    var seen = Object.create(null);

    (data || []).forEach(function (g, gi) {
      (g.photos || []).forEach(function (p, pi) {
        var url = str(p && p.url).trim();
        var kind = urlKind(url);
        if (kind === 'missing') {
          list.push({ kind: 'missing', categoryIndex: gi, photoIndex: pi, message: '缺少图片地址' });
        } else if (kind === 'suspicious') {
          list.push({ kind: 'suspicious', categoryIndex: gi, photoIndex: pi, message: '地址格式可疑' });
        }
        if (url) seen[url] = (seen[url] || 0) + 1;
      });
    });

    Object.keys(seen).forEach(function (url) {
      if (seen[url] > 1) {
        list.push({ kind: 'duplicate', url: url, count: seen[url], message: '重复地址 ×' + seen[url] });
      }
    });
    return list;
  }

  function stats(data) {
    var groups = data || [];
    var photos = 0, missing = 0, captions = 0;
    groups.forEach(function (g) {
      (g.photos || []).forEach(function (p) {
        photos++;
        if (!str(p && p.url).trim()) missing++;
        if (str(p && p.caption).trim()) captions++;
      });
    });
    return {
      categories: groups.length,
      photos: photos,
      missing: missing,
      captions: captions
    };
  }

  return {
    normalize: normalize,
    serialize: serialize,
    parse: parse,
    issues: issues,
    stats: stats,
    urlKind: urlKind
  };
});
