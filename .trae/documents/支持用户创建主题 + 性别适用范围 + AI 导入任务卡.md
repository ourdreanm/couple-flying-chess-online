## 现状梳理
- 主题目前只有内置 [`DEFAULT_THEMES`](file:///d:/codes/web/2026/01/ludo/src/data/defaultThemes.ts)；全量存进 `GameState.themes` 并随 `GameState` 一起落到 localStorage（key: `couples-ludo-game-state`）。
- 配置阶段的主题选择由 [`ThemeSelectorModal.tsx`](file:///d:/codes/web/2026/01/ludo/src/components/modals/ThemeSelectorModal.tsx) 展示全部主题列表；玩家“男方/女方”目前仅通过 HomeView 的 `idx===0` 判断。
- 当前没有任何“新增/编辑主题/任务卡”的 UI 或状态动作；任务卡仅在对局中随机抽取展示。

## 目标功能
1) 允许用户在“任务主题库”里创建主题：字段包含主题名称 + 适用对象（通用/仅男方/仅女方）。
2) 配置阶段选主题时：男方只能选通用或男方主题；女方同理。
3) 创建后可进入主题编辑，支持：手动新增任务卡 + AI 导入（粘贴 AI 返回的 JSON 完成批量导入）。

## 数据结构调整（含兼容老存档）
- 扩展 `Theme`：新增 `audience: 'common' | 'male' | 'female'`。
- 扩展 `Player`：新增 `role: 'male' | 'female'`（用于筛选允许的主题）。
- 在 [`useGameState.ts`](file:///d:/codes/web/2026/01/ludo/src/hooks/useGameState.ts) 加一层“存档规范化/迁移”逻辑：
  - 老存档的 theme 没有 `audience` 时默认补 `common`。
  - 老存档的 player 没有 `role` 时按 id/顺序补：0=male，1=female。
  - 若玩家已选的 `themeId` 不存在或不符合适用范围，则清空为 `null`（避免非法选择继续存在）。

## 状态层（主题/任务卡 CRUD）
在 `useGameState` 增加并暴露这些动作（不引入新库）：
- `createTheme({ name, desc?, audience })`：生成新 themeId、追加到 `state.themes`。
- `updateThemeMeta(themeId, { name, desc, audience })`：更新主题信息。
- `addThemeTask(themeId, taskText)` / `removeThemeTask(themeId, index)`：维护任务卡列表。
- `importThemeTasks(themeId, tasks: string[], mode: 'append' | 'replace' = 'append')`：批量导入（默认追加）。
- 调整 `resetGame()`：重置对局进度与主题选择，但保留 `themes`（避免用户自建主题被“离开游戏/重开”清空）。
- 调整 `startGame()` 校验：
  - 双方已选主题；
  - 主题存在且 `tasks.length > 0`；
  - 主题适用范围与玩家 role 匹配。

## UI 改造
### 1) 主题库页（ThemesView）
- 将 [`ThemesView.tsx`](file:///d:/codes/web/2026/01/ludo/src/components/views/ThemesView.tsx) 从“只读列表”升级为：
  - 顶部新增“新建主题”按钮。
  - 每个主题卡片可点入“编辑主题”弹窗。
  - 在卡片上展示适用范围标签（通用/仅男方/仅女方）与任务数量。

### 2) 新建主题弹窗
- 新增 `ThemeCreateModal`：输入主题名称、可选描述、适用对象单选按钮（通用/仅限男方/仅限女方）。
- 创建成功后自动打开该主题的编辑弹窗（让用户立刻添加任务卡）。

### 3) 主题编辑弹窗（任务卡维护）
- 新增 `ThemeEditorModal`：
  - 顶部可编辑主题名称/描述/适用对象（单选）。
  - 任务卡列表：显示每条 task，支持删除。
  - 手动新增：输入框 + “添加任务”。
  - “AI 导入”按钮：打开 AI 导入对话框。

### 4) AI 导入对话框
- 新增 `AiImportModal`（或集成在 ThemeEditorModal 内）：
  - 展示一段可复制的提示词（提供“复制提示词”按钮；用 `navigator.clipboard.writeText`，失败则降级为选中文本提示）。
  - 下方提供 JSON 粘贴输入框 + “导入”按钮。
  - 解析策略：
    - 支持两种格式：`{"tasks": ["...", "..."]}` 或直接 `["...", "..."]`。
    - 清洗：去掉空串、去重（可选）、trim。
    - 解析失败时给出错误提示。

### 5) 配置阶段主题选择限制
- 改造 [`ThemeSelectorModal.tsx`](file:///d:/codes/web/2026/01/ludo/src/components/modals/ThemeSelectorModal.tsx)：新增 `playerRole` 入参或在 App 侧传入已过滤的 `themes`。
- 策略：默认只展示“允许选择”的主题（男方：common/male；女方：common/female）。

## 需要改动/新增的文件（预估）
- 改动：
  - `src/types/index.ts`
  - `src/data/defaultThemes.ts`（给内置主题补 `audience: 'common'`）
  - `src/hooks/useGameState.ts`
  - `src/App.tsx`
  - `src/components/views/ThemesView.tsx`
  - `src/components/modals/ThemeSelectorModal.tsx`
- 新增：
  - `src/components/modals/ThemeCreateModal.tsx`
  - `src/components/modals/ThemeEditorModal.tsx`
  - `src/components/modals/AiImportModal.tsx`（如不内嵌）
  - （可选）`src/utils/id.ts`：生成 `themeId`。

## 验证方式
- 本地运行后手测覆盖：
  - 新建主题（3 种适用范围）→ 编辑 → 手动添加任务 → 返回配置页选择是否受限。
  - AI 导入：粘贴有效/无效 JSON，确认错误提示与成功导入。
  - “开始游戏”在主题无任务/不匹配适用范围时阻止并提示。
  - 刷新页面后主题仍存在（localStorage 恢复 + 迁移逻辑生效）。