/* 用 Node 跑一遍 core.js 的读写一致性检查：
     node photostool/test-core.cjs
   不依赖任何包，也不会改动 photos.json。 */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('./core.js');

let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? '  → ' + extra : ''));
  if (!ok) failed++;
}

const file = path.join(__dirname, '..', 'photos.json');
const raw = fs.readFileSync(file, 'utf8');

console.log('\n[1] 读入 photos.json');
const data = Core.parse(raw);
const stats = Core.stats(data);
check('分类数 > 0', stats.categories > 0, JSON.stringify(stats));
check('图片数 > 0', stats.photos > 0);
check('没有缺地址的图', stats.missing === 0);
console.log('       ' + data.map(g => g.category + '(' + g.photos.length + ')').join(', '));

console.log('\n[2] 序列化后重新解析，内容不变');
const text = Core.serialize(data);
check('排版：每张图一行', text.split('\n').filter(l => l.includes('"url"')).every(l => /^ {6}\{ "url": /.test(l)));
check('排版：2 空格缩进', text.includes('\n    "category": '));
check('往返一致', JSON.stringify(Core.parse(text)) === JSON.stringify(data));

console.log('\n[3] 兼容旧的平铺写法');
const flat = Core.normalize([
  { url: 'a.png', caption: '甲', category: 'X' },
  { src: 'b.png', name: '乙', category: 'X' },
  { avatar: 'c.png', category: 'Y' }
]);
check('按分类归组', flat.length === 2 && flat[0].photos.length === 2, JSON.stringify(flat));
check('字段别名', flat[0].photos[1].url === 'b.png' && flat[0].photos[1].caption === '乙');

console.log('\n[4] 边界情况');
check('空数组', Core.serialize([]) === '[]\n');
check('空分类', Core.serialize([{ category: 'A', photos: [] }]).includes('"photos": []'));
check('空标题不输出 caption', !Core.serialize([{ category: 'A', photos: [{ url: 'x.png', caption: '' }] }]).includes('caption'));
const tricky = [{ category: 'C', photos: [{ url: 'a"b\\c.png', caption: '带"引号"\\与换行\n' }] }];
check('特殊字符转义', JSON.stringify(JSON.parse(Core.serialize(tricky))) === JSON.stringify(tricky));
let threw = false;
try { Core.parse('{oops}'); } catch (e) { threw = /语法错误/.test(e.message); }
check('语法错误有中文提示', threw);

console.log('\n[5] 校验');
const dirty = Core.normalize([{ category: 'Z', photos: [
  { url: '', caption: '空' },
  { url: 'dup.png', caption: '' },
  { url: 'dup.png', caption: '' },
  { url: 'javascript:alert(1)', caption: '' }
] }]);
const issues = Core.issues(dirty);
check('检出缺地址', issues.some(i => i.kind === 'missing'));
check('检出重复', issues.some(i => i.kind === 'duplicate' && i.count === 2));
check('检出可疑地址', issues.some(i => i.kind === 'suspicious'));

console.log('\n' + (failed ? '✗ ' + failed + ' 项失败' : '✓ 全部通过') + '\n');
process.exit(failed ? 1 : 0);
