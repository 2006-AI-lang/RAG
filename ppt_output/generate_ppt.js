const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.author = "FitQA";
pres.title = "垂直领域RAG智能问答与训练辅助系统总结报告";

// ============================================================
// SLIDE DIMENSIONS
// ============================================================
pres.layout = "LAYOUT_16x9";
const SLIDE_W = 10;
const SLIDE_H = 5.625;
const MARGIN = 0.5;
const CONTENT_X = MARGIN;
const CONTENT_Y = MARGIN;
const CONTENT_W = SLIDE_W - 2 * MARGIN;
const CONTENT_H = SLIDE_H - 2 * MARGIN;
const CENTER_X = SLIDE_W / 2;
const CENTER_Y = SLIDE_H / 2;

// ============================================================
// CONTAINER SYSTEM
// ============================================================
function calculateScaledImageOpts(opts) {
  const { path, w: targetW, h: targetH, x = 0, y = 0, mode = "cover", ...rest } = opts;
  if (!path || !targetW || !targetH) return opts;
  return { path, x, y, w: targetW, h: targetH, sizing: { type: mode, w: targetW, h: targetH }, ...rest };
}

function createVirtualNode(type, data, parentX, parentY) {
  const opts = data.opts || {};
  const node = {
    type, data,
    absX: parentX + (opts.x || 0),
    absY: parentY + (opts.y || 0),
    w: opts.w || 0, h: opts.h || 0,
    children: []
  };
  node.addShape = function(shapeType, opts = {}) {
    const child = createVirtualNode("shape", { shapeType, opts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };
  node.addText = function(text, opts = {}) {
    const safeOpts = { fit: "shrink", ...opts };
    const bulletRe = /^(?:[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB\u2013\u2014]\s*|\-\s+)/;
    if (Array.isArray(text)) {
      text = text.map(item => {
        if (item && item.options && item.options.bullet && typeof item.text === "string") {
          return { ...item, text: item.text.replace(bulletRe, "") };
        }
        return item;
      });
    }
    const child = createVirtualNode("text", { text, opts: safeOpts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };
  node.addImage = function(opts = {}) {
    const scaledOpts = calculateScaledImageOpts(opts);
    const child = createVirtualNode("image", { opts: scaledOpts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };
  node.addTable = function(tableData, opts = {}) {
    const child = createVirtualNode("table", { tableData, opts }, node.absX, node.absY);
    node.children.push(child);
    return child;
  };
  return node;
}

function flattenNode(node, realSlide, pres) {
  const absOpts = { ...node.data.opts, x: node.absX, y: node.absY };
  if (node.type === "shape") realSlide.addShape(node.data.shapeType, absOpts);
  else if (node.type === "text") realSlide.addText(node.data.text, absOpts);
  else if (node.type === "image") realSlide.addImage(absOpts);
  else if (node.type === "table") realSlide.addTable(node.data.tableData, absOpts);
  node.children.forEach(child => flattenNode(child, realSlide, pres));
}

const originalAddSlide = pres.addSlide.bind(pres);
pres.addSlide = function(options) {
  const realSlide = originalAddSlide(options);
  const virtualSlide = {
    children: [],
    _realSlide: realSlide,
    set background(val) { realSlide.background = val; },
    get background() { return realSlide.background; },
    addShape: function(shapeType, opts = {}) {
      const node = createVirtualNode("shape", { shapeType, opts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addText: function(text, opts = {}) {
      const safeOpts = { fit: "shrink", ...opts };
      const node = createVirtualNode("text", { text, opts: safeOpts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addImage: function(opts = {}) {
      const scaledOpts = calculateScaledImageOpts(opts);
      const node = createVirtualNode("image", { opts: scaledOpts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addTable: function(tableData, opts = {}) {
      const node = createVirtualNode("table", { tableData, opts }, 0, 0);
      this.children.push(node);
      return node;
    },
    addChart: function(chartType, data, opts = {}) {
      realSlide.addChart(chartType, data, opts);
    },
    render: function() {
      this.children.forEach(child => flattenNode(child, realSlide, pres));
    }
  };
  return virtualSlide;
};

// ============================================================
// DESIGN CONSTANTS
// ============================================================
const PRIMARY = "1A6B3C";
const SECONDARY = "30B15A";
const ACCENT = "FF9F0A";
const BG = "F5F5F7";
const DARK = "1D1D1F";
const LIGHT = "E9F7EE";
const CARD_BG = "FFFFFF";
const TEXT_SEC = "6E6E73";
const TEXT_MUTED = "86868B";
const DARK_BG = "0A1F12";
const WHITE = "FFFFFF";

const TITLE_FONT = "Songti SC";
const BODY_FONT = "PingFang SC";

const makeShadow = () => ({
  type: "outer", blur: 12, offset: 4, angle: 135,
  color: "000000", opacity: 0.28
});

const makeHeroShadow = () => ({
  type: "outer", blur: 16, offset: 6, angle: 135,
  color: "000000", opacity: 0.32
});

// ============================================================
// SLIDE 1: COVER
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { path: "images/bg-cover_16x9.jpg" };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fill: { color: DARK_BG, transparency: 35 }
  });

  slide.addText("垂直领域 RAG 智能问答与\n训练辅助系统", {
    x: 0.5, y: 1.5, w: 9, h: 1.4,
    fontSize: 36, fontFace: TITLE_FONT, color: WHITE,
    bold: true, align: "center", valign: "middle",
    charSpacing: 2
  });

  slide.addText("项目架构、RAG 检索体系、前端交互与数据库工程总结", {
    x: 1, y: 3.1, w: 8, h: 0.6,
    fontSize: 18, fontFace: TITLE_FONT, color: LIGHT,
    align: "center", valign: "middle",
    charSpacing: 1
  });

  slide.addText("2026 年 9 月", {
    x: 1, y: 4.3, w: 8, h: 0.4,
    fontSize: 14, fontFace: BODY_FONT, color: "BBBBBB",
    align: "center"
  });

  slide.render();
}

// ============================================================
// SLIDE 2: TABLE OF CONTENTS
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("目录", {
    x: 0.5, y: 0.4, w: 9, h: 0.8,
    fontSize: 32, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1.5
  });

  const items = [
    { num: "01", title: "项目概览", desc: "系统定位与核心技术底座" },
    { num: "02", title: "核心实现流程", desc: "文档解析、混合检索与重排生成" },
    { num: "03", title: "前端 UI 设计", desc: "视觉系统、交互技术与体验亮点" },
    { num: "04", title: "数据库搭建", desc: "关系模型与检索存储架构" },
    { num: "05", title: "技术亮点与总结", desc: "成果总结与演进展望" }
  ];

  const startY = 1.45;
  const itemH = 0.72;
  const itemGap = 0.1;

  items.forEach((item, i) => {
    const y = startY + i * (itemH + itemGap);

    slide.addShape(pres.shapes.OVAL, {
      x: 1.5, y: y, w: 0.55, h: 0.55,
      fill: { color: PRIMARY }, shadow: makeShadow()
    });
    slide.addText(item.num, {
      x: 1.5, y: y, w: 0.55, h: 0.55,
      fontSize: 13, fontFace: BODY_FONT, color: WHITE,
      bold: true, align: "center", valign: "middle"
    });

    slide.addText(item.title, {
      x: 2.25, y: y - 0.02, w: 6, h: 0.35,
      fontSize: 17, fontFace: TITLE_FONT, color: DARK, bold: true,
      valign: "middle"
    });

    slide.addText(item.desc, {
      x: 2.25, y: y + 0.3, w: 6, h: 0.25,
      fontSize: 12, fontFace: BODY_FONT, color: TEXT_SEC
    });
  });

  slide.render();
}

// ============================================================
// SLIDE 3: PROJECT OVERVIEW
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("项目概览", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 28, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1.5
  });

  let card = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 1.15, w: 4.8, h: 3.85,
    fill: { color: CARD_BG }, rectRadius: 0.1,
    shadow: makeShadow()
  });

  card.addText("核心技术底座", {
    x: 0.25, y: 0.2, w: 4.3, h: 0.35,
    fontSize: 15, fontFace: TITLE_FONT, color: PRIMARY, bold: true
  });

  card.addText([
    { text: "多源异构解析与重叠切片: PDF/DOCX/TXT 自动解析", options: { bullet: true, breakLine: true } },
    { text: "双路互补混合检索: BM25 词频匹配 + 密集向量语义召回", options: { bullet: true, breakLine: true } },
    { text: "Cross-Encoder 重排: 深度交叉打分, 剔除低相关噪音", options: { bullet: true, breakLine: true } },
    { text: "带溯源的可信生成: 引用知识库原文切片, 可核查", options: { bullet: true, breakLine: true } },
    { text: "前后端解耦: 原生 Web 前端 + FastAPI 后端", options: { bullet: true, breakLine: true } },
    { text: "智能问答与多会话: 流式响应 + 历史回溯", options: { bullet: true, breakLine: true } },
    { text: "知识库全生命周期管理: 拖拽上传 + 切片存储", options: { bullet: true, breakLine: true } },
    { text: "专项训练与习题生成: 定制化评估与训练计划", options: { bullet: true } }
  ], {
    x: 0.25, y: 0.65, w: 4.3, h: 3.0,
    fontSize: 12.5, fontFace: BODY_FONT, color: DARK,
    paraSpaceAfter: 4
  });

  slide.addImage(calculateScaledImageOpts({
    path: "images/image-overview_4x3.jpg",
    x: 5.5, y: 1.5, w: 4.0, h: 3.0,
    mode: "cover"
  }));

  slide.render();
}

// ============================================================
// SLIDE 4: SYSTEM ARCHITECTURE
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("系统架构", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 28, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1.5
  });

  const layers = [
    { label: "前端层", detail: "HTML5 + CSS3 + 模块化 ES6 JS  ·  零构建成本  ·  响应式布局", color: PRIMARY },
    { label: "应用层", detail: "FastAPI  ·  RAG 混合检索  ·  LLM 生成  ·  用户认证", color: SECONDARY },
    { label: "数据层", detail: "关系型数据库  ·  向量索引 (FAISS)  ·  BM25 倒排索引", color: "1A4A2B" }
  ];

  const nodeW = 8, nodeH = 0.85, gap = 0.65;
  const startX = (SLIDE_W - nodeW) / 2;
  const startY = 1.5;

  layers.forEach((layer, i) => {
    const y = startY + i * (nodeH + gap);

    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: startX, y: y, w: nodeW, h: nodeH,
      fill: { color: layer.color }, rectRadius: 0.1,
      shadow: makeShadow()
    });

    slide.addText(layer.label, {
      x: startX + 0.25, y: y, w: 1.5, h: nodeH,
      fontSize: 16, fontFace: TITLE_FONT, color: WHITE,
      bold: true, align: "left", valign: "middle"
    });

    slide.addText(layer.detail, {
      x: startX + 1.8, y: y, w: nodeW - 2.0, h: nodeH,
      fontSize: 12, fontFace: BODY_FONT, color: WHITE,
      valign: "middle"
    });

    if (i < layers.length - 1) {
      slide.addShape(pres.shapes.LINE, {
        x: startX + nodeW / 2, y: y + nodeH,
        w: 0, h: gap - 0.05,
        line: { color: "999999", width: 1.5, endArrowType: "triangle" }
      });
    }
  });

  slide.render();
}

// ============================================================
// SLIDE 5: CORE IMPLEMENTATION FLOW
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("核心实现流程", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 28, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1.5
  });

  // Phase labels
  slide.addText("离线知识加工", {
    x: 0.5, y: 1.05, w: 4.3, h: 0.3,
    fontSize: 13, fontFace: TITLE_FONT, color: PRIMARY, bold: true
  });
  slide.addText("在线混合检索", {
    x: 5.2, y: 1.05, w: 4.3, h: 0.3,
    fontSize: 13, fontFace: TITLE_FONT, color: ACCENT, bold: true
  });

  // Left flow (offline) - vertical steps
  const offlineSteps = [
    { label: "文档上传 (PDF/DOCX/TXT)", color: PRIMARY },
    { label: "文本分块 (重叠滑动切片)", color: SECONDARY },
    { label: "向量化 (Embedding)", color: "1A4A2B" },
    { label: "存储: 向量库 + 倒排索引", color: "2C7A4D" }
  ];

  const stepW = 4.3, stepH = 0.55, stepGap = 0.18;
  const offStartY = 1.45;

  offlineSteps.forEach((step, i) => {
    const y = offStartY + i * (stepH + stepGap);

    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5, y: y, w: stepW, h: stepH,
      fill: { color: step.color }, rectRadius: 0.08,
      shadow: makeShadow()
    });
    slide.addText(step.label, {
      x: 0.5, y: y, w: stepW, h: stepH,
      fontSize: 11, fontFace: BODY_FONT, color: WHITE,
      bold: true, align: "center", valign: "middle"
    });

    if (i < offlineSteps.length - 1) {
      slide.addShape(pres.shapes.LINE, {
        x: 0.5 + stepW / 2, y: y + stepH,
        w: 0, h: stepGap - 0.03,
        line: { color: "999999", width: 1.5, endArrowType: "triangle" }
      });
    }
  });

  // Right flow (online) - vertical steps
  const onlineSteps = [
    { label: "用户提问 (Query)", color: ACCENT },
    { label: "向量召回 + BM25 召回", color: "E8850A" },
    { label: "混合融合 (Hybrid) + Reranker", color: "D4770A" },
    { label: "上下文拼装 → LLM 生成", color: "B8650A" }
  ];

  onlineSteps.forEach((step, i) => {
    const y = offStartY + i * (stepH + stepGap);

    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 5.2, y: y, w: stepW, h: stepH,
      fill: { color: step.color }, rectRadius: 0.08,
      shadow: makeShadow()
    });
    slide.addText(step.label, {
      x: 5.2, y: y, w: stepW, h: stepH,
      fontSize: 11, fontFace: BODY_FONT, color: WHITE,
      bold: true, align: "center", valign: "middle"
    });

    if (i < onlineSteps.length - 1) {
      slide.addShape(pres.shapes.LINE, {
        x: 5.2 + stepW / 2, y: y + stepH,
        w: 0, h: stepGap - 0.03,
        line: { color: "999999", width: 1.5, endArrowType: "triangle" }
      });
    }
  });

  // Bottom note
  slide.addText("单一向量对专有名词匹配敏感度低, BM25 对同义表述泛化能力弱, 双路互补兼顾召回率与准确率", {
    x: 0.5, y: 4.05, w: 9, h: 0.4,
    fontSize: 11, fontFace: BODY_FONT, color: TEXT_MUTED, italic: true,
    align: "center"
  });

  slide.render();
}

// ============================================================
// SLIDE 6: FRONTEND - VISUAL SYSTEM
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("前端 UI 设计：视觉系统与响应式布局", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 24, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1
  });

  let card = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 1.15, w: 4.8, h: 3.85,
    fill: { color: CARD_BG }, rectRadius: 0.1,
    shadow: makeShadow()
  });

  card.addText("现代极简设计哲学", {
    x: 0.25, y: 0.2, w: 4.3, h: 0.35,
    fontSize: 14, fontFace: TITLE_FONT, color: PRIMARY, bold: true
  });

  card.addText([
    { text: "CSS 变量体系: 统管主色调、背景层次、圆角与阴影", options: { bullet: true, breakLine: true } },
    { text: "高度视觉一致性, 天然支持明暗主题扩展", options: { bullet: true, breakLine: true } },
    { text: "弹性栅格: 桌面端三栏布局 (导航+问答+知识库)", options: { bullet: true, breakLine: true } },
    { text: "抽屉式侧边栏: 移动端自动退化为折叠抽屉", options: { bullet: true, breakLine: true } },
    { text: "响应式媒体查询: 无缝自适应多终端", options: { bullet: true, breakLine: true } },
    { text: "零构建成本: 无 Webpack/Vite, 改动即刷新", options: { bullet: true, breakLine: true } },
    { text: "现代原生 Web 技术栈: HTML5 + CSS3 + ES6 JS", options: { bullet: true, breakLine: true } },
    { text: "媲美 SPA 单页应用的交互体验", options: { bullet: true } }
  ], {
    x: 0.25, y: 0.65, w: 4.3, h: 3.0,
    fontSize: 12.5, fontFace: BODY_FONT, color: DARK,
    paraSpaceAfter: 4
  });

  slide.addImage(calculateScaledImageOpts({
    path: "images/image-frontend-design_4x3.jpg",
    x: 5.5, y: 1.5, w: 4.0, h: 3.0,
    mode: "cover"
  }));

  slide.render();
}

// ============================================================
// SLIDE 7: FRONTEND - CORE INTERACTION
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("前端 UI 设计：核心交互技术", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 26, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1
  });

  let card = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 0.5, y: 1.15, w: 4.8, h: 3.85,
    fill: { color: CARD_BG }, rectRadius: 0.1,
    shadow: makeShadow()
  });

  card.addText("关键交互实现", {
    x: 0.25, y: 0.2, w: 4.3, h: 0.35,
    fontSize: 14, fontFace: TITLE_FONT, color: PRIMARY, bold: true
  });

  card.addText([
    { text: "无刷新会话管理: 前端响应式状态机", options: { bullet: true, breakLine: true } },
    { text: "  · 新建/重命名/删除/切换, 历史快速呈现", options: { breakLine: true } },
    { text: "流式打字效果: ReadableStream 消费后端数据", options: { bullet: true, breakLine: true } },
    { text: "  · 边传输边排版, 杜绝视觉停滞感", options: { breakLine: true } },
    { text: "实时 Markdown 渲染 + 代码块高亮", options: { bullet: true, breakLine: true } },
    { text: "引用来源可视化: 结构化参考来源折叠卡片", options: { bullet: true, breakLine: true } },
    { text: "  · 展示匹配文件与原文切片, 增强透明度", options: { breakLine: true } },
    { text: "微动效: 拖拽上传 + 解析进度条 + 骨架动效", options: { bullet: true, breakLine: true } },
    { text: "防御性设计: 按钮防抖, 防止高频重复提交", options: { bullet: true } }
  ], {
    x: 0.25, y: 0.65, w: 4.3, h: 3.0,
    fontSize: 12, fontFace: BODY_FONT, color: DARK,
    paraSpaceAfter: 3
  });

  slide.addImage(calculateScaledImageOpts({
    path: "images/image-frontend-layout_4x3.jpg",
    x: 5.5, y: 1.5, w: 4.0, h: 3.0,
    mode: "cover"
  }));

  slide.render();
}

// ============================================================
// SLIDE 8: FRONTEND - TECH HIGHLIGHTS
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("前端 UI 设计：技术亮点", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 26, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1
  });

  const cards2x2 = [
    { title: "SSE 流式响应", desc: "fetch + ReadableStream\n逐块渲染 + 流式光标\n支持手动停止", color: PRIMARY },
    { title: "实时 Markdown", desc: "轻量语法解析引擎\n代码块高亮\n边传输边排版", color: SECONDARY },
    { title: "拖拽式上传", desc: "Drag & Drop 文件\n动态解析进度条\n切片分块存储", color: "1A4A2B" },
    { title: "防御性交互", desc: "按钮防抖机制\n加载骨架动效\n防止重复提交", color: "2C7A4D" }
  ];

  const gridX = 0.5, gridY = 1.15;
  const gridW = 4.8, gridH = 3.85;
  const cardGap = 0.2;
  const cW = (gridW - cardGap) / 2;
  const cH = (gridH - cardGap) / 2;

  cards2x2.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = gridX + col * (cW + cardGap);
    const cy = gridY + row * (cH + cardGap);

    let card = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: cx, y: cy, w: cW, h: cH,
      fill: { color: CARD_BG }, rectRadius: 0.08,
      shadow: makeShadow()
    });

    card.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: cW, h: 0.06,
      fill: { color: item.color }
    });

    card.addText(item.title, {
      x: 0.2, y: 0.15, w: cW - 0.4, h: 0.35,
      fontSize: 13, fontFace: TITLE_FONT, color: item.color, bold: true
    });

    card.addText(item.desc, {
      x: 0.2, y: 0.55, w: cW - 0.4, h: cH - 0.75,
      fontSize: 11, fontFace: BODY_FONT, color: TEXT_SEC
    });
  });

  slide.addImage(calculateScaledImageOpts({
    path: "images/image-frontend-tech_4x3.jpg",
    x: 5.5, y: 1.5, w: 4.0, h: 3.0,
    mode: "cover"
  }));

  slide.render();
}

// ============================================================
// SLIDE 9: DATABASE - RELATIONAL SCHEMA
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("数据库搭建：关系型数据库模型", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 26, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1
  });

  // Table
  const headerOpts = { fill: { color: PRIMARY }, color: WHITE, bold: true, align: "center", valign: "middle", fontSize: 12, fontFace: BODY_FONT };
  const cellOpts = { color: DARK, fontSize: 11, fontFace: BODY_FONT, valign: "middle" };

  const tableData = [
    [
      { text: "表名 / 实体", options: headerOpts },
      { text: "核心字段", options: headerOpts },
      { text: "业务作用", options: headerOpts }
    ],
    [
      { text: "User (用户表)", options: cellOpts },
      { text: "id, username, password_hash, created_at", options: cellOpts },
      { text: "身份认证与多租户数据隔离", options: cellOpts }
    ],
    [
      { text: "Session (会话表)", options: cellOpts },
      { text: "id, user_id, title, created_at, updated_at", options: cellOpts },
      { text: "一对多关联用户对话上下文", options: cellOpts }
    ],
    [
      { text: "Message (消息表)", options: cellOpts },
      { text: "id, session_id, role, content, sources", options: cellOpts },
      { text: "持久化交互记录, JSON 存引用", options: cellOpts }
    ],
    [
      { text: "Document/Chunk", options: cellOpts },
      { text: "doc_id, filename, file_type, chunk_count", options: cellOpts },
      { text: "文档元数据与切片总数管理", options: cellOpts }
    ]
  ];

  tableData.forEach((row, i) => {
    if (i === 0) return;
    row.forEach(cell => {
      if (!cell.options) cell.options = {};
      if (i % 2 === 0) {
        cell.options.fill = { color: LIGHT };
      } else {
        cell.options.fill = { color: CARD_BG };
      }
    });
  });

  slide.addTable(tableData, {
    x: 0.5, y: 1.15, w: 9,
    colW: [2.2, 4.0, 2.8],
    border: { pt: 0.5, color: "DDDDDD" },
    rowH: 0.5
  });

  // Bottom note
  slide.addText("基于关系型数据库规范化设计, 实现事务元数据与高性能检索索引的物理与逻辑解耦", {
    x: 0.5, y: 3.95, w: 9, h: 0.4,
    fontSize: 11.5, fontFace: BODY_FONT, color: TEXT_SEC, italic: true,
    align: "center"
  });

  slide.addImage(calculateScaledImageOpts({
    path: "images/image-database_4x3.jpg",
    x: 3.0, y: 4.35, w: 4.0, h: 1.0,
    mode: "cover"
  }));

  slide.render();
}

// ============================================================
// SLIDE 10: DATABASE - RETRIEVAL STORAGE
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("数据库搭建：检索存储与向量索引", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 26, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1
  });

  // 2 cards side by side
  const cardW = 4.3, cardH = 3.0, cardGap = 0.4;
  const cardStartX = (SLIDE_W - cardW * 2 - cardGap) / 2;
  const cardY = 1.2;

  // Left card - metadata decoupling
  let card1 = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardStartX, y: cardY, w: cardW, h: cardH,
    fill: { color: CARD_BG }, rectRadius: 0.1,
    shadow: makeShadow()
  });

  card1.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: cardW, h: 0.06,
    fill: { color: PRIMARY }
  });

  card1.addText("元数据与高维特征解耦", {
    x: 0.25, y: 0.2, w: cardW - 0.5, h: 0.35,
    fontSize: 14, fontFace: TITLE_FONT, color: PRIMARY, bold: true
  });

  card1.addText([
    { text: "结构化信息 (文件名/时间/状态)", options: { bullet: true, breakLine: true } },
    { text: "  → 关系数据库, 便于分页呈现", options: { breakLine: true } },
    { text: "高维向量 Embedding", options: { bullet: true, breakLine: true } },
    { text: "  → 专有向量检索层管理", options: { breakLine: true } },
    { text: "基于余弦相似度近邻检索计算", options: { bullet: true, breakLine: true } },
    { text: "物理与逻辑双重解耦", options: { bullet: true, breakLine: true } },
    { text: "前台展示与检索各司其职", options: { bullet: true } }
  ], {
    x: 0.25, y: 0.65, w: cardW - 0.5, h: 2.2,
    fontSize: 12, fontFace: BODY_FONT, color: DARK,
    paraSpaceAfter: 3
  });

  // Right card - BM25 persistence
  let card2 = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: cardStartX + cardW + cardGap, y: cardY, w: cardW, h: cardH,
    fill: { color: CARD_BG }, rectRadius: 0.1,
    shadow: makeShadow()
  });

  card2.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: cardW, h: 0.06,
    fill: { color: SECONDARY }
  });

  card2.addText("倒排词频索引持久化", {
    x: 0.25, y: 0.2, w: cardW - 0.5, h: 0.35,
    fontSize: 14, fontFace: TITLE_FONT, color: SECONDARY, bold: true
  });

  card2.addText([
    { text: "文本段落分词 → BM25 倒排索引", options: { bullet: true, breakLine: true } },
    { text: "词项与文档分块映射序列化存储", options: { bullet: true, breakLine: true } },
    { text: "本地持久化存储, 保障数据安全", options: { bullet: true, breakLine: true } },
    { text: "服务重启后秒级重载", options: { bullet: true, breakLine: true } },
    { text: "BM25 精确命中专业术语", options: { bullet: true, breakLine: true } },
    { text: "向量语义理解自然语言同义表述", options: { bullet: true } }
  ], {
    x: 0.25, y: 0.65, w: cardW - 0.5, h: 2.2,
    fontSize: 12, fontFace: BODY_FONT, color: DARK,
    paraSpaceAfter: 3
  });

  // Bottom note
  slide.addText("双路互补: BM25 解决专有名词命中, 向量解决语义泛化, 兼顾召回率与准确率", {
    x: 0.5, y: 4.4, w: 9, h: 0.4,
    fontSize: 12, fontFace: BODY_FONT, color: TEXT_MUTED, italic: true,
    align: "center"
  });

  slide.addImage(calculateScaledImageOpts({
    path: "images/image-security_4x3.jpg",
    x: 3.0, y: 4.8, w: 4.0, h: 0.55,
    mode: "cover"
  }));

  slide.render();
}

// ============================================================
// SLIDE 11: TECH HIGHLIGHTS & SUMMARY
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { color: BG };

  slide.addText("技术亮点与总结", {
    x: 0.5, y: 0.3, w: 9, h: 0.7,
    fontSize: 28, fontFace: TITLE_FONT, color: DARK,
    bold: true, charSpacing: 1.5
  });

  const highlights = [
    { title: "多级漏斗检索精度优异", desc: "向量语义召回 + BM25 精确命中 + Reranker 交叉深度精排, 有效破解专业领域生僻术语命中率低的行业痛点", color: PRIMARY },
    { title: "极致轻量与零门槛维护", desc: "前端零编译打包, 开箱即用; 后端 API、检索器、解析器与 LLM 客户端层层解耦, 架构整洁明晰", color: SECONDARY },
    { title: "高灵活性与演进潜力", desc: "底层存储和检索接口预留扩展能力, 可无缝接入 Milvus / PGVector 等工业级向量数据库或私有化大模型", color: "1A4A2B" }
  ];

  const hY = 1.2;
  const hH = 1.15;
  const hGap = 0.2;

  highlights.forEach((item, i) => {
    const y = hY + i * (hH + hGap);

    let card = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5, y: y, w: 9, h: hH,
      fill: { color: CARD_BG }, rectRadius: 0.08,
      shadow: makeShadow()
    });

    // Left accent bar
    card.addShape(pres.shapes.RECTANGLE, {
      x: 0, y: 0, w: 0.08, h: hH,
      fill: { color: item.color }
    });

    // Number circle
    card.addShape(pres.shapes.OVAL, {
      x: 0.25, y: 0.3, w: 0.5, h: 0.5,
      fill: { color: item.color }
    });
    card.addText(String(i + 1), {
      x: 0.25, y: 0.3, w: 0.5, h: 0.5,
      fontSize: 16, fontFace: BODY_FONT, color: WHITE,
      bold: true, align: "center", valign: "middle"
    });

    card.addText(item.title, {
      x: 0.9, y: 0.2, w: 8.0, h: 0.35,
      fontSize: 15, fontFace: TITLE_FONT, color: item.color, bold: true
    });

    card.addText(item.desc, {
      x: 0.9, y: 0.6, w: 8.0, h: 0.5,
      fontSize: 12, fontFace: BODY_FONT, color: TEXT_SEC
    });
  });

  slide.render();
}

// ============================================================
// SLIDE 12: CLOSING
// ============================================================
{
  let slide = pres.addSlide();
  slide.background = { path: "images/bg-closing_16x9.jpg" };

  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fill: { color: DARK_BG, transparency: 35 }
  });

  slide.addText("总结", {
    x: 1, y: 0.6, w: 8, h: 0.8,
    fontSize: 32, fontFace: TITLE_FONT, color: WHITE,
    bold: true, align: "center", charSpacing: 1.5
  });

  let card = slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 1.5, y: 1.6, w: 7, h: 2.5,
    fill: { color: DARK_BG, transparency: 30 }, rectRadius: 0.1,
    shadow: makeHeroShadow()
  });

  card.addText([
    { text: "工业级 RAG 检索管线: 解析→切片→混合检索→重排→溯源生成", options: { bullet: true, breakLine: true, color: "E0E0E0" } },
    { text: "现代极简前端: 零构建成本 + SSE 流式 + 拖拽上传 + 防御性交互", options: { bullet: true, breakLine: true, color: "E0E0E0" } },
    { text: "数据库工程: 关系模型 + 向量索引 + BM25 倒排, 物理解耦", options: { bullet: true, breakLine: true, color: "E0E0E0" } },
    { text: "演进方向: Milvus/PGVector 分布式向量库 + 私有化大模型", options: { bullet: true, color: "E0E0E0" } }
  ], {
    x: 0.3, y: 0.25, w: 6.4, h: 2.0,
    fontSize: 13, fontFace: BODY_FONT,
    paraSpaceAfter: 6
  });

  slide.addText("谢谢", {
    x: 1, y: 4.3, w: 8, h: 0.7,
    fontSize: 28, fontFace: TITLE_FONT, color: WHITE,
    bold: true, align: "center", charSpacing: 2
  });

  slide.render();
}

// ============================================================
// GENERATE FILE
// ============================================================
pres.writeFile({ fileName: "垂直领域RAG智能问答与训练辅助系统总结报告.pptx" })
  .then(fn => console.log("Generated: " + fn))
  .catch(err => console.error("Error:", err));
