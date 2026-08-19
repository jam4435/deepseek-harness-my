# Agent Note: tool-bash 部署描述覆盖

Status: implemented

[English](2026-08-15-tool-bash-description-config.md) | 中文

## 问题

`dsh-tool-bash` 根据它可观察到的组合事实（`enableRunInBackground` 与已挂载执行器的沙箱能力）生成模型侧工具描述。更换 shell 执行器的部署——例如通过 `dsh-bash-local` 使用 Windows Git Bash——无法在模型选择工具的时刻教给它特定于环境的规则，而那正是这类指引应当出现的位置。孪生的 [`dsh-tool-bash-persistent`](2026-07-29-persistent-bash-str-replace-editor.md) 已经公开了可配置的 `description`，因此一次性工具缺少该字段是一种不一致；唯一的绕行方案还会把部署事实塞进 persona，违背[工具指引归属 Agent Note](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md)。

## 决策

[`dsh-tool-bash`](../../../../packages/shell/tool-bash/README.md) 增加可选的 `description` 配置字段。省略时逐字节保留生成的 `bashDescription(backgroundEnabled, escalationModes)` 文本；提供时按原样替换完整的模型侧工具描述。空值或纯空白值会在加载时失败，错误为 `tool-bash: description must be non-empty`。schema 声明 `description: z.string()` 且不设默认值，使缺失键保持缺失，与 `enableRunInBackground` 既有的可选配置模式以及持久 bash 孪生的带默认字段保持一致。

覆盖是完整替换，而不是追加片段。配置它的部署方拥有全部模型可见文本，包括这些表面启用时的后台任务与沙箱升权语义。交付的默认描述保持不变，因此生成的工具目录与既有 schema 快照均不变。

本机的 `anchored-standard` preset 使用该字段描述其 Windows Git Bash 执行器，并把仓库级搜索引向专用 `grep`／`glob` 工具。

## 备选方案

**把 Windows Git Bash 指引放进默认 `bashDescription`。** 否决：一个环境的规则会变成所有平台的默认文本，且由此产生的快照／目录刷新会波及整个语料，为大多数部署并不需要的指引付出代价。

**把指引留在部署 persona 或系统提示词段落里。** 否决：逐工具的选择指引应放在工具描述中；提示词段落只承载跨调用习惯。[归属 Agent Note](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) 记录了这一分工。

**增加后缀或片段字段，而不是完整覆盖。** 否决：后缀无法知道它是否重复或矛盾于生成的背景任务／沙箱段落；完整覆盖镜像孪生持久工具已有的约定，让完整的模型可见文本只有一个所有者。

## 后果

- 部署方可以在模型选择工具的确切位置描述自己的 shell 环境，不改变交付默认值及其 token 开销。
- 该字段是全有或全无的覆盖：省略后台任务或沙箱语义的部署方必须自行补述，空值会响亮失败，而不是静默展示误导性描述。
- 本机 Windows Git Bash 实验可以把「优先使用 `grep`／`glob`，绝不在 bash 中递归 `grep -R`」这条规则写进工具描述，在决策点关闭 node_modules 遍历超时这一失败模式。
