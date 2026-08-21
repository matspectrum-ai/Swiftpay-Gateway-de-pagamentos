import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createApiCredential,
  createWebhookEndpoint,
  DashboardApiError,
  disableWebhookEndpoint,
  enableWebhookEndpoint,
  getTransaction,
  listApiCredentials,
  listContexts,
  listTransactions,
  listWebhookEndpoints,
  revokeApiCredential,
  rotateApiCredentialSecret,
  rotateWebhookEndpointSecret,
  updateWebhookEndpoint,
  type ApiCredential,
  type DashboardApiErrorCategory,
  type DashboardEnvironment,
  type MerchantContext,
  type TransactionDetail,
  type TransactionListItem,
  type WebhookEndpoint,
} from './api.js';
import { currentSession, onSessionChange, refreshSession, signIn, signOut } from './auth.js';

const CONTEXT_STORAGE_KEY = 'swiftpay.dashboard.context.v1';
type DashboardView = 'transactions' | 'apiCredentials' | 'webhooks';
type ViewError = Exclude<DashboardApiErrorCategory, 'not_found'> | null;
type SecretReveal = { readonly kind: 'apiCredential' | 'webhook'; readonly label: string; readonly value: string } | null;

function routeView(pathname: string): DashboardView {
  if (pathname === '/settings/api-credentials') return 'apiCredentials';
  if (pathname === '/settings/webhooks') return 'webhooks';
  return 'transactions';
}

function viewPath(view: DashboardView): string {
  if (view === 'apiCredentials') return '/settings/api-credentials';
  if (view === 'webhooks') return '/settings/webhooks';
  return '/transactions';
}

function viewTitle(view: DashboardView): string {
  if (view === 'apiCredentials') return 'Credenciais API';
  if (view === 'webhooks') return 'Webhooks';
  return 'Transações';
}

function errorCategory(error: unknown): ViewError {
  if (!(error instanceof DashboardApiError)) return 'error';
  return error.category === 'not_found' ? 'error' : error.category;
}

function errorMessage(error: ViewError): string | null {
  switch (error) {
    case 'session': return 'Sessão expirada';
    case 'forbidden': return 'Acesso não autorizado';
    case 'unavailable': return 'Serviço temporariamente indisponível';
    case 'validation': return 'Revise os dados informados';
    case 'step_up': return 'Autenticação adicional necessária';
    case 'conflict': return 'Os dados mudaram. Atualize e tente novamente.';
    case 'error': return 'Não foi possível carregar os dados agora.';
    default: return null;
  }
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function statusLabel(status: TransactionListItem['status']): string {
  const labels: Record<TransactionListItem['status'], string> = {
    creating: 'Criando', pending: 'Pendente', paid: 'Pago', expired: 'Expirado', failed: 'Falhou', cancelled: 'Cancelado',
  };
  return labels[status];
}

function storedSelection(contexts: readonly MerchantContext[]): { merchantId: string; environment: DashboardEnvironment } | null {
  try {
    const raw = localStorage.getItem(CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { merchantId?: unknown; environment?: unknown };
    if (typeof parsed.merchantId !== 'string') return null;
    if (parsed.environment !== 'sandbox' && parsed.environment !== 'production') return null;
    if (!contexts.some((item) => item.merchantId === parsed.merchantId)) return null;
    return { merchantId: parsed.merchantId, environment: parsed.environment };
  } catch { return null; }
}

function persistSelection(merchantId: string, environment: DashboardEnvironment): void {
  localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ merchantId, environment }));
}

async function withSessionRetry<T>(session: Session, replaceSession: (session: Session) => void, operation: (accessToken: string) => Promise<T>): Promise<T> {
  try {
    return await operation(session.access_token);
  } catch (error) {
    if (!(error instanceof DashboardApiError) || error.category !== 'session') throw error;
    const refreshed = await refreshSession();
    if (!refreshed) throw error;
    replaceSession(refreshed);
    return operation(refreshed.access_token);
  }
}

function Login({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setInvalid(false);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (!result.session || result.error) { setInvalid(true); return; }
    onAuthenticated(result.session);
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand brand-login"><span className="brand-mark">S</span><span>SwiftPay</span></div>
        <p className="eyebrow">Merchant dashboard</p>
        <h1 id="login-title">Acesse sua operação</h1>
        <p className="muted">Transações, ambientes e integrações em uma visão segura da sua conta.</p>
        <form onSubmit={submit} className="login-form">
          <label>E-mail<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Senha<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {invalid ? <p className="inline-error" role="alert">Não foi possível autenticar com essas credenciais.</p> : null}
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="security-note">Sessão protegida pelo SwiftPay e Supabase Auth.</p>
      </section>
    </main>
  );
}

function EmptyAccess() {
  return <div className="state-card"><h2>Nenhum acesso de merchant</h2><p>Seu usuário não possui uma associação ativa a uma conta SwiftPay.</p></div>;
}

function ErrorState({ value }: { value: ViewError }) {
  const message = errorMessage(value);
  if (!message) return null;
  const detail = value === 'step_up'
    ? 'Conclua o segundo fator no Supabase Auth e tente a operação novamente.'
    : 'Tente novamente. Nenhum detalhe interno foi exposto.';
  return <div className="state-card state-error" role="alert"><h2>{message}</h2><p>{detail}</p></div>;
}

function SecretCard({ reveal, onDismiss }: { reveal: NonNullable<SecretReveal>; onDismiss: () => void }) {
  return (
    <section className="secret-card" aria-live="polite">
      <div><p className="eyebrow">Exibição única</p><h3>{reveal.label}</h3><p>Copie agora. Este segredo não é armazenado pelo dashboard e não será mostrado novamente.</p></div>
      <code>{reveal.value}</code>
      <div className="secret-actions">
        <button className="primary-button" onClick={() => void navigator.clipboard.writeText(reveal.value)}>Copiar</button>
        <button className="ghost-button" onClick={onDismiss}>Ocultar</button>
      </div>
    </section>
  );
}

export function App() {
  const [sessionLoading, setSessionLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<DashboardView>(() => routeView(location.pathname));
  const [contexts, setContexts] = useState<readonly MerchantContext[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<ViewError>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<DashboardEnvironment>('sandbox');
  const [secretReveal, setSecretReveal] = useState<SecretReveal>(null);

  const [transactions, setTransactions] = useState<readonly TransactionListItem[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<ViewError>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNotFound, setDetailNotFound] = useState(false);
  const [detailError, setDetailError] = useState<ViewError>(null);

  const [credentials, setCredentials] = useState<readonly ApiCredential[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);
  const [credentialsError, setCredentialsError] = useState<ViewError>(null);
  const [credentialName, setCredentialName] = useState('');
  const [credentialMutating, setCredentialMutating] = useState(false);

  const [webhooks, setWebhooks] = useState<readonly WebhookEndpoint[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksError, setWebhooksError] = useState<ViewError>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookMutating, setWebhookMutating] = useState(false);
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState('');

  useEffect(() => {
    let active = true;
    void currentSession().then((value) => { if (active) { setSession(value); setSessionLoading(false); } });
    const unsubscribe = onSessionChange((value) => {
      if (!active) return;
      setSession(value);
      if (!value) {
        setContexts([]); setMerchantId(null); setTransactions([]); setCredentials([]); setWebhooks([]); setSecretReveal(null);
        history.replaceState(null, '', '/login');
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const onPopState = () => { setSecretReveal(null); setView(routeView(location.pathname)); };
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  const loadContexts = useCallback(async (activeSession: Session) => {
    setContextLoading(true); setContextError(null);
    try {
      const items = await withSessionRetry(activeSession, setSession, (token) => listContexts(token));
      setContexts(items);
      const selected = storedSelection(items);
      const first = items[0];
      if (selected) { setMerchantId(selected.merchantId); setEnvironment(selected.environment); }
      else if (first) { setMerchantId(first.merchantId); setEnvironment('sandbox'); persistSelection(first.merchantId, 'sandbox'); }
      else setMerchantId(null);
      const nextView = routeView(location.pathname);
      setView(nextView);
      history.replaceState(null, '', viewPath(nextView));
    } catch (error) {
      const category = errorCategory(error); setContextError(category); if (category === 'session') setSession(null);
    } finally { setContextLoading(false); }
  }, []);

  useEffect(() => { if (session) void loadContexts(session); }, [session?.user.id, loadContexts]);

  const activeContext = useMemo(() => contexts.find((item) => item.merchantId === merchantId) ?? null, [contexts, merchantId]);
  const canMutateApiCredentials = activeContext !== null && (environment === 'production'
    ? activeContext.membershipRole === 'owner'
    : activeContext.membershipRole === 'admin' || activeContext.membershipRole === 'owner');
  const canMutateWebhooks = activeContext !== null && (activeContext.membershipRole === 'admin' || activeContext.membershipRole === 'owner');

  function navigate(next: DashboardView) {
    setSecretReveal(null); setView(next); history.pushState(null, '', viewPath(next));
  }

  function chooseMerchant(value: string) {
    setMerchantId(value); setDetail(null); setSecretReveal(null); setEditingEndpointId(null); persistSelection(value, environment);
  }

  function chooseEnvironment(value: DashboardEnvironment) {
    setEnvironment(value); setDetail(null); setSecretReveal(null); setEditingEndpointId(null); if (merchantId) persistSelection(merchantId, value);
  }

  const loadTransactions = useCallback(async (cursor?: string, append = false) => {
    if (!session || !merchantId) return;
    setTransactionsLoading(true); setTransactionsError(null);
    try {
      const page = await withSessionRetry(session, setSession, (token) => listTransactions({ accessToken: token, merchantId, environment, ...(cursor ? { cursor } : {}) }));
      setTransactions((current) => append ? [...current, ...page.items] : page.items); setNextCursor(page.nextCursor);
    } catch (error) {
      const category = errorCategory(error); setTransactionsError(category); if (category === 'session') setSession(null);
    } finally { setTransactionsLoading(false); }
  }, [session, merchantId, environment]);

  const loadCredentials = useCallback(async () => {
    if (!session || !merchantId) return;
    setCredentialsLoading(true); setCredentialsError(null);
    try {
      const items = await withSessionRetry(session, setSession, (token) => listApiCredentials({ accessToken: token, merchantId, environment }));
      setCredentials(items);
    } catch (error) {
      const category = errorCategory(error); setCredentialsError(category); if (category === 'session') setSession(null);
    } finally { setCredentialsLoading(false); }
  }, [session, merchantId, environment]);

  const loadWebhooks = useCallback(async () => {
    if (!session || !merchantId) return;
    setWebhooksLoading(true); setWebhooksError(null);
    try {
      const items = await withSessionRetry(session, setSession, (token) => listWebhookEndpoints({ accessToken: token, merchantId, environment }));
      setWebhooks(items);
    } catch (error) {
      const category = errorCategory(error); setWebhooksError(category); if (category === 'session') setSession(null);
    } finally { setWebhooksLoading(false); }
  }, [session, merchantId, environment]);

  useEffect(() => {
    setTransactions([]); setDetail(null); setNextCursor(null);
    if (view === 'transactions' && merchantId) void loadTransactions();
  }, [merchantId, environment, view, loadTransactions]);
  useEffect(() => { if (view === 'apiCredentials' && merchantId) void loadCredentials(); }, [merchantId, environment, view, loadCredentials]);
  useEffect(() => { if (view === 'webhooks' && merchantId) void loadWebhooks(); }, [merchantId, environment, view, loadWebhooks]);

  async function openDetail(transactionId: string) {
    if (!session || !merchantId) return;
    setDetailLoading(true); setDetail(null); setDetailNotFound(false); setDetailError(null);
    try {
      const value = await withSessionRetry(session, setSession, (token) => getTransaction({ accessToken: token, merchantId, environment, transactionId }));
      setDetail(value);
    } catch (error) {
      if (error instanceof DashboardApiError && error.category === 'not_found') setDetailNotFound(true);
      else { const category = errorCategory(error); setDetailError(category); if (category === 'session') setSession(null); }
    } finally { setDetailLoading(false); }
  }

  async function submitCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !merchantId || !canMutateApiCredentials || credentialMutating) return;
    const name = credentialName.trim(); if (!name) return;
    const idempotencyKey = crypto.randomUUID();
    setCredentialMutating(true); setCredentialsError(null); setSecretReveal(null);
    try {
      const result = await withSessionRetry(session, setSession, (accessToken) => createApiCredential({ accessToken, merchantId, environment, idempotencyKey, name }));
      setCredentialName('');
      setCredentials((current) => [result.credential, ...current.filter((item) => item.id !== result.credential.id)]);
      if (result.secretAvailable && result.secretKey) setSecretReveal({ kind: 'apiCredential', label: `Secret Key — ${result.credential.name}`, value: result.secretKey });
    } catch (error) { const category = errorCategory(error); setCredentialsError(category); if (category === 'session') setSession(null); }
    finally { setCredentialMutating(false); }
  }

  async function rotateCredential(item: ApiCredential) {
    if (!session || !merchantId || !canMutateApiCredentials || credentialMutating) return;
    const idempotencyKey = crypto.randomUUID();
    setCredentialMutating(true); setCredentialsError(null); setSecretReveal(null);
    try {
      const result = await withSessionRetry(session, setSession, (accessToken) => rotateApiCredentialSecret({ accessToken, merchantId, environment, credentialId: item.id, expectedRevision: item.revision, idempotencyKey }));
      setCredentials((current) => current.map((entry) => entry.id === item.id ? result.credential : entry));
      if (result.secretAvailable && result.secretKey) setSecretReveal({ kind: 'apiCredential', label: `Novo Secret Key — ${result.credential.name}`, value: result.secretKey });
    } catch (error) { const category = errorCategory(error); setCredentialsError(category); if (category === 'session') setSession(null); }
    finally { setCredentialMutating(false); }
  }

  async function revokeCredential(item: ApiCredential) {
    if (!session || !merchantId || !canMutateApiCredentials || credentialMutating) return;
    const idempotencyKey = crypto.randomUUID();
    setCredentialMutating(true); setCredentialsError(null); setSecretReveal(null);
    try {
      const result = await withSessionRetry(session, setSession, (accessToken) => revokeApiCredential({ accessToken, merchantId, environment, credentialId: item.id, expectedRevision: item.revision, idempotencyKey }));
      setCredentials((current) => current.map((entry) => entry.id === item.id ? result.credential : entry));
    } catch (error) { const category = errorCategory(error); setCredentialsError(category); if (category === 'session') setSession(null); }
    finally { setCredentialMutating(false); }
  }

  async function submitWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !merchantId || !canMutateWebhooks || webhookMutating) return;
    const url = webhookUrl.trim(); if (!url) return;
    const idempotencyKey = crypto.randomUUID();
    setWebhookMutating(true); setWebhooksError(null); setSecretReveal(null);
    try {
      const result = await withSessionRetry(session, setSession, (accessToken) => createWebhookEndpoint({ accessToken, merchantId, environment, idempotencyKey, url }));
      setWebhookUrl('');
      setWebhooks((current) => [result.endpoint, ...current.filter((item) => item.id !== result.endpoint.id)]);
      if (result.secretAvailable && result.signingSecret) setSecretReveal({ kind: 'webhook', label: 'Signing Secret do webhook', value: result.signingSecret });
    } catch (error) { const category = errorCategory(error); setWebhooksError(category); if (category === 'session') setSession(null); }
    finally { setWebhookMutating(false); }
  }

  async function changeWebhookState(endpoint: WebhookEndpoint, operation: 'disable' | 'enable') {
    if (!session || !merchantId || !canMutateWebhooks || webhookMutating) return;
    const idempotencyKey = crypto.randomUUID();
    setWebhookMutating(true); setWebhooksError(null); setSecretReveal(null);
    try {
      const updated = await withSessionRetry(session, setSession, (accessToken) => operation === 'disable'
        ? disableWebhookEndpoint({ accessToken, merchantId, environment, endpointId: endpoint.id, expectedRevision: endpoint.revision, idempotencyKey })
        : enableWebhookEndpoint({ accessToken, merchantId, environment, endpointId: endpoint.id, expectedRevision: endpoint.revision, idempotencyKey }));
      setWebhooks((current) => current.map((item) => item.id === endpoint.id ? updated : item));
      setEditingEndpointId(null);
    } catch (error) { const category = errorCategory(error); setWebhooksError(category); if (category === 'session') setSession(null); }
    finally { setWebhookMutating(false); }
  }

  async function saveWebhookUrl(endpoint: WebhookEndpoint) {
    if (!session || !merchantId || !canMutateWebhooks || endpoint.status !== 'disabled' || webhookMutating) return;
    const url = editingUrl.trim(); if (!url) return;
    const idempotencyKey = crypto.randomUUID();
    setWebhookMutating(true); setWebhooksError(null); setSecretReveal(null);
    try {
      const updated = await withSessionRetry(session, setSession, (accessToken) => updateWebhookEndpoint({ accessToken, merchantId, environment, endpointId: endpoint.id, expectedRevision: endpoint.revision, idempotencyKey, url }));
      setWebhooks((current) => current.map((item) => item.id === endpoint.id ? updated : item));
      setEditingEndpointId(null); setEditingUrl('');
    } catch (error) { const category = errorCategory(error); setWebhooksError(category); if (category === 'session') setSession(null); }
    finally { setWebhookMutating(false); }
  }

  async function rotateWebhook(endpoint: WebhookEndpoint) {
    if (!session || !merchantId || !canMutateWebhooks || webhookMutating) return;
    const idempotencyKey = crypto.randomUUID();
    setWebhookMutating(true); setWebhooksError(null); setSecretReveal(null);
    try {
      const result = await withSessionRetry(session, setSession, (accessToken) => rotateWebhookEndpointSecret({ accessToken, merchantId, environment, endpointId: endpoint.id, expectedRevision: endpoint.revision, idempotencyKey }));
      setWebhooks((current) => current.map((item) => item.id === endpoint.id ? result.endpoint : item));
      if (result.secretAvailable && result.signingSecret) setSecretReveal({ kind: 'webhook', label: 'Novo Signing Secret do webhook', value: result.signingSecret });
    } catch (error) { const category = errorCategory(error); setWebhooksError(category); if (category === 'session') setSession(null); }
    finally { setWebhookMutating(false); }
  }

  if (sessionLoading) return <main className="loading-screen"><div className="spinner" /><span>Validando sessão…</span></main>;
  if (!session) return <Login onAuthenticated={setSession} />;

  const activeSettingsError = view === 'apiCredentials' ? credentialsError : webhooksError;

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SwiftPay</span></div>
        <nav className="primary-nav" aria-label="Navegação principal">
          <button className={`nav-item ${view === 'transactions' ? 'active' : ''}`} onClick={() => navigate('transactions')}>Transações</button>
          <button className={`nav-item ${view === 'apiCredentials' ? 'active' : ''}`} onClick={() => navigate('apiCredentials')}>Credenciais API</button>
          <button className={`nav-item ${view === 'webhooks' ? 'active' : ''}`} onClick={() => navigate('webhooks')}>Webhooks</button>
        </nav>
        <div className="sidebar-footer"><span className="safe-dot" /> Ambiente protegido</div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">Operação</p><h1>{viewTitle(view)}</h1></div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={() => void loadContexts(session)}>Atualizar</button>
            <button className="ghost-button" onClick={() => void signOut()}>Sair</button>
          </div>
        </header>

        <main className="content">
          {contextLoading ? <div className="state-card">Carregando seus merchants…</div> : null}
          <ErrorState value={contextError} />
          {!contextLoading && !contextError && contexts.length === 0 ? <EmptyAccess /> : null}

          {contexts.length > 0 ? (
            <>
              <section className="context-bar" aria-label="Contexto operacional">
                <div className="context-field"><label htmlFor="merchant">Merchant</label><select id="merchant" value={merchantId ?? ''} onChange={(event) => chooseMerchant(event.target.value)}>{contexts.map((item) => <option key={item.merchantId} value={item.merchantId}>{item.merchantName}</option>)}</select></div>
                <div className="environment-switch" aria-label="Ambiente"><button className={environment === 'sandbox' ? 'selected' : ''} onClick={() => chooseEnvironment('sandbox')}>Sandbox</button><button className={environment === 'production' ? 'selected' : ''} onClick={() => chooseEnvironment('production')}>Produção</button></div>
                {activeContext ? <div className="context-meta"><span className={`lifecycle ${activeContext.lifecycleStatus}`}>{activeContext.lifecycleStatus}</span><span>{activeContext.membershipRole}</span></div> : null}
              </section>

              {secretReveal ? <SecretCard reveal={secretReveal} onDismiss={() => setSecretReveal(null)} /> : null}

              {view === 'transactions' ? (
                <>
                  <section className="panel">
                    <div className="panel-header"><div><h2>Transações recentes</h2><p>Leitura do ambiente {environment === 'sandbox' ? 'Sandbox' : 'Produção'}.</p></div><span className="read-only-badge">Somente leitura</span></div>
                    <ErrorState value={transactionsError} />
                    {transactionsLoading && transactions.length === 0 ? <div className="table-state">Carregando transações…</div> : null}
                    {!transactionsLoading && !transactionsError && transactions.length === 0 ? <div className="table-state"><strong>Nenhuma transação</strong><span>Quando houver movimentação neste ambiente, ela aparecerá aqui.</span></div> : null}
                    {transactions.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Transação</th><th>Status</th><th>Valor</th><th>Origem</th><th>Criada em</th><th /></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><strong>{item.externalId ?? item.id.slice(0, 8)}</strong><span className="cell-subtle">{item.id}</span></td><td><span className={`status ${item.status}`}>{statusLabel(item.status)}</span></td><td>{formatMoney(item.amount)}</td><td>{item.source}</td><td>{formatDate(item.createdAt)}</td><td><button className="row-action" onClick={() => void openDetail(item.id)}>Ver detalhes</button></td></tr>)}</tbody></table></div> : null}
                    {nextCursor ? <div className="pagination"><button className="ghost-button" disabled={transactionsLoading} onClick={() => void loadTransactions(nextCursor, true)}>Carregar mais</button></div> : null}
                  </section>
                  <section className="panel detail-panel">
                    <div className="panel-header"><div><h2>Detalhe da transação</h2><p>Selecione uma transação para inspecionar o snapshot autorizado.</p></div></div>
                    {detailLoading ? <div className="table-state">Carregando detalhe…</div> : null}
                    {detailNotFound ? <div className="state-card"><h3>Transação não encontrada</h3><p>O recurso não existe neste contexto ou não está disponível para esta conta.</p></div> : null}
                    <ErrorState value={detailError} />
                    {detail ? <div className="detail-grid"><div><span>ID</span><strong>{detail.id}</strong></div><div><span>Status</span><strong>{statusLabel(detail.status)}</strong></div><div><span>Valor bruto</span><strong>{formatMoney(detail.amount)}</strong></div><div><span>Taxa</span><strong>{formatMoney(detail.fee)}</strong></div><div><span>Valor líquido</span><strong>{formatMoney(detail.netAmount)}</strong></div><div><span>Pago em</span><strong>{formatDate(detail.paidAt)}</strong></div>{detail.pix ? <div className="detail-wide"><span>Pix txId</span><strong>{detail.pix.txId}</strong></div> : null}</div> : null}
                  </section>
                </>
              ) : null}

              {view === 'apiCredentials' ? (
                <section className="panel settings-panel">
                  <div className="panel-header"><div><h2>Credenciais API</h2><p>Chaves de integração do ambiente selecionado. O backend continua sendo a autoridade de AAL2 e permissões.</p></div>{canMutateApiCredentials ? null : <span className="read-only-badge">Somente leitura</span>}</div>
                  <ErrorState value={activeSettingsError} />
                  {canMutateApiCredentials ? <form className="settings-form" onSubmit={submitCredential}><label>Nome da credencial<input value={credentialName} maxLength={120} onChange={(event) => setCredentialName(event.target.value)} placeholder="Ex.: integração produção" required /></label><button className="primary-button" disabled={credentialMutating}>Criar credencial</button></form> : <p className="muted">Seu papel atual permite consultar, mas não alterar credenciais neste ambiente.</p>}
                  {credentialsLoading ? <div className="table-state">Carregando credenciais…</div> : null}
                  {!credentialsLoading && credentials.length === 0 ? <div className="table-state"><strong>Nenhuma credencial</strong><span>Crie uma credencial quando precisar integrar um sistema.</span></div> : null}
                  {credentials.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Public Key</th><th>Status</th><th>Último uso</th><th>Ações</th></tr></thead><tbody>{credentials.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><span className="cell-subtle">rev. {item.revision} · secret v{item.secretVersion}</span></td><td><code>{item.publicKey}</code></td><td>{item.status}</td><td>{formatDate(item.lastUsedAt)}</td><td><div className="row-actions">{canMutateApiCredentials && item.status === 'active' ? <><button className="row-action" disabled={credentialMutating} onClick={() => void rotateCredential(item)}>Rotacionar segredo</button><button className="row-action danger" disabled={credentialMutating} onClick={() => void revokeCredential(item)}>Revogar</button></> : <span className="cell-subtle">Somente leitura</span>}</div></td></tr>)}</tbody></table></div> : null}
                </section>
              ) : null}

              {view === 'webhooks' ? (
                <section className="panel settings-panel">
                  <div className="panel-header"><div><h2>Webhooks</h2><p>Endpoints HTTPS para o evento <code>payment.paid</code>. Alterações continuam validadas e autorizadas pelo A7.</p></div>{canMutateWebhooks ? null : <span className="read-only-badge">Somente leitura</span>}</div>
                  <ErrorState value={activeSettingsError} />
                  {canMutateWebhooks ? <form className="settings-form" onSubmit={submitWebhook}><label>URL HTTPS<input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhooks/swiftpay" required /></label><label>Evento<input value="payment.paid" readOnly /></label><button className="primary-button" disabled={webhookMutating}>Criar webhook</button></form> : <p className="muted">Seu papel atual permite consultar, mas não alterar endpoints.</p>}
                  {webhooksLoading ? <div className="table-state">Carregando webhooks…</div> : null}
                  {!webhooksLoading && webhooks.length === 0 ? <div className="table-state"><strong>Nenhum webhook</strong><span>Cadastre um endpoint para receber eventos de pagamento.</span></div> : null}
                  <div className="settings-list">{webhooks.map((endpoint) => <article className="settings-card" key={endpoint.id}><div className="settings-card-head"><div><strong>{endpoint.url}</strong><span className="cell-subtle">{endpoint.subscribedEvents.join(', ')} · rev. {endpoint.revision}</span></div><span className={`status ${endpoint.status}`}>{endpoint.status}</span></div>{editingEndpointId === endpoint.id && endpoint.status === 'disabled' ? <div className="inline-edit"><input type="url" value={editingUrl} onChange={(event) => setEditingUrl(event.target.value)} /><button className="primary-button" disabled={webhookMutating} onClick={() => void saveWebhookUrl(endpoint)}>Salvar URL</button><button className="ghost-button" onClick={() => setEditingEndpointId(null)}>Cancelar</button></div> : null}<div className="row-actions">{canMutateWebhooks ? <>{endpoint.status === 'active' ? <button className="ghost-button" disabled={webhookMutating} onClick={() => void changeWebhookState(endpoint, 'disable')}>Desativar</button> : <><button className="ghost-button" disabled={webhookMutating} onClick={() => void changeWebhookState(endpoint, 'enable')}>Ativar</button><button className="ghost-button" disabled={webhookMutating} onClick={() => { setEditingEndpointId(endpoint.id); setEditingUrl(endpoint.url); }}>Editar URL</button></>}<button className="ghost-button" disabled={webhookMutating} onClick={() => void rotateWebhook(endpoint)}>Rotacionar segredo</button></> : <span className="read-only-badge">Somente leitura</span>}</div></article>)}</div>
                </section>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
