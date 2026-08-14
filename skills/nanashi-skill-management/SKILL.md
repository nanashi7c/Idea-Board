---
name: nanashi-skill-management
description: ClaudeまたはCodex用Skillを追加、更新、同期、検証するときに使う。原本と生成物を区別し、プロジェクトで定義された管理手順を適用する。
---

# Skill Management

## 管理手順

1. Skillを編集する前に、プロジェクトが定める原本と生成先を確認する。
2. 原本だけを編集し、生成先を直接編集しない。
3. プロジェクトに同期処理があれば、Skillの追加または更新後に実行する。
4. プロジェクトに検証処理があれば、commit前に実行して原本と生成物の一致を確認する。

## `skills:sync`を採用している場合

- `skills/`をClaudeとCodexで共通利用するSkillの原本とする。
- `.claude/skills/`と`.agents/skills/`を生成物として扱い、直接編集しない。
- Skillの追加または更新後に`pnpm skills:sync`を実行する。
- commit前に`pnpm skills:check`を実行する。
