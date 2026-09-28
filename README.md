# cocos_fanye

Cocos Creator 2.x（2.4.15）+ TypeScript 的学习/示例项目，用来练习「翻页」一类的效果。

## 环境要求

- Cocos Creator **2.4.15**（版本记录在 `project.json` 中）
- Node.js（可选，只用于本地脚本和小工具）

## 打开项目

1. Cocos Dashboard → 「项目」→「添加」，选择本目录（即包含 `assets/` 和 `settings/` 的目录）。
2. 首次打开时 Creator 会自动生成 `library/`、`temp/`、`local/`，这些目录已在 `.gitignore` 中忽略，**不要提交**。
3. 打开场景 `assets/Scene/helloworld.fire`，点预览即可运行。

## 目录结构

```
assets/           资源与脚本，唯一需要手工维护的源码目录
  Scene/          场景（.fire）
  Script/         TypeScript 脚本
  Texture/        贴图
settings/         项目设置与构建配置
project.json      项目名、引擎版本、项目 id
tsconfig.json     TypeScript 编辑器配置（Creator 2.x 标准配置）
jsconfig.json     兼容旧版编辑器的配置
```

## Git 约定

- 提交范围：`assets/`、`settings/`、`project.json`、`tsconfig.json`、`jsconfig.json` 和文档。
- 不提交：`library/`、`temp/`、`local/`、`build/`、`node_modules/`。
- **`.meta` 必须和对应资源一起提交**：`.meta` 里的 UUID 是场景、预制体引用资源的唯一标识，单独删除或手改 UUID 会导致引用全部丢失。

## 当前起点

- `assets/Scene/helloworld.fire` 和 `assets/Script/Helloworld.ts` 来自 Cocos Creator 官方 `helloworld-typescript` 模板，只作为「能跑起来」的起点，方便先验证环境和 Git 流程。
- 后续的翻页示例会逐文件加到 `assets/Script/` 下。
