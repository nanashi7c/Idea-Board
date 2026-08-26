# Idea Board

気軽にアイデアや資料を配置し、いつでも過去の状態へ戻れる創作支援ボードです。

自由に情報を配置できるキャンバスと、スナップショット・ブランチ・比較機能により、創作における試行錯誤を支援します。

> [!NOTE]
> 現在開発中のプロジェクトです。

## 主な機能

MVPでは次の機能を提供する予定です。

- テキストや画像を自由に配置できる無限キャンバス
- カードの移動、リサイズ、複数選択、自動整列
- ボードの状態を記録するスナップショット
- 複数案を並行して検討するブランチ
- 保存した状態の並列表示・重ね合わせ・差分表示
- ボード構造を保持したエクスポート
- Undo / Redoと自動バックアップ

MVPは、デスクトップブラウザから利用する個人向けの非公開ボードを対象とします。

## 技術スタック

| 領域             | 技術                       |
| ---------------- | -------------------------- |
| フロントエンド   | Next.js、React、TypeScript |
| キャンバス       | Konva、react-konva         |
| 状態管理         | Zustand                    |
| API              | Hono                       |
| データベース     | PostgreSQL、JSONB          |
| 認証・ストレージ | Amazon Cognito、Amazon S3  |
| インフラ         | AWS、Terraform             |
| テスト           | Vitest、Playwright         |
| CI               | GitHub Actions             |

ボードの状態は直列化可能な単一ツリーとして管理し、Undo / Redo、スナップショット、比較、エクスポートの共通基盤として利用します。

## リポジトリ構成

```text
idea-board/
├── apps/
│   ├── web/       # Next.jsフロントエンド
│   └── api/       # Hono API
├── packages/
│   └── shared/    # 共有する型・スキーマ・定数
├── skills/        # 開発支援用Skill
└── docker-compose.yml
```

## セットアップ

### 必要な環境

- Node.js 24
- pnpm 11
- Docker（PostgreSQLを使用する場合）

### 開発サーバー

```bash
pnpm install
pnpm dev
```

起動後、次のURLへアクセスできます。

- Web: http://localhost:3000/board
- API: http://localhost:8787/healthz

データベースなどの環境変数が必要な場合は、[`.env.example`](./.env.example)を`.env`へコピーしてください。

PostgreSQLは次のコマンドで起動できます。

```bash
docker compose up -d
```

## 開発コマンド

| コマンド         | 内容                       |
| ---------------- | -------------------------- |
| `pnpm dev`       | WebとAPIを起動             |
| `pnpm build`     | 全ワークスペースをビルド   |
| `pnpm lint`      | ESLintを実行               |
| `pnpm typecheck` | 型チェックを実行           |
| `pnpm test`      | 定義済みのテストを実行     |
| `pnpm test:e2e`  | Playwright E2Eテストを実行 |
