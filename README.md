# dsh-model-in-use

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-cordis--plugin-3cc400.svg)](https://github.com/deepseek-ai/deepseek-harness)

**让 DSH 的模型下拉菜单更好用**：看见哪些模型正被别的会话占用、记住每个模型的推理档位、记住分组的折叠状态，并修掉菜单的间距与吸顶标题问题。

一个独立的 DSH **客户端（web）cordis 插件**，不需要改宿主包。

---

## 它做什么

| 功能 | 说明 |
| --- | --- |
| **占用圆点** | 已被其他**正在运行**的会话使用的模型，行尾显示 `#3cc400` 青绿圆点，悬停提示「其他会话正在使用中」 |
| **分组级圆点** | 该模型所属分组的标题前也点一个小圆点——分组折叠时仍能看出「这里面有模型在跑」 |
| **折叠记忆** | 每个服务商分组可折叠，状态记在 `localStorage`，重开菜单 / 刷新页面都保留 |
| **推理档位记忆** | 选择模型后，该模型的推理档位被记住；切走再切回、或**新开对话**选同一模型，都会恢复上次的档位，不用每次手动调 |
| **间距修正** | 分组之间的间距按视觉顺序排布，不再出现某两个分组贴在一起 |
| **吸顶不透明** | 吸顶的分组标题底色钉成不透明，二级菜单文字不再从标题底下透出来 |
| **侧边栏悬浮详情** | 会话悬浮卡的「进行中」后追加当前模型与推理档位，如 `进行中 ● Deepseek-V4.1-Flash · x0.00 Low` |

关于圆点：

- **非互斥**：只是提示，不阻止选择，多个会话可以选同一个模型。
- **实时**：对方开始 / 停止运行、或切换模型，圆点立刻出现 / 消失。
- 当前会话自己那一行不标记（那里本来就有对勾）。
- 被选中那一行**同时有对勾和圆点**时，圆点向左让位到对勾格前面的间隙里（`right:27px`），两者并排而不是叠在一起。
- subagent 会话不计入，只统计主会话。
- 只装饰 composer 的模型下拉；`/model` 斜杠命令的弹窗不动。

## 安装

```bash
# 从 GitHub 安装（推荐）
dsh plugin --profile desktop add github:Faide-cyber/dsh-model-in-use
```

或在 **dshmarket 插件市场**里搜索 `dsh-model-in-use` 一键安装（本仓库已打 `dsh-plugin` topic，市场每 2 小时自动收录）。

装完**必须完全退出 DSH 再重开**：客户端 bundle 的字节是在激活时快照进 module table 的，没有 HMR watcher 时不会重读。

本地开发时可以直接 link：

```jsonc
// <profile>/package.json
"dependencies": { "dsh-model-in-use": "link:E:/dsh/plugin/dsh-model-in-use" },
"dsh": { "profile": { "bundles": [ /* …, */ "dsh-model-in-use" ] } }
```

插件自带 `cordis.patch.yml`（`dsh.bundle.patch`），向 Web roster 插入一行 `model-in-use`；客户端半边只在 web 平台加载。仓库已提交构建产物（`lib/`），安装时无需构建步骤。

## 使用

装好即生效，没有配置项。几个约定：

- **推理档位按「模型」记忆，不按「服务商」**。同一个模型常常能在多个 provider id 下取到（例如国际站与国内站都提供同一个模型），按模型记才能保证换站点也读得到。
- 在档位菜单里选「**跟随服务商默认**」时，**只对本次对话生效，不会删除已记住的档位**——下次再点这个模型仍会恢复它自己的档位。
- 分组的折叠状态默认**全部展开**（默认折叠会让人以为「模型列表没了」）。

## 兼容性

| 宿主包 | 用途 |
| --- | --- |
| `@deepseek-ai/dsh-api-session-controller` | 会话与模型选择投影 |
| `@deepseek-ai/dsh-client-locale` | 文案命名空间 |
| `@deepseek-ai/dsh-client-ui-model-selection` | 模型目录与 `ModelDirectory.select()` |
| `@deepseek-ai/dsh-client-ui-workspace` | 侧边栏 Slot |

这些包由宿主提供，插件**不把它们打进 `dependencies`**（那会遮蔽宿主实例）。插件只在 web 平台加载。

## 已知边界

- 圆点的水平位置（未选中 `right:14px`、选中 `right:27px`）是按当前行的 `padding:6px 8px` + `gap:8px` + 18px 对勾格量出来的。行距 / 内边距若变化，需要重新量；想彻底摆脱这个耦合，得让上游组件开放一个 slot。
- 折叠状态靠 CSS 隐藏行，键盘方向键仍会走过被隐藏的行；被隐藏的行本来就看不见，可接受。
- 推理档位记忆依赖宿主的 `directory.select()`、`directory.store` 与 `modelDirectories.live.directories.values` 形状不变。宿主若同时改掉这些入口或字段，记忆会被静默旁路——好在它只丢记忆，不会挡住选择。
- 恢复的档位以「发请求那一刻能查到的 catalog」为准；菜单 UI 上勾选的落位依赖宿主 `select()` 成功后自己的 `syncInputs()`，本插件不再二次刷新。
- CSS 排版类修复无法在本装置里自证（没有渲染引擎），只用断言钉住决定性 token。

## 测试

```bash
node verify.mjs          # 行为断言，直接加载 lib/client.js，不复制不重写
node negative-proof.mjs  # 反例：故意写坏的实现必须全部被装置抓住
node scope-proof.mjs     # 装置自检：菜单不是 body 子节点、观察者尊重 subtree、不支持的 selector 抛错
```

三个脚本共用 `fixture.mjs`。**装置本身按真实形状搭**：`mountComposer()` 先挂出闭合状态的 composer，`openCodexMenu()` 再往它的子树里插菜单——菜单永远不是 `<body>` 的直接子节点。`FixtureMutationObserver` 尊重 `observe()` 的 `options`，只给「watched 是变更目标、或带 subtree 的祖先」投递记录。`modelDirectories` 由 traceable face 包住：字符串赋值会像真实 Cordis shadow 一样消失，只有通过 `cordis.original` 改到 origin 才能拦住稍后才创建的目录。

`negative-proof.mjs` 每个变体用 `from` 字符串锚定 shipped 源码做单点替换，且要求该串在源码里**恰好出现一次**——同时出现在注释里的锚点会生成「真实代码没被改动」的假变体，这类装置 bug 直接判 FAIL。

---

## 实现细节

以下是各个行为「为什么这么做」的笔记。改这个插件之前值得先读一遍。

### 分组之间的间距

上游的间距规则是 `section + section { margin-top: 4px }`，**按 DOM 相邻**生效。而 freecodego 用 CSS `order` 给分组排序、从不移动节点，于是这个 margin 落在「DOM 里相邻的那一对」而不是「用户看到的那一对」——所以会出现某两个分组贴在一起、别的都正常。

修法是把容器改成 flex 纵向 + `gap: 4px`：flex 的 `gap` 按**视觉顺序**排布，无论 `order` 是什么值都正确。原来的 `margin-top` 归零，避免加两遍。

### 吸顶标题为什么会和 2 级菜单文字重合

分组标题是 `position: sticky; top: 0`，会盖在滚过去的行上面，底色是 `--dsw-alias-bg-layer-2`。玻璃皮肤把这个 token 调成了半透明（`rgba(24,31,46,.46+…)`），于是标题底下的行文字直接透上来，两层文字糊成一行。

修法是同一条规则里把**同一个颜色**的 alpha 钉成 1：

```css
background: var(--dsw-alias-bg-layer-2, #2c2c2e);
background: rgb(from var(--dsw-alias-bg-layer-2, #2c2c2e) r g b / 1);
```

`rgb(from …)` 保留皮肤的色相，`/ 1` 把 alpha 钉死，所以换任何皮肤都是那块正确且不透明的底色。第一条声明是不支持相对颜色语法的引擎的兜底。

⚠️ **`/ 1` 不能省**。相对颜色语法里，**省略 alpha 不等于 1**——它会继承**源颜色**的 alpha（见 [MDN: Using relative colors](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Colors/Using_relative_colors)，"If the alpha channel value is not explicitly specified, it defaults to the alpha channel value of the origin-color (not 100%)"）。所以写成 `rgb(from … r g b)` 会原样复现那个半透明，文字照样透出来。

`verify.mjs` 场景 14 与 `negative-proof.mjs` 变体 12 都钉这一条；后者就是把 `/ 1` 删掉的单点改写。

### 为什么是 DOM 装饰

composer 的模型下拉落在 `conversation.input.model` 这个 `single` 槽上。该槽实际生效的 occupant 是 `dsh-codex-subscription` 的 `CodexModelSelect`（`priority: -10`，把随包发行的 `ModelSelect` 压成 `active: false`），而它没有「行装饰」扩展点。所以本插件：

1. 给命中的模型行 `<button class="codexModelSelectOption" role="menuitemradio">` 打一个 `data-dsh-model-in-use` 属性；
2. 给分组标题 `<div class="codexModelSelectGroupTitle">` 打 `data-dsh-group-toggle`，给 `<section>` 打 `data-dsh-group-collapsed`；
3. 注入样式，用 `::after` 伪元素画圆点和折角箭头，用一条 `display:none` 收起整组。

伪元素不在 React 的 reconciliation 里，React 重渲染行 / 标题时不会碰它；反过来，插件也只增删属性，不挪动 React 的 DOM 子节点——折叠全靠 section 上的状态属性和 CSS，所以不存在「React 重排子节点把菜单搞崩」的风险。

行 DOM 里没有 provider/model id，所以行是靠**组标题 + 模型名**这两个组件实际渲染的字符串去和共享目录 `modelDirectories.catalog` 对齐还原成 `(provider, model)` 的。Codex 版渲染的组标题是 `group.name` **原文**（不是本地化的 `provider.account`），所以不需要 `model` 命名空间的翻译。

### 为什么 title 打在名字 span 上，而不是行按钮上

`title`（悬停说明）刻意加在行的 `span.codexModelSelectOptionName` 上，**不加在 `button` 上**。freecodego 的菜单装饰器判定一个分组是否归它管，条件是 `group.querySelectorAll('button[role="menuitemradio"][title]').length > 0`；一旦行按钮带 `title`，它就会认领同一批分组，于是同一个标题上会挂两个折角、两套折叠状态，互相打架。把 `title` 留在名字 span 上，那道闸门就一直是关的，这个装饰器独享这些分组。

`verify.mjs` 的 `the tooltip is not on the row button` 就是钉这一条的。

### 分组级圆点

一个分组里只要有任一模型正在被别的会话使用，就给这个分组的 `<section>` 打 `data-dsh-group-in-use`，标题前面用 `::before` 点一个同样的 `#3cc400` 圆点，**标题文字保持原来的颜色不变**。

为什么需要它：折叠会把行藏起来。没有这个分组级圆点的话，用户把某个分组折叠起来，就再也看不见「这个分组里有会话正在跑」。圆点加在标题上是折叠状态下唯一还能表达这件事的位置。

`::before` 和折叠箭头 `::after` 都挂在标题上，标题是 flex 行，所以两者能分居两端。箭头用 `margin-left:auto` 顶到右边，**不用** `justify-content:space-between`——标题的文字是裸文本节点（匿名 flex item），有了圆点就变成三个 item，space-between 会把文字挤到中间去。

### 折叠记忆

- 分组的身份是**服务商 id**，从 section 的 `aria-labelledby`（组件写的是 `${reactId}-${group.id}`，菜单 id 是 `${reactId}-menu`，所以前缀可推）里切出来，**不是**标题文字。标题文字是本地化的显示名（内置账号路由在中文下是「DeepSeek 账号」），用文字当 key 的话，用户一换界面语言，所有折叠记忆就全丢。
- 存储 key：`dsh-model-in-use:collapsed-groups`，值是 `{ [providerId]: true }`。
- `localStorage` 被禁用 / 写满时全部读写都吞掉异常：折叠当次仍然生效，只是不记忆。菜单永远不会因为存储不可用而坏掉。
- 默认**全部展开**——默认折叠会让用户以为「模型列表没了」。

### 占用判定

一个模型被标记，当且仅当存在另一个会话同时满足：

- 是**主会话**（`origin !== 'subagent'` 且没有 `parentId`）；
- 此刻**正在运行**（`running`）；
- 它当前的模型就是这个模型 —— `projectionValues.modelSelection.next ?? catalog.default`。

`next` 是 `pending ?? lastUsed`，也就是「它现在真正在用哪个模型」。当前会话自己那一行永远不标记。

### 推理档位记忆

选择模型之后，为这个模型选过的推理档位会被记住（`localStorage`，键 `dsh-model-in-use:model-efforts`，键名 `${model}`，**只按模型、不带 provider**）；之后无论在已有对话切回，还是在新对话选择该模型，都会恢复绑定的档位。

**绑定按模型而不是按服务商**：同一个模型常常能在多个 provider id 下取到（例如 `workbuddyai` 国际站与 `workbuddyai-cn` 国内站都提供 `deepseek-v4.1-flash`）。真实会话日志里同一模型正是在这两个 id 之间来回出现；若键里带上 provider，换一个站点就会读不到自己刚写的记忆，切走再切回、新开对话都会退回 Default。因此记忆粒度是模型。

实际模型切换通常汇到 `directory.select(selection)`，本插件把它包了一层；但 Codex 在点击「已经是当前模型」的行时只关菜单，不调用 `select()`。因此插件还会遍历宿主正式的 `modelDirectories.live.directories.values`，订阅每个已在使用的目录 store，把已就绪的官方默认档位校正成该模型记住的档位。会话目录按需创建，而 `sessions.list` 的通知可能早于该会话 scope 可用；插件也通过 `Symbol.for('cordis.original')` 取得 Cordis Service 的真实对象，在真实 `directoryFor` 上挂创建拦截。不能给 Service face 直接赋值——那只会写到一次性的 traceable shadow，后续选择路径看不到。

规则很刻意：

- 每个主会话第一次出现时，其 durable `modelSelection.next ?? lastUsed` 若带受支持的明确档位，会为**尚未记忆**的模型补种一次；因此插件启动前已有的 `A=Low`、`B=High` 也能直接作为初始绑定。每个会话只参与补种一次，避免用户清除模型绑定后又被后续 projection 更新重新写回。
- 三种意图、两种形状 —— 上游自己的调用点才是判别依据，不能靠猜：
  - `chooseModel`（模型行）只在模型真的换了才调用 `select()`（点当前模型只关菜单）；模型行 selection 通常只带 `{ provider, model }`，不带档位；
  - `chooseEffort`（档位子菜单）**总是带当前模型**，真实选档位时带 `reasoningEffort`，「跟随服务商默认」那项不带；如果点击的档位已经生效，Codex 会只关菜单、不调用 `select()`，插件通过菜单与会话目录的映射补记这次显式点击。
- 于是判别规则是：同模型且 `reasoningEffort` 是字符串并改变当前有效档位 ⇒ 用户明确选了档位，**包括它刚好等于官方默认档位**，记下它；同模型且完全不带档位 ⇒ 选了「服务商默认」，**只对本次对话生效、不删记忆**；换模型时，模型行不带档位不是编辑，查目标模型已有记忆，仅在它自己的 `reasoning.efforts` 仍支持时覆盖。
- 关键点：不能用 `selection.reasoningEffort === defaultEffort` 否定同模型的真实档位点击；这样会让用户选 Low 后没有绑定，随后 A→B→A 回到 Default。
- `ModelDirectory.select()` 会先把目标写进 `store.pending`，再等待 Host projection；因此判别当前模型时取 `pending ?? current`，避免快速 A→B→A 仍拿尚未结算的旧 A 误判成同模型。
- 新对话若已经默认落在同一模型、因 Codex 的 close-only 分支根本没有发出选择，由该 live directory 的 store 校正。校正按 (目录, 目标档位) 只尝试一次：宿主拒绝该档位时会更新 store 并再次通知订阅，不设这道闸就会对同一次被拒的选择无限重试。
- 读路径每次都重新读 `localStorage`（内存副本只做读不到时的回退），这样多个窗口里记的档位互相可见；存储完全坏掉时只丢持久化，不会挡住选择本身。
- 读侧替换：组合框标签只读 `store.current`，而 `select()` 的同步阶段只写 `status`/`pending`、不碰 `current`，所以首帧会先显示默认档位。插件在 `directoryFor` 渲染路径上**同步**改写 `store.current` 的档位使首帧即正确，用 `substitutingDirectories` WeakSet 防重入回声、`projectedSelections` WeakMap 存宿主原值供写穿读取。

### 侧边栏悬浮详情

侧边栏会话悬浮卡的「进行中」状态后，会用一个 `#3cc400` 绿点分隔，再追加该会话当前模型的完整名称和推理档位，例如 `进行中 ● Deepseek-V4.1-Flash · x0.00 Low`。这一行禁止换行，悬浮卡按内容增宽；模型来自会话的 `modelSelection` projection，档位名称来自当前 catalog，找不到档位名称时保留档位 id。该信息只装饰悬浮卡，不改变会话状态。

模型名**原样使用 catalog 的写法**（它自带的 `·` 保留自己的空格）；档位与模型名之间只加一个普通空格，不再追加 `·`。

实现使用 workspace 正式提供的 `sidebar.session.row.hover` Slot，由 Slot 传入稳定的 `sessionId`；不再按对话标题猜是哪张悬浮卡。renderer 会先包一层 `div[data-slot="sidebar.session.row.hover"]`，因此隐藏 anchor 必须先 `closest()` 回到这层 Slot wrapper，再找 wrapper 后面的「进行中」行；随后用 React portal 把文字作为该行最后一项渲染进去——既满足同一行展示，也不直接改写 React 管理的 DOM。

### 菜单不是 portal

`CodexModelSelect` 把菜单**内联渲染在 composer 子树深处**（源码里没有任何 `createPortal`），所以打开菜单只会往 `<body>` 的深层子孙里插节点，`<body>` 自己的 childList 不变。因此：

- `<body>` 的观察者必须带 `subtree: true`，否则菜单打开对插件完全不可见；
- 但裸的 subtree 观察会在每个流式 token 上触发，所以 mutation records 先经 `paneTouched()` 过滤，只有「增删了 `codexModelSelectGroups`」才唤醒一次 `scan()`。

`verify.mjs` 场景 4 与 `negative-proof.mjs` 变体 6 就是钉住这一条的。

---

## License

[MIT](LICENSE)
