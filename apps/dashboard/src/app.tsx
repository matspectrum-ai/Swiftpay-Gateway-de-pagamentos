import type { Session } from '@supabase/supabase-js';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DashboardApiError,
  getTransaction,
  listContexts,
  listTransactions,
  type DashboardEnvironment,
  type MerchantContext,
  type TransactionDetail,
  type TransactionListItem,
} from './api.js';
import { currentSession, onSessionChange, refreshSession, signIn, signOut } from './auth.js';

const CONTEXT_STORAGE_KEY = 'swiftpay.dashboard.context.v1';

type ViewError = 'session' | 'forbidden' | 'unavailable' | 'error' | null;

function errorCategory(error: unknown): ViewError {
  return error instanceof DashboardApiError ? error.category === 'not_found' ? 'error' : error.category : 'error';
}

function errorMessage(error: ViewError): string | null {
  switch (error) {
    case 'session': return 'Sessão expirada';
    case 'forbidden': return 'Acesso não autorizado';
    case 'unavailable': return 'Serviço temporariamente indisponível';
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
    creating: 'Criando',
    pending: 'Pendente',
    paid: 'Pago',
    expired: 'Expirado',
    failed: 'Falhou',
    cancelled: 'Cancelado',
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
  } catch {
    return null;
  }
}

function persistSelection(merchantId: string, environment: DashboardEnvironment): void {
  localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ merchantId, environment }));
}

async function withSessionRetry<T>(
  session: Session,
  replaceSession: (session: Session) => void,
  operation: (accessToken: string) => Promise<T>,
): Promise<T> {
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
    if (!result.session || result.error) {
      setInvalid(true);
      return;
    }
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
  return message ? <div className="state-card state-error" role="alert"><h2>{message}</h2><p>Tente novamente. Nenhum detalhe interno foi exposto.</p></div> : null;
}

export function App() {
  const [sessionLoading, setSessionLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [contexts, setContexts] = useState<readonly MerchantContext[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<ViewError>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<DashboardEnvironment>('sandbox');
  const [transactions, setTransactions] = useState<readonly TransactionListItem[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<ViewError>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNotFound, setDetailNotFound] = useState(false);
  const [detailError, setDetailError] = useState<ViewError>(null);

  useEffect(() => {
    let active = true;
    void currentSession().then((value) => {
      if (!active) return;
      setSession(value);
      setSessionLoading(false);
    });
    const unsubscribe = onSessionChange((value) => {
      if (!active) return;
      setSession(value);
      if (!value) {
        setContexts([]);
        setMerchantId(null);
        setTransactions([]);
        setDetail(null);
        history.replaceState(null, '', '/login');
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const loadContexts = useCallback(async (activeSession: Session) => {
    setContextLoading(true);
    setContextError(null);
    try {
      const items = await withSessionRetry(activeSession, setSession, (token) => listContexts(token));
      setContexts(items);
      const selected = storedSelection(items);
      const first = items[0];
      if (selected) {
        setMerchantId(selected.merchantId);
        setEnvironment(selected.environment);
      } else if (first) {
        setMerchantId(first.merchantId);
        setEnvironment('sandbox');
        persistSelection(first.merchantId, 'sandbox');
      } else {
        setMerchantId(null);
      }
      history.replaceState(null, '', '/transactions');
    } catch (error) {
      const category = errorCategory(error);
      setContextError(category);
      if (category === 'session') setSession(null);
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadContexts(session);
  }, [session?.user.id, loadContexts]);

  const activeContext = useMemo(
    () => contexts.find((item) => item.merchantId === merchantId) ?? null,
    [contexts, merchantId],
  );

  const loadTransactions = useCallback(async (cursor?: string, append = false) => {
    if (!session || !merchantId) return;
    setTransactionsLoading(true);
    setTransactionsError(null);
    try {
      const page = await withSessionRetry(session, setSession, (token) => listTransactions({
        accessToken: token,
        merchantId,
        environment,
        ...(cursor ? { cursor } : {}),
      }));
      setTransactions((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    } catch (error) {
      const category = errorCategory(error);
      setTransactionsError(category);
      if (category === 'session') setSession(null);
    } finally {
      setTransactionsLoading(false);
    }
  }, [session, merchantId, environment]);

  useEffect(() => {
    setTransactions([]);
    setDetail(null);
    setNextCursor(null);
    if (merchantId) void loadTransactions();
  }, [merchantId, environment, loadTransactions]);

  async function openDetail(transactionId: string) {
    if (!session || !merchantId) return;
    setDetailLoading(true);
    setDetail(null);
    setDetailNotFound(false);
    setDetailError(null);
    try {
      const value = await withSessionRetry(session, setSession, (token) => getTransaction({
        accessToken: token,
        merchantId,
        environment,
        transactionId,
      }));
      setDetail(value);
    } catch (error) {
      if (error instanceof DashboardApiError && error.category === 'not_found') setDetailNotFound(true);
      else {
        const category = errorCategory(error);
        setDetailError(category);
        if (category === 'session') setSession(null);
      }
    } finally {
      setDetailLoading(false);
    }
  }

  function chooseMerchant(value: string) {
    setMerchantId(value);
    setDetail(null);
    persistSelection(value, environment);
  }

  function chooseEnvironment(value: DashboardEnvironment) {
    setEnvironment(value);
    setDetail(null);
    if (merchantId) persistSelection(merchantId, value);
  }

  if (sessionLoading) return <main className="loading-screen"><div className="spinner" /><span>Validando sessão…</span></main>;
  if (!session) return <Login onAuthenticated={setSession} />;

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SwiftPay</span></div>
        <nav className="primary-nav" aria-label="Navegação principal">
          <button className="nav-item active"><span className="nav-icon">↗</span>Transações</button>
          <button className="nav-item" disabled><span className="nav-icon">⌁</span>Credenciais API <small>em breve</small></button>
          <button className="nav-item" disabled><span className="nav-icon">◎</span>Webhooks <small>em breve</small></button>
        </nav>
        <div className="sidebar-footer"><span className="safe-dot" /> Ambiente protegido</div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operação</p>
            <h1>Transações</h1>
          </div>
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
                <div className="context-field">
                  <label htmlFor="merchant">Merchant</label>
                  <select id="merchant" value={merchantId ?? ''} onChange={(event) => chooseMerchant(event.target.value)}>
                    {contexts.map((item) => <option key={item.merchantId} value={item.merchantId}>{item.merchantName}</option>)}
                  </select>
                </div>
                <div className="environment-switch" aria-label="Ambiente">
                  <button className={environment === 'sandbox' ? 'selected' : ''} onClick={() => chooseEnvironment('sandbox')}>Sandbox</button>
                  <button className={environment === 'production' ? 'selected' : ''} onClick={() => chooseEnvironment('production')}>Produção</button>
                </div>
                {activeContext ? (
                  <div className="context-meta">
                    <span className={`lifecycle ${activeContext.lifecycleStatus}`}>{activeContext.lifecycleStatus}</span>
                    <span>{activeContext.membershipRole}</span>
                  </div>
                ) : null}
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div><h2>Transações recentes</h2><p>Leitura do ambiente {environment === 'sandbox' ? 'Sandbox' : 'Produção'}.</p></div>
                  <span className="read-only-badge">Somente leitura</span>
                </div>
                <ErrorState value={transactionsError} />
                {transactionsLoading && transactions.length === 0 ? <div className="table-state">Carregando transações…</div> : null}
                {!transactionsLoading && !transactionsError && transactions.length === 0 ? <div className="table-state"><strong>Nenhuma transação</strong><span>Quando houver movimentação neste ambiente, ela aparecerá aqui.</span></div> : null}
                {transactions.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Transação</th><th>Status</th><th>Valor</th><th>Origem</th><th>Criada em</th><th /></tr></thead>
                      <tbody>
                        {transactions.map((item) => (
                          <tr key={item.id}>
                            <td><strong>{item.externalId ?? item.id.slice(0, 8)}</strong><span className="cell-subtle">{item.id}</span></td>
                            <td><span className={`status ${item.status}`}>{statusLabel(item.status)}</span></td>
                            <td>{formatMoney(item.amount)}</td>
                            <td>{item.source}</td>
                            <td>{formatDate(item.createdAt)}</td>
                            <td><button className="row-action" onClick={() => void openDetail(item.id)}>Ver detalhes</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {nextCursor ? <div className="pagination"><button className="ghost-button" disabled={transactionsLoading} onClick={() => void loadTransactions(nextCursor, true)}>Carregar mais</button></div> : null}
              </section>

              <section className="panel detail-panel">
                <div className="panel-header"><div><h2>Detalhe da transação</h2><p>Selecione uma transação para inspecionar o snapshot autorizado.</p></div></div>
                {detailLoading ? <div className="table-state">Carregando detalhe…</div> : null}
                {detailNotFound ? <div className="state-card"><h3>Transação não encontrada</h3><p>O recurso não existe neste contexto ou não está disponível para esta conta.</p></div> : null}
                <ErrorState value={detailError} />
                {detail ? (
                  <div className="detail-grid">
                    <div><span>ID</span><strong>{detail.id}</strong></div>
                    <div><span>Status</span><strong>{statusLabel(detail.status)}</strong></div>
                    <div><span>Valor bruto</span><strong>{formatMoney(detail.amount)}</strong></div>
                    <div><span>Taxa</span><strong>{formatMoney(detail.fee)}</strong></div>
                    <div><span>Valor líquido</span><strong>{formatMoney(detail.netAmount)}</strong></div>
                    <div><span>Pago em</span><strong>{formatDate(detail.paidAt)}</strong></div>
                    {detail.pix ? <div className="detail-wide"><span>Pix txId</span><strong>{detail.pix.txId}</strong></div> : null}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
