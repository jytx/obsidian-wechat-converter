import { describe, it, expect } from 'vitest';

const {
  convertExternalLinksToFootnotes,
  isWechatInternalLink,
  buildFootnoteEntry,
  MP_WEIXIN_LINK_REGEX,
} = require('../services/external-link-footnotes');

// 辅助：在 jsdom 里创建一个容器并填入 HTML
function createRoot(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

// 辅助：读取文中所有 <sup> 索引（如 "[1]"）
function getInlineIndices(root) {
  return Array.from(root.querySelectorAll('a[href] sup'))
    .map((sup) => sup.textContent.trim());
}

// 辅助：读取文末 References 区块的条目文本
function getReferenceEntries(root) {
  const section = root.querySelector('section');
  if (!section) return [];
  // 每条 <p> 是一个参考文献条目（外层包了 div，里面是 p 列表）
  return Array.from(section.querySelectorAll('p'))
    .map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

describe('external-link-footnotes: isWechatInternalLink', () => {
  it('应识别 mp.weixin.qq.com 为微信内链', () => {
    expect(isWechatInternalLink('https://mp.weixin.qq.com/s?__biz=xxx')).toBe(true);
    expect(isWechatInternalLink('http://mp.weixin.qq.com/s?id=1')).toBe(true);
  });

  it('应识别非微信域名为外链', () => {
    expect(isWechatInternalLink('https://github.com/DeusData/codebase-memory-mcp')).toBe(false);
    expect(isWechatInternalLink('https://openeuler.csdn.net/xxx')).toBe(false);
    expect(isWechatInternalLink('https://example.com')).toBe(false);
  });

  it('不应把相似域名误判为微信内链', () => {
    expect(isWechatInternalLink('https://mp.weixin.qq.com.evil.com/')).toBe(false);
    expect(isWechatInternalLink('https://fake-mp.weixin.qq.com.attacker.com/')).toBe(false);
  });
});

describe('external-link-footnotes: convertExternalLinksToFootnotes', () => {
  it('应在文中外链加上标索引，文末生成对应条目', () => {
    const root = createRoot(
      '<a href="https://github.com/foo">GitHub 项目</a>'
    );
    convertExternalLinksToFootnotes(root);

    // 文中：<a> 末尾追加 <sup>[1]</sup>
    expect(getInlineIndices(root)).toEqual(['[1]']);

    // 文末：1 条参考文献，包含标题和 URL
    const entries = getReferenceEntries(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('[1]');
    expect(entries[0]).toContain('GitHub 项目');
    expect(entries[0]).toContain('https://github.com/foo');
  });

  it('应跳过微信内链，不转换', () => {
    const root = createRoot(
      '<a href="https://mp.weixin.qq.com/s?__biz=123">公众号文章</a>'
    );
    convertExternalLinksToFootnotes(root);

    // 不应加索引
    expect(getInlineIndices(root)).toEqual([]);
    // 不应生成 References 区块
    expect(root.querySelector('section')).toBeNull();
  });

  it('应跳过锚点链接（#xxx），不转换', () => {
    const root = createRoot(
      '<a href="#section-1">跳转到第一节</a>'
    );
    convertExternalLinksToFootnotes(root);

    expect(getInlineIndices(root)).toEqual([]);
    expect(root.querySelector('section')).toBeNull();
  });

  it('应对相同 URL 去重，复用索引', () => {
    const root = createRoot(
      '<a href="https://github.com/same">链接一</a>' +
      '<a href="https://github.com/same">链接二</a>' +
      '<a href="https://github.com/same">链接三</a>'
    );
    convertExternalLinksToFootnotes(root);

    // 三处文中都用 [1]（去重复用）
    expect(getInlineIndices(root)).toEqual(['[1]', '[1]', '[1]']);
    // 文末只有 1 条
    expect(getReferenceEntries(root)).toHaveLength(1);
  });

  it('多个不同外链应分配递增索引', () => {
    const root = createRoot(
      '<a href="https://a.com">A</a>' +
      '<a href="https://b.com">B</a>' +
      '<a href="https://c.com">C</a>'
    );
    convertExternalLinksToFootnotes(root);

    expect(getInlineIndices(root)).toEqual(['[1]', '[2]', '[3]']);
    expect(getReferenceEntries(root)).toHaveLength(3);
  });

  it('显示文字与 URL 相同时，文末条目应省略标题前缀', () => {
    const root = createRoot(
      '<a href="https://example.com">https://example.com</a>'
    );
    convertExternalLinksToFootnotes(root);

    const entries = getReferenceEntries(root);
    expect(entries).toHaveLength(1);
    // 应该是 "[1] https://example.com" 而不是 "[1] https://example.com: https://example.com"
    expect(entries[0]).toBe('[1] https://example.com');
  });

  it('应混合处理内链与外链：只转换外链', () => {
    const root = createRoot(
      '<a href="https://mp.weixin.qq.com/s?id=1">内链</a>' +
      '<a href="https://github.com/foo">外链</a>'
    );
    convertExternalLinksToFootnotes(root);

    // 只有外链那一个有索引
    expect(getInlineIndices(root)).toEqual(['[1]']);
    expect(getReferenceEntries(root)).toHaveLength(1);
    expect(getReferenceEntries(root)[0]).toContain('https://github.com/foo');
  });

  it('无外链时不应生成 References 区块', () => {
    const root = createRoot('<p>纯文本，没有链接</p>');
    convertExternalLinksToFootnotes(root);
    expect(root.querySelector('section')).toBeNull();
  });

  it('空 root 应安全返回，不报错', () => {
    expect(() => convertExternalLinksToFootnotes(null)).not.toThrow();
    expect(() => convertExternalLinksToFootnotes(createRoot(''))).not.toThrow();
  });

  it('应保留原 <a> 的 href 和文本内容', () => {
    const root = createRoot(
      '<a href="https://github.com/foo" style="color:#576b95;">项目地址</a>'
    );
    convertExternalLinksToFootnotes(root);

    const anchor = root.querySelector('a[href="https://github.com/foo"]');
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute('href')).toBe('https://github.com/foo');
    expect(anchor.getAttribute('style')).toContain('color:#576b95');
    // 原文本保留，索引追加在后面
    expect(anchor.textContent).toContain('项目地址');
    expect(anchor.textContent).toContain('[1]');
  });

  it('References 区块应使用 inline style（微信兼容，不依赖 class）', () => {
    const root = createRoot('<a href="https://x.com">X</a>');
    convertExternalLinksToFootnotes(root);

    const section = root.querySelector('section');
    expect(section).not.toBeNull();
    const style = section.getAttribute('style') || '';
    expect(style).toContain('font-size');
    expect(style).toContain('margin');
  });

  it('应支持自定义标题和颜色', () => {
    const root = createRoot('<a href="https://x.com">X</a>');
    convertExternalLinksToFootnotes(root, {
      title: '参考资料',
      accentColor: '#ff0000',
    });

    const heading = root.querySelector('section h4');
    expect(heading.textContent).toBe('参考资料');
    expect((heading.getAttribute('style') || '').includes('#ff0000')).toBe(true);
  });
});

describe('external-link-footnotes: buildFootnoteEntry', () => {
  it('显示文字与 URL 不同时，应输出 "标题: URL" 格式', () => {
    const entry = buildFootnoteEntry(1, 'GitHub', 'https://github.com', document);
    const text = entry.textContent.replace(/\s+/g, ' ').trim();
    expect(text).toBe('[1] GitHub: https://github.com');
  });

  it('显示文字与 URL 相同时，应省略标题前缀', () => {
    const entry = buildFootnoteEntry(2, 'https://x.com', 'https://x.com', document);
    const text = entry.textContent.replace(/\s+/g, ' ').trim();
    expect(text).toBe('[2] https://x.com');
  });
});

describe('external-link-footnotes: MP_WEIXIN_LINK_REGEX', () => {
  it('应匹配 http 和 https 的 mp.weixin.qq.com', () => {
    expect(MP_WEIXIN_LINK_REGEX.test('https://mp.weixin.qq.com/s?id=1')).toBe(true);
    expect(MP_WEIXIN_LINK_REGEX.test('http://mp.weixin.qq.com/')).toBe(true);
  });
});
