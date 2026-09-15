/* ==========================================================================
 * 单文件打包：node build.js
 * --------------------------------------------------------------------------
 * 把 index.html / style.css / main.js / storyData.json / photoes 里的图片
 * 全部并成一个自包含的 HTML，输出到 deploy/index.html。
 * 双击即可打开，不需要本地服务器，拷给任何人都能直接看。
 * 注意：不含「漫游前传」开场页（独立页面 + 同目录音频，无法内联），
 * 该版本点封面「开始漫游」会直接进星图。
 *
 * 开发文件一律原样保留：改完文案或样式，重新跑一次本脚本即可。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'deploy');
const OUT = path.join(OUT_DIR, 'index.html');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const inline = (p) => {
  const ext = path.extname(p).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  return 'data:' + mime + ';base64,' + fs.readFileSync(path.join(ROOT, p)).toString('base64');
};

let html = read('index.html');
const css = read('style.css');
const src = read('main.js');
const data = JSON.parse(read('storyData.json'));

// 单文件版没有 漫游前传/ 目录（前传是独立页面 + 同目录音频，无法内联）：
// 置空 PREQUEL_URL，点「开始漫游」直接进星图（多文件版保留跳前传）。
const PREQUEL_MARK = "PREQUEL_URL: '漫游前传/index.html'";
if (!src.includes(PREQUEL_MARK)) {
  throw new Error('单文件降级失败：main.js 里没找到 PREQUEL_URL 配置行，请检查写法是否改动过');
}
const js = src.replace(PREQUEL_MARK, "PREQUEL_URL: ''");

// 二类照片（每点位第二张）：JSON 里写的路径优先；路径对不上就按 二类/<序号>.* 找；
// 还没有图就返回 null，本次打包跳过换图（不影响第一张与整体流程）
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const SECOND_DIR = '二类';

function resolveSecond(spot, index) {
  if (!spot.image2) return null;
  if (fs.existsSync(path.join(ROOT, spot.image2))) return spot.image2;

  const dir = path.join(ROOT, SECOND_DIR);
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) =>
    path.basename(f, path.extname(f)) === String(index + 1) &&
    IMG_EXT.includes(path.extname(f).toLowerCase())
  );
  return hit ? SECOND_DIR + '/' + hit : null;
}

// 图片全部转成 base64 内联，点位的 image / image2 字段直接换成 data URI
const noSecond = [];
data.spots.forEach((spot, i) => {
  if (spot.image) spot.image = inline(spot.image);

  const second = resolveSecond(spot, i);
  if (second) spot.image2 = inline(second);
  else { delete spot.image2; noSecond.push(i + 1); }
});

// JSON 里若出现 "</"，会提前关掉 <script> 标签，转义成 <\/ （仍然是合法 JSON）
const json = JSON.stringify(data).replace(/<\//g, '<\\/');

html = html
  .replace(
    '  <!-- 唯一外部样式；无任何第三方库、字体 CDN。星空由 CSS 绘制，实景图来自 photoes/ -->',
    '  <!-- 单文件版：CSS / JS / 文案数据 / 图片（base64）全部内联，双击即可打开，无需本地服务器 -->'
  )
  .replace(
    /<link rel="stylesheet" href="\.\/style\.css" \/>/,
    () => '<style>\n' + css + '\n</style>'
  )
  .replace(
    /<script src="\.\/main\.js"><\/script>/,
    () => '<script id="storyData" type="application/json">' + json + '</script>\n<script>\n' + js + '\n</script>'
  );

if (html.includes('./style.css') || html.includes('./main.js')) {
  throw new Error('内联失败：index.html 里仍残留外部引用，请检查标签写法是否改动过');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);

console.log('已生成 ' + path.relative(ROOT, OUT) + '（' + (fs.statSync(OUT).size / 1048576).toFixed(2) + ' MB）');
if (noSecond.length) {
  console.log('提示：第 ' + noSecond.join('、') + ' 站还没有二类照片，本次打包跳过换图；');
  console.log('      把图放进 ' + SECOND_DIR + '/<序号>.png|jpg 后重新跑一次 node build.js 即可。');
}
console.log('双击即可打开；或把它放进任意静态站点目录直接部署。');
