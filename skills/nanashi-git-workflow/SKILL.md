---
name: nanashi-git-workflow
description: Gitリポジトリでcommit、commit message、ブランチ名、PRタイトル、PR説明を扱うときに使う。プロジェクト固有の規約とGit運用ルールを適用する。
---

# Git Workflow

## 規約の優先順位

- プロジェクト固有のcommit規約がある場合は、汎用Skillのデフォルトより優先する。
- 一次資料に記載された最新のcommit type一覧を正とする。
- 見出し番号やセクション番号には依存せず、規約の見出しと内容から対象箇所を特定する。
- `skills/cmd-commit/references/commit-message.md`などの汎用prefix一覧は、プロジェクト固有の規約がない場合のデフォルトとして扱う。

## CommitとPR

- commit messageとPR説明は、それだけで変更内容と理由を理解できるようにする。
- commit messageとPR説明には、設計ドキュメントへの参照を書かない。
- 実装と設計ドキュメントの対応は、設計ドキュメント側からPRまたはcommitへリンクする一方向の運用にする。
- commit messageを考える前に、現在のブランチ名が変更の主目的に合っているか確認する。
- ブランチ名が適切でない場合はcommitせず、理由と適切な新しいブランチ名を提案する。
