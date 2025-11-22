const fetch = require("node-fetch");
const fs = require("fs");

class GitHubNoToolMiner {
constructor() {
  this.tokens = [
    process.env.TOKEN_1,
    process.env.TOKEN_2,
    process.env.TOKEN_3,
  ].filter(Boolean);

  if (this.tokens.length === 0) {
    throw new Error("Nenhuma chave da API do GitHub foi encontrada nas variáveis de ambiente (TOKEN_1, TOKEN_2, etc.)");
  }

  this.tokenIndex = 0;
  this.token = this.tokens[0];
  this.graphqlUrl = "https://api.github.com/graphql";
  this.restUrl = "https://api.github.com";

  // Arquivos de controle e saída
  this.outputCsvFile = "repositorios_sem_ferramentas.csv";
  this.processedReposFile = "processed_repos_no_tool.json";
  this.processedRepos = this.loadProcessedRepos();
  
  this.perPage = 100; // GraphQL permite até 100
  this.startTime = Date.now();
  this.maxRunMillis = (5 * 60 + 50) * 60 * 1000; // 5h50min para ter margem de segurança
  this.timeoutTriggered = false;

  // Definições das ferramentas para busca
  this.accessibilityTools = {
    AXE: ["axe-core", "react-axe", "cypress-axe", "jest-axe", "axe-playwright", "axe-selenium-python"],
    Pa11y: ["pa11y", "pa11y-ci"],
    WAVE: ["wave-cli", "wave-accessibility", "webaim-wave"],
    AChecker: ["achecker", "accessibility-checker", "ibma/equal-access"],
    Lighthouse: ["lighthouse", "lighthouse-ci", "lhci", "lighthouse-ci-action"],
    HTML_CodeSniffer: ["html_codesniffer", "htmlcs", "squizlabs/html_codesniffer"],
  };
  
  this.initializeCSV();
}

initializeCSV() {
  if (!fs.existsSync(this.outputCsvFile)) {
    const headers = "Repositorio,Numero de Estrelas,Ultimo Commit,Linguagem Principal\n";
    fs.writeFileSync(this.outputCsvFile, headers);
  }
}

loadProcessedRepos() {
  try {
    if (fs.existsSync(this.processedReposFile)) {
      const data = JSON.parse(fs.readFileSync(this.processedReposFile, "utf8"));
      console.log(`📋 Carregados ${data.length} repositórios já processados.`);
      return new Set(data);
    }
  } catch (error) { console.warn(`⚠️ Erro ao carregar repositórios processados: ${error.message}`); }
  return new Set();
}

saveProcessedRepos() {
  try {
    fs.writeFileSync(this.processedReposFile, JSON.stringify([...this.processedRepos]));
  } catch (error) { console.warn(`⚠️ Erro ao salvar repositórios processados: ${error.message}`); }
}

nextToken() {
  this.tokenIndex = (this.tokenIndex + 1) % this.tokens.length;
  this.token = this.tokens[this.tokenIndex];
  console.log(`🔄 Trocando para o token de índice ${this.tokenIndex}`);
}

async makeGraphQLRequest(query, variables = {}) {
   // ... (copie a função makeGraphQLRequest do seu script original aqui, pois ela já está correta e robusta)
   // Para ser autônomo, uma versão simplificada:
   const options = {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ query, variables }),
   };
   const response = await fetch(this.graphqlUrl, options);
   if (response.status === 403) {
      console.warn("⏳ Rate limit GraphQL atingido, trocando de token...");
      this.nextToken();
      return this.makeGraphQLRequest(query, variables); // Tenta novamente com o novo token
   }
   if (!response.ok) throw new Error(`Erro GraphQL: ${response.statusText}`);
   const result = await response.json();
   if (result.errors) throw new Error(`Erro na query GraphQL: ${JSON.stringify(result.errors)}`);
   return result.data;
}

async getFileContent(owner, repo, filePath) {
  const url = `${this.restUrl}/repos/${owner}/${repo}/contents/${filePath}`;
  try {
      const response = await fetch(url, { headers: { Authorization: `token ${this.token}` } });
      if (response.status === 404) return null; // Arquivo não encontrado
      if (!response.ok) return null; // Outros erros
      const data = await response.json();
      if (data && data.content) {
          return Buffer.from(data.content, 'base64').toString('utf8');
      }
  } catch (e) { /* ignora */ }
  return null;
}

searchToolsInContent(content, foundTools) {
  const contentLower = (content || "").toLowerCase();
  for (const [toolName, keywords] of Object.entries(this.accessibilityTools)) {
      if (keywords.some(keyword => contentLower.includes(keyword.toLowerCase()))) {
          foundTools[toolName] = true;
      }
  }
}

async checkForTools(repoFullName) {
  const [owner, repoName] = repoFullName.split('/');
  const foundTools = Object.fromEntries(Object.keys(this.accessibilityTools).map(key => [key, false]));

  const filesToCheck = ['package.json', '.github/workflows/main.yml', '.github/workflows/ci.yml', 'composer.json', 'pom.xml', 'requirements.txt'];

  for (const filePath of filesToCheck) {
      const content = await this.getFileContent(owner, repoName, filePath);
      if (content) {
          this.searchToolsInContent(content, foundTools);
      }
      // Para não exceder o rate limit da API REST rapidamente
      await new Promise(resolve => setTimeout(resolve, 200)); 
  }
  
  return foundTools;
}

async run() {
  console.log("🚀 MINERADOR DE REPOSITÓRIOS POPULARES SEM FERRAMENTAS");
  console.log("=".repeat(70));
  
  const timer = setTimeout(() => { this.timeoutTriggered = true; }, this.maxRunMillis);
  
  const queries = ["stars:>1000", "stars:500..1000"]; // Foco em repositórios populares

  for (const query of queries) {
    if (this.timeoutTriggered) break;

    let cursor = null;
    let hasNextPage = true;
    let pageCount = 0;

    while (hasNextPage && pageCount < 10 && !this.timeoutTriggered) { // Limita a 10 páginas por query
      pageCount++;
      const graphqlQuery = `
        query Search($query: String!, $after: String) {
          search(query: $query, type: REPOSITORY, first: ${this.perPage}, after: $after) {
            repositoryCount
            pageInfo { hasNextPage endCursor }
            nodes { ... on Repository { nameWithOwner, stargazerCount, pushedAt, language: primaryLanguage { name } } }
          }
        }`;

      try {
        const data = await this.makeGraphQLRequest(graphqlQuery, { query: `${query} sort:stars-desc`, after: cursor });
        const repos = data.search.nodes;

        for (const repo of repos) {
          if (this.timeoutTriggered) break;
          if (!repo || !repo.nameWithOwner || this.processedRepos.has(repo.nameWithOwner)) continue;

          const tools = await this.checkForTools(repo.nameWithOwner);
          const hasAnyTool = Object.values(tools).some(found => found);

          if (!hasAnyTool) {
            console.log(`✅ [SEM FERRAMENTAS] ${repo.nameWithOwner} (⭐ ${repo.stargazerCount})`);
            const record = [
                `"${repo.nameWithOwner}"`,
                repo.stargazerCount,
                repo.pushedAt,
                repo.language ? repo.language.name : 'N/A'
            ].join(',');
            fs.appendFileSync(this.outputCsvFile, record + '\n');
          } else {
            console.log(`- [COM FERRAMENTAS] Ignorando ${repo.nameWithOwner}`);
          }

          this.processedRepos.add(repo.nameWithOwner);
        }

        hasNextPage = data.search.pageInfo.hasNextPage;
        cursor = data.search.pageInfo.endCursor;

      } catch (error) {
        console.error(`❌ Erro durante a busca: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Pausa longa em caso de erro
      }
    }
  }
  
  clearTimeout(timer);
  this.saveProcessedRepos();
  console.log("\n🎉 Mineração concluída!");
}
}

// Execução
(async () => {
try {
  const miner = new GitHubNoToolMiner();
  await miner.run();
} catch (e) {
  console.error("💥 Erro fatal no script:", e.message);
  process.exit(1);
}
})();
