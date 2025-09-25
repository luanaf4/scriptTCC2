const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

class GitHubAccessibilityMiner {
constructor() {
  this.tokens = [
    process.env.TOKEN_1,
    process.env.TOKEN_2,
    process.env.TOKEN_3,
  ].filter(Boolean);
  this.tokenIndex = 0;
  this.token = this.tokens[0];
  this.tokenLimits = Array(this.tokens.length).fill(null); 
  this.graphqlUrl = "https://api.github.com/graphql";
  this.restUrl = "https://api.github.com";
  this.csvFile = "repositorios_acessibilidade.csv";
  this.processedReposFile = "processed_repos.json";
  this.processedRepos = this.loadProcessedRepos();
  // Adicionar repositórios pulados do CSV
  const skippedCsv = '/Users/dtidigital/scriptTCC2/repositorios_pulados.csv';
  if (fs.existsSync(skippedCsv)) {
    const lines = fs.readFileSync(skippedCsv, 'utf8').split('\n');
    for (let i = 1; i < lines.length; i++) { 
      const repo = lines[i].trim();
      if (repo) this.processedRepos.add(repo);
    }
    this.saveProcessedRepos();
    console.log(`📋 Adicionados ${lines.length-1} repositórios pulados ao processed_repos.json`);
  }
  this.perPage = 100;

  // Sem controle de tempo interno - o GitHub Actions já controla com timeout-minutes: 35791
  this.startTime = Date.now();

  // Ferramentas de acessibilidade (multi-linguagem)
  this.accessibilityTools = {
    AXE: [
      // JavaScript/Node.js
      "axe-core",
      "axe",
      "@axe-core",
      "react-axe",
      "axe-selenium",
      "cypress-axe",
      "jest-axe",
      "axe-playwright",
      "axe-webdriverjs",
      "vue-axe",
      // Python
      "axe-selenium-python",
      "pytest-axe",
      "axe-core-python",
      // Java
      "axe-selenium-java",
      "axe-core-maven",
      "axe-core-api",
      // C#
      "selenium.axe",
      "axe.core",
      "axe-core-nuget",
      // Ruby
      "axe-core-rspec",
      "axe-matchers",
      "axe-core-capybara",
      // PHP
      "axe-core-php",
      "dmore/chrome-mink-driver",
    ],
    Pa11y: [
      // JavaScript/Node.js
      "pa11y",
      "pa11y-ci",
      "@pa11y",
      "pa11y-webdriver",
      "pa11y-reporter-cli",
      // Python
      "pa11y-python",
      "accessibility-checker-python",
      // Outros
      "pa11y-dashboard",
      "koa-pa11y",
    ],
    WAVE: ["wave", "wave-cli", "wave-accessibility", "webaim-wave"],
    AChecker: [
      "achecker",
      "accessibility-checker",
      "ibma/equal-access",
      "equal-access",
      "accessibility-checker-engine",
    ],
    Lighthouse: [
      // JavaScript/Node.js
      "lighthouse",
      "@lighthouse",
      "lighthouse-ci",
      "lhci",
      "lighthouse-batch",
      "lighthouse-plugin-accessibility",
      "lighthouse-ci-action",
      // Python
      "pylighthouse",
      "lighthouse-python",
      // Outros
      "lighthouse-badges",
      "lighthouse-keeper",
    ],
    Asqatasun: ["asqatasun", "asqata-sun", "tanaguru", "contrast-finder"],
    HTML_CodeSniffer: [
      "html_codesniffer",
      "htmlcs",
      "squizlabs/html_codesniffer",
      "pa11y-reporter-htmlcs",
      "htmlcodesniffer",
      "html-codesniffer",
    ],
  };

  // Arquivos de configuração
  this.configFiles = [
    ".pa11yci.json",
    ".pa11yci.yaml",
    ".lighthouseci.json",
    ".html_codesniffer.json",
    "pa11y.json",
    "lighthouse.json",
    "axe.json",
    "wave.json",
    ".pa11y.json",
    ".lighthouse.json",
    ".axe.json",
    ".wave.json",
    "pa11y.js",
    "pa11yci.js",
    ".pa11yrc",
    ".pa11yrc.json",
    "lhci.json",
  ];

  this.stats = {
    analyzed: 0,
    saved: 0,
    errors: 0,
    skipped: 0,
    startTime: new Date().toISOString(),
  };
  this.loadReposFromCSV();
  this.initializeCSV();
}

initializeCSV() {
  if (!fs.existsSync(this.csvFile)) {
    const headers = [
      "Repositório",
      "Número de Estrelas",
      "Último Commit",
      "AXE",
      "Pa11y",
      "WAVE",
      "AChecker",
      "Lighthouse",
      "Asqatasun",
      "HTML_CodeSniffer",
    ].join(",");
    fs.writeFileSync(this.csvFile, headers + "\n");
  }
}

loadReposFromCSV() {
  try {
    if (fs.existsSync(this.csvFile)) {
      const csvContent = fs.readFileSync(this.csvFile, 'utf8');
      const lines = csvContent.split('\n');
      
      // Pular o cabeçalho
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          const columns = line.split(',');
          const repoName = columns[0];
          if (repoName && !this.processedRepos.has(repoName)) {
            this.processedRepos.add(repoName);
          }
        }
      }
      console.log(`📋 Carregados ${this.processedRepos.size} repositórios do CSV e JSON`);
    }
  } catch (error) {
    console.log(`⚠️ Erro ao carregar repositórios do CSV: ${error.message}`);
  }
}

loadProcessedRepos() {
  try {
    if (fs.existsSync(this.processedReposFile)) {
      const data = JSON.parse(fs.readFileSync(this.processedReposFile, "utf8"));
      console.log(`📋 Carregados ${data.length} repositórios já processados`);
      return new Set(data);
    }
  } catch (error) {
    console.log(
      `⚠️ Erro ao carregar repositórios processados: ${error.message}`
    );
  }
  return new Set();
}

saveProcessedRepos() {
  try {
    fs.writeFileSync(
      this.processedReposFile,
      JSON.stringify([...this.processedRepos], null, 2)
    );
  } catch (error) {
    console.log(
      `⚠️ Erro ao salvar repositórios processados: ${error.message}`
    );
  }
}

nextToken() {
  this.tokenIndex = (this.tokenIndex + 1) % this.tokens.length;
  this.token = this.tokens[this.tokenIndex];
}

switchTokenIfNeeded(rateLimit) {
  if (rateLimit !== null && rateLimit <= 0) {
    let startIndex = this.tokenIndex;
    let found = false;
    for (let i = 1; i <= this.tokens.length; i++) {
      let nextIndex = (startIndex + i) % this.tokens.length;
      if (!this.tokenLimits[nextIndex] || this.tokenLimits[nextIndex] > 0) {
        this.tokenIndex = nextIndex;
        this.token = this.tokens[this.tokenIndex];
        found = true;
        break;
      }
    }
    if (!found) {
      console.log('⏳ Todos os tokens atingiram o rate limit. Aguardando reset...');
    }
  }
}

async makeGraphQLRequest(query, variables = {}) {
  const options = {
    method: "POST",
    headers: {
      "User-Agent": "GitHub-Accessibility-Miner-Action",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    },
    body: JSON.stringify({ query, variables }),
    timeout: 20000,
  };

  const response = await fetch(this.graphqlUrl, options);
  const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
  const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));
  this.tokenLimits[this.tokenIndex] = rateLimit;
  this.switchTokenIfNeeded(rateLimit);

  if (rateLimit < 100) {
    const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 0);
    console.log(
      `⏳ Rate limit baixo (${rateLimit}), aguardando ${Math.ceil(
        waitTime / 1000
      )}s...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL Error: ${JSON.stringify(result.errors)}`);
  }

  return result.data;
}

async makeRestRequest(url) {
  const options = {
    headers: {
      "User-Agent": "GitHub-Accessibility-Miner-Action",
      Accept: "application/vnd.github.v3+json",
      Authorization: `token ${this.token}`,
    },
    timeout: 20000,
  };

  const response = await fetch(url, options);
  const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
  const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));
  this.tokenLimits[this.tokenIndex] = rateLimit;
  this.switchTokenIfNeeded(rateLimit);

  if (rateLimit < 50) {
    const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 0);
    console.log(
      `⏳ Rate limit REST baixo (${rateLimit}), aguardando ${Math.ceil(
        waitTime / 1000
      )}s...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

async searchRepositories(query, cursor = null) {
  const graphqlQuery = `
    query SearchRepositories($query: String!, $first: Int!, $after: String) {
      search(query: $query, type: REPOSITORY, first: $first, after: $after) {
        repositoryCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ... on Repository {
            id
            name
            nameWithOwner
            description
            url
            homepageUrl
            stargazerCount
            updatedAt
            createdAt
            primaryLanguage {
              name
            }
            languages(first: 10) {
              nodes {
                name
              }
            }
            repositoryTopics(first: 20) {
              nodes {
                topic {
                  name
                }
              }
            }
            owner {
              login
            }
            defaultBranchRef {
              name
            }
            isArchived
            isFork
            isPrivate
            licenseInfo {
              name
            }
          }
        }
      }
      rateLimit {
        remaining
        resetAt
      }
    }
  `;

  const variables = {
    query: `${query} sort:stars-desc`,
    first: this.perPage,
    after: cursor,
  };

  try {
    console.log(
      `🔍 Buscando GraphQL: "${query}"${
        cursor ? ` - Cursor: ${String(cursor).substring(0, 10)}...` : ""
      }`
    );
    const data = await this.makeGraphQLRequest(graphqlQuery, variables);

    // Log do rate limit GraphQL
    if (data.rateLimit) {
      console.log(
        `   📊 Rate limit GraphQL: ${data.rateLimit.remaining} restantes`
      );
    }

    return {
      items: data.search.nodes || [],
      pageInfo: data.search.pageInfo,
      totalCount: data.search.repositoryCount,
    };
  } catch (error) {
    console.log(`❌ Erro na busca GraphQL: ${error.message}`);
    throw error;
  }
}

async getRepositoryContents(owner, repo, path = "") {
  const url = `${this.restUrl}/repos/${owner}/${repo}/contents/${path}`;

  try {
    const contents = await this.makeRestRequest(url);
    return Array.isArray(contents) ? contents : [contents];
  } catch (error) {
    if (error.message && error.message.includes("404")) {
      return [];
    }
    throw error;
  }
}

async getFileContent(owner, repo, filePath) {
  try {
    const content = await this.makeRestRequest(
      `${this.restUrl}/repos/${owner}/${repo}/contents/${filePath}`
    );
    if (content && content.content) {
      return Buffer.from(content.content, "base64").toString("utf8");
    }
  } catch (error) {
    return null;
  }
  return null;
}

async getReadmeContent(owner, repo) {
  const possibleNames = [
    "README.md",
    "README.MD",
    "README",
    "readme.md",
    "readme",
    "Readme.md",
  ];
  for (const name of possibleNames) {
    const content = await this.getFileContent(owner, repo, name);
    if (content) return content;
  }
  return null;
}

// Novo método isLibraryRepository usando README
async isLibraryRepository(repo) {
  const owner = (repo.owner && repo.owner.login) || "";
  const name = (repo.name || "").toLowerCase();
  const fullName = ((repo.full_name || repo.nameWithOwner) || "").toLowerCase();
  const description = (repo.description || "").toLowerCase();

  // topics pode vir como array de strings (REST) ou não existir; garantir string
  let topicsArr = [];
  if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
    topicsArr = repo.repositoryTopics.nodes.map(
      (n) => ((n && n.topic && n.topic.name) || "").toLowerCase()
    );
  } else if (Array.isArray(repo.topics)) {
    topicsArr = repo.topics.map((t) => (t || "").toLowerCase());
  } else {
    topicsArr = [];
  }

  const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();

  // 🔹 Tenta buscar o README
  let readmeContent = "";
  try {
    const readme = await this.getReadmeContent(owner, repo.name || repo.nameWithOwner);
    if (readme) {
      readmeContent = (readme || "").toLowerCase();
    }
  } catch (e) {
    // Sem README, segue sem ele
  }

  // 🔹 Combina tudo para análise
  const combinedText = [
    description,
    name,
    fullName,
    topicsArr.join(" "),
    homepage,
    readmeContent,
  ].join(" ");

  // Palavras que DEFINITIVAMENTE indicam bibliotecas/componentes
  const strongLibraryKeywords = [
    "library",
    "lib",
    "biblioteca",
    "component library",
    "ui library",
    "component collection",
    "design system",
    "ui components",
    "react components",
    "vue components",
    "angular components",
    "component kit",
    "ui kit",
    "framework",
    "toolkit",
    "boilerplate",
    "template",
    "starter kit",
    "starter template",
    "seed",
    "skeleton",
    "scaffold",
    "generator",
    "cli tool",
    "command line",
    "npm package",
    "node module",
    "plugin",
    "extension",
    "addon",
    "middleware",
    "utility",
    "utils",
    "utilities",
    "helper",
    "helpers",
    "sdk",
    "api client",
    "wrapper",
    "binding",
    "polyfill",
    "shim",
    "mock",
    "stub",
    "collection",
    // 🔹 Palavras comuns no README de libs
    "npm install",
    "yarn add",
    "composer require",
    "pip install",
    "gem install",
    "usage",
    "installation",
    "import ",
    "require(",
  ];

  // Padrões no nome que indicam bibliotecas
  const libraryNamePatterns = [
    /^react-/,
    /^vue-/,
    /^angular-/,
    /^ng-/,
    /^@[^/]+\//, // Prefixos comuns
    /-ui$/,
    /-components$/,
    /-lib$/,
    /-kit$/,
    /-utils$/,
    /-helpers$/, // Sufixos
    /^ui-/,
    /^lib-/,
    /^utils-/,
    /^helper-/,
    /^tool-/,
    /^cli-/, // Prefixos específicos
    /-boilerplate$/,
    /-template$/,
    /-starter$/,
    /-seed$/,
    /-skeleton$/,
  ];

  // Palavras que indicam aplicação REAL
  const appKeywords = [
    "web app",
    "webapp",
    "web application",
    "application",
    "app",
    "website",
    "site",
    "portal",
    "platform",
    "dashboard",
    "admin panel",
    "management system",
    "cms",
    "blog",
    "e-commerce",
    "ecommerce",
    "shop",
    "store",
    "marketplace",
    "social network",
    "chat app",
    "messaging",
    "game",
    "todo app",
    "task manager",
    "project management",
    "crm",
    "erp",
    "saas",
    "web service",
    "api server",
    "backend",
  ];

  // Verificar padrões fortes de biblioteca no nome
  const hasLibraryNamePattern = libraryNamePatterns.some(
    (pattern) => pattern.test(name) || pattern.test(fullName)
  );

  // Verificar palavras fortes de biblioteca no texto combinado
  const hasStrongLibraryKeywords = strongLibraryKeywords.some((keyword) =>
    combinedText.includes(keyword)
  );

  // Verificar palavras de aplicação
  const hasAppKeywords = appKeywords.some((keyword) =>
    combinedText.includes(keyword)
  );

  // Verificar se é "awesome list" ou coleção
  const isAwesomeList =
    combinedText.includes("awesome") ||
    combinedText.includes("curated list") ||
    combinedText.includes("collection of") ||
    combinedText.includes("list of");

  // Verificar se é documentação, tutorial ou exemplo
  const isDocsOrTutorial =
    combinedText.includes("documentation") ||
    combinedText.includes("tutorial") ||
    combinedText.includes("example") ||
    combinedText.includes("demo") ||
    combinedText.includes("sample") ||
    combinedText.includes("guide");

  // Verificar repositórios de configuração ou dotfiles
  const isConfigRepo =
    combinedText.includes("dotfiles") ||
    combinedText.includes("config") ||
    combinedText.includes("settings") ||
    combinedText.includes("configuration");

  // CRITÉRIOS DE EXCLUSÃO (é biblioteca se):
  const isLibrary =
    hasLibraryNamePattern ||
    (hasStrongLibraryKeywords && !hasAppKeywords) ||
    isAwesomeList ||
    isDocsOrTutorial ||
    isConfigRepo;

  // Log para debug
  if (isLibrary) {
    const reasons = [];
    if (hasLibraryNamePattern) reasons.push("nome suspeito");
    if (hasStrongLibraryKeywords && !hasAppKeywords)
      reasons.push("palavras de biblioteca");
    if (isAwesomeList) reasons.push("lista awesome");
    if (isDocsOrTutorial) reasons.push("docs/tutorial");
    if (isConfigRepo) reasons.push("configuração");
    if (readmeContent) reasons.push("README indica biblioteca");
    console.log(
      `   📚 Biblioteca detectada (${reasons.join(", ")}): ${repo.full_name || repo.nameWithOwner || ""}`
    );
  }

  return isLibrary;
}

isWebApplication(repo) {
  const description = (repo.description || "").toLowerCase();
  const name = (repo.name || "").toLowerCase();

  // Adaptar para GraphQL - topics vêm em formato diferente
  let topics = [];
  if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
    topics = repo.repositoryTopics.nodes.map((n) => ((n && n.topic && n.topic.name) || "").toLowerCase());
  } else if (Array.isArray(repo.topics)) {
    topics = repo.topics.map((t) => (t || "").toLowerCase());
  } else {
    topics = [];
  }

  const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();

  // Combinar todas as informações
  const allContent = [description, name, topics.join(" "), homepage].join(" ");

  // Palavras que CONFIRMAM que é uma aplicação web
  const webAppKeywords = [
    // Tipos de aplicação
    "web application",
    "web app",
    "webapp",
    "website",
    "web platform",
    "web portal",
    "web interface",
    "web service",
    "online application",
    "web based",
    "browser based",
    "online platform",

    // Tipos específicos de aplicação
    "dashboard",
    "admin panel",
    "control panel",
    "management system",
    "cms",
    "content management",
    "blog platform",
    "forum",
    "ecommerce",
    "e-commerce",
    "online store",
    "shop",
    "marketplace",
    "social network",
    "social platform",
    "community platform",
    "chat application",
    "messaging app",
    "communication platform",
    "crm",
    "erp",
    "saas",
    "business application",
    "booking system",
    "reservation system",
    "ticketing system",
    "learning platform",
    "education platform",
    "lms",
    "portfolio site",
    "personal website",
    "company website",
    "news site",
    "media platform",
    "publishing platform",

    // Indicadores técnicos de aplicação web
    "frontend",
    "backend",
    "fullstack",
    "full-stack",
    "single page application",
    "spa",
    "progressive web app",
    "pwa",
    "responsive",
    "mobile-first",
    "cross-platform web",

    // Contextos de uso
    "deployed",
    "hosted",
    "live demo",
    "production",
    "users",
    "customers",
    "clients",
    "visitors",
  ];

  // Palavras que NEGAM que é uma aplicação (bibliotecas, ferramentas, etc.)
  const nonAppKeywords = [
    // Bibliotecas e componentes
    "library",
    "lib",
    "component library",
    "ui library",
    "design system",
    "components",
    "widgets",
    "elements",
    "controls",
    "framework",
    "toolkit",
    "sdk",
    "api client",
    "wrapper",

    // Ferramentas e utilitários
    "tool",
    "utility",
    "util",
    "helper",
    "plugin",
    "extension",
    "cli",
    "command line",
    "script",
    "automation",
    "generator",
    "builder",
    "compiler",
    "bundler",

    // Templates e boilerplates
    "template",
    "boilerplate",
    "starter",
    "seed",
    "skeleton",
    "scaffold",
    "example",
    "demo",
    "sample",
    "tutorial",

    // Documentação e recursos
    "documentation",
    "docs",
    "guide",
    "tutorial",
    "learning",
    "awesome",
    "curated",
    "collection",
    "list of",
    "resources",

    // Configuração e setup
    "config",
    "configuration",
    "setup",
    "dotfiles",
    "settings",
  ];

  // Verificar se tem palavras de aplicação web
  const hasWebAppKeywords = webAppKeywords.some((keyword) =>
    allContent.includes(keyword)
  );

  // Verificar se tem palavras que negam aplicação
  const hasNonAppKeywords = nonAppKeywords.some((keyword) =>
    allContent.includes(keyword)
  );

  // Verificar topics específicos que indicam aplicação
  const webAppTopics = [
    "webapp",
    "web-app",
    "website",
    "web-application",
    "dashboard",
    "admin-panel",
    "cms",
    "ecommerce",
    "e-commerce",
    "saas",
    "platform",
    "portal",
    "frontend",
    "fullstack",
    "spa",
    "pwa",
    "responsive",
    "bootstrap",
    "tailwind",
  ];

  const hasWebAppTopics = topics.some((topic) => webAppTopics.includes(topic));

  // Verificar se tem homepage (aplicações geralmente têm)
  const hasHomepage = !!(homepage && homepage.includes("http"));

  // LÓGICA DE DECISÃO:
  const isWebApp =
    (hasWebAppKeywords && !hasNonAppKeywords) || hasWebAppTopics || hasHomepage;

  // Log para debug
  if (!isWebApp) {
    const reasons = [];
    if (!hasWebAppKeywords) reasons.push("sem palavras de webapp");
    if (hasNonAppKeywords) reasons.push("tem palavras de biblioteca/ferramenta");
    if (!hasWebAppTopics) reasons.push("sem topics de webapp");
    if (!hasHomepage) reasons.push("sem homepage");

    console.log(`   🔍 Não é webapp (${reasons.join(", ")})`);
  } else {
    const reasons = [];
    if (hasWebAppKeywords && !hasNonAppKeywords) reasons.push("palavras de webapp");
    if (hasWebAppTopics) reasons.push("topics de webapp");
    if (hasHomepage) reasons.push("tem homepage");

    console.log(`   ✅ Confirmado como webapp (${reasons.join(", ")})`);
  }

  return isWebApp;
}

async checkRepositoryAbout(repo, foundTools) {
  const description = (repo.description || "");
  // Adaptar para GraphQL - topics vêm em formato diferente
  let topics = [];
  if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
    topics = repo.repositoryTopics.nodes.map((n) => (n && n.topic && n.topic.name) || "");
  } else if (Array.isArray(repo.topics)) {
    topics = repo.topics.map((t) => t || "");
  } else {
    topics = [];
  }
  const homepage = (repo.homepageUrl || repo.homepage || "");

  // Combinar todas as informações do "about"
  const aboutContent = [description, topics.join(" "), homepage].join(" ").toLowerCase();

  if (aboutContent.trim()) {
    console.log(`     📋 Analisando descrição/about do repositório`);

    // Buscar ferramentas na descrição
    this.searchToolsInContent(aboutContent, foundTools);

    // Verificar menções específicas de acessibilidade
    const accessibilityKeywords = [
      "accessibility",
      "accessible",
      "a11y",
      "wcag",
      "aria",
      "screen reader",
      "keyboard navigation",
      "color contrast",
      "accessibility testing",
      "accessibility audit",
      "accessibility compliance",
      "web accessibility",
      "inclusive design",
      "universal design",
      "disability",
      "assistive technology",
    ];

    const hasAccessibilityMention = accessibilityKeywords.some((keyword) =>
      aboutContent.includes(keyword)
    );

    if (hasAccessibilityMention) {
      console.log(`     ♿ Menção de acessibilidade encontrada na descrição`);

      // Se menciona acessibilidade, verificar mais profundamente
      // Procurar por ferramentas mesmo que não estejam explícitas
      const implicitTools = {
        "accessibility audit": ["AXE", "Pa11y", "Lighthouse"],
        "accessibility testing": ["AXE", "Pa11y", "WAVE"],
        "wcag compliance": ["AXE", "AChecker", "WAVE"],
        "a11y testing": ["AXE", "Pa11y"],
        "accessibility scanner": ["AXE", "WAVE", "AChecker"],
        "color contrast": ["AXE", "WAVE"],
        "screen reader": ["AXE", "Pa11y"],
      };

      for (const [phrase, tools] of Object.entries(implicitTools)) {
        if (aboutContent.includes(phrase)) {
          tools.forEach((tool) => {
            if (!foundTools[tool]) {
              console.log(`     🔍 ${tool} inferido por menção: "${phrase}"`);
              foundTools[tool] = true;
            }
          });
        }
      }
    }

    // Log dos topics se existirem
    if (topics.length > 0) {
      console.log(`     🏷️  Topics: ${topics.join(", ")}`);
    }
  }
}

async analyzeRepository(repo) {
  const owner = (repo.owner && repo.owner.login) || "";
  const name = repo.name || "";
  const fullName = repo.nameWithOwner || repo.full_name || `${owner}/${name}`;

  console.log(
    `🔬 Analisando: ${fullName} (⭐ ${repo.stargazerCount || repo.stargazers_count || 0})`
  );

  try {
    // Verificar se é muito antigo
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const lastUpdateStr = repo.updatedAt || repo.updated_at || null;
    const lastUpdate = lastUpdateStr ? new Date(lastUpdateStr) : null;

    if (lastUpdate && lastUpdate < oneYearAgo) {
      console.log(`   📅 Muito antigo, pulando...`);
      return null;
    }

    // Filtrar bibliotecas usando nome, descrição e topics
    if (await this.isLibraryRepository(repo)) {
      console.log(`   📚 Biblioteca/ferramenta detectada, pulando...`);
      return null;
    }

    // Verificar se é realmente uma aplicação web usando o "about"
    if (!this.isWebApplication(repo)) {
      console.log(`   ❌ Não é uma aplicação web, pulando...`);
      return null;
    }

    const foundTools = {
      AXE: false,
      Pa11y: false,
      WAVE: false,
      AChecker: false,
      Lighthouse: false,
      Asqatasun: false,
      HTML_CodeSniffer: false,
    };

    // Verificar descrição/about do repositório
    await this.checkRepositoryAbout(repo, foundTools);

    // Verificar arquivos de configuração
    await this.checkConfigFiles(owner, name, foundTools);

    // Verificar arquivos de dependências de todas as linguagens
    await this.checkDependencyFiles(owner, name, foundTools);

    // Verificar workflows do GitHub
    await this.checkWorkflows(owner, name, foundTools);

    const hasAnyTool = Object.values(foundTools).some((tool) => tool);

    if (hasAnyTool) {
      const toolsFound = Object.keys(foundTools).filter((key) => foundTools[key]);
      console.log(`   ✅ Ferramentas: ${toolsFound.join(", ")}`);

      return {
        repository: fullName,
        stars: repo.stargazerCount || repo.stargazers_count || 0,
        lastCommit: repo.updatedAt || repo.updated_at || "",
        ...foundTools,
      };
    }

    console.log(`   ❌ Nenhuma ferramenta encontrada`);
    return null;
  } catch (error) {
    console.log(`   ⚠️ Erro: ${error.message}`);
    this.stats.errors++;
    return null;
  }
}

async checkConfigFiles(owner, name, foundTools) {
  try {
    const rootContents = await this.getRepositoryContents(owner, name);

    for (const file of rootContents) {
      const fileName = file && file.name ? file.name : "";
      if (this.configFiles.includes(fileName)) {
        console.log(`     📄 Config: ${fileName}`);

        if (fileName.includes("pa11y")) foundTools["Pa11y"] = true;
        if (fileName.includes("lighthouse") || fileName.includes("lhci"))
          foundTools["Lighthouse"] = true;
        if (fileName.includes("axe")) foundTools["AXE"] = true;
        if (fileName.includes("wave")) foundTools["WAVE"] = true;
        if (fileName.includes("html_codesniffer"))
          foundTools["HTML_CodeSniffer"] = true;
      }
    }
  } catch (error) {
    // Ignorar erros de acesso
  }
}

async checkDependencyFiles(owner, name, foundTools) {
  // Arquivos de dependências por linguagem/framework
  const dependencyFiles = [
    // JavaScript/Node.js
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",

    // Python
    "requirements.txt",
    "requirements.in",
    "Pipfile",
    "Pipfile.lock",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "poetry.lock",

    // PHP
    "composer.json",
    "composer.lock",

    // Java
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "gradle.properties",

    // C# / .NET
    "packages.config",
    "project.json",
    "*.csproj",
    "*.fsproj",
    "*.vbproj",
    "Directory.Build.props",
    "Directory.Packages.props",

    // Ruby
    "Gemfile",
    "Gemfile.lock",
    "*.gemspec",

    // Go
    "go.mod",
    "go.sum",
    "Gopkg.toml",
    "Gopkg.lock",

    // Rust
    "Cargo.toml",
    "Cargo.lock",

    // Dart/Flutter
    "pubspec.yaml",
    "pubspec.lock",

    // Swift
    "Package.swift",
    "Podfile",
    "Podfile.lock",

    // Outros
    "Makefile",
    "CMakeLists.txt",
    "meson.build",
  ];

  for (const depFile of dependencyFiles) {
    try {
      // Para arquivos com wildcards (*.csproj), verificar conteúdo da pasta
      if (depFile.includes("*")) {
        const extension = depFile.replace("*", "");
        const rootContents = await this.getRepositoryContents(owner, name);

        for (const file of rootContents) {
          const fileName = file && file.name ? file.name : "";
          if (fileName.endsWith(extension)) {
            const content = await this.getFileContent(owner, name, fileName);
            if (content) {
              console.log(`     📄 Analisando ${fileName}`);
              this.searchToolsInContent(content, foundTools);
            }
          }
        }
      } else {
        const content = await this.getFileContent(owner, name, depFile);
        if (content) {
          console.log(`     📦 Analisando ${depFile}`);
          this.searchToolsInContent(content, foundTools);
        }
      }
    } catch (error) {
      // Ignorar arquivos inexistentes
    }
  }
}

async checkWorkflows(owner, name, foundTools) {
  try {
    const workflows = await this.getRepositoryContents(
      owner,
      name,
      ".github/workflows"
    );

    for (const workflow of workflows) {
      const workflowName = (workflow && workflow.name) || "";
      if (workflowName.endsWith(".yml") || workflowName.endsWith(".yaml")) {
        const content = await this.getFileContent(owner, name, workflow.path);
        if (content) {
          console.log(`     ⚙️ Workflow: ${workflowName}`);
          this.searchToolsInContent(content, foundTools);
        }
      }
    }
  } catch (error) {
    // Ignorar se não tiver workflows
  }
}

searchToolsInContent(content, foundTools) {
  const contentLower = (content || "").toLowerCase();

  for (const [toolName, keywords] of Object.entries(this.accessibilityTools)) {
    if (!foundTools[toolName]) {
      for (const keyword of keywords) {
        if (contentLower.includes((keyword || "").toLowerCase())) {
          foundTools[toolName] = true;
          console.log(`       🎯 ${toolName} via: ${keyword}`);
          break;
        }
      }
    }
  }
}

appendToCSV(repositories) {
  if (repositories.length === 0) return;

  const csvLines = repositories.map((repo) => {
    return [
      repo.repository,
      repo.stars,
      repo.lastCommit,
      repo.AXE,
      repo.Pa11y,
      repo.WAVE,
      repo.AChecker,
      repo.Lighthouse,
      repo.Asqatasun,
      repo.HTML_CodeSniffer,
    ].join(",");
  });

  fs.appendFileSync(this.csvFile, csvLines.join("\n") + "\n");
  console.log(`💾 ${repositories.length} repositórios salvos no CSV`);
}

shouldContinueRunning() {
  // GitHub Actions controla o timeout automaticamente
  // Apenas continua executando até ser interrompido
  return true;
}

printProgress() {
  const elapsed = Date.now() - this.startTime;
  const hours = Math.floor(elapsed / (1000 * 60 * 60));
  const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));

  console.log(`\n📊 PROGRESSO ATUAL:`);
  console.log(`⏱️  Tempo decorrido: ${hours}h ${minutes}m`);
  console.log(`🔬 Repositórios analisados: ${this.stats.analyzed}`);
  console.log(`💾 Repositórios salvos: ${this.stats.saved}`);
  console.log(`⏭️  Repositórios pulados: ${this.stats.skipped}`);
  console.log(`❌ Erros: ${this.stats.errors}`);
  console.log(
    `📈 Taxa de sucesso: ${(
      (this.stats.saved / Math.max(this.stats.analyzed, 1)) *
      100
    ).toFixed(1)}%`
  );
  console.log(`🗃️  Total processados: ${this.processedRepos.size}\n`);
}

async run() {
  console.log("🚀 GITHUB ACCESSIBILITY MINER - EXECUÇÃO CONTÍNUA");
  console.log(`🔑 Token configurado: ${this.token ? "✅" : "❌"}`);
  console.log(`📊 Repositórios já processados: ${this.processedRepos.size}`);
  console.log(`⏰ Timeout controlado pelo GitHub Actions (35791 minutos)\n`);

  const queries = [
    // Termos gerais de aplicação web
    "web application",
    "webapp",
    "web app",
    "website application",
    "web platform",
    "web portal",
    "online application",
    "web based application",
    "web service",
    "fullstack application",
    "frontend application",
    "single page application",

    // Tipos de aplicação por função
    "dashboard application",
    "admin panel",
    "management system",
    "control panel",
    "monitoring dashboard",
    "analytics dashboard",

    // E-commerce e vendas
    "ecommerce application",
    "online store",
    "shopping application",
    "marketplace application",
    "retail application",

    // Sistemas de gestão
    "crm application",
    "erp application",
    "cms application",
    "content management",
    "project management",
    "task management",

    // Aplicações sociais e comunicação
    "social application",
    "chat application",
    "messaging application",
    "forum application",
    "community platform",

    // Aplicações de conteúdo
    "blog application",
    "news application",
    "media application",
    "publishing platform",
    "content platform",

    // Aplicações de negócio
    "saas application",
    "business application",
    "enterprise application",
    "corporate application",
    "professional application",

    // Aplicações educacionais e pessoais
    "learning platform",
    "education application",
    "portfolio application",
    "personal application",
    "productivity application",

    // Aplicações específicas populares
    "todo application",
    "calendar application",
    "booking application",
    "reservation system",
    "inventory system",
    "helpdesk application",
    "ticketing system",
    "survey application",
    "form application",
    "gallery application",
  ];

  const foundRepos = [];
  let queryIndex = 0;

  // Loop contínuo até acabar o tempo
  while (this.shouldContinueRunning()) {
    try {
      const query = queries[queryIndex % queries.length];
      console.log(`\n🔍 Consulta: "${query}"`);

      // Usar cursor-based pagination (GraphQL)
      let cursor = null;
      let pageCount = 0;

      do {
        pageCount++;
        console.log(
          `   📄 Página ${pageCount}${cursor ? ` - Cursor: ${String(cursor).substring(0, 10)}...` : ""}`
        );

        const searchResult = await this.searchRepositories(query, cursor);

        if (!searchResult.items || searchResult.items.length === 0) {
          console.log(`   📭 Sem resultados nesta página.`);
          break;
        }

        for (const repo of searchResult.items) {
          if (!this.shouldContinueRunning()) break;

          this.stats.analyzed++;

          // Normalizar identificador do repositório para controle
          const repoId =
            repo.nameWithOwner || repo.full_name || `${(repo.owner && repo.owner.login) || ""}/${repo.name || ""}`;

          if (this.processedRepos.has(repoId)) {
            this.stats.skipped++;
            continue;
          }

          const analysis = await this.analyzeRepository(repo);

          if (analysis) {
            foundRepos.push(analysis);
            this.stats.saved++;

            // Salvar em lotes de 5
            if (foundRepos.length >= 5) {
              this.appendToCSV(foundRepos);
              foundRepos.forEach((r) => this.processedRepos.add(r.repository));
              this.saveProcessedRepos();
              foundRepos.length = 0;
            }
          }

          this.processedRepos.add(repoId);

          // Mostrar progresso a cada 50 repositórios
          if (this.stats.analyzed % 50 === 0) {
            this.printProgress();
          }

          // Pausa pequena entre repositórios
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Decidir se vamos para a próxima página (cursor)
        if (
          searchResult.pageInfo &&
          searchResult.pageInfo.hasNextPage &&
          pageCount < 10
        ) {
          cursor = searchResult.pageInfo.endCursor;
          // pequena pausa entre páginas
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          cursor = null; // encerra o loop de páginas para essa query
        }
      } while (cursor && this.shouldContinueRunning());

      // Avança para próxima query
      queryIndex++;
      // pequena pausa entre queries
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`❌ Erro na execução: ${error.message}`);

      if (error.message.includes("rate limit")) {
        console.log(`⏳ Rate limit atingido, aguardando 10 minutos...`);
        await new Promise((resolve) => setTimeout(resolve, 20000));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      this.stats.errors++;
    }
  }

  // Salvar repositórios restantes
  if (foundRepos.length > 0) {
    this.appendToCSV(foundRepos);
    foundRepos.forEach((r) => this.processedRepos.add(r.repository));
  }

  this.saveProcessedRepos();

  // Relatório final (só executa se o script terminar naturalmente, não por timeout)
  console.log(`\n🎉 EXECUÇÃO FINALIZADA NATURALMENTE!`);
  this.printProgress();
  console.log(`📄 Arquivo CSV: ${this.csvFile}`);
  console.log(`🗃️  Arquivo de controle: ${this.processedReposFile}`);
  console.log(`\n💡 Nota: Se foi interrompido por timeout do GitHub Actions, isso é normal!`);
}
}

// Executar
const miner = new GitHubAccessibilityMiner();
miner.run().catch((error) => {
console.error("💥 Erro fatal:", error);
process.exit(1);
});
