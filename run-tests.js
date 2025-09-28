const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fetch = require('node-fetch');
const detectPort = require('detect-port');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const repoName = process.argv[2];
let urlApp = process.argv[3];
const tools = process.argv[4].split(',').map(t => t.trim());

const WCAG_TOTAL_CRITERIA = 50;
const WCAG_AUTOMATIZAVEL = Math.round(WCAG_TOTAL_CRITERIA * 0.44);

function saveRawResult(filename, content) {
fs.writeFileSync(filename, content);
console.log(`Resultado bruto salvo em: ${filename}`);
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

async function detectLocalUrl() {
const portasComuns = [3000, 5000, 8080];
for (const porta of portasComuns) {
  const livre = await detectPort(porta);
  if (livre !== porta) {
    return `http://localhost:${porta}`;
  }
}
return null;
}

function detectPortFromEnv(repoPath) {
const envPath = path.join(repoPath, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/PORT\s*=\s*(\d+)/i);
  if (match) return parseInt(match[1], 10);
}
return null;
}

function detectPortFromPackageJson(repoPath) {
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

async function runAxe(url) {
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle2' });
const axeSource = fs.readFileSync(require.resolve('axe-core'), 'utf8');
await page.evaluate(axeSource);
const results = await page.evaluate(async () => await axe.run());
await browser.close();
const levels = classifyByLevel(results.violations, v => v.tags.join(' '));
return { violacoes: results.violations.length, erros: results.violations.map(v => v.id), ...levels };
}

async function runLighthouse(url) {
execSync(`npx lighthouse ${url} --quiet --output=json --output-path=lh.json --output=html --output-path=lh.html`, { stdio: 'inherit' });
const lhJson = fs.readFileSync('lh.json', 'utf8');
const lhHtml = fs.readFileSync('lh.html', 'utf8');

saveRawResult(`lighthouse-result-${repoName}.json`, lhJson);
saveRawResult(`lighthouse-result-${repoName}.html`, lhHtml);

const lh = JSON.parse(lhJson);
const failed = Object.values(lh.audits).filter(a => a.score === 0);
const levels = classifyByLevel(failed, a => a.description || '');
return { violacoes: failed.length, erros: failed.map(a => a.id), ...levels };
}

async function runWaveExtension(url) {
const browser = await puppeteer.launch({
  headless: false,
  args: [
    `--disable-extensions-except=${process.cwd()}/wave-extension`,
    `--load-extension=${process.cwd()}/wave-extension`
  ]
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle2' });

const htmlContent = await page.content();
saveRawResult(`wave-result-${repoName}.html`, htmlContent);

await page.waitForSelector('#wave5errors', { timeout: 15000 }).catch(() => {});
const errorsCount = await page.evaluate(() => {
  const el = document.querySelector('#wave5errors');
  return el ? parseInt(el.textContent, 10) : null;
});

const levels = { nivelA: 0, nivelAA: 0, nivelAAA: 0, indefinido: errorsCount ?? 0 };
await browser.close();
return { violacoes: errorsCount ?? 0, erros: [], ...levels };
}

async function runACheckerLocal(url) {
const res = await fetch(`http://localhost:8000/checkacc.php?uri=${encodeURIComponent(url)}&output=json`);
const data = await res.json();
const levels = classifyByLevel(data.resultset || [], e => e.guideline || '');
return { violacoes: data.summary.NumOfErrors, erros: data.resultset?.map(e => e.error_id) || [], ...levels };
}

(async () => {
const results = [];
const allErrorsSet = new Set();

if (!urlApp) {
  console.log("Detectando porta local...");
  let localUrl = await detectLocalUrl();
  if (!localUrl) {
    console.log("Nenhuma porta padrão detectada, tentando ler .env e package.json...");
    const repoPath = path.join(process.cwd(), 'target-repo');
    let portaEnv = detectPortFromEnv(repoPath);
    let portaPkg = detectPortFromPackageJson(repoPath);
    const portaCustom = portaEnv || portaPkg;
    if (portaCustom) localUrl = `http://localhost:${portaCustom}`;
  }
  if (localUrl) {
    console.log(`Servidor detectado em ${localUrl}`);
    urlApp = localUrl;
  } else {
    console.log("Nenhum servidor detectado. Marcando como FAIL.");
    tools.forEach(tool => {
      results.push({
        repositorio: repoName,
        ferramenta: tool,
        status: 'FAIL',
        violacoes_total: null,
        violacoes_A: null,
        violacoes_AA: null,
        violacoes_AAA: null,
        violacoes_indefinido: null,
        cer: null,
        taxa_sucesso_acessibilidade: null
      });
    });
    await saveCsv(results);
    process.exit(0);
  }
}

for (const tool of tools) {
  try {
    let res;
    if (tool === 'AXE') res = await runAxe(urlApp);
    else if (tool === 'Lighthouse') res = await runLighthouse(urlApp);
    else if (tool === 'WAVE') res = await runWaveExtension(urlApp);
    else if (tool === 'AChecker') res = await runACheckerLocal(urlApp);
    else continue;

    res.erros.forEach(e => allErrorsSet.add(e));
    results.push({
      repositorio: repoName,
      ferramenta: tool,
      status: 'OK',
      violacoes_total: res.violacoes,
      violacoes_A: res.nivelA,
      violacoes_AA: res.nivelAA,
      violacoes_AAA: res.nivelAAA,
      violacoes_indefinido: res.indefinido,
      cer: 0,
      taxa_sucesso_acessibilidade: ((WCAG_AUTOMATIZAVEL - res.violacoes) / WCAG_AUTOMATIZAVEL).toFixed(2)
    });
  } catch {
    results.push({
      repositorio: repoName,
      ferramenta: tool,
      status: 'FAIL',
      violacoes_total: null,
      violacoes_A: null,
      violacoes_AA: null,
      violacoes_AAA: null,
      violacoes_indefinido: null,
      cer: null,
      taxa_sucesso_acessibilidade: null
    });
  }
}

const totalDistinctErrors = allErrorsSet.size;
results.forEach(r => {
  if (r.status === 'OK' && totalDistinctErrors > 0) {
    r.cer = (r.violacoes_total / totalDistinctErrors).toFixed(2);
  }
});

await saveCsv(results);
})();

async function saveCsv(results) {
const csvWriter = createCsvWriter({
  path: 'resultados_acessibilidade.csv',
  header: [
    { id: 'repositorio', title: 'Repositorio' },
    { id: 'ferramenta', title: 'Ferramenta' },
    { id: 'status', title: 'Status' },
    { id: 'violacoes_total', title: 'ViolacoesTotal' },
    { id: 'violacoes_A', title: 'ViolacoesA' },
    { id: 'violacoes_AA', title: 'ViolacoesAA' },
    { id: 'violacoes_AAA', title: 'ViolacoesAAA' },
    { id: 'violacoes_indefinido', title: 'ViolacoesIndefinido' },
    { id: 'cer', title: 'CER' },
    { id: 'taxa_sucesso_acessibilidade', title: 'TaxaSucessoAcessibilidade' }
  ]
});
await csvWriter.writeRecords(results);
console.log('Resultados salvos em resultados_acessibilidade.csv');
}