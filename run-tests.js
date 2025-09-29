const fs = require('fs');
const csv = require('csv-parser');
const fetch = require('node-fetch');
const { execSync, spawn } = require('child_process');
const puppeteer = require('puppeteer');
const path = require('path');
const detectPort = require('detect-port');
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
const WCAG_AUTOMATIZAVEL = Math.round(WCAG_TOTAL_CRITERIA * 0.44); // ≈ 26 critérios

// === Configuração de múltiplos tokens ===
const tokens = [
 process.env.TOKEN_1,
 process.env.TOKEN_2,
 process.env.TOKEN_3
].filter(Boolean);

let tokenIndex = 0;
let tokenLimits = Array(tokens.length).fill(null);

function nextToken() {
 tokenIndex = (tokenIndex + 1) % tokens.length;
}

function switchTokenIfNeeded(rateLimit) {
 if (rateLimit !== null && rateLimit <= 0) {
   let startIndex = tokenIndex;
   let found = false;
   for (let i = 1; i <= tokens.length; i++) {
     let nextIndex = (startIndex + i) % tokens.length;
     if (!tokenLimits[nextIndex] || tokenLimits[nextIndex] > 0) {
       tokenIndex = nextIndex;
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
     'User-Agent': 'GitHub-Accessibility-AXE',
     Accept: 'application/vnd.github.v3+json',
     Authorization: `token ${tokens[tokenIndex]}`
   },
   timeout: 20000
 };

 const response = await fetch(url, options);
 const rateLimit = parseInt(response.headers.get('x-ratelimit-remaining'));
 const resetTime = parseInt(response.headers.get('x-ratelimit-reset'));
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
   await new Promise(resolve => setTimeout(resolve, waitTime));
 }

 return await response.json();
}

async function getHomepageFromGitHub(repoName) {
 try {
   const data = await makeRestRequest(`https://api.github.com/repos/${repoName}`);
   if (data && data.homepage && data.homepage.trim() !== '') {
     return data.homepage.trim();
   }
   return null;
 } catch (err) {
   console.error(`❌ Erro ao consultar API GitHub para ${repoName}: ${err.message}`);
   return null;
 }
}

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
}

function detectLanguageAndStartCommand(repoPath) {
 if (fs.existsSync(path.join(repoPath, 'package.json'))) {
   const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
   if (pkg.scripts && pkg.scripts.start) {
     return { cmd: 'npm start', port: detectPortFromFiles(repoPath) || 3000 };
   }
   if (pkg.scripts && pkg.scripts.dev) {
     return { cmd: 'npm run dev', port: detectPortFromFiles(repoPath) || 3000 };
   }
 }
 if (fs.existsSync(path.join(repoPath, 'manage.py'))) {
   return { cmd: 'python manage.py runserver', port: 8000 };
 }
 if (fs.existsSync(path.join(repoPath, 'composer.json'))) {
   return { cmd: 'php artisan serve', port: 8000 };
 }
 if (fs.existsSync(path.join(repoPath, 'pom.xml'))) {
   return { cmd: './mvnw spring-boot:run', port: 8080 };
 }
 return null;
}

function detectPortFromFiles(repoPath) {
 const envPath = path.join(repoPath, '.env');
 if (fs.existsSync(envPath)) {
   const envContent = fs.readFileSync(envPath, 'utf8');
   const match = envContent.match(/PORT\s*=\s*(\d+)/i);
   if (match) return parseInt(match[1], 10);
 }
 const pkgPath = path.join(repoPath, 'package.json');
 if (fs.existsSync(pkgPath)) {
   const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
   if (pkg.scripts && pkg.scripts.start) {
     const match = pkg.scripts.start.match(/PORT\s*=\s*(\d+)/i) || pkg.scripts.start.match(/--port\s+(\d+)/i);
     if (match) return parseInt(match[1], 10);
   }
 }
 return null;
}

async function saveCsv(results) {
 const csvWriter = createCsvWriter({
   path: 'resultados_acessibilidade.csv',
   header: [
     { id: 'repositorio', title: 'Repositorio' },
     { id: 'status', title: 'Status' },
     { id: 'metodo_execucao', title: 'MetodoExecucao' },
     { id: 'motivo_fail', title: 'MotivoFail' },
     { id: 'violacoes_total', title: 'ViolacoesTotal' },
     { id: 'warnings_total', title: 'WarningsTotal' },
     { id: 'violacoes_A', title: 'ViolacoesA' },
     { id: 'violacoes_AA', title: 'ViolacoesAA' },
     { id: 'violacoes_AAA', title: 'ViolacoesAAA' },
     { id: 'violacoes_indefinido', title: 'ViolacoesIndefinido' },
     { id: 'criterios_total', title: 'WCAG_CriteriosTotal' },
     { id: 'criterios_automatizaveis', title: 'WCAG_CriteriosAutomatizaveis' },
     { id: 'taxa_sucesso_acessibilidade', title: 'TaxaSucessoAcessibilidade' }
   ]
 });
 await csvWriter.writeRecords(results);
 console.log('📄 Resultados salvos em resultados_acessibilidade.csv');
}

(async () => {
 const repos = [];
 fs.createReadStream('filtrados.csv')
   .pipe(csv({ separator: '|', mapHeaders: ({ header }) => header.trim() }))
   .on('data', (row) => {
     if (row['AXE'] && row['AXE'].trim() === 'true') {
       repos.push(row['Repositório'].trim());
     }
   })
   .on('end', async () => {
     console.log(`📊 Total de repositórios para testar: ${repos.length}`);
     const results = [];

     for (const repoName of repos) {
       console.log(`🔍 Processando ${repoName}`);
       let metodo_execucao = 'FAIL';
       let motivo_fail = '';

       try {
         let urlApp = await getHomepageFromGitHub(repoName);

         if (urlApp) {
           metodo_execucao = 'URL';
           const res = await runAxe(urlApp);
           results.push({
             repositorio: repoName,
             status: 'OK',
             metodo_execucao,
             motivo_fail: '',
             violacoes_total: res.violacoes,
             warnings_total: res.warnings,
             violacoes_A: res.nivelA,
             violacoes_AA: res.nivelAA,
             violacoes_AAA: res.nivelAAA,
             violacoes_indefinido: res.indefinido,
             criterios_total: WCAG_TOTAL_CRITERIA,
             criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
             taxa_sucesso_acessibilidade: ((WCAG_AUTOMATIZAVEL - res.violacoes) / WCAG_AUTOMATIZAVEL).toFixed(2)
           });
           continue;
         }

         console.log(`📥 Clonando ${repoName}...`);
         execSync(`rm -rf target-repo && git clone --depth=1 https://github.com/${repoName}.git target-repo`, { stdio: 'inherit' });
         const repoPath = path.join(process.cwd(), 'target-repo');
         const startInfo = detectLanguageAndStartCommand(repoPath);

         if (!startInfo) throw new Error('Não foi possível detectar linguagem/comando de start');

         console.log(`🚀 Iniciando servidor: ${startInfo.cmd}`);
         const server = spawn(startInfo.cmd, { shell: true, cwd: repoPath, stdio: 'inherit' });
         await new Promise(resolve => setTimeout(resolve, 15000));

         urlApp = `http://localhost:${startInfo.port}`;
         metodo_execucao = 'Clonagem';
         const res = await runAxe(urlApp);

         results.push({
           repositorio: repoName,
           status: 'OK',
           metodo_execucao,
           motivo_fail: '',
           violacoes_total: res.violacoes,
           warnings_total: res.warnings,
           violacoes_A: res.nivelA,
           violacoes_AA: res.nivelAA,
           violacoes_AAA: res.nivelAAA,
           violacoes_indefinido: res.indefinido,
           criterios_total: WCAG_TOTAL_CRITERIA,
           criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
           taxa_sucesso_acessibilidade: ((WCAG_AUTOMATIZAVEL - res.violacoes) / WCAG_AUTOMATIZAVEL).toFixed(2)
         });

         server.kill();
       } catch (err) {
         console.error(`❌ Falha em ${repoName}: ${err.message}`);
         results.push({
           repositorio: repoName,
           status: 'FAIL',
           metodo_execucao,
           motivo_fail: err.message,
           violacoes_total: null,
           warnings_total: null,
           violacoes_A: null,
           violacoes_AA: null,
           violacoes_AAA: null,
           violacoes_indefinido: null,
           criterios_total: WCAG_TOTAL_CRITERIA,
           criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
           taxa_sucesso_acessibilidade: null
         });
       }
     }

     await saveCsv(results);
   });
})();
