const fs = require('fs');
const { execSync, spawn } = require('child_process');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

/**
* WCAG 2.2 - Total de critérios de sucesso
* Fonte: W3C Web Content Accessibility Guidelines (WCAG) 2.2
* https://www.w3.org/WAI/standards-guidelines/wcag/
*
* Total de critérios WCAG 2.2 = 58
*
* Cobertura automatizável (~44%) segundo Abu Doush et al. (2023):
* "apenas cerca de 44% dos critérios de acessibilidade estabelecidos pela WCAG 2.1
* podem ser totalmente automatizados com tecnologias padrão"
*
* Esse fator é mantido para WCAG 2.2 por similaridade, mas idealmente deveria ser recalculado
* com base em um mapeamento atualizado dos critérios 2.2.
*/
const WCAG_TOTAL_CRITERIA = 58;
const WCAG_AUTOMATIZAVEL = Math.round(WCAG_TOTAL_CRITERIA * 0.44); // ~26 critérios

// ----------------------
// Lógica de múltiplos tokens (igual ao minerador)
// ----------------------
const tokens = [
 process.env.TOKEN_1,
 process.env.TOKEN_2,
 process.env.TOKEN_3
].filter(Boolean);

let tokenIndex = 0;
let token = tokens[0];
let tokenLimits = Array(tokens.length).fill(null);

function nextToken() {
 tokenIndex = (tokenIndex + 1) % tokens.length;
 token = tokens[tokenIndex];
}

function switchTokenIfNeeded(rateLimit) {
 if (rateLimit !== null && rateLimit <= 0) {
   let startIndex = tokenIndex;
   let found = false;
   for (let i = 1; i <= tokens.length; i++) {
     let nextIndex = (startIndex + i) % tokens.length;
     if (!tokenLimits[nextIndex] || tokenLimits[nextIndex] > 0) {
       tokenIndex = nextIndex;
       token = tokens[tokenIndex];
       found = true;
       break;
     }
   }
   if (!found) {
     console.log('⏳ Todos os tokens atingiram o rate limit. Aguardando reset...');
   }
 }
}

async function makeRestRequest(url) {
 const options = {
   headers: {
     "User-Agent": "GitHub-Accessibility-Runner",
     Accept: "application/vnd.github.v3+json",
     Authorization: `token ${token}`,
   },
   timeout: 20000,
 };

 const response = await fetch(url, options);
 const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
 const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));
 tokenLimits[tokenIndex] = rateLimit;

 if (rateLimit < 50 && tokens.length > 1) {
   nextToken();
   tokenLimits[tokenIndex] = null;
   console.log(`🔄 Trocando para o próximo token (REST), rate limit baixo: ${rateLimit}`);
 }

 switchTokenIfNeeded(rateLimit);

 if (rateLimit < 50 && tokens.length <= 1) {
   const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 0);
   console.log(`⏳ Rate limit REST baixo (${rateLimit}), aguardando ${Math.ceil(waitTime / 1000)}s...`);
   await new Promise((resolve) => setTimeout(resolve, waitTime));
 }

 return await response.json();
}

// ----------------------
// Funções AXE
// ----------------------
function classifyByLevel(errors, extractor) {
let nivelA = 0, nivelAA = 0, nivelAAA = 0, indefinido = 0;
errors.forEach(err => {
  const level = extractor(err);
  if (!level) {
    indefinido++;
  } else if (level.includes('wcag2a') || level.includes('Level A')) {
    nivelA++;
  } else if (level.includes('wcag2aa') || level.includes('Level AA')) {
    nivelAA++;
  } else if (level.includes('wcag2aaa') || level.includes('Level AAA')) {
    nivelAAA++;
  } else {
    indefinido++;
  }
});
return { nivelA, nivelAA, nivelAAA, indefinido };
}

async function runAxe(url) {
console.log(`🚀 Iniciando AXE em ${url}`);
try {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  const axeSource = fs.readFileSync(require.resolve('axe-core'), 'utf8');
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => await axe.run());

  const confirmedViolations = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  const warnings = results.violations.filter(v => v.impact === 'moderate' || v.impact === 'minor');

  const levels = classifyByLevel(confirmedViolations, v => v.tags.join(' '));

  await browser.close();
  return {
    violacoes: confirmedViolations.length,
    warnings: warnings.length,
    erros: confirmedViolations.map(v => v.id),
    ...levels
  };
} catch (err) {
  console.error(`❌ Erro no AXE/Puppeteer: ${err.message}`);
  return null;
}
}

// ----------------------
// Buscar homepage usando API com lógica de tokens
// ----------------------
async function getHomepage(repoFullName) {
 try {
   const data = await makeRestRequest(`https://api.github.com/repos/${repoFullName}`);
   return data.homepage || null;
 } catch (err) {
   console.error(`❌ Erro ao buscar homepage: ${err.message}`);
   return null;
 }
}

// ----------------------
// Detectar linguagem e rodar localmente
// ----------------------
function detectLanguage(repoPath) {
if (fs.existsSync(`${repoPath}/package.json`)) return 'node';
if (fs.existsSync(`${repoPath}/requirements.txt`)) return 'python';
if (fs.existsSync(`${repoPath}/composer.json`)) return 'php';
if (fs.existsSync(`${repoPath}/pom.xml`)) return 'java-maven';
if (fs.existsSync(`${repoPath}/build.gradle`)) return 'java-gradle';
return 'unknown';
}

function startServer(repoPath, lang) {
try {
  switch (lang) {
    case 'node':
      execSync('npm install', { cwd: repoPath, stdio: 'inherit' });
      return spawn('npm', ['start'], { cwd: repoPath, stdio: 'inherit' });
    case 'python':
      execSync('pip install -r requirements.txt', { cwd: repoPath, stdio: 'inherit' });
      return spawn('python', ['app.py'], { cwd: repoPath, stdio: 'inherit' });
    case 'php':
      execSync('composer install', { cwd: repoPath, stdio: 'inherit' });
      return spawn('php', ['-S', 'localhost:8080', '-t', 'public'], { cwd: repoPath, stdio: 'inherit' });
    case 'java-maven':
      execSync('mvn install', { cwd: repoPath, stdio: 'inherit' });
      return spawn('mvn', ['spring-boot:run'], { cwd: repoPath, stdio: 'inherit' });
    case 'java-gradle':
      execSync('./gradlew build', { cwd: repoPath, stdio: 'inherit' });
      return spawn('./gradlew', ['bootRun'], { cwd: repoPath, stdio: 'inherit' });
    default:
      console.error('⚠️ Linguagem desconhecida, não foi possível iniciar servidor.');
      return null;
  }
} catch (err) {
  console.error(`❌ Erro ao iniciar servidor: ${err.message}`);
  return null;
}
}

// ----------------------
// Salvar CSV
// ----------------------
async function saveCsv(results) {
const csvWriter = createCsvWriter({
  path: 'resultados_acessibilidade.csv',
  header: [
    { id: 'repositorio', title: 'Repositorio' },
    { id: 'metodo', title: 'Metodo' },
    { id: 'status', title: 'Status' },
    { id: 'violacoes_total', title: 'ViolacoesTotal' },
    { id: 'warnings_total', title: 'WarningsTotal' },
    { id: 'violacoes_A', title: 'ViolacoesA' },
    { id: 'violacoes_AA', title: 'ViolacoesAA' },
    { id: 'violacoes_AAA', title: 'ViolacoesAAA' },
    { id: 'violacoes_indefinido', title: 'ViolacoesIndefinido' },
    { id: 'criterios_total', title: 'WCAG_CriteriosTotal' },
    { id: 'criterios_automatizaveis', title: 'WCAG_CriteriosAutomatizaveis' },
    { id: 'cer', title: 'CER' },
    { id: 'taxa_sucesso_acessibilidade', title: 'TaxaSucessoAcessibilidade' }
  ]
});
await csvWriter.writeRecords(results);
console.log('📄 Resultados salvos em resultados_acessibilidade.csv');
}

// ----------------------
// Execução principal
// ----------------------
(async () => {
const reposData = JSON.parse(fs.readFileSync('repositorios.json', 'utf8'));
const results = [];
const toolErrorsMap = {};

for (const repo of reposData) {
  const repoName = repo["Repositório"];
  let metodo = '';
  let res = null;

  // Primeira tentativa: homepage
  const homepage = await getHomepage(repoName);
  if (homepage) {
    metodo = 'homepage';
    res = await runAxe(homepage);
  }

  // Segunda tentativa: clonar e rodar
  if (!res) {
    metodo = 'clonado';
    const repoPath = `./temp/${repoName.replace('/', '_')}`;
    try {
      execSync(`git clone --depth=1 https://github.com/${repoName}.git ${repoPath}`, { stdio: 'inherit' });
      const lang = detectLanguage(repoPath);
      const server = startServer(repoPath, lang);
      if (server) {
        await new Promise(r => setTimeout(r, 15000));
        res = await runAxe('http://localhost:8080');
        server.kill();
      }
    } catch (err) {
      console.error(`❌ Erro ao clonar/rodar ${repoName}: ${err.message}`);
    }
  }

  if (!res) {
    metodo = metodo || 'falhou';
    results.push({
      repositorio: repoName,
      metodo,
      status: 'FAIL',
      violacoes_total: null,
      warnings_total: null,
      violacoes_A: null,
      violacoes_AA: null,
      violacoes_AAA: null,
      violacoes_indefinido: null,
      criterios_total: WCAG_TOTAL_CRITERIA,
      criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
      cer: null,
      taxa_sucesso_acessibilidade: null
    });
    continue;
  }

  toolErrorsMap['AXE'] = new Set(res.erros);

  results.push({
    repositorio: repoName,
    metodo,
    status: 'OK',
    violacoes_total: res.violacoes,
    warnings_total: res.warnings,
    violacoes_A: res.nivelA,
    violacoes_AA: res.nivelAA,
    violacoes_AAA: res.nivelAAA,
    violacoes_indefinido: res.indefinido,
    criterios_total: WCAG_TOTAL_CRITERIA,
    criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
    cer: 0,
    taxa_sucesso_acessibilidade: ((WCAG_AUTOMATIZAVEL - res.violacoes) / WCAG_AUTOMATIZAVEL).toFixed(2)
  });
}

// Cálculo CER
const allErrorsGlobal = new Set();
Object.values(toolErrorsMap).forEach(set => {
  set.forEach(err => allErrorsGlobal.add(err));
});

results.forEach(r => {
  if (r.status === 'OK' && allErrorsGlobal.size > 0) {
    const toolSet = toolErrorsMap['AXE'] || new Set();
    r.cer = (toolSet.size / allErrorsGlobal.size).toFixed(2);
  }
});

await saveCsv(results);
})();
