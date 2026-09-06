import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createGatewayCustomer,
  createGatewayPayout,
  DashboardApiError,
  listContexts,
  listGatewayAccounts,
  listGatewayAccountStatement,
  listGatewayCustomers,
  listGatewayPayouts,
  type DashboardEnvironment,
  type GatewayAccount,
  type GatewayCustomer,
  type GatewayPayout,
  type GatewayStatementItem,
  type MerchantContext,
} from './api.js';
import { currentSession, refreshSession, signOut } from './auth.js';

export type A30DashboardView = 'customers' | 'accounts' | 'payouts';

function money(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function date(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function withSessionRetry<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
  const session = await currentSession();
  if (!session) throw new DashboardApiError('session');
  try { return await operation(session.access_token); }
  catch (error) {
    if (!(error instanceof DashboardApiError) || error.category !== 'session') throw error;
    const refreshed = await refreshSession();
    if (!refreshed) throw error;
    return operation(refreshed.access_token);
  }
}

function title(view: A30DashboardView): string {
  if (view === 'customers') return 'Clientes';
  if (view === 'accounts') return 'Contas e saldo';
  return 'Transferências e saques';
}

function Navigation({ view }: { view: A30DashboardView }) {
  return (
    <nav className="sidebar-nav" aria-label="Navegação principal">
      <a href="/transactions">Transações</a>
      <a className={view === 'customers' ? 'active' : undefined} href="/customers">Clientes</a>
      <a className={view === 'accounts' ? 'active' : undefined} href="/accounts">Contas e saldo</a>
      <a className={view === 'payouts' ? 'active' : undefined} href="/payouts">Transferências / saques</a>
      <a href="/payment-links">Links de pagamento</a>
      <a href="/settings/api-credentials">Credenciais API</a>
      <a href="/settings/webhooks">Webhooks</a>
    </nav>
  );
}

export function A30OperationsView({ view }: { view: A30DashboardView }) {
  const [contexts, setContexts] = useState<readonly MerchantContext[]>([]);
  const [merchantId, setMerchantId] = useState('');
  const [environment, setEnvironment] = useState<DashboardEnvironment>('sandbox');
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<readonly GatewayCustomer[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerDocument, setCustomerDocument] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [accounts, setAccounts] = useState<readonly GatewayAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [statement, setStatement] = useState<readonly GatewayStatementItem[]>([]);

  const [payouts, setPayouts] = useState<readonly GatewayPayout[]>([]);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [pixKeyType, setPixKeyType] = useState<'cpf' | 'cnpj' | 'email' | 'phone' | 'random'>('cpf');
  const [pixKey, setPixKey] = useState('');

  const selectedContext = useMemo(
    () => contexts.find((item) => item.merchantId === merchantId) ?? null,
    [contexts, merchantId],
  );
  const canMutate = selectedContext?.membershipRole === 'admin' || selectedContext?.membershipRole === 'owner';

  useEffect(() => {
    let active = true;
    void withSessionRetry((token) => listContexts(token))
      .then((items) => {
        if (!active) return;
        setContexts(items);
        setMerchantId(items[0]?.merchantId ?? '');
        setLoading(false);
      })
      .catch(() => { if (active) { setError('Não foi possível carregar seus merchants.'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  async function reload(targetMerchant = merchantId, targetEnvironment = environment) {
    if (!targetMerchant) return;
    setLoading(true); setError(null);
    try {
      if (view === 'customers') {
        setCustomers(await withSessionRetry((token) => listGatewayCustomers({ accessToken: token, merchantId: targetMerchant, environment: targetEnvironment })));
      } else if (view === 'accounts') {
        const nextAccounts = await withSessionRetry((token) => listGatewayAccounts({ accessToken: token, merchantId: targetMerchant, environment: targetEnvironment }));
        setAccounts(nextAccounts);
        const targetAccount = nextAccounts.find((item) => item.id === selectedAccountId) ?? nextAccounts[0] ?? null;
        setSelectedAccountId(targetAccount?.id ?? null);
        if (targetAccount) {
          setStatement(await withSessionRetry((token) => listGatewayAccountStatement({ accessToken: token, merchantId: targetMerchant, environment: targetEnvironment, accountId: targetAccount.id })));
        } else setStatement([]);
      } else {
        setPayouts(await withSessionRetry((token) => listGatewayPayouts({ accessToken: token, merchantId: targetMerchant, environment: targetEnvironment })));
      }
    } catch {
      setError(`Não foi possível carregar ${title(view).toLowerCase()}.`);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (merchantId) void reload(merchantId, environment); }, [merchantId, environment, view]);

  async function chooseAccount(accountId: string) {
    setSelectedAccountId(accountId);
    if (!merchantId) return;
    setLoading(true); setError(null);
    try {
      setStatement(await withSessionRetry((token) => listGatewayAccountStatement({ accessToken: token, merchantId, environment, accountId })));
    } catch { setError('Não foi possível carregar o extrato desta conta.'); }
    finally { setLoading(false); }
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate || mutating) return;
    if (![customerName, customerDocument, customerEmail, customerPhone].some((value) => value.trim().length > 0)) {
      setError('Informe ao menos um dado do cliente.'); return;
    }
    setMutating(true); setError(null);
    try {
      await withSessionRetry((token) => createGatewayCustomer({
        accessToken: token,
        merchantId,
        environment,
        idempotencyKey: crypto.randomUUID(),
        ...(customerName.trim() ? { name: customerName.trim() } : {}),
        ...(customerDocument.trim() ? { document: customerDocument.trim() } : {}),
        ...(customerEmail.trim() ? { email: customerEmail.trim() } : {}),
        ...(customerPhone.trim() ? { phone: customerPhone.trim() } : {}),
      }));
      setCustomerName(''); setCustomerDocument(''); setCustomerEmail(''); setCustomerPhone('');
      await reload();
    } catch { setError('Não foi possível criar o cliente.'); }
    finally { setMutating(false); }
  }

  async function submitPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate || environment !== 'sandbox' || mutating) return;
    const amountCents = Number(payoutAmount);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1 || pixKey.trim().length === 0) {
      setError('Informe valor em centavos e uma chave Pix.'); return;
    }
    setMutating(true); setError(null);
    try {
      await withSessionRetry((token) => createGatewayPayout({
        accessToken: token,
        merchantId,
        environment,
        idempotencyKey: crypto.randomUUID(),
        amountCents,
        keyType: pixKeyType,
        pixKey: pixKey.trim(),
      }));
      setPayoutAmount(''); setPixKey('');
      await reload();
    } catch { setError('Não foi possível criar a transferência/saque. Verifique o saldo disponível.'); }
    finally { setMutating(false); }
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">S</span><span>SwiftPay</span></div>
        <Navigation view={view} />
        <button className="ghost-button" onClick={() => void signOut().then(() => { location.href = '/'; })}>Sair</button>
      </aside>

      <section className="content">
        <header className="page-header">
          <div><p className="eyebrow">Operação Pix</p><h1>{title(view)}</h1></div>
          <div className="context-controls">
            <select aria-label="Merchant" value={merchantId} onChange={(event) => setMerchantId(event.target.value)}>
              {contexts.map((item) => <option key={item.merchantId} value={item.merchantId}>{item.merchantName}</option>)}
            </select>
            <select aria-label="Ambiente" value={environment} onChange={(event) => setEnvironment(event.target.value as DashboardEnvironment)}>
              <option value="sandbox">Sandbox</option><option value="production">Produção</option>
            </select>
          </div>
        </header>

        {!canMutate && selectedContext ? <section className="state-card"><p>Seu papel permite consulta. Mutações exigem admin ou owner.</p></section> : null}
        {error ? <section className="state-card state-error" role="alert"><p>{error}</p></section> : null}

        {view === 'customers' ? (
          <section className="settings-grid">
            <form className="settings-card" onSubmit={submitCustomer}>
              <p className="eyebrow">Novo cliente</p><h2>Referência de pagador</h2>
              <label>Nome<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
              <label>Documento<input value={customerDocument} onChange={(event) => setCustomerDocument(event.target.value)} /></label>
              <label>E-mail<input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></label>
              <label>Telefone<input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></label>
              <button className="primary-button" disabled={!canMutate || mutating}>{mutating ? 'Salvando…' : 'Criar cliente'}</button>
            </form>
            <section className="settings-card">
              <p className="eyebrow">Clientes</p><h2>{loading ? 'Carregando…' : `${customers.length} cliente(s)`}</h2>
              <div className="settings-list">{customers.map((item) => (
                <article key={item.id} className="settings-row"><div><strong>{item.name || item.external_ref || item.id}</strong><p>{item.email || 'Sem e-mail'} · {item.phone || 'Sem telefone'}</p><small>Criado {date(item.created_at)}</small></div></article>
              ))}</div>
            </section>
          </section>
        ) : null}

        {view === 'accounts' ? (
          <section className="settings-grid">
            <section className="settings-card">
              <p className="eyebrow">Ledger</p><h2>{loading ? 'Carregando…' : `${accounts.length} conta(s)`}</h2>
              <div className="settings-list">{accounts.map((item) => (
                <article key={item.id} className="settings-row"><div><strong>{item.type}</strong><p>{money(item.balance_cents)}</p></div><button className="ghost-button" onClick={() => void chooseAccount(item.id)}>Extrato</button></article>
              ))}</div>
            </section>
            <section className="settings-card">
              <p className="eyebrow">Extrato imutável</p><h2>{statement.length} lançamento(s)</h2>
              <div className="settings-list">{statement.map((item) => (
                <article key={item.id} className="settings-row"><div><strong>{item.balance_effect === 'credit' ? '+' : '-'} {money(item.amount_cents)}</strong><p>{item.operation_type} · {item.source_type}</p><small>{date(item.occurred_at)}</small></div></article>
              ))}</div>
            </section>
          </section>
        ) : null}

        {view === 'payouts' ? (
          <section className="settings-grid">
            <form className="settings-card" onSubmit={submitPayout}>
              <p className="eyebrow">Nova saída</p><h2>Pix-out / saque</h2>
              {environment === 'production' ? <p className="muted">Produção permanece bloqueada até ativação do PSP real.</p> : null}
              <label>Valor em centavos<input inputMode="numeric" value={payoutAmount} onChange={(event) => setPayoutAmount(event.target.value)} placeholder="1000" required /></label>
              <label>Tipo de chave<select value={pixKeyType} onChange={(event) => setPixKeyType(event.target.value as typeof pixKeyType)}><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random">Aleatória</option></select></label>
              <label>Chave Pix<input value={pixKey} onChange={(event) => setPixKey(event.target.value)} required /></label>
              <button className="primary-button" disabled={!canMutate || environment !== 'sandbox' || mutating}>{mutating ? 'Processando…' : 'Criar transferência'}</button>
            </form>
            <section className="settings-card">
              <p className="eyebrow">Saídas</p><h2>{loading ? 'Carregando…' : `${payouts.length} operação(ões)`}</h2>
              <div className="settings-list">{payouts.map((item) => (
                <article key={item.id} className="settings-row"><div><strong>{money(item.amount_cents)}</strong><p>{item.state}</p><small>{date(item.created_at)}</small></div></article>
              ))}</div>
            </section>
          </section>
        ) : null}
      </section>
    </main>
  );
}
