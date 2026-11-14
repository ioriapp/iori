import tseslint from "typescript-eslint";
import playwright from "eslint-plugin-playwright";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";

import iori from "./scripts/eslint-plugin-iori/index.mjs";

const sourceFiles = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
const productFiles = [
  "packages/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "apps/host/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "apps/client/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
];
const androidUiRestriction = {
  group: ["**/android-system-ui.mjs"],
  importNames: ["androidSystemControl", "androidSystemControls"],
  message:
    "Clientの復帰はwaitForAndroidForeground、画面の文字はdump失敗を観測できない状態として扱うandroidClientTextVisibleを使ってください。インストーラーはandroidInstallerControl(s)を使ってください。",
};
const verificationRestrictedImports = {
  patterns: [
    androidUiRestriction,
    {
      group: ["**/terminal/daemon/launch.*"],
      importNames: ["stopTerminalDaemon"],
      message:
        "検証用の係はterminal/daemon-process.mjsの共通helperでunitごと回収してください。shellの正常終了待ちだけでは後始末が止まることがあります。",
    },
  ],
};

export default [
  {
    ...playwright.configs["flat/recommended"],
    files: ["e2e/ui/**/*.{ts,mjs}"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      "playwright/no-eval": "error",
      "playwright/no-element-handle": "error",
      "playwright/no-force-option": "error",
      "playwright/no-wait-for-timeout": "error",
      "playwright/no-wait-for-selector": "error",
      "playwright/no-wait-for-navigation": "error",
      "playwright/prefer-web-first-assertions": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(evaluate|evaluateHandle|waitForFunction|isVisible|isHidden|isEnabled|isDisabled|isEditable|isChecked|waitFor)$/]",
          message:
            "画面の操作と判定にはlocatorとweb-first assertionを使ってください。",
        },
        {
          selector:
            "CallExpression[callee.name=/^(setTimeout|setInterval|sleep)$/]",
          message:
            "固定の待機は使わず、Playwrightのassertionで結果を待ってください。",
        },
      ],
    },
  },
  {
    files: ["e2e/ui/**/*.{ts,mjs}"],
    ignores: ["e2e/ui/fixtures/test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(poll|toPass|evaluate|evaluateHandle|waitForFunction|waitForTimeout|isVisible|isHidden|isEnabled|isDisabled|isEditable|isChecked|waitFor)$/]",
          message:
            "画面の判定はweb-first assertionを使い、DOMに無い値の待機はfixtureに置いてください。",
        },
        {
          selector:
            "CallExpression[callee.name=/^(setTimeout|setInterval|sleep)$/]",
          message: "固定の待機を使わないでください。",
        },
      ],
    },
  },
  {
    files: ["e2e/ui/fixtures/browser.ts"],
    rules: {
      "playwright/no-eval": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "verification/host-setup/run*.mjs",
      "verification/updates/run*.mjs",
    ],
    rules: { "iori/no-sync-distribution-download": "error" },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/target/**",
      "**/generated/**",
      "**/gen/**",
      "**/.claude/skills/**",
      "**/.local/**",
    ],
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      iori,
      "@eslint-community/eslint-comments": eslintComments,
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@eslint-community/eslint-comments/require-description": [
        "error",
        {
          ignore: [
            "eslint",
            "eslint-enable",
            "eslint-env",
            "exported",
            "global",
            "globals",
          ],
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-expect-error": "allow-with-description",
          "ts-nocheck": false,
          "ts-check": false,
          minimumDescriptionLength: 1,
        },
      ],
    },
  },
  {
    files: [
      "verification/connection/**/*.mjs",
      "verification/updates/**/*.mjs",
      "verification/host-setup/**/*.mjs",
      "verification/terminal/**/*.mjs",
      "verification/reading/**/*.mjs",
      "verification/native/**/*.mjs",
      "verification/ui.mjs",
      "e2e/connection/**/*.mjs",
      "e2e/terminal/**/*.mjs",
      "e2e/workspace/**/*.mjs",
      "verification/workspace/**/*.mjs",
      "verification/web/**/*.mjs",
      "verification/window-chrome/**/*.mjs",
      "verification/cli/**/*.mjs",
      "e2e/cli-screen/**/*.mjs",
      "e2e/cli/**/*.mjs",
      "e2e/web/**/*.mjs",
    ],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "Buffer",
          "URL",
          "console",
          "fetch",
          "process",
          "setTimeout",
          "clearTimeout",
          "WebSocket",
          "TextDecoder",
        ].map((name) => [name, "readonly"]),
      ),
    },
    rules: { "no-undef": "error" },
  },
  {
    files: ["verification/**/*.mjs", "e2e/**/*.mjs"],
    rules: {
      "iori/no-ssh-start-process": "error",
      "iori/no-terminal-echo-marker": "error",
      "iori/no-web-terminal-observation": "error",
      "iori/no-claude-credentials-link-copy": "error",
      "iori/no-wait-for-operation-without-failure": "error",
    },
  },
  {
    files: ["verification/**/*.mjs"],
    ignores: [
      "verification/terminal/daemon-process.mjs",
      "verification/native/android-system-ui.mjs",
      "verification/native/android-launcher.mjs",
      "verification/native/android-clipboard.mjs",
    ],
    rules: {
      "no-restricted-imports": ["error", verificationRestrictedImports],
    },
  },
  {
    files: [
      "e2e/**/*.mjs",
      "scripts/release/**/*.mjs",
      "verification/terminal/daemon-process.mjs",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: [androidUiRestriction] }],
    },
  },
  {
    files: [
      "verification/native/android-system-ui.mjs",
      "verification/native/android-launcher.mjs",
      "verification/native/android-clipboard.mjs",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: verificationRestrictedImports.patterns.filter(
            (restriction) => restriction !== androidUiRestriction,
          ),
        },
      ],
    },
  },
  {
    files: ["e2e/**/*.mjs", "verification/**/*.mjs"],
    ignores: ["e2e/connection/scenario.mjs", "verification/workspace/run.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator='+'][left.value='button'] > CallExpression.right[callee.name='attr'][arguments.0.value='data-iori-folder-path']",
          message:
            "フォルダー選択はopenFolder helperを使い、folder-picker内に限定してください。同じパスのサイドバーの＋と取り違えます。",
        },
        {
          selector: "Literal[value=/sidebar-toggle/]",
          message:
            "サイドバーの開閉はopenSidebar/closeSidebarを使い、現在の開閉状態を引き継いでください。",
        },
      ],
    },
  },
  {
    files: ["e2e/**/*.mjs", "verification/**/*.mjs"],
    ignores: ["verification/workspace/interaction.mjs"],
    rules: { "iori/no-workspace-entrance-click": "error" },
  },
  {
    files: ["verification/updates/**/*.mjs"],
    rules: {
      "iori/no-transient-update-host": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value='com.android.settings']",
          message:
            "提供元の許可は対象アプリの行を特定するsetAndroidInstallPermissionを使ってください。",
        },
        {
          selector:
            "CallExpression[callee.property.name='click'] Literal[value=/sidebar-toggle/]",
          message:
            "サイドバーはopenSidebarを使い、開始画面と作業画面の両方から開けるようにしてください。",
        },
      ],
    },
  },
  {
    files: ["verification/updates/build-*.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value='tls/cert.pem']",
          message:
            "検証用ソースはtls/ca.pemを信頼してください。サーバー証明書とCA証明書を兼用しないでください。",
        },
      ],
    },
  },
  {
    files: ["verification/native/android-system-ui.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='androidSystemControl'] Literal[regex.pattern=/Switch/], CallExpression[callee.property.name='find'] Literal[regex.pattern=/Switch/]",
          message:
            "先頭のSwitchを選ばず、対象アプリのtitleと共通する行から一意に特定してください。",
        },
      ],
    },
  },
  {
    files: ["verification/native/android-launcher.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value='android.intent.action.ALL_APPS']",
          message:
            "検証端末のNovaはALL_APPSに対応していません。workspaceを上へスワイプして一覧の実アイコンを押してください。",
        },
      ],
    },
  },
  {
    files: ["e2e/cli-screen/*status.mjs"],
    rules: { "iori/no-cli-bundled-submit": "error" },
  },
  {
    files: ["e2e/cli-screen/**/*.mjs", "e2e/web/**/*.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='observed'] Literal[value='clear/exit'], CallExpression[callee.property.name='includes'] Literal[value='clear/exit']",
          message:
            "Piの起動案内は分割画面の保存画面から消えるため、入力画面はwaitForPiInputで待ってください。",
        },
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name='PI_CODING_AGENT_DIR'], MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.value='PI_CODING_AGENT_DIR']",
          message:
            "Piの検証用保存先はverification/cli/home.mjsのpiAgentDirectoryを使ってください。呼び出し元のPI_CODING_AGENT_DIRは引き継ぎません。",
        },
      ],
    },
  },
  {
    files: ["verification/window-chrome/**/*.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "UnaryExpression[operator='-'][argument.value=3], BinaryExpression[operator='+'][right.value=3]",
          message:
            "Windowsの枠の座標はwindowsResizePointを使ってください。装飾なしの窓の上端はクライアント領域の外側ではありません。",
        },
      ],
    },
  },
  {
    files: productFiles,
    ignores: ["**/*.test.*", "apps/*/test/**"],
    rules: {
      "iori/no-cli-name-branch": "error",
      "iori/no-fixed-timeout-failure": "error",
      "iori/no-stored-value-rejection": "error",
      "iori/no-unknown-display": "error",
    },
  },
  {
    files: ["verification/host-setup/**/*.mjs"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          ...verificationRestrictedImports,
          paths: [
            {
              name: "node:readline/promises",
              message:
                "時間制限下の標準入力待ちはSIGTTINで停止します。native/owner-ready.mjsを使ってOwnerの返答後に再開してください。",
            },
          ],
        },
      ],
    },
  },
];
