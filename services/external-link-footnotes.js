/**
 * 外链转底部引用模块
 *
 * 解决微信公众号草稿箱外链无法点击的平台限制：
 * 把文中外链标注上标索引，文末生成完整 URL 参考文献列表，
 * 方便读者复制访问。参考 doocs/md 的成熟实现。
 *
 * 设计要点：
 * - 纯函数，直接操作传入的 DOM root，不修改全局状态
 * - 微信内链（mp.weixin.qq.com）保留原样，因为本来就能点
 * - 相同 URL 去重，复用索引
 * - 全部使用 inline style，不依赖 CSS class（微信会剥离 <style> 和 class）
 */

// 微信公众号内链：文章、视频号等，这类链接在微信里本来就能点击
const MP_WEIXIN_LINK_REGEX = /^https?:\/\/mp\.weixin\.qq\.com\//i;

// 参考文献区块的默认标题（与 doocs/md 保持一致）
const DEFAULT_REFERENCES_TITLE = 'References';

/**
 * 判断一个 URL 是否为微信内链（不需要转换）
 * @param {string} href - 链接地址
 * @returns {boolean} true 表示是微信内链
 */
function isWechatInternalLink(href) {
  return typeof href === 'string' && MP_WEIXIN_LINK_REGEX.test(href.trim());
}

/**
 * 构建文末单条参考文献的 HTML
 * 当显示文字和 URL 相同时，省略标题前缀，只展示 URL
 *
 * @param {number} index - 索引编号
 * @param {string} title - 链接显示文字
 * @param {string} link - 链接 URL
 * @param {object} document - DOM document 对象，用于创建元素
 * @returns {HTMLElement} 该条参考文献的容器元素
 */
function buildFootnoteEntry(index, title, link, document) {
  const entry = document.createElement('p');
  entry.setAttribute('style', 'margin:0;padding:0;');

  const indexCode = document.createElement('code');
  indexCode.setAttribute('style', 'font-size:90%;opacity:0.6;');
  indexCode.textContent = `[${index}]`;
  entry.appendChild(indexCode);

  // 显示文字与 URL 相同时，省略 "标题:" 前缀，只展示 URL
  if (title && title !== link) {
    const titleSeparator = document.createTextNode(` ${title}: `);
    entry.appendChild(titleSeparator);
  } else {
    const spacer = document.createTextNode(' ');
    entry.appendChild(spacer);
  }

  const urlItalic = document.createElement('i');
  urlItalic.setAttribute('style', 'word-break:break-all;');
  urlItalic.textContent = link;
  entry.appendChild(urlItalic);

  entry.appendChild(document.createElement('br'));
  return entry;
}

/**
 * 构建文末 References 区块
 *
 * @param {Array<[number, string, string]>} footnotes - [index, title, link] 数组
 * @param {string} title - 区块标题
 * @param {string} accentColor - 索引/标题颜色（取主题链接色）
 * @param {object} document - DOM document 对象
 * @returns {HTMLElement} 完整的 References section 元素
 */
function buildReferencesSection(footnotes, title, accentColor, document) {
  const section = document.createElement('section');
  // 全 inline style：字号缩小、顶部留白分隔、颜色淡化
  section.setAttribute(
    'style',
    `font-size:80%;margin:24px 8px 0;color:#999;word-break:break-all;`
  );

  const heading = document.createElement('h4');
  heading.setAttribute(
    'style',
    `margin:0 0 8px;font-size:14px;font-weight:bold;color:${accentColor};`
  );
  heading.textContent = title || DEFAULT_REFERENCES_TITLE;
  section.appendChild(heading);

  const list = document.createElement('div');
  footnotes
    .map(([index, entryTitle, link]) => buildFootnoteEntry(index, entryTitle, link, document))
    .forEach((entry) => list.appendChild(entry));
  section.appendChild(list);

  return section;
}

/**
 * 将 root 内的外链转换为「文中上标索引 + 文末参考文献列表」
 *
 * 转换规则：
 * 1. 跳过微信内链（mp.weixin.qq.com）和锚点链接（#xxx）
 * 2. 相同 URL 去重，复用索引
 * 3. 文中：在每个外链末尾插入 <sup>[索引]</sup>，保留原 <a> 链接样式
 * 4. 文末：追加 References 区块，列出所有外链完整 URL
 *
 * @param {HTMLElement} root - 渲染后的 HTML 根节点（会被直接修改）
 * @param {object} options - 配置项
 * @param {string} [options.title] - References 区块标题，默认 "References"
 * @param {string} [options.accentColor] - 索引/标题颜色，默认 "#576b95"（微信默认链接蓝）
 * @returns {void} 直接修改 root
 */
function convertExternalLinksToFootnotes(root, options) {
  if (!root) return;
  if (typeof document === 'undefined' && !root.ownerDocument) return;

  const doc = root.ownerDocument || document;
  const config = options || {};
  const accentColor = config.accentColor || '#576b95';
  const referencesTitle = config.title || DEFAULT_REFERENCES_TITLE;

  // 收集所有外链 <a>，跳过微信内链和锚点
  const allAnchors = Array.from(root.querySelectorAll('a[href]'));
  const externalAnchors = allAnchors.filter((anchor) => {
    const href = (anchor.getAttribute('href') || '').trim();
    if (!href) return false;
    if (href.startsWith('#')) return false; // 锚点链接，不转换
    return !isWechatInternalLink(href);
  });

  if (externalAnchors.length === 0) return;

  // 去重：相同 URL 复用索引
  const footnotes = []; // [index, title, link]
  const urlToIndex = new Map();

  externalAnchors.forEach((anchor) => {
    const href = (anchor.getAttribute('href') || '').trim();
    const text = (anchor.textContent || '').trim();

    let index = urlToIndex.get(href);
    if (index === undefined) {
      index = footnotes.length + 1;
      urlToIndex.set(href, index);
      footnotes.push([index, text, href]);
    }

    // 文中：在 <a> 末尾插入上标索引（保留原链接样式，仅追加 sup）
    const sup = doc.createElement('sup');
    sup.setAttribute('style', `color:${accentColor};font-size:75%;`);
    sup.textContent = `[${index}]`;
    anchor.appendChild(sup);
  });

  // 文末：追加 References 区块
  const referencesSection = buildReferencesSection(footnotes, referencesTitle, accentColor, doc);
  root.appendChild(referencesSection);
}

module.exports = {
  convertExternalLinksToFootnotes,
  isWechatInternalLink,
  buildReferencesSection,
  buildFootnoteEntry,
  MP_WEIXIN_LINK_REGEX,
  DEFAULT_REFERENCES_TITLE,
};
