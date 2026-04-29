import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL    = 'http://localhost:5173';
const ADMIN_EMAIL = 'admin@baia360.com';
const ADMIN_PASS  = 'Agucla*25';
const SS_DIR      = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

const results: { num: number; name: string; passed: boolean | null; obs?: string }[] = [];

function log(num: number, name: string, passed: boolean, obs = '') {
  results.push({ num, name, passed, obs });
  console.log(`\n### Teste #${num} - ${name}`);
  console.log(`  Resultado : ${passed ? '[PASS]' : '[FAIL]'}`);
  if (obs) console.log(`  Obs       : ${obs}`);
}
function skip(num: number, name: string, reason: string) {
  results.push({ num, name, passed: null, obs: reason });
  console.log(`\n### Teste #${num} - ${name}`);
  console.log(`  Resultado : [SKIP] - ${reason}`);
}
async function ss(page: any, name: string) {
  await page.screenshot({ path: path.join(SS_DIR, `${name}.png`), fullPage: false });
}

// Helper: faz login e aguarda hub
async function doLogin(page: any) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASS);
  await page.locator('button:has-text("Entrar"), button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

// Helper: navega para um modulo pelo texto visivel no hub
async function goToModule(page: any, texto: string): Promise<boolean> {
  // Busca por texto exato dentro de elementos clicaveis
  const el = page.locator(`text="${texto}"`).first();
  if (await el.count() === 0) return false;
  await el.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  return true;
}

// Helper: volta para o hub clicando no botao "← Baia 360"
// O app e uma SPA pura sem rotas de URL — goBack() nao funciona.
async function goBackToHub(page: any): Promise<void> {
  const backBtn = page.locator('button:has-text("Baia 360")').first();
  if (await backBtn.count() > 0) {
    await backBtn.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
  } else {
    // Fallback: re-login
    await doLogin(page);
  }
}

test.describe('Baia 360 - Browser + Security Tests', () => {

  // ── 3.1 Login ────────────────────────────────────────────────────
  test('3.1 - Fluxo de Login', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await ss(page, '01_login_inicial');

    const hasForm = await page.locator('input[type="password"]').count() > 0;
    log(101, '3.1a - Tela de login carregou', hasForm, `URL: ${page.url()}`);

    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASS);
    await page.locator('button:has-text("Entrar"), button[type="submit"]').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await ss(page, '02_hub_pos_login');

    const url = page.url();
    const notLogin = !url.includes('/login');
    log(102, '3.1b - Login redireciona para Hub', notLogin, `URL: ${url}`);

    // Verifica cards pelo texto visivel no hub
    const cards = ['Central de Relatórios', 'Atlas'];
    let found = 0;
    for (const c of cards) {
      if (await page.locator(`text="${c}"`).count() > 0) found++;
    }
    log(103, '3.1c - Cards do Hub visiveis', found >= 2, `${found}/${cards.length} cards encontrados`);

    // Nome do admin no header (Hub mostra usuario.nome completo)
    const hasAdmin = await page.locator('text=Administrador').count() > 0 ||
                     await page.locator('text=admin').count() > 0;
    log(104, '3.1d - Nome do admin no header', hasAdmin, `Administrador visivel: ${hasAdmin}`);
  });

  // ── 3.2 Cadastro ─────────────────────────────────────────────────
  test('3.2 - Fluxo de Cadastro', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Login tem <button onClick={onCadastro}>Criar conta</button> (nao <a>)
    const link = page.locator('button:has-text("Criar conta")').first();
    if (await link.count() === 0) { skip(201, '3.2 Cadastro', 'Botao Criar conta nao encontrado'); return; }

    await link.click();
    await page.waitForLoadState('networkidle');
    await ss(page, '04_cadastro_tela');
    log(201, '3.2a - Tela de cadastro abriu', true, `URL: ${page.url()}`);

    await page.locator('input[placeholder*="Nome"], input[placeholder*="nome"]').first().fill('Teste QA Browser');
    await page.locator('input[type="email"]').fill(`qa_browser_${Date.now()}@baia360.com`);
    await page.locator('input[type="password"]').first().fill('TesteQA@123!');
    const conf = page.locator('input[type="password"]').nth(1);
    if (await conf.count() > 0) await conf.fill('TesteQA@123!');

    await page.locator('button:has-text("Criar conta"), button[type="submit"]').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await ss(page, '05_cadastro_resultado');

    const body = await page.locator('body').innerText();
    const rateLimited = body.toLowerCase().includes('many') || body.toLowerCase().includes('429') || body.toLowerCase().includes('muitas');
    const success     = body.toLowerCase().includes('aprovação') || body.toLowerCase().includes('aguarde') ||
                        body.toLowerCase().includes('pendente') || body.toLowerCase().includes('sucesso') ||
                        body.toLowerCase().includes('administrador') || body.toLowerCase().includes('quase');

    if (rateLimited) {
      skip(202, '3.2b - Mensagem de sucesso', 'Rate limit de cadastro ativo (5/hora)');
    } else {
      log(202, '3.2b - Mensagem de sucesso/aprovacao', success,
          success ? 'Mensagem exibida' : `Resposta: ${body.substring(0, 120)}`);
    }
  });

  // ── 3.3 Navegacao Hub ────────────────────────────────────────────
  test('3.3 - Hub Navegacao', async ({ page }) => {
    await doLogin(page);
    await ss(page, '06_hub_navegacao');

    const modulos = [
      { texto: 'Central de Relatórios', num: 301 },
      { texto: 'Atlas',                 num: 302 },
      { texto: 'Agenda',                num: 303 },
      { texto: 'Painel de Controle',    num: 304 },
    ];

    for (const mod of modulos) {
      // Garante que estamos no hub antes de tentar navegar
      const noHub = await page.locator('text="Central de Relatórios"').count() > 0 ||
                    await page.locator('text="Atlas"').count() > 0;
      if (!noHub) await doLogin(page);

      const went = await goToModule(page, mod.texto);
      if (went) {
        const url = page.url();
        await ss(page, `hub_${mod.num}_${mod.texto.replace(/\s/g, '_')}`);
        log(mod.num, `3.3 - ${mod.texto} abriu`, true, `URL: ${url}`);
        // Volta ao hub pelo botao interno (SPA sem rotas de URL)
        await goBackToHub(page);
      } else {
        skip(mod.num, `3.3 - ${mod.texto}`, 'Texto nao encontrado no hub');
      }
    }
  });

  // ── 3.4 Atlas conversa ───────────────────────────────────────────
  test('3.4 - Atlas conversa basica', async ({ page }) => {
    await doLogin(page);

    const went = await goToModule(page, 'Atlas');
    if (!went) { skip(401, '3.4 Atlas', 'Card Atlas nao encontrado'); return; }
    await ss(page, '10_atlas_inicial');
    log(401, '3.4a - Atlas carregou', true, `URL: ${page.url()}`);

    const msgInput = page.locator('textarea, input[placeholder*="mensagem" i], input[placeholder*="Digite" i]').first();
    if (await msgInput.count() === 0) { skip(402, '3.4b Atlas mensagem', 'Campo de texto nao encontrado'); return; }

    // Filtra erros JS reais, ignora erros de rede (401, Failed to load resource)
    const consoleErrors: string[] = [];
    page.on('console', (m: any) => {
      if (m.type() === 'error') {
        const txt = m.text();
        if (!txt.includes('Failed to load resource') && !txt.includes('net::ERR')) {
          consoleErrors.push(txt);
        }
      }
    });

    await msgInput.fill('Ola, tudo bem?');
    await ss(page, '11_atlas_mensagem_escrita');
    await msgInput.press('Enter');

    // Aguarda resposta SSE (ate 30s)
    let hasReply = false;
    for (let i = 0; i < 30 && !hasReply; i++) {
      await page.waitForTimeout(1000);
      const all = await page.locator('body').innerText();
      hasReply = all.includes('Ola, tudo bem?') && all.length > 200;
    }
    await ss(page, '12_atlas_resposta');
    log(402, '3.4b - Atlas respondeu', hasReply, hasReply ? 'Resposta exibida' : 'Timeout 30s sem resposta');
    log(403, '3.4c - Sem erros JS criticos', consoleErrors.length === 0,
        consoleErrors.length > 0 ? consoleErrors.slice(0, 2).join(' | ') : 'nenhum erro JS');
  });

  // ── 3.5 Atlas historico ──────────────────────────────────────────
  test('3.5 - Atlas historico', async ({ page }) => {
    await doLogin(page);
    const went = await goToModule(page, 'Atlas');
    if (!went) { skip(501, '3.5 Atlas historico', 'Atlas nao encontrado'); return; }
    await page.waitForTimeout(1000);

    // Botao "Nova conversa" (sidebar do Atlas)
    const newBtn = page.locator('button:has-text("Nova conversa"), button:has-text("nova conversa"), button:has-text("Nova")').first();
    const hasNewBtn = await newBtn.count() > 0;
    log(501, '3.5a - Botao nova conversa existe', hasNewBtn, '');

    if (hasNewBtn) await newBtn.click();
    await page.waitForTimeout(500);
    await ss(page, '13_atlas_historico');

    // Sidebar do Atlas tem "Buscar conversas" e/ou "Projetos"
    const hasSidebar = await page.locator('text=Buscar conversas').count() > 0 ||
                       await page.locator('text=Projetos').count() > 0 ||
                       await page.locator('text=Nova conversa').count() > 0 ||
                       await page.locator('[class*="sidebar"], [class*="Sidebar"]').count() > 0;
    log(502, '3.5b - Sidebar/historico visivel', hasSidebar, `sidebar found: ${hasSidebar}`);
  });

  // ── 3.6 Central de Relatorios ────────────────────────────────────
  test('3.6 - Central de Relatorios', async ({ page }) => {
    await doLogin(page);
    const went = await goToModule(page, 'Central de Relatórios');
    if (!went) { skip(601, '3.6 Central', 'Card nao encontrado'); return; }
    await page.waitForTimeout(1000);
    await ss(page, '14_central_relatorios');

    const mods = ['Pedidos', 'Fretes', 'Armazenagem', 'Estoque', 'Recebimentos'];
    let found = 0;
    for (const m of mods) {
      if (await page.locator(`text=${m}`).count() > 0) found++;
    }
    log(601, `3.6 - Modulos visiveis na Central`, found >= 3, `${found}/${mods.length} modulos encontrados`);
  });

  // ── 3.7 Gestao de Usuarios ───────────────────────────────────────
  test('3.7 - Gestao de Usuarios', async ({ page }) => {
    await doLogin(page);

    // O hub admin tem card "Usuarios" na secao Administracao
    const went = await goToModule(page, 'Usuários');
    if (!went) {
      // Tenta texto alternativo
      const alt = await goToModule(page, 'Gestão');
      if (!alt) { skip(701, '3.7 Gestao Usuarios', 'Card Usuarios nao encontrado no hub'); return; }
    }
    await page.waitForTimeout(1000);
    await ss(page, '16_gestao_usuarios');

    const hasContent = await page.locator('table, [class*="table"], [class*="Table"]').count() > 0 ||
                       await page.locator('text=admin@baia360.com').count() > 0 ||
                       await page.locator('text=Usuários').count() > 0;
    log(701, '3.7 - Pagina de usuarios carregou', hasContent, `conteudo encontrado: ${hasContent}`);
  });

  // ── 3.8 Perfil ───────────────────────────────────────────────────
  test('3.8 - Perfil do usuario', async ({ page }) => {
    await doLogin(page);
    await ss(page, '17a_hub_perfil');

    // Hub header tem <button title="Meu perfil"> com usuario.nome
    const perfilBtn = page.locator('button[title="Meu perfil"], button:has-text("Administrador")').first();
    if (await perfilBtn.count() > 0) {
      await perfilBtn.click();
      await page.waitForTimeout(1200);
      await ss(page, '17b_perfil_aberto');
      const body = await page.locator('body').innerText();
      const hasEmail = body.includes(ADMIN_EMAIL);
      log(801, '3.8 - Perfil exibe email do usuario', hasEmail,
          hasEmail ? ADMIN_EMAIL : `email nao encontrado — trecho: ${body.substring(0, 150)}`);
    } else {
      skip(801, '3.8 Perfil', 'Botao de perfil nao encontrado no header do Hub');
    }
  });

  // ── 3.9 Responsividade ───────────────────────────────────────────
  test('3.9 - Responsividade', async ({ browser }) => {
    const sizes = [
      { w: 1920, h: 1080, tag: '1920x1080' },
      { w: 1366, h: 768,  tag: '1366x768'  },
      { w: 375,  h: 812,  tag: '375x812_mobile' },
    ];
    for (const [i, sz] of sizes.entries()) {
      const ctx = await browser.newContext({ viewport: { width: sz.w, height: sz.h } });
      const pg  = await ctx.newPage();
      await pg.goto(BASE_URL);
      await pg.waitForLoadState('networkidle');
      await pg.screenshot({ path: path.join(SS_DIR, `18_resp_${sz.tag}.png`) });
      const hasCrash = await pg.locator('text=Something went wrong').count() > 0 ||
                       await pg.locator('text=Error Boundary').count() > 0;
      log(900 + i, `3.9 - Responsividade ${sz.tag}`, !hasCrash, `${sz.w}x${sz.h} sem crash: ${!hasCrash}`);
      await ctx.close();
    }
  });

  // ── 3.10 Logout ─────────────────────────────────────────────────
  test('3.10 - Logout', async ({ page }) => {
    await doLogin(page);

    const sairBtn = page.locator('button:has-text("Sair")').first();
    if (await sairBtn.count() === 0) { skip(1001, '3.10 Logout', 'Botao Sair nao encontrado'); return; }

    await sairBtn.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
    await ss(page, '19_pos_logout');

    const url   = page.url();
    const hasPwd = await page.locator('input[type="password"]').count() > 0;
    log(1001, '3.10a - Logout redireciona para login', hasPwd, `URL: ${url} | tem campo senha: ${hasPwd}`);

    // Acesso direto sem token deve mostrar login
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    const isLogin = await page.locator('input[type="password"]').count() > 0;
    log(1002, '3.10b - Acesso direto sem token mostra login', isLogin, `campo senha: ${isLogin}`);
  });

  // ── 4.1 XSS ─────────────────────────────────────────────────────
  test('4.1 - XSS via Atlas', async ({ page }) => {
    await doLogin(page);
    const went = await goToModule(page, 'Atlas');
    if (!went) { skip(1101, '4.1 XSS', 'Atlas nao encontrado'); return; }
    await page.waitForTimeout(1000);

    const alerts: string[] = [];
    page.on('dialog', async (d: any) => { alerts.push(d.message()); await d.dismiss(); });

    const msgInput = page.locator('textarea, input[placeholder*="mensagem" i]').first();
    if (await msgInput.count() === 0) { skip(1101, '4.1 XSS', 'Campo texto nao encontrado'); return; }

    const xss = '<script>window.__XSS__=true;alert("xss")</script><img src=x onerror="window.__XSS2__=true">';
    await msgInput.fill(xss);
    await msgInput.press('Enter');
    await page.waitForTimeout(2000);
    await ss(page, '20_xss_atlas');

    const x1 = await page.evaluate(() => (window as any).__XSS__ === true);
    const x2 = await page.evaluate(() => (window as any).__XSS2__ === true);
    log(1101, '4.1 - XSS nao executado no Atlas', !x1 && !x2 && alerts.length === 0,
        `alert: ${alerts.length} | __XSS__: ${x1} | onerror: ${x2}`);
  });

  // ── 4.2 Token invalido ───────────────────────────────────────────
  test('4.2 - Token invalido redireciona', async ({ page }) => {
    await doLogin(page);

    await page.context().addCookies([{
      name: 'access_token_cookie', value: 'invalid.token.here',
      domain: 'localhost', path: '/'
    }]);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await ss(page, '21_token_invalido');

    const hasPwd = await page.locator('input[type="password"]').count() > 0;
    log(1201, '4.2 - Token invalido redireciona para login', hasPwd,
        `URL: ${page.url()} | campo senha: ${hasPwd}`);
  });

  // ── 4.3 Acesso direto sem login ──────────────────────────────────
  test('4.3 - Acesso direto sem login', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await ss(page, '22_acesso_sem_login');

    const hasPwd = await page.locator('input[type="password"]').count() > 0;
    log(1301, '4.3 - Sem login mostra tela de login', hasPwd, `URL: ${page.url()} | campo senha: ${hasPwd}`);
  });

  // ── Resumo ───────────────────────────────────────────────────────
  test.afterAll(() => {
    const p = results.filter(r => r.passed === true).length;
    const f = results.filter(r => r.passed === false).length;
    const s = results.filter(r => r.passed === null).length;
    console.log('\n' + '='.repeat(60));
    console.log('## RESUMO - FASES 3 e 4 (BROWSER)');
    console.log('='.repeat(60));
    console.log(`Total  : ${results.length}`);
    console.log(`[PASS] : ${p}`);
    console.log(`[FAIL] : ${f}`);
    console.log(`[SKIP] : ${s}`);
    results.filter(r => r.passed === false).forEach(r =>
      console.log(`  FAIL #${r.num} ${r.name} - ${r.obs}`)
    );
    results.filter(r => r.passed === null).forEach(r =>
      console.log(`  SKIP #${r.num} ${r.name} - ${r.obs}`)
    );
  });
});
