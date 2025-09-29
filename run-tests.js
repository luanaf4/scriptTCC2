const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
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
const WCAG_AUTOMATIZAVEL = Math.round(WCAG_TOTAL_CRITERIA * 0.44); // ~26 critérios

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
  return { violacoes: 0, warnings: 0, erros: [], nivelA: 0, nivelAA: 0, nivelAAA: 0, indefinido: 0 };
}
}

async function saveCsv(results) {
const csvWriter = createCsvWriter({
  path: 'resultados_acessibilidade.csv',
  header: [
    { id: 'repositorio', title: 'Repositorio' },
    { id: 'ferramenta', title: 'Ferramenta' },
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

(async () => {
const repos = [];

// 📌 Leitura adaptada para JSON
const reposData = JSON.parse(fs.readFileSync('filtrados.json', 'utf8'));

reposData.forEach(r => {
  repos.push(r["Repositório"]);
});

console.log(`📊 Total de repositórios para testar: ${repos.length}`);

const results = [];
const toolErrorsMap = {};

for (const repoName of repos) {
  try {
    const urlApp = await detectLocalUrl();
    if (!urlApp) {
      results.push({
        repositorio: repoName,
        ferramenta: 'AXE',
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

    const res = await runAxe(urlApp);
    toolErrorsMap['AXE'] = new Set(res.erros);

    results.push({
      repositorio: repoName,
      ferramenta: 'AXE',
      status: 'OK',
      violacoes_total: res.violacoes,
      warnings_total: res.warnings,
      violacoes_A: res.nivelA,
      violacoes_AA: res.nivelAA,
      violacoes_AAA: res.nivelAAA,
      violacoes_indefinido: res.indefinido,
      criterios_total: WCAG_TOTAL_CRITERIA,
      criterios_automatizaveis: WCAG_AUTOMATIZAVEL,
      cer: 0, // será calculado depois
      taxa_sucesso_acessibilidade: ((WCAG_AUTOMATIZAVEL - res.violacoes) / WCAG_AUTOMATIZAVEL).toFixed(2)
    });
  } catch (err) {
    console.error(`❌ Erro no repo ${repoName}: ${err.message}`);
  }
}

// 📌 Cálculo do CER
// Fórmula: CER = erros únicos da ferramenta / erros únicos de todas as ferramentas
// Por hora, como estamos usando apenas uma ferramenta (AXE),
// o conjunto global de erros é igual ao conjunto da ferramenta,
// então o CER sempre será 1.00 (100%).
const allErrorsGlobal = new Set();
Object.values(toolErrorsMap).forEach(set => {
  set.forEach(err => allErrorsGlobal.add(err));
});

results.forEach(r => {
  if (r.status === 'OK' && allErrorsGlobal.size > 0) {
    const toolSet = toolErrorsMap[r.ferramenta] || new Set();
    r.cer = (toolSet.size / allErrorsGlobal.size).toFixed(2);
  }
});

await saveCsv(results);
})();
