# cocos_fanye

Cocos Creator 2.x（2.4.15）+ TypeScript 的学习/示例项目，用来练习「翻页」一类的效果。

## 环境要求

- Cocos Creator **2.4.15**（版本记录在 `project.json` 中）
- Node.js（可选，只用于本地脚本和小工具）

## 打开项目

1. Cocos Dashboard → 「项目」→「添加」，选择本目录（即包含 `assets/` 和 `settings/` 的目录）。
2. 首次打开时 Creator 会自动生成 `library/`、`temp/`、`local/`，这些目录已在 `.gitignore` 中忽略，**不要提交**。
3. 打开场景 `assets/Game.fire`，点预览即可运行。

## 网格翻页组件

`HrzPageCurl` 挂在书脊控制节点上。控制节点下放两个同尺寸、无可见子节点的承载节点，并在组件的 `frontNode`、`backNode` 属性中绑定。真实页面节点放在承载节点之外，翻页前仍可正常交互。

调用 `await pageCurl.play(frontSource, backSource, turnRight)`；正反面源节点必传，`turnRight` 可省略（默认向左翻）。组件在调用时截图；背面源节点可在屏幕外，也可初始隐藏，但其父节点必须处于激活状态。控制节点的原点为书脊，两个承载节点的逻辑尺寸由使用者设置且必须相同。

动画结束后，真实正面保持隐藏，真实背面永久移到书脊镜像位置并显示；临时 Sprite 和截图纹理会释放。同一组件下次可传入另一组源节点。播放中的重复调用会直接忽略；截图失败时恢复源节点原状态。

## 目录结构

```
assets/           资源与脚本，唯一需要手工维护的源码目录
  Game.fire       翻页 demo 场景
  src/            TypeScript 脚本
  res/            演示图片
settings/         项目设置与构建配置
project.json      项目名、引擎版本、项目 id
tsconfig.json     TypeScript 编辑器配置（Creator 2.x 标准配置）
jsconfig.json     兼容旧版编辑器的配置
```

## Git 约定

- 提交范围：`assets/`、`settings/`、`project.json`、`tsconfig.json`、`jsconfig.json` 和文档。
- 不提交：`library/`、`temp/`、`local/`、`build/`、`node_modules/`。
- **`.meta` 必须和对应资源一起提交**：`.meta` 里的 UUID 是场景、预制体引用资源的唯一标识，单独删除或手改 UUID 会导致引用全部丢失。
