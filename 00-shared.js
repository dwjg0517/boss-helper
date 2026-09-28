// BOSS海投助手 · 模块共享命名空间
//
// content_scripts 中声明的多个 js 文件在同一个 isolated world 中执行，
// 但各自是独立的脚本作用域：一个文件里顶层 `const` 声明的名字，
// 无法被另一个文件访问（会抛 ReferenceError）。
//
// 因此各模块统一挂到 globalThis.__BH__ 上，文件名以加载顺序为数字前缀，
// manifest 的 js 数组顺序即加载顺序。当前划分：
//
//   00-shared.js    命名空间初始化
//   01-config.js    CONFIG 配置
//   02-state.js     state 状态与 elements DOM 引用
//   30-controls.js  启停控制（toggleProcess / toggleChatProcess）
//   lib/pdf.min.js  PDF.js（第三方）
//   99-content.js   入口：FilterUtils / Core / UI / init()，最后加载
//
// 命名约定：数字前缀 = 加载顺序；99 为入口，可访问全部模块。
// 尚未抽出的模块（FilterUtils / Core / UI）仍在入口文件里，
// 后续可分别落到 10-filters.js / 20-core.js / 40-ui.js。
//
// ── 模块共享机制的两条硬性约束（重构时务必遵守）────────────────────
//
// 1. 不要把 __BH__ 直接暴露给页面。
//    isolated world 与页面主世界虽然共享同一份 DOM，但 JS 作用域是隔离的，
//    页面脚本读不到 globalThis.__BH__。若将来需要把某个对象交给页面
//    （例如回传数据），必须显式走 postMessage 或 DOM 属性传递，
//    不能指望共享 globalThis。
//
// 2. 不要给 __BH__ 定义 getter，也不要在模块间传递"活绑定"。
//    各文件顶层写 `const CONFIG = __BH__.CONFIG;` 会固化当时的引用。
//    本项目现有模块内部会替换对象字段（例如 UI._applyTheme 会重写
//    CONFIG.COLORS），因此绑定的是"对象引用"而非快照，这没问题；
//    但如果将来某个模块整体替换 __BH__.X = 新对象，已绑定旧引用的模块
//    不会看到变化。要整体替换时，请改为就地修改对象字段。
//
globalThis.__BH__ = globalThis.__BH__ || {};
