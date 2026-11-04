/**
 * Generated language associations. Sources (MIT):
 * VS Code 1.143.1, extensions/<name>/package.json contributes.languages:
 * https://github.com/microsoft/vscode/tree/1.143.1/extensions
 * GitHub Linguist 73ee9a3b277f398c37ca4ab0dea0193849de6460, extensions/filenames/interpreters:
 * https://github.com/github-linguist/linguist/blob/73ee9a3b277f398c37ca4ab0dea0193849de6460/lib/linguist/languages.yml
 *
 * Rebuild: node scripts/fetch-syntax-languages.mjs && node scripts/generate-syntax-languages.mjs
 *
 * Generation: parse VS Code manifests (JSONC), preserve extensions, filenames,
 * filenamePatterns and firstLine; resolve ids/aliases against Shiki 4.5.0
 * bundledLanguagesInfo (JSX/TSX, Objective-C, Dockerfile, Jade, Fortran aliases resolved).
 * Parse Linguist YAML; retain each association only if exactly one Linguist
 * language owns it (including languages unavailable in Shiki when counting).
 * Match Linguist names/aliases to canonical Shiki names (ignoring spaces,
 * brackets and hyphens); alias-to-alias matches also require matching tm_scope.
 * Never substitute a different language
 * merely because Linguist reuses its grammar (e.g. Dhall/Haskell, Nu/Nushell).
 * Name bindings: 1C Enterprise=bsl, DM=dream-maker, Godot Resource=gdresource,
 * Fortran=fortran-fixed-form, Windows Registry Entries=reg, Terraform Template=terraform.
 * Linguist supplies only languages absent from VS Code; never run heuristics.
 * All bundled Shiki grammars remain available for embedded languages.
 */
export type SyntaxLanguageAssociation = {
  language: string;
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
  firstLine?: string;
  interpreters?: string[];
};

export const vscodeLanguages: SyntaxLanguageAssociation[] = [
  {
    language: "bat",
    extensions: [".bat", ".cmd"],
  },
  {
    language: "clojure",
    extensions: [".clj", ".cljs", ".cljc", ".cljx", ".clojure", ".edn"],
  },
  {
    language: "coffee",
    extensions: [".coffee", ".cson", ".iced"],
  },
  {
    language: "jsonc",
    extensions: [
      ".code-workspace",
      "language-configuration.json",
      "icon-theme.json",
      "color-theme.json",
    ],
    filenames: [
      "settings.json",
      "launch.json",
      "tasks.json",
      "mcp.json",
      "keybindings.json",
      "extensions.json",
      "argv.json",
      "profiles.json",
      "devcontainer.json",
      ".devcontainer.json",
    ],
  },
  {
    language: "json",
    extensions: [".code-profile"],
  },
  {
    language: "markdown",
    extensions: [".copilotmd"],
  },
  {
    language: "c",
    extensions: [".c", ".i"],
  },
  {
    language: "cpp",
    extensions: [
      ".cpp",
      ".cppm",
      ".cc",
      ".ccm",
      ".cxx",
      ".cxxm",
      ".c++",
      ".c++m",
      ".hpp",
      ".hh",
      ".hxx",
      ".h++",
      ".h",
      ".ii",
      ".ino",
      ".inl",
      ".ipp",
      ".ixx",
      ".mpp",
      ".mxx",
      ".tpp",
      ".txx",
      ".hpp.in",
      ".h.in",
    ],
  },
  {
    language: "csharp",
    extensions: [".cs", ".csx", ".cake"],
  },
  {
    language: "css",
    extensions: [".css"],
  },
  {
    language: "dart",
    extensions: [".dart"],
  },
  {
    language: "diff",
    extensions: [".diff", ".patch", ".rej"],
  },
  {
    language: "docker",
    extensions: [".dockerfile", ".containerfile"],
    filenames: ["Dockerfile", "Containerfile"],
    filenamePatterns: ["Dockerfile.*", "Containerfile.*"],
  },
  {
    language: "dotenv",
    extensions: [".env"],
    filenames: [".env", ".flaskenv", "user-dirs.dirs"],
    filenamePatterns: [".env.*"],
  },
  {
    language: "fsharp",
    extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  },
  {
    language: "git-commit",
    filenames: ["COMMIT_EDITMSG", "MERGE_MSG"],
  },
  {
    language: "git-rebase",
    filenames: ["git-rebase-todo"],
    filenamePatterns: ["**/rebase-merge/done"],
  },
  {
    language: "go",
    extensions: [".go"],
  },
  {
    language: "groovy",
    extensions: [".groovy", ".gvy", ".gradle", ".jenkinsfile", ".nf"],
    filenames: ["Jenkinsfile"],
    filenamePatterns: ["Jenkinsfile*"],
    firstLine: "^#!.*\\bgroovy\\b",
  },
  {
    language: "handlebars",
    extensions: [".handlebars", ".hbs", ".hjs"],
  },
  {
    language: "hlsl",
    extensions: [
      ".hlsl",
      ".hlsli",
      ".fx",
      ".fxh",
      ".vsh",
      ".psh",
      ".cginc",
      ".compute",
    ],
  },
  {
    language: "html",
    extensions: [
      ".html",
      ".htm",
      ".shtml",
      ".xhtml",
      ".xht",
      ".mdoc",
      ".jsp",
      ".asp",
      ".aspx",
      ".jshtm",
      ".volt",
      ".ejs",
      ".rhtml",
    ],
  },
  {
    language: "ini",
    extensions: [".ini"],
  },
  {
    language: "ini",
    extensions: [
      ".conf",
      ".properties",
      ".cfg",
      ".directory",
      ".gitattributes",
      ".gitconfig",
      ".gitmodules",
      ".editorconfig",
      ".repo",
    ],
    filenames: ["gitconfig"],
    filenamePatterns: ["**/.config/git/config", "**/.git/config"],
  },
  {
    language: "java",
    extensions: [".java", ".jav"],
  },
  {
    language: "jsx",
    extensions: [".jsx"],
  },
  {
    language: "javascript",
    extensions: [".js", ".es6", ".mjs", ".cjs", ".pac"],
    filenames: ["jakefile"],
    firstLine: "^#!.*\\bnode",
  },
  {
    language: "json",
    extensions: [
      ".json",
      ".bowerrc",
      ".jscsrc",
      ".webmanifest",
      ".js.map",
      ".css.map",
      ".ts.map",
      ".har",
      ".jslintrc",
      ".jsonld",
      ".geojson",
      ".ipynb",
      ".vuerc",
    ],
    filenames: ["composer.lock", ".watchmanconfig"],
  },
  {
    language: "jsonc",
    extensions: [
      ".jsonc",
      ".eslintrc",
      ".eslintrc.json",
      ".jsfmtrc",
      ".jshintrc",
      ".swcrc",
      ".hintrc",
      ".babelrc",
      ".toolset.jsonc",
    ],
    filenames: [
      "babel.config.json",
      "bun.lock",
      ".babelrc.json",
      ".ember-cli",
      "typedoc.json",
    ],
    filenamePatterns: ["**/.github/hooks/*.json"],
  },
  {
    language: "jsonl",
    extensions: [".jsonl", ".ndjson"],
    filenames: [],
  },
  {
    language: "julia",
    extensions: [".jl"],
    firstLine: "^#!\\s*/.*\\bjulia[0-9.-]*\\b",
  },
  {
    language: "tex",
    extensions: [".sty", ".cls", ".bbx", ".cbx"],
  },
  {
    language: "latex",
    extensions: [".tex", ".ltx", ".ctx"],
  },
  {
    language: "bibtex",
    extensions: [".bib"],
  },
  {
    language: "less",
    extensions: [".less"],
  },
  {
    language: "log",
    extensions: [".log", "*.log.?"],
  },
  {
    language: "lua",
    extensions: [".lua"],
  },
  {
    language: "make",
    extensions: [".mak", ".mk"],
    filenames: ["Makefile", "makefile", "GNUmakefile", "OCamlMakefile"],
    firstLine: "^#!\\s*/usr/bin/make",
  },
  {
    language: "markdown",
    extensions: [
      ".md",
      ".mkd",
      ".mkdn",
      ".mdwn",
      ".mdown",
      ".markdown",
      ".markdn",
      ".mdtxt",
      ".mdtext",
      ".litcoffee",
      ".ron",
      ".ronn",
      ".workbook",
    ],
    filenamePatterns: ["**/.cursor/**/*.mdc"],
  },
  {
    language: "ini",
    extensions: [".npmrc"],
  },
  {
    language: "objective-c",
    extensions: [".m"],
  },
  {
    language: "objective-cpp",
    extensions: [".mm"],
  },
  {
    language: "perl",
    extensions: [".pl", ".pm", ".pod", ".t", ".PL", ".psgi"],
    firstLine: "^#!.*\\bperl\\b",
  },
  {
    language: "raku",
    extensions: [
      ".raku",
      ".rakumod",
      ".rakutest",
      ".rakudoc",
      ".nqp",
      ".p6",
      ".pl6",
      ".pm6",
    ],
    firstLine: "(^#!.*\\bperl6\\b)|use\\s+v6|raku|=begin\\spod|my\\sclass",
  },
  {
    language: "php",
    extensions: [".php", ".php4", ".php5", ".phtml", ".ctp"],
    firstLine: "^#!\\s*/.*\\bphp\\b",
  },
  {
    language: "powershell",
    extensions: [".ps1", ".psm1", ".psd1", ".pssc", ".psrc"],
    firstLine: "^#!\\s*/.*\\bpwsh\\b",
  },
  {
    language: "pug",
    extensions: [".pug", ".jade"],
  },
  {
    language: "python",
    extensions: [
      ".py",
      ".rpy",
      ".pyw",
      ".cpy",
      ".gyp",
      ".gypi",
      ".pyi",
      ".ipy",
      ".pyt",
    ],
    filenames: ["SConstruct", "SConscript"],
    firstLine: "^#!\\s*/?.*\\bpython[0-9.-]*\\b",
  },
  {
    language: "r",
    extensions: [".R", ".Rhistory", ".Rprofile", ".rt"],
  },
  {
    language: "razor",
    extensions: [".cshtml", ".razor"],
  },
  {
    language: "rst",
    extensions: [".rst"],
  },
  {
    language: "ruby",
    extensions: [
      ".rb",
      ".rbx",
      ".rjs",
      ".gemspec",
      ".rake",
      ".ru",
      ".erb",
      ".podspec",
      ".rbi",
    ],
    filenames: [
      "rakefile",
      "gemfile",
      "guardfile",
      "podfile",
      "capfile",
      "cheffile",
      "hobofile",
      "vagrantfile",
      "appraisals",
      "rantfile",
      "berksfile",
      "berksfile.lock",
      "thorfile",
      "puppetfile",
      "dangerfile",
      "brewfile",
      "fastfile",
      "appfile",
      "deliverfile",
      "matchfile",
      "scanfile",
      "snapfile",
      "gymfile",
    ],
    firstLine: "^#!\\s*/.*\\bruby\\b",
  },
  {
    language: "rust",
    extensions: [".rs"],
  },
  {
    language: "scss",
    extensions: [".scss"],
  },
  {
    language: "shaderlab",
    extensions: [".shader"],
  },
  {
    language: "shellscript",
    extensions: [
      ".sh",
      ".bash",
      ".bashrc",
      ".bash_aliases",
      ".bash_profile",
      ".bash_login",
      ".ebuild",
      ".eclass",
      ".profile",
      ".bash_logout",
      ".xprofile",
      ".xsession",
      ".xsessionrc",
      ".Xsession",
      ".zsh",
      ".zshrc",
      ".zprofile",
      ".zlogin",
      ".zlogout",
      ".zshenv",
      ".zsh-theme",
      ".fish",
      ".ksh",
      ".csh",
      ".cshrc",
      ".tcshrc",
      ".yashrc",
      ".yash_profile",
    ],
    filenames: [
      "APKBUILD",
      "PKGBUILD",
      ".envrc",
      ".hushlogin",
      "zshrc",
      "zshenv",
      "zlogin",
      "zprofile",
      "zlogout",
      "bashrc_Apple_Terminal",
      "zshrc_Apple_Terminal",
    ],
    firstLine:
      "^#!.*\\b(bash|fish|zsh|sh|ksh|dtksh|pdksh|mksh|ash|dash|yash|sh|csh|jcsh|tcsh|itcsh).*|^#\\s*-\\*-[^*]*mode:\\s*shell-script[^*]*-\\*-",
  },
  {
    language: "sql",
    extensions: [".sql", ".dsql"],
  },
  {
    language: "swift",
    extensions: [".swift"],
  },
  {
    language: "typescript",
    extensions: [".ts", ".cts", ".mts"],
    firstLine: "^#!.*\\b(deno|bun|ts-node)\\b",
  },
  {
    language: "tsx",
    extensions: [".tsx"],
  },
  {
    language: "jsonc",
    filenames: ["tsconfig.json", "jsconfig.json"],
    filenamePatterns: [
      "tsconfig.*.json",
      "jsconfig.*.json",
      "tsconfig-*.json",
      "jsconfig-*.json",
    ],
  },
  {
    language: "json",
    extensions: [".tsbuildinfo"],
  },
  {
    language: "vb",
    extensions: [".vb", ".brs", ".vbs", ".bas", ".vba"],
  },
  {
    language: "xml",
    extensions: [
      ".xml",
      ".xsd",
      ".ascx",
      ".atom",
      ".axml",
      ".axaml",
      ".bpmn",
      ".cpt",
      ".csl",
      ".csproj",
      ".csproj.user",
      ".dita",
      ".ditamap",
      ".dtd",
      ".ent",
      ".mod",
      ".dtml",
      ".fsproj",
      ".fxml",
      ".iml",
      ".isml",
      ".jmx",
      ".launch",
      ".menu",
      ".mxml",
      ".nuspec",
      ".opml",
      ".owl",
      ".proj",
      ".props",
      ".pt",
      ".publishsettings",
      ".pubxml",
      ".pubxml.user",
      ".rbxlx",
      ".rbxmx",
      ".rdf",
      ".rng",
      ".rss",
      ".shproj",
      ".slnx",
      ".storyboard",
      ".svg",
      ".targets",
      ".tld",
      ".tmx",
      ".vbproj",
      ".vbproj.user",
      ".vcxproj",
      ".vcxproj.filters",
      ".wixproj",
      ".wsdl",
      ".wxi",
      ".wxl",
      ".wxs",
      ".xaml",
      ".xbl",
      ".xib",
      ".xlf",
      ".xliff",
      ".xpdl",
      ".xul",
      ".xoml",
    ],
    firstLine: "(\\<\\?xml.*)|(\\<svg)|(\\<\\!doctype\\s+svg)",
  },
  {
    language: "xsl",
    extensions: [".xsl", ".xslt"],
  },
  {
    language: "yaml",
    extensions: [
      ".yaml",
      ".yml",
      ".eyaml",
      ".eyml",
      ".cff",
      ".yaml-tmlanguage",
      ".yaml-tmpreferences",
      ".yaml-tmtheme",
      ".winget",
    ],
    firstLine: "^#cloud-config",
  },
];

export const linguistLanguages: SyntaxLanguageAssociation[] = [
  {
    language: "bsl",
    extensions: [".bsl", ".os"],
  },
  {
    language: "abap",
    extensions: [".abap"],
  },
  {
    language: "apl",
    extensions: [".apl", ".dyalog"],
    interpreters: ["apl", "aplx", "dyalog"],
  },
  {
    language: "ada",
    extensions: [".adb", ".ada", ".ads"],
  },
  {
    language: "apache",
    extensions: [".apacheconf"],
    filenames: [".htaccess", "apache2.conf", "httpd.conf"],
  },
  {
    language: "apex",
    extensions: [".apex"],
  },
  {
    language: "applescript",
    extensions: [".applescript", ".scpt"],
    interpreters: ["osascript"],
  },
  {
    language: "asciidoc",
    extensions: [".asciidoc", ".adoc"],
  },
  {
    language: "asm",
    extensions: [".a51", ".nasm"],
  },
  {
    language: "astro",
    extensions: [".astro"],
  },
  {
    language: "ahk",
    extensions: [".ahk", ".ah1", ".ah2", ".ahkl"],
  },
  {
    language: "awk",
    extensions: [".awk", ".auk", ".gawk", ".mawk", ".nawk"],
    interpreters: ["awk", "gawk", "mawk", "nawk"],
  },
  {
    language: "bird2",
    filenames: ["bird.conf"],
  },
  {
    language: "ballerina",
    extensions: [".bal"],
  },
  {
    language: "berry",
    extensions: [".be"],
  },
  {
    language: "bicep",
    extensions: [".bicep", ".bicepparam"],
  },
  {
    language: "blade",
    extensions: [".blade", ".blade.php"],
  },
  {
    language: "c3",
    extensions: [".c3"],
  },
  {
    language: "cmake",
    extensions: [".cmake", ".cmake.in"],
    filenames: ["CMakeLists.txt"],
  },
  {
    language: "cobol",
    extensions: [".cob", ".cbl", ".ccp", ".cobol", ".cpy"],
  },
  {
    language: "codeowners",
    filenames: ["CODEOWNERS"],
  },
  {
    language: "csv",
    extensions: [".csv"],
  },
  {
    language: "cadence",
    extensions: [".cdc"],
  },
  {
    language: "chapel",
    extensions: [".chpl"],
  },
  {
    language: "clarity",
    extensions: [".clar"],
  },
  {
    language: "soy",
    extensions: [".soy"],
  },
  {
    language: "codeql",
    extensions: [".ql", ".qll"],
  },
  {
    language: "common-lisp",
    extensions: [".asd", ".ny", ".podsl", ".sexp"],
    interpreters: ["lisp", "sbcl", "ccl", "clisp", "ecl"],
  },
  {
    language: "crystal",
    extensions: [".cr"],
    interpreters: ["crystal"],
  },
  {
    language: "cypher",
    extensions: [".cyp", ".cypher"],
  },
  {
    language: "d",
    extensions: [".di"],
  },
  {
    language: "dream-maker",
    extensions: [".dm"],
  },
  {
    language: "edge",
    extensions: [".edge"],
  },
  {
    language: "elixir",
    extensions: [".exs"],
    filenames: ["mix.lock"],
    interpreters: ["elixir"],
  },
  {
    language: "elm",
    extensions: [".elm"],
  },
  {
    language: "emacs-lisp",
    extensions: [".el", ".emacs", ".emacs.desktop"],
    filenames: [
      ".abbrev_defs",
      ".emacs",
      ".emacs.desktop",
      ".gnus",
      ".spacemacs",
      ".viper",
      "Cask",
      "Eask",
      "Project.ede",
      "_emacs",
      "abbrev_defs",
    ],
  },
  {
    language: "erlang",
    extensions: [
      ".erl",
      ".app",
      ".app.src",
      ".escript",
      ".hrl",
      ".xrl",
      ".yrl",
    ],
    filenames: ["Emakefile", "rebar.config", "rebar.config.lock", "rebar.lock"],
    interpreters: ["escript"],
  },
  {
    language: "fennel",
    extensions: [".fnl"],
    interpreters: ["fennel"],
  },
  {
    language: "fortran-fixed-form",
    extensions: [".f77"],
  },
  {
    language: "fortran-free-form",
    extensions: [".f90", ".f03", ".f08", ".f95"],
  },
  {
    language: "gdshader",
    extensions: [".gdshader", ".gdshaderinc"],
  },
  {
    language: "glsl",
    extensions: [
      ".glsl",
      ".fp",
      ".frg",
      ".fsh",
      ".fshader",
      ".geo",
      ".geom",
      ".glslf",
      ".glslv",
      ".gshader",
      ".rchit",
      ".rmiss",
      ".tesc",
      ".tese",
      ".vert",
      ".vrx",
      ".vs",
      ".vsh",
      ".vshader",
    ],
  },
  {
    language: "gn",
    extensions: [".gn", ".gni"],
    filenames: [".gn"],
    interpreters: ["gn"],
  },
  {
    language: "po",
    extensions: [".po", ".pot"],
  },
  {
    language: "gherkin",
    extensions: [".feature", ".story"],
  },
  {
    language: "gleam",
    extensions: [".gleam"],
  },
  {
    language: "glimmer-js",
    extensions: [".gjs"],
  },
  {
    language: "gnuplot",
    extensions: [".gp", ".gnu", ".gnuplot", ".plot"],
    interpreters: ["gnuplot"],
  },
  {
    language: "gdresource",
    extensions: [".gdnlib", ".gdns", ".tres", ".tscn"],
    filenames: ["project.godot"],
  },
  {
    language: "graphql",
    extensions: [".graphql", ".gql", ".graphqls"],
  },
  {
    language: "hcl",
    extensions: [".hcl", ".nomad", ".tf", ".tfvars", ".tofu"],
  },
  {
    language: "erb",
    extensions: [".erb", ".erb.deface", ".rhtml"],
  },
  {
    language: "http",
    extensions: [".http"],
  },
  {
    language: "hxml",
    extensions: [".hxml"],
  },
  {
    language: "hack",
    extensions: [".hack", ".hhi"],
  },
  {
    language: "haml",
    extensions: [".haml", ".haml.deface"],
  },
  {
    language: "haskell",
    extensions: [".hs", ".hs-boot", ".hsc"],
    interpreters: ["runghc", "runhaskell", "runhugs"],
  },
  {
    language: "haxe",
    extensions: [".hx", ".hxsl"],
  },
  {
    language: "hurl",
    extensions: [".hurl"],
  },
  {
    language: "hy",
    extensions: [".hy"],
    interpreters: ["hy"],
  },
  {
    language: "imba",
    extensions: [".imba"],
  },
  {
    language: "json5",
    extensions: [".json5"],
  },
  {
    language: "jinja",
    extensions: [".jinja", ".j2", ".jinja2"],
  },
  {
    language: "jison",
    extensions: [".jison"],
  },
  {
    language: "jsonnet",
    extensions: [".jsonnet", ".libsonnet"],
  },
  {
    language: "just",
    extensions: [".just"],
    filenames: [
      ".JUSTFILE",
      ".Justfile",
      ".justfile",
      "JUSTFILE",
      "Justfile",
      "justfile",
    ],
  },
  {
    language: "kdl",
    extensions: [".kdl"],
  },
  {
    language: "kotlin",
    extensions: [".kt", ".ktm", ".kts"],
  },
  {
    language: "kusto",
    extensions: [".kql"],
  },
  {
    language: "llvm",
    extensions: [".ll"],
  },
  {
    language: "lean",
    extensions: [".hlean"],
  },
  {
    language: "liquid",
    extensions: [".liquid"],
  },
  {
    language: "luau",
    extensions: [".luau"],
    interpreters: ["luau"],
  },
  {
    language: "matlab",
    extensions: [".matlab"],
  },
  {
    language: "mdx",
    extensions: [".mdx"],
  },
  {
    language: "marko",
    extensions: [".marko"],
  },
  {
    language: "mermaid",
    extensions: [".mmd", ".mermaid"],
  },
  {
    language: "moonbit",
    extensions: [".mbt"],
    filenames: ["moon.mod", "moon.pkg"],
  },
  {
    language: "move",
    extensions: [".move"],
  },
  {
    language: "nsis",
    extensions: [".nsi", ".nsh"],
  },
  {
    language: "nextflow",
    extensions: [".nf"],
    filenames: ["nextflow.config"],
    interpreters: ["nextflow"],
  },
  {
    language: "nginx",
    extensions: [".nginx", ".nginxconf"],
    filenames: ["nginx.conf"],
  },
  {
    language: "nim",
    extensions: [".nim", ".nim.cfg", ".nimble", ".nimrod", ".nims"],
    filenames: ["nim.cfg"],
  },
  {
    language: "nix",
    extensions: [".nix"],
  },
  {
    language: "nushell",
    interpreters: ["nu"],
  },
  {
    language: "ocaml",
    extensions: [".eliom", ".eliomi", ".ml4", ".mli", ".mll", ".mly"],
    interpreters: ["ocamlrun", "ocamlscript"],
  },
  {
    language: "openscad",
    extensions: [".scad"],
  },
  {
    language: "org",
    extensions: [".org"],
  },
  {
    language: "plsql",
    extensions: [
      ".pls",
      ".bdy",
      ".fnc",
      ".pck",
      ".pkb",
      ".pks",
      ".plb",
      ".plsql",
      ".spc",
      ".tpb",
      ".tps",
      ".trg",
      ".vw",
    ],
  },
  {
    language: "pascal",
    extensions: [".pas", ".dfm", ".dpr", ".lpr", ".pascal"],
    interpreters: ["instantfpc"],
  },
  {
    language: "pkl",
    interpreters: ["pkl"],
  },
  {
    language: "polar",
    extensions: [".polar"],
  },
  {
    language: "postcss",
    extensions: [".pcss", ".postcss"],
  },
  {
    language: "powerquery",
    extensions: [".pq"],
  },
  {
    language: "prisma",
    extensions: [".prisma"],
  },
  {
    language: "prolog",
    extensions: [".prolog", ".yap"],
    interpreters: ["swipl", "yap"],
  },
  {
    language: "proto",
    extensions: [".proto"],
  },
  {
    language: "puppet",
    filenames: ["Modulefile"],
  },
  {
    language: "purescript",
    extensions: [".purs"],
  },
  {
    language: "qml",
    extensions: [".qml", ".qbs"],
  },
  {
    language: "rbs",
    extensions: [".rbs"],
  },
  {
    language: "ron",
    extensions: [".ron"],
  },
  {
    language: "rosmsg",
    extensions: [".action", ".srv"],
  },
  {
    language: "racket",
    extensions: [".rkt", ".rktd", ".rktl", ".scrbl"],
    interpreters: ["racket"],
  },
  {
    language: "regexp",
    extensions: [".regexp", ".regex"],
  },
  {
    language: "coq",
    extensions: [".coq"],
  },
  {
    language: "sas",
    extensions: [".sas"],
  },
  {
    language: "sparql",
    extensions: [".sparql", ".rq"],
  },
  {
    language: "ssh-config",
    filenames: [
      "ssh-config",
      "ssh_config",
      "sshconfig",
      "sshconfig.snip",
      "sshd-config",
      "sshd_config",
    ],
  },
  {
    language: "sass",
    extensions: [".sass"],
  },
  {
    language: "scala",
    extensions: [".scala", ".kojo", ".sbt"],
    interpreters: ["scala"],
  },
  {
    language: "scheme",
    extensions: [".sld", ".sps", ".ss"],
    interpreters: [
      "scheme",
      "guile",
      "bigloo",
      "chicken",
      "csi",
      "gosh",
      "r6rs",
    ],
  },
  {
    language: "shellsession",
    extensions: [".sh-session"],
  },
  {
    language: "smithy",
    extensions: [".smithy"],
  },
  {
    language: "stata",
    extensions: [".do", ".ado", ".doh", ".ihlp", ".mata", ".matah", ".sthlp"],
  },
  {
    language: "stylus",
    extensions: [".styl"],
  },
  {
    language: "surrealql",
    extensions: [".surql"],
  },
  {
    language: "svelte",
    extensions: [".svelte"],
  },
  {
    language: "system-verilog",
    extensions: [".sv", ".svh", ".vh"],
  },
  {
    language: "toml",
    extensions: [".toml", ".toml.example"],
    filenames: [
      "Cargo.lock",
      "Cargo.toml.orig",
      "Gopkg.lock",
      "Pipfile",
      "mise.local.lock",
      "mise.lock",
      "pdm.lock",
      "poetry.lock",
      "uv.lock",
    ],
  },
  {
    language: "tsv",
    extensions: [".tsv"],
  },
  {
    language: "talonscript",
    extensions: [".talon"],
  },
  {
    language: "tcl",
    extensions: [".tcl", ".adp", ".sdc", ".tcl.in", ".tm", ".xdc"],
    filenames: ["owh", "starfield"],
    interpreters: ["tclsh", "wish"],
  },
  {
    language: "terraform",
    extensions: [".tftpl"],
  },
  {
    language: "turtle",
    extensions: [".ttl"],
  },
  {
    language: "twig",
    extensions: [".twig"],
  },
  {
    language: "vhdl",
    extensions: [
      ".vhdl",
      ".vhd",
      ".vhf",
      ".vhi",
      ".vho",
      ".vhs",
      ".vht",
      ".vhw",
    ],
  },
  {
    language: "vala",
    extensions: [".vala", ".vapi"],
  },
  {
    language: "verilog",
    extensions: [".veo"],
  },
  {
    language: "viml",
    extensions: [".vim", ".vimrc", ".vmb"],
    filenames: [
      ".exrc",
      ".gvimrc",
      ".nvimrc",
      ".vimrc",
      "_vimrc",
      "gvimrc",
      "nvimrc",
      "vimrc",
    ],
  },
  {
    language: "vue",
    extensions: [".vue"],
  },
  {
    language: "vyper",
    extensions: [".vy"],
  },
  {
    language: "wgsl",
    extensions: [".wgsl"],
  },
  {
    language: "wasm",
    extensions: [".wast", ".wat"],
  },
  {
    language: "wit",
    extensions: [".wit"],
  },
  {
    language: "wikitext",
    extensions: [".mediawiki", ".wiki", ".wikitext"],
  },
  {
    language: "reg",
    extensions: [".reg"],
  },
  {
    language: "wolfram",
    extensions: [
      ".mathematica",
      ".cdf",
      ".ma",
      ".mt",
      ".nbp",
      ".wl",
      ".wls",
      ".wlt",
    ],
    interpreters: [
      "wolfram",
      "WolframKernel",
      "wolframscript",
      "math",
      "MathKernel",
      "MathematicaScript",
      "WolframNB",
      "Mathematica",
    ],
  },
  {
    language: "zenscript",
    extensions: [".zs"],
  },
  {
    language: "zig",
    extensions: [".zig", ".zig.zon"],
  },
  {
    language: "desktop",
    extensions: [".desktop", ".desktop.in"],
  },
  {
    language: "fish",
    extensions: [".fish"],
    interpreters: ["fish"],
  },
  {
    language: "templ",
    extensions: [".templ"],
  },
];
